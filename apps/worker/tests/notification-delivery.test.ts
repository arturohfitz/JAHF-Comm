import assert from "node:assert/strict";
import test, { after } from "node:test";

import { EvolutionOutboundError } from "@jahf-comm/whatsapp";

const databaseUrl = process.env.DATABASE_URL_TEST;
const developmentDatabaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL_TEST is required for worker delivery tests.");
}

const testDatabase = new URL(databaseUrl);
const databaseName = testDatabase.pathname.replace("/", "");

if (!["test", "testing"].some((marker) => databaseName.includes(marker))) {
  throw new Error("DATABASE_URL_TEST must point to a database marked as test.");
}

if (developmentDatabaseUrl) {
  const developmentDatabase = new URL(developmentDatabaseUrl);

  if (
    developmentDatabase.host === testDatabase.host &&
    developmentDatabase.pathname === testDatabase.pathname
  ) {
    throw new Error("DATABASE_URL_TEST must not point to DATABASE_URL.");
  }
}

process.env.DATABASE_URL = databaseUrl;

const {
  ContactStage,
  ConversationStage,
  MembershipRole,
  NotificationDeliveryStatus,
  NotificationSeverity,
  NotificationType,
  WhatsAppAccountStatus,
  WhatsAppProvider,
  prisma
} = await import("@jahf-comm/db");
const { customerAlertSource } = await import("@jahf-comm/db/customer-alerts");
const { processNotificationDeliveryJob } = await import(
  "../src/notification-delivery"
);

const runId = `worker-nd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let sequence = 0;

after(async () => {
  await prisma.tenant.deleteMany({
    where: {
      slug: {
        startsWith: runId
      }
    }
  });
  await prisma.$disconnect();
});

function nextId(label: string) {
  sequence += 1;
  return `${runId}-${label}-${sequence}`;
}

function env(overrides: Record<string, string | undefined>) {
  return {
    DATABASE_URL: databaseUrl,
    REDIS_URL: "redis://localhost:6379",
    APP_PUBLIC_URL: "http://localhost:3000",
    WHATSAPP_ALERTS_ENABLED: "false",
    WHATSAPP_ALERTS_DRY_RUN: "true",
    EVOLUTION_OUTBOUND_TIMEOUT_MS: "15000",
    WHATSAPP_ALERT_MAX_RETRIES: "3",
    WHATSAPP_ALERT_BACKOFF_SECONDS: "60",
    ...overrides
  } as NodeJS.ProcessEnv;
}

const quietLogger = {
  info() {},
  warn() {},
  error() {}
};

async function createBase(label: string) {
  const suffix = nextId(label);
  const tenant = await prisma.tenant.create({
    data: {
      name: `Tenant ${suffix}`,
      slug: `${runId}-${suffix}`
    }
  });
  const agent = await prisma.user.create({
    data: { email: `${suffix}-agent@example.com`, name: "Agent" }
  });

  await prisma.membership.create({
    data: {
      tenantId: tenant.id,
      userId: agent.id,
      role: MembershipRole.AGENT
    }
  });

  const contact = await prisma.contact.create({
    data: {
      tenantId: tenant.id,
      name: `Cliente ${suffix}`,
      normalizedPhoneNumber: `+52155${sequence.toString().padStart(8, "0")}`,
      phoneNumber: `+52155${sequence.toString().padStart(8, "0")}`,
      stage: ContactStage.PROSPECT
    }
  });
  const conversationAccount = await prisma.whatsAppAccount.create({
    data: {
      tenantId: tenant.id,
      name: `Conversaciones ${suffix}`,
      phoneNumber: `+52156${sequence.toString().padStart(8, "0")}`,
      normalizedPhoneNumber: `+52156${sequence.toString().padStart(8, "0")}`,
      provider: WhatsAppProvider.EVOLUTION,
      status: WhatsAppAccountStatus.CONNECTED,
      instanceName: `conversation-${suffix}`,
      providerInstanceId: `conversation-${suffix}`
    }
  });
  const alertAccount = await prisma.whatsAppAccount.create({
    data: {
      tenantId: tenant.id,
      name: `Alertas ${suffix}`,
      phoneNumber: `+52157${sequence.toString().padStart(8, "0")}`,
      normalizedPhoneNumber: `+52157${sequence.toString().padStart(8, "0")}`,
      provider: WhatsAppProvider.EVOLUTION,
      status: WhatsAppAccountStatus.CONNECTED,
      instanceName: `alerts-${suffix}`,
      providerInstanceId: `alerts-${suffix}`
    }
  });
  const conversation = await prisma.conversation.create({
    data: {
      tenantId: tenant.id,
      contactId: contact.id,
      whatsappAccountId: conversationAccount.id,
      assignedUserId: agent.id,
      stage: ConversationStage.OPEN
    }
  });

  await prisma.customerMemory.create({
    data: {
      tenantId: tenant.id,
      contactId: contact.id,
      commercialSummary: "Memoria factual.",
      recommendedNextAction: "Responder al cliente."
    }
  });
  await prisma.tenantNotificationSettings.create({
    data: {
      tenantId: tenant.id,
      whatsappAlertsAccountId: alertAccount.id,
      whatsappAlertsEnabled: true
    }
  });
  await prisma.notificationPreference.create({
    data: {
      tenantId: tenant.id,
      userId: agent.id,
      whatsappEnabled: true,
      whatsappPhone: "+5215512345678",
      minimumSeverity: NotificationSeverity.HIGH
    }
  });
  const notification = await prisma.notification.create({
    data: {
      tenantId: tenant.id,
      userId: agent.id,
      type: NotificationType.ACTION_REQUIRED,
      severity: NotificationSeverity.HIGH,
      title: "Cliente reactivado",
      description: "El cliente requiere seguimiento.",
      metadata: {
        source: customerAlertSource,
        rules: ["CUSTOMER_COMMERCIAL_REACTIVATION"],
        contactId: contact.id,
        conversationId: conversation.id,
        triggerMessageId: nextId("message"),
        href: `/inbox?conversationId=${conversation.id}`
      }
    }
  });

  return { tenant, agent, contact, conversation, notification };
}

function payload(base: Awaited<ReturnType<typeof createBase>>) {
  return {
    tenantId: base.tenant.id,
    notificationId: base.notification.id,
    channel: "WHATSAPP" as const
  };
}

test("ENABLED false impide llamar sendEvolutionText y deja DRY_RUN", async () => {
  const base = await createBase("disabled");
  let calls = 0;
  const result = await processNotificationDeliveryJob(payload(base), {
    env: env({ WHATSAPP_ALERTS_ENABLED: "false", WHATSAPP_ALERTS_DRY_RUN: "true" }),
    logger: quietLogger,
    sendText: async () => {
      calls += 1;
      throw new Error("No debe llamarse");
    }
  });

  assert.equal(calls, 0);
  assert.equal(result.delivery?.status, NotificationDeliveryStatus.DRY_RUN);
});

test("ENABLED true y DRY_RUN true no llama sender real", async () => {
  const base = await createBase("dry");
  let calls = 0;
  const result = await processNotificationDeliveryJob(payload(base), {
    env: env({ WHATSAPP_ALERTS_ENABLED: "true", WHATSAPP_ALERTS_DRY_RUN: "true" }),
    logger: quietLogger,
    sendText: async () => {
      calls += 1;
      throw new Error("No debe llamarse");
    }
  });

  assert.equal(calls, 0);
  assert.equal(result.delivery?.status, NotificationDeliveryStatus.DRY_RUN);
});

test("LIVE con sender simulado guarda SENT sin texto completo", async () => {
  const base = await createBase("live");
  const beforeCounts = await Promise.all([
    prisma.contact.count({ where: { tenantId: base.tenant.id } }),
    prisma.conversation.count({ where: { tenantId: base.tenant.id } }),
    prisma.message.count({ where: { tenantId: base.tenant.id } })
  ]);
  const result = await processNotificationDeliveryJob(payload(base), {
    env: env({
      WHATSAPP_ALERTS_ENABLED: "true",
      WHATSAPP_ALERTS_DRY_RUN: "false",
      EVOLUTION_API_URL: "https://evolution.test",
      EVOLUTION_API_KEY: "test-key"
    }),
    logger: quietLogger,
    sendText: async (input) => {
      assert.equal(input.apiKey, "test-key");
      assert.equal(input.baseUrl, "https://evolution.test");
      assert.equal(input.number, "+5215512345678");
      assert.equal(input.text.includes("Cliente reactivado"), true);

      return {
        providerMessageId: "provider-live-1",
        providerStatus: "PENDING",
        httpStatus: 201,
        responseReceived: true
      };
    }
  });
  const afterCounts = await Promise.all([
    prisma.contact.count({ where: { tenantId: base.tenant.id } }),
    prisma.conversation.count({ where: { tenantId: base.tenant.id } }),
    prisma.message.count({ where: { tenantId: base.tenant.id } })
  ]);
  const delivery = await prisma.notificationDelivery.findUniqueOrThrow({
    where: {
      tenantId_notificationId_channel: {
        tenantId: base.tenant.id,
        notificationId: base.notification.id,
        channel: "WHATSAPP"
      }
    }
  });
  const metadata = delivery.metadata as Record<string, unknown>;

  assert.equal(result.status, "sent");
  assert.equal(delivery.status, NotificationDeliveryStatus.SENT);
  assert.equal(delivery.providerMessageId, "provider-live-1");
  assert.equal(delivery.attemptCount, 1);
  assert.ok(delivery.sentAt);
  assert.equal(metadata.providerStatus, "PENDING");
  assert.equal(metadata.httpStatus, 201);
  assert.equal(JSON.stringify(metadata).includes("Cliente reactivado"), false);
  assert.deepEqual(afterCounts, beforeCounts);
});

test("LIVE con configuracion incompleta falla sin llamar sender ni consumir intento", async () => {
  const base = await createBase("missing-config");
  let calls = 0;
  const result = await processNotificationDeliveryJob(payload(base), {
    env: env({
      WHATSAPP_ALERTS_ENABLED: "true",
      WHATSAPP_ALERTS_DRY_RUN: "false",
      EVOLUTION_API_URL: "",
      EVOLUTION_API_KEY: ""
    }),
    logger: quietLogger,
    sendText: async () => {
      calls += 1;
      throw new Error("No debe llamarse");
    }
  });

  assert.equal(calls, 0);
  assert.equal(result.delivery?.status, NotificationDeliveryStatus.FAILED);
  assert.equal(result.delivery?.errorCode, "PROVIDER_CONFIGURATION_MISSING");
  assert.equal(result.delivery?.attemptCount, 0);
});

test("DRY_RUN historico no se envia despues de cambiar a LIVE", async () => {
  const base = await createBase("historical-dry");
  let calls = 0;

  await processNotificationDeliveryJob(payload(base), {
    env: env({ WHATSAPP_ALERTS_ENABLED: "true", WHATSAPP_ALERTS_DRY_RUN: "true" }),
    logger: quietLogger,
    sendText: async () => {
      calls += 1;
      throw new Error("No debe llamarse");
    }
  });
  const result = await processNotificationDeliveryJob(payload(base), {
    env: env({
      WHATSAPP_ALERTS_ENABLED: "true",
      WHATSAPP_ALERTS_DRY_RUN: "false",
      EVOLUTION_API_URL: "https://evolution.test",
      EVOLUTION_API_KEY: "test-key"
    }),
    logger: quietLogger,
    sendText: async () => {
      calls += 1;
      throw new Error("No debe llamarse");
    }
  });

  assert.equal(calls, 0);
  assert.equal(result.delivery?.status, NotificationDeliveryStatus.DRY_RUN);
});

test("dos workers concurrentes solo llaman una vez al sender", async () => {
  const base = await createBase("concurrent");
  let calls = 0;
  const liveEnv = env({
    WHATSAPP_ALERTS_ENABLED: "true",
    WHATSAPP_ALERTS_DRY_RUN: "false",
    EVOLUTION_API_URL: "https://evolution.test",
    EVOLUTION_API_KEY: "test-key"
  });
  const sendText = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 50));

    return {
      providerMessageId: `provider-concurrent-${calls}`,
      providerStatus: "PENDING",
      httpStatus: 201,
      responseReceived: true
    };
  };

  await Promise.all([
    processNotificationDeliveryJob(payload(base), {
      env: liveEnv,
      logger: quietLogger,
      sendText
    }),
    processNotificationDeliveryJob(payload(base), {
      env: liveEnv,
      logger: quietLogger,
      sendText
    })
  ]);

  assert.equal(calls, 1);
});

test("TIMEOUT_UNKNOWN termina UNKNOWN sin lanzar reintento", async () => {
  const base = await createBase("unknown");
  const result = await processNotificationDeliveryJob(payload(base), {
    env: env({
      WHATSAPP_ALERTS_ENABLED: "true",
      WHATSAPP_ALERTS_DRY_RUN: "false",
      EVOLUTION_API_URL: "https://evolution.test",
      EVOLUTION_API_KEY: "test-key"
    }),
    logger: quietLogger,
    sendText: async () => {
      throw new EvolutionOutboundError({
        category: "TIMEOUT_UNKNOWN",
        retryable: false,
        deliveryUnknown: true,
        safeMessage: "Timeout desconocido."
      });
    }
  });

  assert.equal(result.status, "unknown");
  assert.equal(result.delivery?.status, NotificationDeliveryStatus.UNKNOWN);
  assert.equal(result.delivery?.nextAttemptAt, null);
});

test("error reintentable queda FAILED con nextAttemptAt y lanza error controlado", async () => {
  const base = await createBase("retryable");

  await assert.rejects(
    () =>
      processNotificationDeliveryJob(payload(base), {
        env: env({
          WHATSAPP_ALERTS_ENABLED: "true",
          WHATSAPP_ALERTS_DRY_RUN: "false",
          EVOLUTION_API_URL: "https://evolution.test",
          EVOLUTION_API_KEY: "test-key"
        }),
        logger: quietLogger,
        sendText: async () => {
          throw new EvolutionOutboundError({
            category: "RATE_LIMITED",
            retryable: true,
            deliveryUnknown: false,
            httpStatus: 429,
            safeMessage: "Rate limit."
          });
        }
      }),
    /Rate limit/
  );

  const delivery = await prisma.notificationDelivery.findUniqueOrThrow({
    where: {
      tenantId_notificationId_channel: {
        tenantId: base.tenant.id,
        notificationId: base.notification.id,
        channel: "WHATSAPP"
      }
    }
  });

  assert.equal(delivery.status, NotificationDeliveryStatus.FAILED);
  assert.equal(delivery.errorCode, "RATE_LIMITED");
  assert.ok(delivery.nextAttemptAt);
});
