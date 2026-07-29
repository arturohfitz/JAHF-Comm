import { createHash, randomUUID } from "node:crypto";

import {
  MembershipRole,
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationSeverity,
  NotificationType,
  Prisma,
  WhatsAppAccountStatus,
  prisma
} from "@jahf-comm/db";
import {
  EvolutionOutboundError,
  sendEvolutionText
} from "@jahf-comm/whatsapp";

export const controlledWhatsappTestSource = "INTERNAL_WHATSAPP_TEST";
export const controlledWhatsappTestConfirmation =
  "SEND_ONE_CONTROLLED_WHATSAPP_TEST";

export type ControlledWhatsappAlertTestMode = "preflight" | "live";
export type ControlledWhatsappAlertTestInput = {
  mode: ControlledWhatsappAlertTestMode;
  tenantId: string;
  actorUserId: string;
  targetUserId: string;
  testRunId?: string;
  confirm?: string;
  confirmDedicatedNoWebhook?: boolean;
};
export type ControlledWhatsappAlertTestOptions = {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  sendText?: typeof sendEvolutionText;
  logger?: Pick<Console, "info" | "warn" | "error">;
};

type ValidationContext = {
  tenant: { id: string; name: string; slug: string };
  actor: {
    id: string;
    email: string;
    name: string | null;
    role: MembershipRole;
  };
  target: {
    id: string;
    email: string;
    name: string | null;
    role: MembershipRole;
  };
  preference: {
    whatsappPhone: string;
  };
  account: {
    id: string;
    name: string;
    displayName: string | null;
    status: WhatsAppAccountStatus;
    instanceName: string;
  };
  envState: {
    testEnabled: boolean;
    alertsEnabled: boolean;
    dryRun: boolean;
    hasEvolutionUrl: boolean;
    hasEvolutionApiKey: boolean;
  };
};

function readBooleanEnv(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === "") {
    return fallback;
  }

  return value.toLowerCase() === "true";
}

function maskPhone(value: string) {
  const digits = value.replace(/\D/g, "");

  if (digits.length <= 4) {
    return "****";
  }

  return `${"*".repeat(Math.max(digits.length - 4, 4))}${digits.slice(-4)}`;
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function validateUuid(value: string | undefined) {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value
      )
  );
}

function createDeduplicationKey(input: {
  tenantId: string;
  targetUserId: string;
  testRunId: string;
}) {
  return `internal-whatsapp-test:v1:${input.tenantId}:${input.targetUserId}:${input.testRunId}`;
}

function buildControlledTestText(input: { testRunId: string; now: Date }) {
  return [
    "Prueba controlada de JAHF Comm",
    "",
    "Este es un mensaje de prueba del sistema de alertas internas por WhatsApp.",
    "",
    "No corresponde a un cliente ni requiere seguimiento.",
    "",
    `Ejecucion: ${input.testRunId.slice(0, 8)}`,
    `Fecha: ${input.now.toISOString()}`
  ].join("\n");
}

function readEnvState(env: NodeJS.ProcessEnv) {
  return {
    testEnabled: readBooleanEnv(env.WHATSAPP_ALERT_TEST_ENABLED, false),
    alertsEnabled: readBooleanEnv(env.WHATSAPP_ALERTS_ENABLED, false),
    dryRun: readBooleanEnv(env.WHATSAPP_ALERTS_DRY_RUN, true),
    hasEvolutionUrl: Boolean(env.EVOLUTION_API_URL),
    hasEvolutionApiKey: Boolean(env.EVOLUTION_API_KEY)
  };
}

function requireSafeGlobalState(envState: ValidationContext["envState"]) {
  if (envState.alertsEnabled) {
    throw new Error("WHATSAPP_ALERTS_ENABLED must remain false.");
  }

  if (!envState.dryRun) {
    throw new Error("WHATSAPP_ALERTS_DRY_RUN must remain true.");
  }
}

async function validateControlledTestContext(input: {
  tenantId: string;
  actorUserId: string;
  targetUserId: string;
  env: NodeJS.ProcessEnv;
}) {
  const envState = readEnvState(input.env);

  requireSafeGlobalState(envState);

  if (!envState.hasEvolutionUrl) {
    throw new Error("EVOLUTION_API_URL is required for controlled test validation.");
  }

  if (!envState.hasEvolutionApiKey) {
    throw new Error("EVOLUTION_API_KEY is required for controlled test validation.");
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: { id: true, name: true, slug: true }
  });

  if (!tenant) {
    throw new Error("Tenant not found.");
  }

  const [actorMembership, targetMembership] = await Promise.all([
    prisma.membership.findFirst({
      where: {
        tenantId: input.tenantId,
        userId: input.actorUserId
      },
      select: {
        role: true,
        user: { select: { id: true, email: true, name: true } }
      }
    }),
    prisma.membership.findFirst({
      where: {
        tenantId: input.tenantId,
        userId: input.targetUserId
      },
      select: {
        role: true,
        user: { select: { id: true, email: true, name: true } }
      }
    })
  ]);

  const actorRoles: MembershipRole[] = [
    MembershipRole.OWNER,
    MembershipRole.ADMIN
  ];

  if (!actorMembership || !actorRoles.includes(actorMembership.role)) {
    throw new Error("Actor must be OWNER or ADMIN in this tenant.");
  }

  if (!targetMembership || targetMembership.role === MembershipRole.VIEWER) {
    throw new Error("Target user must be an operational member of this tenant.");
  }

  const [preference, settings] = await Promise.all([
    prisma.notificationPreference.findUnique({
      where: {
        tenantId_userId: {
          tenantId: input.tenantId,
          userId: input.targetUserId
        }
      }
    }),
    prisma.tenantNotificationSettings.findUnique({
      where: { tenantId: input.tenantId },
      include: { whatsappAlertsAccount: true }
    })
  ]);

  if (!preference?.whatsappEnabled || !preference.whatsappPhone) {
    throw new Error("Target user WhatsApp notification preference is not enabled.");
  }

  if (!/^\+?\d{8,15}$/.test(preference.whatsappPhone.replace(/[^\d+]/g, ""))) {
    throw new Error("Target user WhatsApp phone is invalid.");
  }

  if (!settings?.whatsappAlertsEnabled) {
    throw new Error("Tenant WhatsApp alert settings are not enabled.");
  }

  if (!settings.whatsappAlertsAccountId || !settings.whatsappAlertsAccount) {
    throw new Error("Tenant does not have a dedicated WhatsApp alert account.");
  }

  const validAccountStatuses: WhatsAppAccountStatus[] = [
    WhatsAppAccountStatus.CONNECTED,
    WhatsAppAccountStatus.PENDING
  ];

  if (!validAccountStatuses.includes(settings.whatsappAlertsAccount.status)) {
    throw new Error("Dedicated WhatsApp alert account is not in a valid status.");
  }

  if (!settings.whatsappAlertsAccount.instanceName) {
    throw new Error("Dedicated WhatsApp alert account is missing instanceName.");
  }

  const targetConversationUsingAccount = await prisma.conversation.findFirst({
    where: {
      tenantId: input.tenantId,
      assignedUserId: input.targetUserId,
      whatsappAccountId: settings.whatsappAlertsAccountId
    },
    select: { id: true }
  });

  if (targetConversationUsingAccount) {
    throw new Error(
      "Dedicated WhatsApp alert account is used by a conversation assigned to the target user."
    );
  }

  return {
    tenant,
    actor: {
      ...actorMembership.user,
      role: actorMembership.role
    },
    target: {
      ...targetMembership.user,
      role: targetMembership.role
    },
    preference: {
      whatsappPhone: preference.whatsappPhone
    },
    account: {
      id: settings.whatsappAlertsAccount.id,
      name: settings.whatsappAlertsAccount.name,
      displayName: settings.whatsappAlertsAccount.displayName,
      status: settings.whatsappAlertsAccount.status,
      instanceName: settings.whatsappAlertsAccount.instanceName
    },
    envState
  } satisfies ValidationContext;
}

function buildPreflightResult(input: {
  context: ValidationContext;
  testRunId: string;
}) {
  return {
    mode: "preflight" as const,
    testRunId: input.testRunId,
    tenant: input.context.tenant,
    actor: input.context.actor,
    target: input.context.target,
    destinationMasked: maskPhone(input.context.preference.whatsappPhone),
    dedicatedAccount: {
      id: input.context.account.id,
      label: input.context.account.displayName ?? input.context.account.name,
      status: input.context.account.status,
      instanceName: input.context.account.instanceName
    },
    env: {
      hasEvolutionUrl: input.context.envState.hasEvolutionUrl,
      hasEvolutionApiKey: input.context.envState.hasEvolutionApiKey,
      whatsappAlertsEnabled: input.context.envState.alertsEnabled,
      whatsappAlertsDryRun: input.context.envState.dryRun,
      whatsappAlertTestEnabled: input.context.envState.testEnabled
    },
    pendingConfirmations: [
      "Confirmacion manual requerida: la instancia dedicada no debe enviar sus eventos al webhook de JAHF Comm.",
      `Para live: --testRunId ${input.testRunId}`,
      `Para live: --confirm ${controlledWhatsappTestConfirmation}`,
      "Para live: --confirmDedicatedNoWebhook"
    ],
    liveCommand: [
      "pnpm --filter @jahf-comm/worker whatsapp-alert:test --",
      "--mode live",
      `--tenantId ${input.context.tenant.id}`,
      `--actorUserId ${input.context.actor.id}`,
      `--targetUserId ${input.context.target.id}`,
      `--testRunId ${input.testRunId}`,
      `--confirm ${controlledWhatsappTestConfirmation}`,
      "--confirmDedicatedNoWebhook"
    ].join(" ")
  };
}

export async function runControlledWhatsappAlertTest(
  input: ControlledWhatsappAlertTestInput,
  options: ControlledWhatsappAlertTestOptions = {}
) {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const logger = options.logger ?? console;
  const context = await validateControlledTestContext({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    targetUserId: input.targetUserId,
    env
  });
  const testRunId =
    input.mode === "preflight" ? (input.testRunId ?? randomUUID()) : input.testRunId;

  if (input.mode === "preflight") {
    return buildPreflightResult({
      context,
      testRunId: testRunId ?? randomUUID()
    });
  }

  if (!context.envState.testEnabled) {
    throw new Error("WHATSAPP_ALERT_TEST_ENABLED must be true for live mode.");
  }

  if (!testRunId || !validateUuid(testRunId)) {
    throw new Error("A valid testRunId UUID is required for live mode.");
  }

  const liveTestRunId = testRunId;

  if (input.confirm !== controlledWhatsappTestConfirmation) {
    throw new Error("Live mode confirmation phrase is invalid.");
  }

  if (input.confirmDedicatedNoWebhook !== true) {
    throw new Error("Dedicated no-webhook manual confirmation is required.");
  }

  const deduplicationKey = createDeduplicationKey({
    tenantId: context.tenant.id,
    targetUserId: context.target.id,
    testRunId: liveTestRunId
  });
  const existing = await prisma.notification.findFirst({
    where: {
      tenantId: context.tenant.id,
      OR: [
        { deduplicationKey },
        {
          metadata: {
            path: ["testRunId"],
            equals: liveTestRunId
          }
        }
      ]
    },
    select: { id: true }
  });

  if (existing) {
    return {
      mode: "live" as const,
      status: "duplicate" as const,
      testRunId: liveTestRunId,
      notificationId: existing.id
    };
  }

  const text = buildControlledTestText({ testRunId: liveTestRunId, now });
  const metadata = {
    source: controlledWhatsappTestSource,
    version: 1,
    controlledTest: true,
    testRunId: liveTestRunId,
    destinationMasked: maskPhone(context.preference.whatsappPhone),
    messageHash: hashText(text),
    messageLength: text.length,
    dryRun: false
  } satisfies Prisma.InputJsonObject;
  let notificationId: string;
  let deliveryId: string;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const notification = await tx.notification.create({
        data: {
          tenantId: context.tenant.id,
          userId: context.target.id,
          type: NotificationType.SYSTEM,
          severity: NotificationSeverity.HIGH,
          title: "Prueba controlada de alertas por WhatsApp",
          description: "Mensaje tecnico controlado para validar Evolution outbound.",
          deduplicationKey,
          metadata
        },
        select: { id: true }
      });
      const delivery = await tx.notificationDelivery.create({
        data: {
          tenantId: context.tenant.id,
          notificationId: notification.id,
          userId: context.target.id,
          channel: NotificationChannel.WHATSAPP,
          status: NotificationDeliveryStatus.PROCESSING,
          destination: context.preference.whatsappPhone,
          provider: "EVOLUTION",
          metadata
        },
        select: { id: true }
      });

      return { notification, delivery };
    });

    notificationId = created.notification.id;
    deliveryId = created.delivery.id;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        mode: "live" as const,
        status: "duplicate" as const,
        testRunId: liveTestRunId
      };
    }

    throw error;
  }

  const attempted = await prisma.notificationDelivery.update({
    where: {
      tenantId_id: {
        tenantId: context.tenant.id,
        id: deliveryId
      }
    },
    data: {
      attemptCount: { increment: 1 },
      lastAttemptAt: now
    }
  });
  const sendText = options.sendText ?? sendEvolutionText;
  const startedAt = Date.now();

  try {
    const result = await sendText({
      baseUrl: env.EVOLUTION_API_URL ?? "",
      apiKey: env.EVOLUTION_API_KEY ?? "",
      instanceName: context.account.instanceName,
      number: context.preference.whatsappPhone,
      text,
      timeoutMs: 15000,
      logger
    });
    const delivery = await prisma.notificationDelivery.update({
      where: {
        tenantId_id: {
          tenantId: context.tenant.id,
          id: deliveryId
        }
      },
      data: {
        status: NotificationDeliveryStatus.SENT,
        providerMessageId: result.providerMessageId,
        sentAt: now,
        errorCode: null,
        errorMessage: null,
        metadata: {
          ...metadata,
          providerStatus: result.providerStatus,
          httpStatus: result.httpStatus
        }
      }
    });

    logger.info("Controlled WhatsApp alert test accepted by provider.", {
      tenantId: context.tenant.id,
      targetUserId: context.target.id,
      testRunId: liveTestRunId,
      notificationId,
      deliveryId,
      status: delivery.status,
      providerStatus: result.providerStatus,
      httpStatus: result.httpStatus,
      destinationMasked: maskPhone(context.preference.whatsappPhone),
      durationMs: Date.now() - startedAt
    });

    return {
      mode: "live" as const,
      status: "sent" as const,
      testRunId: liveTestRunId,
      notificationId,
      delivery
    };
  } catch (error) {
    const outboundError =
      error instanceof EvolutionOutboundError
        ? error
        : new EvolutionOutboundError({
            category: "NETWORK_ERROR",
            retryable: true,
            deliveryUnknown: false,
            safeMessage: "Unexpected controlled WhatsApp test error."
          });
    const status = outboundError.deliveryUnknown
      ? NotificationDeliveryStatus.UNKNOWN
      : NotificationDeliveryStatus.FAILED;
    const delivery = await prisma.notificationDelivery.update({
      where: {
        tenantId_id: {
          tenantId: context.tenant.id,
          id: deliveryId
        }
      },
      data: {
        status,
        errorCode: outboundError.category,
        errorMessage: outboundError.safeMessage,
        nextAttemptAt: null,
        metadata: {
          ...metadata,
          retryableWouldBe: outboundError.retryable && !outboundError.deliveryUnknown,
          deliveryUnknown: outboundError.deliveryUnknown,
          httpStatus: outboundError.httpStatus,
          errorCategory: outboundError.category,
          attemptCount: attempted.attemptCount
        }
      }
    });

    logger.warn("Controlled WhatsApp alert test failed.", {
      tenantId: context.tenant.id,
      targetUserId: context.target.id,
      testRunId: liveTestRunId,
      notificationId,
      deliveryId,
      status: delivery.status,
      errorCategory: outboundError.category,
      httpStatus: outboundError.httpStatus,
      destinationMasked: maskPhone(context.preference.whatsappPhone),
      durationMs: Date.now() - startedAt
    });

    return {
      mode: "live" as const,
      status: outboundError.deliveryUnknown
        ? ("unknown" as const)
        : ("failed" as const),
      testRunId: liveTestRunId,
      notificationId,
      delivery
    };
  }
}
