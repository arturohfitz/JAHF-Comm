import { createHash } from "node:crypto";

import {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationSeverity,
  Prisma,
  prisma
} from "./index.js";
import { customerAlertSource } from "./customer-alerts.js";
import { isValidHHmm, isValidTimezone } from "./notification-preferences.js";

export const notificationDeliverySource = "WHATSAPP_ALERT_DRY_RUN";
const maxMessageLength = 1800;
const defaultOutboundTimeoutMs = 15000;
const defaultProcessingStaleMinutes = 15;
const defaultMaxRetries = 3;
const defaultBackoffSeconds = 60;

export type WhatsappAlertRuntimeMode = "DISABLED" | "DRY_RUN" | "LIVE";

export type WhatsappAlertRuntimeState = {
  enabled: boolean;
  dryRun: boolean;
  mode: WhatsappAlertRuntimeMode;
};

export type WhatsappAlertRuntimeConfig = WhatsappAlertRuntimeState & {
  timeoutMs: number;
  processingStaleMinutes: number;
  maxRetries: number;
  backoffSeconds: number;
};

export type ClaimedWhatsappDeliveryContext = {
  deliveryId: string;
  tenantId: string;
  notificationId: string;
  destination: string;
  instanceName: string;
  text: string;
  metadata: Prisma.InputJsonObject;
};

const severityRank: Record<NotificationSeverity, number> = {
  [NotificationSeverity.LOW]: 1,
  [NotificationSeverity.MEDIUM]: 2,
  [NotificationSeverity.HIGH]: 3,
  [NotificationSeverity.URGENT]: 4
};

const terminalDeliveryStatuses = new Set<NotificationDeliveryStatus>([
  NotificationDeliveryStatus.SENT,
  NotificationDeliveryStatus.DRY_RUN,
  NotificationDeliveryStatus.SKIPPED,
  NotificationDeliveryStatus.UNKNOWN
]);

export class RetryableWhatsappDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableWhatsappDeliveryError";
  }
}

function readBooleanEnv(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === "") {
    return fallback;
  }

  return value.toLowerCase() === "true";
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getWhatsappAlertRuntimeState(
  env: NodeJS.ProcessEnv = process.env
): WhatsappAlertRuntimeState {
  const enabled = readBooleanEnv(env.WHATSAPP_ALERTS_ENABLED, false);
  const dryRun = readBooleanEnv(env.WHATSAPP_ALERTS_DRY_RUN, true);

  return {
    enabled,
    dryRun,
    mode: !enabled ? "DISABLED" : dryRun ? "DRY_RUN" : "LIVE"
  };
}

export function getWhatsappAlertRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): WhatsappAlertRuntimeConfig {
  return {
    ...getWhatsappAlertRuntimeState(env),
    timeoutMs: readPositiveInteger(
      env.EVOLUTION_OUTBOUND_TIMEOUT_MS,
      defaultOutboundTimeoutMs
    ),
    processingStaleMinutes: readPositiveInteger(
      env.WHATSAPP_ALERT_PROCESSING_STALE_MINUTES,
      defaultProcessingStaleMinutes
    ),
    maxRetries: readPositiveInteger(
      env.WHATSAPP_ALERT_MAX_RETRIES,
      defaultMaxRetries
    ),
    backoffSeconds: readPositiveInteger(
      env.WHATSAPP_ALERT_BACKOFF_SECONDS,
      defaultBackoffSeconds
    )
  };
}

export function calculateWhatsappRetryAt(input: {
  attemptCount: number;
  backoffSeconds?: number;
  now?: Date;
}) {
  const backoffSeconds = input.backoffSeconds ?? defaultBackoffSeconds;
  const exponent = Math.max(input.attemptCount - 1, 0);
  const delaySeconds = backoffSeconds * 2 ** exponent;

  return new Date((input.now ?? new Date()).getTime() + delaySeconds * 1000);
}

function isTerminalDeliveryStatus(status: NotificationDeliveryStatus) {
  return terminalDeliveryStatuses.has(status);
}

type DeliveryDecision =
  | {
      status: typeof NotificationDeliveryStatus.SKIPPED;
      code: string;
      message: string;
      nextAttemptAt?: null;
    }
  | {
      status: typeof NotificationDeliveryStatus.PENDING;
      code: string;
      message: string;
      nextAttemptAt: Date;
    }
  | {
      status: typeof NotificationDeliveryStatus.DRY_RUN;
      code: null;
      message: null;
      nextAttemptAt?: null;
    };

type DeliveryActionDecision =
  | DeliveryDecision
  | {
      status: typeof NotificationDeliveryStatus.PENDING;
      code: null;
      message: null;
      nextAttemptAt?: null;
    };

type NotificationMetadata = {
  source?: unknown;
  rules?: unknown;
  contactId?: unknown;
  conversationId?: unknown;
  triggerMessageId?: unknown;
  returnType?: unknown;
  inactivityMinutes?: unknown;
  hasRegisteredSale?: unknown;
  salesCount?: unknown;
  openSupportTicketsCount?: unknown;
  intent?: unknown;
  priority?: unknown;
  sentiment?: unknown;
  href?: unknown;
};

function readMetadata(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as NotificationMetadata)
    : {};
}

function readString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function truncate(value: string | null | undefined, maxLength: number) {
  if (!value) {
    return "";
  }

  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function maskDestination(value: string) {
  if (value.length <= 4) {
    return "****";
  }

  return `${"*".repeat(Math.max(value.length - 4, 0))}${value.slice(-4)}`;
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function joinUrl(baseUrl: string | undefined, href: string | null) {
  if (!baseUrl || !href) {
    return null;
  }

  return `${baseUrl.replace(/\/$/, "")}${href.startsWith("/") ? href : `/${href}`}`;
}

function getLocalTimeParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour") % 24,
    minute: value("minute")
  };
}

function localMinutes(date: Date, timezone: string) {
  const parts = getLocalTimeParts(date, timezone);

  return parts.hour * 60 + parts.minute;
}

function parseHHmm(value: string) {
  const [hours, minutes] = value.split(":").map(Number);

  return hours * 60 + minutes;
}

function isBetweenQuietHours(
  currentMinutes: number,
  startMinutes: number,
  endMinutes: number
) {
  if (startMinutes === endMinutes) {
    return true;
  }

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function addDaysToLocalDate(
  parts: ReturnType<typeof getLocalTimeParts>,
  days: number
) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function zonedLocalTimeToUtc(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timezone: string;
}) {
  let candidate = new Date(
    Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute)
  );

  for (let index = 0; index < 4; index += 1) {
    const parts = getLocalTimeParts(candidate, input.timezone);
    const diffMinutes =
      (Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) -
        Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute)) /
      60000;

    if (diffMinutes === 0) {
      return candidate;
    }

    candidate = new Date(candidate.getTime() - diffMinutes * 60000);
  }

  return candidate;
}

export function meetsMinimumSeverity(input: {
  notificationSeverity: NotificationSeverity;
  minimumSeverity: NotificationSeverity;
}) {
  return (
    severityRank[input.notificationSeverity] >= severityRank[input.minimumSeverity]
  );
}

export function isWithinQuietHours(input: {
  now: Date;
  timezone: string;
  start: string;
  end: string;
}) {
  if (
    !isValidTimezone(input.timezone) ||
    !isValidHHmm(input.start) ||
    !isValidHHmm(input.end)
  ) {
    return false;
  }

  return isBetweenQuietHours(
    localMinutes(input.now, input.timezone),
    parseHHmm(input.start),
    parseHHmm(input.end)
  );
}

export function calculateQuietHoursEnd(input: {
  now: Date;
  timezone: string;
  start: string;
  end: string;
}) {
  const currentMinutes = localMinutes(input.now, input.timezone);
  const startMinutes = parseHHmm(input.start);
  const endMinutes = parseHHmm(input.end);
  const nowParts = getLocalTimeParts(input.now, input.timezone);
  const endHour = Math.floor(endMinutes / 60);
  const endMinute = endMinutes % 60;
  const endDayOffset =
    startMinutes > endMinutes && currentMinutes >= startMinutes ? 1 : 0;
  const endDate = addDaysToLocalDate(nowParts, endDayOffset);

  return zonedLocalTimeToUtc({
    ...endDate,
    hour: endHour,
    minute: endMinute,
    timezone: input.timezone
  });
}

export function buildWhatsAppNotificationText(input: {
  title: string;
  description: string | null;
  contactName: string | null;
  contactPhone: string | null;
  rules: string[];
  summary: string | null;
  recommendedAction: string | null;
  url: string | null;
}) {
  const lines = [
    `Alerta JAHF Comm: ${truncate(input.title, 120)}`,
    input.contactName ? `Cliente: ${truncate(input.contactName, 120)}` : null,
    input.contactPhone ? `Telefono: ${maskDestination(input.contactPhone)}` : null,
    input.description ? `Resumen: ${truncate(input.description, 500)}` : null,
    input.summary ? `Memoria: ${truncate(input.summary, 360)}` : null,
    input.recommendedAction
      ? `Accion sugerida: ${truncate(input.recommendedAction, 240)}`
      : null,
    input.rules.length > 0
      ? `Reglas: ${input.rules.map((rule) => rule.replaceAll("_", " ")).join(", ")}`
      : null,
    input.url ? `Abrir: ${input.url}` : null
  ].filter((line): line is string => Boolean(line));

  return truncate(lines.join("\n"), maxMessageLength);
}

export async function evaluateWhatsappDeliveryEligibility(input: {
  tenantId: string;
  userId: string;
  notificationSeverity: NotificationSeverity;
  notificationMetadata: NotificationMetadata;
  now?: Date;
}) {
  const [membership, settings, preference] = await Promise.all([
    prisma.membership.findFirst({
      where: {
        tenantId: input.tenantId,
        userId: input.userId
      },
      select: { id: true, role: true }
    }),
    prisma.tenantNotificationSettings.findUnique({
      where: { tenantId: input.tenantId },
      include: { whatsappAlertsAccount: true }
    }),
    prisma.notificationPreference.findUnique({
      where: {
        tenantId_userId: {
          tenantId: input.tenantId,
          userId: input.userId
        }
      }
    })
  ]);

  if (!membership) {
    return {
      status: NotificationDeliveryStatus.SKIPPED,
      code: "USER_NOT_IN_TENANT",
      message: "Notification user is not a member of this tenant."
    } satisfies DeliveryDecision;
  }

  if (String(membership.role) === "VIEWER") {
    return {
      status: NotificationDeliveryStatus.SKIPPED,
      code: "VIEWER_NOT_ELIGIBLE",
      message: "VIEWER users cannot receive operational WhatsApp alerts."
    } satisfies DeliveryDecision;
  }

  if (input.notificationMetadata.source !== customerAlertSource) {
    return {
      status: NotificationDeliveryStatus.SKIPPED,
      code: "UNSUPPORTED_NOTIFICATION_SOURCE",
      message: "Only customer alert notifications are eligible for WhatsApp delivery."
    } satisfies DeliveryDecision;
  }

  if (!settings?.whatsappAlertsEnabled) {
    return {
      status: NotificationDeliveryStatus.SKIPPED,
      code: "TENANT_WHATSAPP_ALERTS_DISABLED",
      message: "Tenant WhatsApp alerts are disabled."
    } satisfies DeliveryDecision;
  }

  if (!settings.whatsappAlertsAccountId || !settings.whatsappAlertsAccount) {
    return {
      status: NotificationDeliveryStatus.SKIPPED,
      code: "TENANT_WHATSAPP_ALERTS_ACCOUNT_MISSING",
      message: "Tenant does not have a WhatsApp alerts account configured."
    } satisfies DeliveryDecision;
  }

  if (!preference?.whatsappEnabled) {
    return {
      status: NotificationDeliveryStatus.SKIPPED,
      code: "USER_WHATSAPP_DISABLED",
      message: "User has not enabled WhatsApp alert delivery."
    } satisfies DeliveryDecision;
  }

  if (!preference.whatsappPhone) {
    return {
      status: NotificationDeliveryStatus.SKIPPED,
      code: "USER_WHATSAPP_PHONE_MISSING",
      message: "User does not have an internal WhatsApp destination."
    } satisfies DeliveryDecision;
  }

  if (
    !meetsMinimumSeverity({
      notificationSeverity: input.notificationSeverity,
      minimumSeverity: preference.minimumSeverity
    })
  ) {
    return {
      status: NotificationDeliveryStatus.SKIPPED,
      code: "BELOW_MINIMUM_SEVERITY",
      message: "Notification severity is below the user preference."
    } satisfies DeliveryDecision;
  }

  const rules = readStringArray(input.notificationMetadata.rules);

  if (
    !preference.returningCustomerEnabled &&
    rules.some((rule) => rule.includes("RETURN") || rule.includes("REACTIVATION"))
  ) {
    return {
      status: NotificationDeliveryStatus.SKIPPED,
      code: "RETURNING_CUSTOMER_ALERTS_DISABLED",
      message: "User disabled returning customer WhatsApp alerts."
    } satisfies DeliveryDecision;
  }

  if (
    !preference.supportEnabled &&
    rules.some((rule) => rule.includes("SUPPORT"))
  ) {
    return {
      status: NotificationDeliveryStatus.SKIPPED,
      code: "SUPPORT_ALERTS_DISABLED",
      message: "User disabled support WhatsApp alerts."
    } satisfies DeliveryDecision;
  }

  if (
    !preference.highPriorityEnabled &&
    rules.some((rule) => rule.includes("HIGH_PRIORITY") || rule.includes("URGENT"))
  ) {
    return {
      status: NotificationDeliveryStatus.SKIPPED,
      code: "HIGH_PRIORITY_ALERTS_DISABLED",
      message: "User disabled high priority WhatsApp alerts."
    } satisfies DeliveryDecision;
  }

  if (
    !preference.negativeSentimentEnabled &&
    rules.includes("NEGATIVE_CUSTOMER_SENTIMENT")
  ) {
    return {
      status: NotificationDeliveryStatus.SKIPPED,
      code: "NEGATIVE_SENTIMENT_ALERTS_DISABLED",
      message: "User disabled negative sentiment WhatsApp alerts."
    } satisfies DeliveryDecision;
  }

  if (
    preference.quietHoursEnabled &&
    preference.quietHoursStart &&
    preference.quietHoursEnd &&
    isWithinQuietHours({
      now: input.now ?? new Date(),
      timezone: preference.timezone,
      start: preference.quietHoursStart,
      end: preference.quietHoursEnd
    }) &&
    !(
      input.notificationSeverity === NotificationSeverity.URGENT &&
      preference.allowUrgentDuringQuietHours
    )
  ) {
    return {
      status: NotificationDeliveryStatus.PENDING,
      code: "QUIET_HOURS",
      message: "Delivery is delayed until quiet hours end.",
      nextAttemptAt: calculateQuietHoursEnd({
        now: input.now ?? new Date(),
        timezone: preference.timezone,
        start: preference.quietHoursStart,
        end: preference.quietHoursEnd
      })
    } satisfies DeliveryDecision;
  }

  return {
    status: NotificationDeliveryStatus.DRY_RUN,
    code: null,
    message: null
  } satisfies DeliveryDecision;
}

export async function prepareWhatsappNotificationDelivery(input: {
  tenantId: string;
  notificationId: string;
  now?: Date;
  publicUrl?: string;
  env?: NodeJS.ProcessEnv;
}) {
  const runtime = getWhatsappAlertRuntimeState(input.env);
  const existingDelivery = await prisma.notificationDelivery.findUnique({
    where: {
      tenantId_notificationId_channel: {
        tenantId: input.tenantId,
        notificationId: input.notificationId,
        channel: NotificationChannel.WHATSAPP
      }
    }
  });

  if (existingDelivery && isTerminalDeliveryStatus(existingDelivery.status)) {
    return {
      status:
        existingDelivery.status === NotificationDeliveryStatus.DRY_RUN
          ? ("dry_run" as const)
          : existingDelivery.status === NotificationDeliveryStatus.SENT
            ? ("sent" as const)
            : existingDelivery.status === NotificationDeliveryStatus.UNKNOWN
              ? ("unknown" as const)
              : ("skipped" as const),
      delivery: existingDelivery
    };
  }

  if (existingDelivery?.status === NotificationDeliveryStatus.PROCESSING) {
    return {
      status: "processing" as const,
      delivery: existingDelivery
    };
  }

  if (existingDelivery) {
    return {
      status:
        existingDelivery.status === NotificationDeliveryStatus.PENDING
          ? ("pending" as const)
          : existingDelivery.status === NotificationDeliveryStatus.FAILED
            ? ("failed" as const)
            : ("skipped" as const),
      delivery: existingDelivery
    };
  }

  const notification = await prisma.notification.findFirst({
    where: {
      id: input.notificationId,
      tenantId: input.tenantId
    },
    select: {
      id: true,
      tenantId: true,
      userId: true,
      title: true,
      description: true,
      severity: true,
      metadata: true
    }
  });

  if (!notification) {
    return { status: "skipped_missing_notification" as const, delivery: null };
  }

  if (!notification.userId) {
    return { status: "skipped_missing_user" as const, delivery: null };
  }

  const metadata = readMetadata(notification.metadata);
  const conversationId = readString(metadata.conversationId);
  const contactId = readString(metadata.contactId);
  const href = readString(metadata.href);
  const [preference, contact, memory] = await Promise.all([
    prisma.notificationPreference.findUnique({
      where: {
        tenantId_userId: {
          tenantId: input.tenantId,
          userId: notification.userId
        }
      },
      select: {
        whatsappPhone: true
      }
    }),
    contactId
      ? prisma.contact.findFirst({
          where: {
            id: contactId,
            tenantId: input.tenantId
          },
          select: {
            name: true,
            phoneNumber: true,
            normalizedPhoneNumber: true
          }
        })
      : Promise.resolve(null),
    contactId
      ? prisma.customerMemory.findUnique({
          where: {
            tenantId_contactId: {
              tenantId: input.tenantId,
              contactId
            }
          },
          select: {
            commercialSummary: true,
            recommendedNextAction: true
          }
        })
      : Promise.resolve(null)
  ]);
  const decision = await evaluateWhatsappDeliveryEligibility({
    tenantId: input.tenantId,
    userId: notification.userId,
    notificationSeverity: notification.severity,
    notificationMetadata: metadata,
    now: input.now
  });
  const deliveryAction: DeliveryActionDecision =
    decision.status === NotificationDeliveryStatus.DRY_RUN && runtime.mode === "LIVE"
      ? {
          status: NotificationDeliveryStatus.PENDING,
          code: null,
          message: null,
          nextAttemptAt: null
        }
      : decision;
  const destination = preference?.whatsappPhone ?? "";
  const text = buildWhatsAppNotificationText({
    title: notification.title,
    description: notification.description,
    contactName: contact?.name ?? null,
    contactPhone: contact?.phoneNumber ?? contact?.normalizedPhoneNumber ?? null,
    rules: readStringArray(metadata.rules),
    summary: memory?.commercialSummary ?? null,
    recommendedAction: memory?.recommendedNextAction ?? null,
    url: joinUrl(input.publicUrl ?? process.env.APP_PUBLIC_URL, href)
  });
  const deliveryMetadata = {
    source: notificationDeliverySource,
    version: 2,
    mode: runtime.mode.toLowerCase(),
    dryRun: runtime.mode !== "LIVE",
    originalNotificationSource: readString(metadata.source),
    contactId,
    conversationId,
    triggerMessageId: readString(metadata.triggerMessageId),
    returnType: readString(metadata.returnType),
    inactivityMinutes: readNumber(metadata.inactivityMinutes),
    hasRegisteredSale: Boolean(metadata.hasRegisteredSale),
    salesCount: readNumber(metadata.salesCount),
    openSupportTicketsCount: readNumber(metadata.openSupportTicketsCount),
    intent: readString(metadata.intent),
    priority: readString(metadata.priority),
    sentiment: readString(metadata.sentiment),
    rules: readStringArray(metadata.rules),
    destinationMasked: destination ? maskDestination(destination) : null,
    messageHash: hashValue(text),
    messageLength: text.length,
    publicUrlConfigured: Boolean(input.publicUrl ?? process.env.APP_PUBLIC_URL)
  } satisfies Prisma.InputJsonObject;

  let delivery;

  try {
    delivery = await prisma.notificationDelivery.create({
      data: {
        tenantId: input.tenantId,
        notificationId: input.notificationId,
        userId: notification.userId,
        channel: NotificationChannel.WHATSAPP,
        destination,
        status: deliveryAction.status,
        nextAttemptAt:
          deliveryAction.status === NotificationDeliveryStatus.PENDING
            ? (deliveryAction.nextAttemptAt ?? null)
            : null,
        lastAttemptAt:
          deliveryAction.status === NotificationDeliveryStatus.DRY_RUN
            ? new Date()
            : null,
        errorCode: deliveryAction.code,
        errorMessage: deliveryAction.message,
        metadata: deliveryMetadata
      }
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      delivery = await prisma.notificationDelivery.findUniqueOrThrow({
        where: {
          tenantId_notificationId_channel: {
            tenantId: input.tenantId,
            notificationId: input.notificationId,
            channel: NotificationChannel.WHATSAPP
          }
        }
      });
    } else {
      throw error;
    }
  }

  return {
    status:
      delivery.status === NotificationDeliveryStatus.DRY_RUN
        ? ("dry_run" as const)
        : delivery.status === NotificationDeliveryStatus.PENDING
          ? ("pending" as const)
          : delivery.status === NotificationDeliveryStatus.SENT
            ? ("sent" as const)
            : delivery.status === NotificationDeliveryStatus.UNKNOWN
              ? ("unknown" as const)
          : ("skipped" as const),
    delivery
  };
}

function metadataRecord(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Prisma.JsonObject)
    : {};
}

function normalizePhoneForCompare(value: string | null | undefined) {
  return value?.replace(/\D/g, "") ?? "";
}

async function updateDeliveryAfterValidation(input: {
  tenantId: string;
  deliveryId: string;
  status: NotificationDeliveryStatus;
  errorCode: string | null;
  errorMessage: string | null;
  nextAttemptAt?: Date | null;
  metadata?: Prisma.InputJsonObject;
}) {
  return prisma.notificationDelivery.update({
    where: {
      tenantId_id: {
        tenantId: input.tenantId,
        id: input.deliveryId
      }
    },
    data: {
      status: input.status,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      nextAttemptAt: input.nextAttemptAt ?? null,
      metadata: input.metadata
    }
  });
}

export async function claimWhatsappNotificationDelivery(input: {
  tenantId: string;
  notificationId: string;
  now?: Date;
  maxRetries?: number;
}) {
  const now = input.now ?? new Date();
  const maxRetries = input.maxRetries ?? defaultMaxRetries;
  const claim = await prisma.notificationDelivery.updateMany({
    where: {
      tenantId: input.tenantId,
      notificationId: input.notificationId,
      channel: NotificationChannel.WHATSAPP,
      OR: [
        {
          status: NotificationDeliveryStatus.PENDING,
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }]
        },
        {
          status: NotificationDeliveryStatus.FAILED,
          attemptCount: { lt: maxRetries },
          nextAttemptAt: { lte: now },
          metadata: {
            path: ["retryable"],
            equals: true
          }
        }
      ]
    },
    data: {
      status: NotificationDeliveryStatus.PROCESSING,
      lastAttemptAt: now,
      errorCode: null,
      errorMessage: null
    }
  });

  if (claim.count !== 1) {
    return null;
  }

  return prisma.notificationDelivery.findFirst({
    where: {
      tenantId: input.tenantId,
      notificationId: input.notificationId,
      channel: NotificationChannel.WHATSAPP,
      status: NotificationDeliveryStatus.PROCESSING
    }
  });
}

export async function markStaleWhatsappDeliveriesUnknown(input: {
  tenantId?: string;
  now?: Date;
  staleMinutes?: number;
} = {}) {
  const now = input.now ?? new Date();
  const staleMinutes = input.staleMinutes ?? defaultProcessingStaleMinutes;
  const staleBefore = new Date(now.getTime() - staleMinutes * 60 * 1000);
  const staleDeliveries = await prisma.notificationDelivery.findMany({
    where: {
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      channel: NotificationChannel.WHATSAPP,
      status: NotificationDeliveryStatus.PROCESSING,
      lastAttemptAt: {
        lt: staleBefore
      }
    },
    select: {
      id: true,
      tenantId: true,
      metadata: true
    }
  });

  for (const delivery of staleDeliveries) {
    await prisma.notificationDelivery.update({
      where: {
        tenantId_id: {
          tenantId: delivery.tenantId,
          id: delivery.id
        }
      },
      data: {
        status: NotificationDeliveryStatus.UNKNOWN,
        nextAttemptAt: null,
        errorCode: "PROCESSING_STALE",
        errorMessage: "Delivery was left PROCESSING beyond the stale threshold.",
        metadata: {
          ...metadataRecord(delivery.metadata),
          deliveryUnknown: true,
          staleMarkedAt: now.toISOString()
        }
      }
    });
  }

  return { markedUnknown: staleDeliveries.length };
}

export async function buildClaimedWhatsappDeliveryContext(input: {
  tenantId: string;
  deliveryId: string;
  now?: Date;
  publicUrl?: string;
}) {
  const now = input.now ?? new Date();
  const delivery = await prisma.notificationDelivery.findFirst({
    where: {
      id: input.deliveryId,
      tenantId: input.tenantId,
      channel: NotificationChannel.WHATSAPP,
      status: NotificationDeliveryStatus.PROCESSING
    }
  });

  if (!delivery) {
    return { status: "not_claimed" as const, context: null };
  }

  const notification = await prisma.notification.findFirst({
    where: {
      id: delivery.notificationId,
      tenantId: input.tenantId
    },
    select: {
      id: true,
      userId: true,
      title: true,
      description: true,
      severity: true,
      metadata: true
    }
  });

  if (!notification?.userId) {
    await updateDeliveryAfterValidation({
      tenantId: input.tenantId,
      deliveryId: delivery.id,
      status: NotificationDeliveryStatus.SKIPPED,
      errorCode: "NOTIFICATION_USER_MISSING",
      errorMessage: "Notification has no user assigned."
    });

    return { status: "skipped" as const, context: null };
  }

  const originalMetadata = readMetadata(notification.metadata);
  const decision = await evaluateWhatsappDeliveryEligibility({
    tenantId: input.tenantId,
    userId: notification.userId,
    notificationSeverity: notification.severity,
    notificationMetadata: originalMetadata,
    now
  });

  if (decision.status === NotificationDeliveryStatus.SKIPPED) {
    await updateDeliveryAfterValidation({
      tenantId: input.tenantId,
      deliveryId: delivery.id,
      status: NotificationDeliveryStatus.SKIPPED,
      errorCode: decision.code,
      errorMessage: decision.message,
      metadata: {
        ...metadataRecord(delivery.metadata),
        retryable: false
      }
    });

    return { status: "skipped" as const, context: null };
  }

  if (decision.status === NotificationDeliveryStatus.PENDING) {
    await updateDeliveryAfterValidation({
      tenantId: input.tenantId,
      deliveryId: delivery.id,
      status: NotificationDeliveryStatus.PENDING,
      errorCode: decision.code,
      errorMessage: decision.message,
      nextAttemptAt: decision.nextAttemptAt,
      metadata: {
        ...metadataRecord(delivery.metadata),
        retryable: false
      }
    });

    return { status: "pending" as const, context: null };
  }

  const metadata = readMetadata(notification.metadata);
  const contactId = readString(metadata.contactId);
  const conversationId = readString(metadata.conversationId);
  const href = readString(metadata.href);
  const [preference, settings, conversation, contact, memory] = await Promise.all([
    prisma.notificationPreference.findUnique({
      where: {
        tenantId_userId: {
          tenantId: input.tenantId,
          userId: notification.userId
        }
      }
    }),
    prisma.tenantNotificationSettings.findUnique({
      where: { tenantId: input.tenantId },
      include: { whatsappAlertsAccount: true }
    }),
    conversationId
      ? prisma.conversation.findFirst({
          where: {
            id: conversationId,
            tenantId: input.tenantId
          },
          select: {
            whatsappAccountId: true
          }
        })
      : Promise.resolve(null),
    contactId
      ? prisma.contact.findFirst({
          where: {
            id: contactId,
            tenantId: input.tenantId
          },
          select: {
            name: true,
            phoneNumber: true,
            normalizedPhoneNumber: true
          }
        })
      : Promise.resolve(null),
    contactId
      ? prisma.customerMemory.findUnique({
          where: {
            tenantId_contactId: {
              tenantId: input.tenantId,
              contactId
            }
          },
          select: {
            commercialSummary: true,
            recommendedNextAction: true
          }
        })
      : Promise.resolve(null)
  ]);

  if (!settings?.whatsappAlertsAccount?.instanceName) {
    await updateDeliveryAfterValidation({
      tenantId: input.tenantId,
      deliveryId: delivery.id,
      status: NotificationDeliveryStatus.FAILED,
      errorCode: "PROVIDER_ACCOUNT_INSTANCE_MISSING",
      errorMessage: "WhatsApp alerts account is missing instanceName.",
      metadata: {
        ...metadataRecord(delivery.metadata),
        retryable: false
      }
    });

    return { status: "failed" as const, context: null };
  }

  if (
    conversation?.whatsappAccountId &&
    conversation.whatsappAccountId === settings.whatsappAlertsAccountId
  ) {
    await updateDeliveryAfterValidation({
      tenantId: input.tenantId,
      deliveryId: delivery.id,
      status: NotificationDeliveryStatus.SKIPPED,
      errorCode: "ALERT_ACCOUNT_MATCHES_CONVERSATION_ACCOUNT",
      errorMessage: "Internal alert account must be dedicated."
    });

    return { status: "skipped" as const, context: null };
  }

  const destination = preference?.whatsappPhone ?? delivery.destination;
  const customerPhone = contact?.normalizedPhoneNumber ?? contact?.phoneNumber;

  if (
    normalizePhoneForCompare(destination) &&
    normalizePhoneForCompare(destination) === normalizePhoneForCompare(customerPhone)
  ) {
    await updateDeliveryAfterValidation({
      tenantId: input.tenantId,
      deliveryId: delivery.id,
      status: NotificationDeliveryStatus.SKIPPED,
      errorCode: "DESTINATION_IS_CUSTOMER_PHONE",
      errorMessage: "Internal alert destination cannot be the customer phone."
    });

    return { status: "skipped" as const, context: null };
  }

  const text = buildWhatsAppNotificationText({
    title: notification.title,
    description: notification.description,
    contactName: contact?.name ?? null,
    contactPhone: contact?.phoneNumber ?? contact?.normalizedPhoneNumber ?? null,
    rules: readStringArray(metadata.rules),
    summary: memory?.commercialSummary ?? null,
    recommendedAction: memory?.recommendedNextAction ?? null,
    url: joinUrl(input.publicUrl ?? process.env.APP_PUBLIC_URL, href)
  });
  const safeMetadata = {
    ...metadataRecord(delivery.metadata),
    source: notificationDeliverySource,
    version: 2,
    dryRun: false,
    rules: readStringArray(metadata.rules),
    contactId,
    conversationId,
    triggerMessageId: readString(metadata.triggerMessageId),
    destinationMasked: destination ? maskDestination(destination) : null,
    messageHash: hashValue(text),
    messageLength: text.length
  } satisfies Prisma.InputJsonObject;

  return {
    status: "ready" as const,
    context: {
      deliveryId: delivery.id,
      tenantId: input.tenantId,
      notificationId: notification.id,
      destination,
      instanceName: settings.whatsappAlertsAccount.instanceName,
      text,
      metadata: safeMetadata
    } satisfies ClaimedWhatsappDeliveryContext
  };
}

export async function markWhatsappDeliveryProviderAttempt(input: {
  tenantId: string;
  deliveryId: string;
  now?: Date;
}) {
  const updated = await prisma.notificationDelivery.update({
    where: {
      tenantId_id: {
        tenantId: input.tenantId,
        id: input.deliveryId
      }
    },
    data: {
      attemptCount: {
        increment: 1
      },
      lastAttemptAt: input.now ?? new Date()
    }
  });

  return updated;
}

export async function markWhatsappDeliverySent(input: {
  tenantId: string;
  deliveryId: string;
  providerMessageId: string;
  providerStatus: string | null;
  httpStatus: number;
  metadata: Prisma.InputJsonObject;
  now?: Date;
}) {
  const now = input.now ?? new Date();

  return prisma.notificationDelivery.update({
    where: {
      tenantId_id: {
        tenantId: input.tenantId,
        id: input.deliveryId
      }
    },
    data: {
      status: NotificationDeliveryStatus.SENT,
      providerMessageId: input.providerMessageId,
      sentAt: now,
      nextAttemptAt: null,
      errorCode: null,
      errorMessage: null,
      metadata: {
        ...input.metadata,
        providerStatus: input.providerStatus,
        httpStatus: input.httpStatus,
        retryable: false,
        deliveryUnknown: false
      }
    }
  });
}

export async function markWhatsappDeliveryFailed(input: {
  tenantId: string;
  deliveryId: string;
  category: string;
  safeMessage: string;
  httpStatus: number | null;
  retryable: boolean;
  deliveryUnknown: boolean;
  attemptCount: number;
  maxRetries?: number;
  backoffSeconds?: number;
  metadata: Prisma.InputJsonObject;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const maxRetries = input.maxRetries ?? defaultMaxRetries;
  const shouldRetry =
    input.retryable && !input.deliveryUnknown && input.attemptCount < maxRetries;
  const status = input.deliveryUnknown
    ? NotificationDeliveryStatus.UNKNOWN
    : NotificationDeliveryStatus.FAILED;

  return prisma.notificationDelivery.update({
    where: {
      tenantId_id: {
        tenantId: input.tenantId,
        id: input.deliveryId
      }
    },
    data: {
      status,
      nextAttemptAt: shouldRetry
        ? calculateWhatsappRetryAt({
            attemptCount: input.attemptCount,
            backoffSeconds: input.backoffSeconds,
            now
          })
        : null,
      errorCode: input.category,
      errorMessage: input.safeMessage,
      metadata: {
        ...input.metadata,
        retryable: shouldRetry,
        deliveryUnknown: input.deliveryUnknown,
        httpStatus: input.httpStatus,
        errorCategory: input.category
      }
    }
  });
}
