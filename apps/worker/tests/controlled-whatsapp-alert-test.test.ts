import assert from "node:assert/strict";
import test, { after } from "node:test";

import { EvolutionOutboundError } from "@jahf-comm/whatsapp";

const databaseUrl = process.env.DATABASE_URL_TEST;
const developmentDatabaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL_TEST is required for controlled test tests.");
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
  WhatsAppAccountStatus,
  WhatsAppProvider,
  prisma
} = await import("@jahf-comm/db");
const {
  controlledWhatsappTestConfirmation,
  controlledWhatsappTestSource,
  runControlledWhatsappAlertTest
} = await import("../src/controlled-whatsapp-alert-test");

const runId = `controlled-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let sequence = 0;
let uuidSequence = 0;

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

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    DATABASE_URL: databaseUrl,
    WHATSAPP_ALERTS_ENABLED: "false",
    WHATSAPP_ALERTS_DRY_RUN: "true",
    WHATSAPP_ALERT_TEST_ENABLED: "false",
    EVOLUTION_API_URL: "https://evolution.test/private",
    EVOLUTION_API_KEY: "test-api-key",
    ...overrides
  } as NodeJS.ProcessEnv;
}

function uuid() {
  uuidSequence += 1;
  return `00000000-0000-4000-8000-${uuidSequence
    .toString(16)
    .padStart(12, "0")}`;
}

function quietLogger(calls: unknown[] = []) {
  return {
    info(_message: string, payload?: unknown) {
      calls.push(payload);
    },
    warn(_message: string, payload?: unknown) {
      calls.push(payload);
    },
    error(_message: string, payload?: unknown) {
      calls.push(payload);
    }
  };
}

async function createBase(label: string) {
  const suffix = nextId(label);
  const tenant = await prisma.tenant.create({
    data: {
      name: `Tenant ${suffix}`,
      slug: `${runId}-${suffix}`
    }
  });
  const otherTenant = await prisma.tenant.create({
    data: {
      name: `Other ${suffix}`,
      slug: `${runId}-${suffix}-other`
    }
  });
  const owner = await prisma.user.create({
    data: { email: `${suffix}-owner@example.com`, name: "Owner" }
  });
  const admin = await prisma.user.create({
    data: { email: `${suffix}-admin@example.com`, name: "Admin" }
  });
  const agent = await prisma.user.create({
    data: { email: `${suffix}-agent@example.com`, name: "Agent" }
  });
  const viewer = await prisma.user.create({
    data: { email: `${suffix}-viewer@example.com`, name: "Viewer" }
  });
  const otherUser = await prisma.user.create({
    data: { email: `${suffix}-other@example.com`, name: "Other" }
  });

  await prisma.membership.createMany({
    data: [
      { tenantId: tenant.id, userId: owner.id, role: MembershipRole.OWNER },
      { tenantId: tenant.id, userId: admin.id, role: MembershipRole.ADMIN },
      { tenantId: tenant.id, userId: agent.id, role: MembershipRole.AGENT },
      { tenantId: tenant.id, userId: viewer.id, role: MembershipRole.VIEWER },
      { tenantId: otherTenant.id, userId: otherUser.id, role: MembershipRole.AGENT }
    ]
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
      displayName: `Alertas ${suffix}`,
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

  return {
    tenant,
    otherTenant,
    owner,
    admin,
    agent,
    viewer,
    otherUser,
    contact,
    conversation,
    conversationAccount,
    alertAccount
  };
}

async function counts(tenantId: string) {
  return Promise.all([
    prisma.notification.count({ where: { tenantId } }),
    prisma.notificationDelivery.count({ where: { tenantId } }),
    prisma.contact.count({ where: { tenantId } }),
    prisma.conversation.count({ where: { tenantId } }),
    prisma.message.count({ where: { tenantId } }),
    prisma.customerMemory.count({ where: { tenantId } }),
    prisma.aIClassification.count({ where: { tenantId } })
  ]);
}

async function preflight(base: Awaited<ReturnType<typeof createBase>>) {
  return runControlledWhatsappAlertTest(
    {
      mode: "preflight",
      tenantId: base.tenant.id,
      actorUserId: base.owner.id,
      targetUserId: base.agent.id
    },
    { env: env(), logger: quietLogger() }
  );
}

test("preflight no llama sender, no escribe DB y devuelve salida segura", async () => {
  const base = await createBase("preflight-safe");
  const before = await counts(base.tenant.id);
  const result = await preflight(base);
  const after = await counts(base.tenant.id);
  const serialized = JSON.stringify(result);

  assert.deepEqual(after, before);
  assert.match(result.testRunId, /^[0-9a-f-]{36}$/i);
  assert.equal(serialized.includes("+5215512345678"), false);
  assert.equal(serialized.includes("****5678"), true);
  assert.equal(serialized.includes("test-api-key"), false);
  assert.equal(serialized.includes("https://evolution.test/private"), false);
  assert.equal(
    result.pendingConfirmations.some((item) =>
      item.includes("Confirmacion manual requerida")
    ),
    true
  );
});

test("preflight acepta OWNER y ADMIN, rechaza AGENT y VIEWER como actor", async () => {
  const base = await createBase("preflight-roles");
  await preflight(base);

  await runControlledWhatsappAlertTest(
    {
      mode: "preflight",
      tenantId: base.tenant.id,
      actorUserId: base.admin.id,
      targetUserId: base.agent.id
    },
    { env: env(), logger: quietLogger() }
  );
  await assert.rejects(
    () =>
      runControlledWhatsappAlertTest(
        {
          mode: "preflight",
          tenantId: base.tenant.id,
          actorUserId: base.agent.id,
          targetUserId: base.agent.id
        },
        { env: env(), logger: quietLogger() }
      ),
    /OWNER or ADMIN/
  );
  await assert.rejects(
    () =>
      runControlledWhatsappAlertTest(
        {
          mode: "preflight",
          tenantId: base.tenant.id,
          actorUserId: base.viewer.id,
          targetUserId: base.agent.id
        },
        { env: env(), logger: quietLogger() }
      ),
    /OWNER or ADMIN/
  );
});

test("preflight rechaza destinatario de otro tenant, VIEWER y preferencia desactivada", async () => {
  const base = await createBase("preflight-target");

  await assert.rejects(
    () =>
      runControlledWhatsappAlertTest(
        {
          mode: "preflight",
          tenantId: base.tenant.id,
          actorUserId: base.owner.id,
          targetUserId: base.otherUser.id
        },
        { env: env(), logger: quietLogger() }
      ),
    /operational member/
  );
  await assert.rejects(
    () =>
      runControlledWhatsappAlertTest(
        {
          mode: "preflight",
          tenantId: base.tenant.id,
          actorUserId: base.owner.id,
          targetUserId: base.viewer.id
        },
        { env: env(), logger: quietLogger() }
      ),
    /operational member/
  );

  await prisma.notificationPreference.update({
    where: {
      tenantId_userId: {
        tenantId: base.tenant.id,
        userId: base.agent.id
      }
    },
    data: { whatsappEnabled: false }
  });
  await assert.rejects(() => preflight(base), /preference is not enabled/);
});

test("preflight rechaza cuenta desconectada o usada en conversacion del destinatario", async () => {
  const base = await createBase("preflight-account");

  await prisma.whatsAppAccount.update({
    where: {
      tenantId_id: {
        tenantId: base.tenant.id,
        id: base.alertAccount.id
      }
    },
    data: { status: WhatsAppAccountStatus.DISCONNECTED }
  });
  await assert.rejects(() => preflight(base), /not in a valid status/);

  await prisma.whatsAppAccount.update({
    where: {
      tenantId_id: {
        tenantId: base.tenant.id,
        id: base.alertAccount.id
      }
    },
    data: { status: WhatsAppAccountStatus.CONNECTED }
  });
  await prisma.conversation.create({
    data: {
      tenantId: base.tenant.id,
      contactId: base.contact.id,
      whatsappAccountId: base.alertAccount.id,
      assignedUserId: base.agent.id,
      stage: ConversationStage.OPEN
    }
  });

  await assert.rejects(() => preflight(base), /used by a conversation/);
});

async function live(
  base: Awaited<ReturnType<typeof createBase>>,
  input: {
    testRunId?: string;
    sendText?: Parameters<typeof runControlledWhatsappAlertTest>[1]["sendText"];
    envOverrides?: Record<string, string | undefined>;
    logs?: unknown[];
  } = {}
) {
  return runControlledWhatsappAlertTest(
    {
      mode: "live",
      tenantId: base.tenant.id,
      actorUserId: base.owner.id,
      targetUserId: base.agent.id,
      testRunId: input.testRunId ?? uuid(),
      confirm: controlledWhatsappTestConfirmation,
      confirmDedicatedNoWebhook: true
    },
    {
      env: env({
        WHATSAPP_ALERT_TEST_ENABLED: "true",
        ...input.envOverrides
      }),
      logger: quietLogger(input.logs),
      sendText:
        input.sendText ??
        (async () => ({
          providerMessageId: "provider-controlled-test",
          providerStatus: "PENDING",
          httpStatus: 201,
          responseReceived: true
        }))
    }
  );
}

test("live rechaza interlocks y confirmaciones incorrectas", async () => {
  const base = await createBase("live-interlocks");

  await assert.rejects(
    () => live(base, { envOverrides: { WHATSAPP_ALERT_TEST_ENABLED: "false" } }),
    /TEST_ENABLED/
  );
  await assert.rejects(
    () => live(base, { envOverrides: { WHATSAPP_ALERTS_ENABLED: "true" } }),
    /ALERTS_ENABLED/
  );
  await assert.rejects(
    () => live(base, { envOverrides: { WHATSAPP_ALERTS_DRY_RUN: "false" } }),
    /DRY_RUN/
  );
  await assert.rejects(
    () =>
      runControlledWhatsappAlertTest(
        {
          mode: "live",
          tenantId: base.tenant.id,
          actorUserId: base.owner.id,
          targetUserId: base.agent.id,
          testRunId: uuid(),
          confirm: "SEND",
          confirmDedicatedNoWebhook: true
        },
        { env: env({ WHATSAPP_ALERT_TEST_ENABLED: "true" }), logger: quietLogger() }
      ),
    /confirmation phrase/
  );
  await assert.rejects(
    () =>
      runControlledWhatsappAlertTest(
        {
          mode: "live",
          tenantId: base.tenant.id,
          actorUserId: base.owner.id,
          targetUserId: base.agent.id,
          testRunId: uuid(),
          confirm: controlledWhatsappTestConfirmation
        },
        { env: env({ WHATSAPP_ALERT_TEST_ENABLED: "true" }), logger: quietLogger() }
      ),
    /no-webhook/
  );
  await assert.rejects(() => live(base, { testRunId: "invalid" }), /valid testRunId/);
});

test("live con fake llama una vez, crea Notification/Delivery y no crea entidades de cliente", async () => {
  const base = await createBase("live-success");
  const before = await counts(base.tenant.id);
  const logs: unknown[] = [];
  let calls = 0;
  const result = await live(base, {
    logs,
    sendText: async (input) => {
      calls += 1;
      assert.equal(input.baseUrl, "https://evolution.test/private");
      assert.equal(input.apiKey, "test-api-key");
      assert.equal(input.number, "+5215512345678");
      assert.equal(input.text.includes("Prueba controlada de JAHF Comm"), true);

      return {
        providerMessageId: "provider-controlled-success",
        providerStatus: "PENDING",
        httpStatus: 201,
        responseReceived: true
      };
    }
  });
  const after = await counts(base.tenant.id);
  const delivery = await prisma.notificationDelivery.findFirstOrThrow({
    where: { tenantId: base.tenant.id }
  });
  const notification = await prisma.notification.findFirstOrThrow({
    where: { tenantId: base.tenant.id }
  });
  const metadata = delivery.metadata as Record<string, unknown>;
  const serializedLogs = JSON.stringify(logs);

  assert.equal(calls, 1);
  assert.equal(result.status, "sent");
  assert.equal(notification.metadata?.toString().includes("unused"), false);
  assert.equal(delivery.status, NotificationDeliveryStatus.SENT);
  assert.equal(delivery.providerMessageId, "provider-controlled-success");
  assert.equal(delivery.attemptCount, 1);
  assert.ok(delivery.sentAt);
  assert.equal((notification.metadata as Record<string, unknown>).source, controlledWhatsappTestSource);
  assert.equal(typeof metadata.messageLength, "number");
  assert.equal((metadata.messageLength as number) > 0, true);
  assert.equal(JSON.stringify(metadata).includes("Prueba controlada"), false);
  assert.equal(JSON.stringify(metadata).includes("test-api-key"), false);
  assert.equal(serializedLogs.includes("+5215512345678"), false);
  assert.equal(serializedLogs.includes("****5678"), true);
  assert.deepEqual(after.slice(2), before.slice(2));
  assert.equal(after[0], before[0] + 1);
  assert.equal(after[1], before[1] + 1);
});

test("live timeout queda UNKNOWN y errores retryable/permanentes quedan FAILED sin segundo intento", async () => {
  const unknownBase = await createBase("live-unknown");
  const retryableBase = await createBase("live-retryable");
  const permanentBase = await createBase("live-permanent");
  let unknownCalls = 0;
  let retryableCalls = 0;
  let permanentCalls = 0;
  const unknown = await live(unknownBase, {
    testRunId: uuid(),
    sendText: async () => {
      unknownCalls += 1;
      throw new EvolutionOutboundError({
        category: "TIMEOUT_UNKNOWN",
        retryable: false,
        deliveryUnknown: true,
        safeMessage: "Timeout unknown."
      });
    }
  });
  const retryable = await live(retryableBase, {
    testRunId: uuid(),
    sendText: async () => {
      retryableCalls += 1;
      throw new EvolutionOutboundError({
        category: "RATE_LIMITED",
        retryable: true,
        deliveryUnknown: false,
        httpStatus: 429,
        safeMessage: "Rate limited."
      });
    }
  });
  const permanent = await live(permanentBase, {
    testRunId: uuid(),
    sendText: async () => {
      permanentCalls += 1;
      throw new EvolutionOutboundError({
        category: "AUTHENTICATION",
        retryable: false,
        deliveryUnknown: false,
        httpStatus: 401,
        safeMessage: "Authentication failed."
      });
    }
  });

  assert.equal(unknownCalls, 1);
  assert.equal(retryableCalls, 1);
  assert.equal(permanentCalls, 1);
  assert.equal(unknown.delivery.status, NotificationDeliveryStatus.UNKNOWN);
  assert.equal(retryable.delivery.status, NotificationDeliveryStatus.FAILED);
  assert.equal(permanent.delivery.status, NotificationDeliveryStatus.FAILED);
  assert.equal(retryable.delivery.attemptCount, 1);
  assert.equal(retryable.delivery.nextAttemptAt, null);
});

test("testRunId reutilizado y concurrencia no vuelven a enviar", async () => {
  const base = await createBase("dedupe");
  const testRunId = uuid();
  let calls = 0;
  const sendText = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));

    return {
      providerMessageId: `provider-${calls}`,
      providerStatus: "PENDING",
      httpStatus: 201,
      responseReceived: true
    };
  };

  await Promise.all([
    live(base, { testRunId, sendText }),
    live(base, { testRunId, sendText })
  ]);
  const duplicate = await live(base, { testRunId, sendText });
  const notifications = await prisma.notification.count({
    where: { tenantId: base.tenant.id }
  });
  const deliveries = await prisma.notificationDelivery.count({
    where: { tenantId: base.tenant.id }
  });

  assert.equal(calls, 1);
  assert.equal(duplicate.status, "duplicate");
  assert.equal(notifications, 1);
  assert.equal(deliveries, 1);
});

test("dos tenants permanecen aislados", async () => {
  const first = await createBase("tenant-one");
  const second = await createBase("tenant-two");

  await live(first, { testRunId: uuid() });

  assert.equal(
    await prisma.notification.count({ where: { tenantId: first.tenant.id } }),
    1
  );
  assert.equal(
    await prisma.notification.count({ where: { tenantId: second.tenant.id } }),
    0
  );
});
