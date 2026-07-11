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

const severityRank: Record<NotificationSeverity, number> = {
  [NotificationSeverity.LOW]: 1,
  [NotificationSeverity.MEDIUM]: 2,
  [NotificationSeverity.HIGH]: 3,
  [NotificationSeverity.URGENT]: 4
};

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
      select: { id: true }
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
}) {
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
    mode: "dry_run",
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

  const delivery = await prisma.notificationDelivery.upsert({
    where: {
      tenantId_notificationId_channel: {
        tenantId: input.tenantId,
        notificationId: input.notificationId,
        channel: NotificationChannel.WHATSAPP
      }
    },
    create: {
      tenantId: input.tenantId,
      notificationId: input.notificationId,
      userId: notification.userId,
      channel: NotificationChannel.WHATSAPP,
      destination,
      status: decision.status,
      nextAttemptAt:
        decision.status === NotificationDeliveryStatus.PENDING
          ? decision.nextAttemptAt
          : null,
      lastAttemptAt: new Date(),
      errorCode: decision.code,
      errorMessage: decision.message,
      metadata: deliveryMetadata
    },
    update: {
      userId: notification.userId,
      destination,
      status: decision.status,
      nextAttemptAt:
        decision.status === NotificationDeliveryStatus.PENDING
          ? decision.nextAttemptAt
          : null,
      lastAttemptAt: new Date(),
      errorCode: decision.code,
      errorMessage: decision.message,
      metadata: deliveryMetadata
    }
  });

  return {
    status:
      delivery.status === NotificationDeliveryStatus.DRY_RUN
        ? ("dry_run" as const)
        : delivery.status === NotificationDeliveryStatus.PENDING
          ? ("pending" as const)
          : ("skipped" as const),
    delivery
  };
}
