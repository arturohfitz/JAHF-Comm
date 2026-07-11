import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test, { after } from "node:test";

import { EvolutionOutboundError } from "@jahf-comm/whatsapp";

const execFileAsync = promisify(execFile);
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
const { readControlledWhatsappCliInput } = await import(
  "../scripts/controlled-whatsapp-alert-test"
);

const runId = `controlled-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const sentinelPhone = "5215512345678";
const sentinelPhoneWithPlus = `+${sentinelPhone}`;
const sentinelApiKey = "SUPER_SECRET_API_KEY_SENTINEL";
const sentinelUrl = "https://private-sensitive-evolution.example.internal";
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
  await prisma.user.deleteMany({
    where: {
      email: {
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
    DATABASE_PASSWORD_SENTINEL: "DB_PASSWORD_SENTINEL",
    WEBHOOK_SECRET: "WEBHOOK_SECRET_SENTINEL",
    WHATSAPP_ALERTS_ENABLED: "false",
    WHATSAPP_ALERTS_DRY_RUN: "true",
    WHATSAPP_ALERT_TEST_ENABLED: "false",
    EVOLUTION_API_URL: sentinelUrl,
    EVOLUTION_API_KEY: sentinelApiKey,
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
      whatsappPhone: sentinelPhoneWithPlus,
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

async function trackedSnapshot(base: Awaited<ReturnType<typeof createBase>>) {
  const tenantIds = [base.tenant.id, base.otherTenant.id];
  const userIds = [
    base.owner.id,
    base.admin.id,
    base.agent.id,
    base.viewer.id,
    base.otherUser.id
  ];

  return {
    notifications: await prisma.notification.count({
      where: { tenantId: base.tenant.id }
    }),
    notificationDeliveries: await prisma.notificationDelivery.count({
      where: { tenantId: base.tenant.id }
    }),
    contacts: await prisma.contact.count({ where: { tenantId: base.tenant.id } }),
    conversations: await prisma.conversation.count({
      where: { tenantId: base.tenant.id }
    }),
    messages: await prisma.message.count({ where: { tenantId: base.tenant.id } }),
    customerMemories: await prisma.customerMemory.count({
      where: { tenantId: base.tenant.id }
    }),
    aiClassifications: await prisma.aIClassification.count({
      where: { tenantId: base.tenant.id }
    }),
    customerEvents: await prisma.customerEvent.count({
      where: { tenantId: base.tenant.id }
    }),
    notificationPreferences: await prisma.notificationPreference.count({
      where: { tenantId: base.tenant.id }
    }),
    tenantNotificationSettings: await prisma.tenantNotificationSettings.count({
      where: { tenantId: base.tenant.id }
    }),
    whatsappAccounts: await prisma.whatsAppAccount.count({
      where: { tenantId: base.tenant.id }
    }),
    memberships: await prisma.membership.count({
      where: { tenantId: { in: tenantIds } }
    }),
    users: await prisma.user.count({ where: { id: { in: userIds } } }),
    tenants: await prisma.tenant.count({ where: { id: { in: tenantIds } } })
  };
}

async function preflight(
  base: Awaited<ReturnType<typeof createBase>>,
  input: {
    actorUserId?: string;
    targetUserId?: string;
    envOverrides?: Record<string, string | undefined>;
    sendText?: Parameters<typeof runControlledWhatsappAlertTest>[1]["sendText"];
  } = {}
) {
  return runControlledWhatsappAlertTest(
    {
      mode: "preflight",
      tenantId: base.tenant.id,
      actorUserId: input.actorUserId ?? base.owner.id,
      targetUserId: input.targetUserId ?? base.agent.id
    },
    {
      env: env(input.envOverrides),
      logger: quietLogger(),
      sendText: input.sendText
    }
  );
}

async function live(
  base: Awaited<ReturnType<typeof createBase>>,
  input: {
    testRunId?: string;
    confirm?: string;
    confirmDedicatedNoWebhook?: boolean;
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
      confirm: input.confirm ?? controlledWhatsappTestConfirmation,
      confirmDedicatedNoWebhook: input.confirmDedicatedNoWebhook ?? true
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

async function successfulLiveCase(label: string) {
  const base = await createBase(label);
  const before = await trackedSnapshot(base);
  const logs: unknown[] = [];
  let calls = 0;
  const result = await live(base, {
    logs,
    sendText: async (input) => {
      calls += 1;
      assert.equal(input.baseUrl, sentinelUrl);
      assert.equal(input.apiKey, sentinelApiKey);
      assert.equal(input.number, sentinelPhoneWithPlus);
      assert.equal(input.text.includes("Prueba controlada de JAHF Comm"), true);
      assert.equal("textMessage" in input, false);

      return {
        providerMessageId: "provider-controlled-success",
        providerStatus: "PENDING",
        httpStatus: 201,
        responseReceived: true
      };
    }
  });
  const after = await trackedSnapshot(base);
  const delivery = await prisma.notificationDelivery.findFirstOrThrow({
    where: { tenantId: base.tenant.id }
  });
  const notification = await prisma.notification.findFirstOrThrow({
    where: { tenantId: base.tenant.id }
  });

  return { base, before, after, calls, result, delivery, notification, logs };
}

function assertSafeSerializedOutput(serialized: string) {
  assert.equal(serialized.includes(sentinelPhone), false);
  assert.equal(serialized.includes(sentinelPhoneWithPlus), false);
  assert.equal(serialized.includes("****5678"), true);
  assert.equal(serialized.includes(sentinelApiKey), false);
  assert.equal(serialized.includes(sentinelUrl), false);
  assert.equal(serialized.includes("DB_PASSWORD_SENTINEL"), false);
  assert.equal(serialized.includes("WEBHOOK_SECRET_SENTINEL"), false);
  assert.equal(serialized.includes("Prueba controlada de JAHF Comm"), false);
  assert.equal(serialized.includes("Este es un mensaje de prueba"), false);
}

function controlledSource() {
  return readFileSync(
    new URL("../src/controlled-whatsapp-alert-test.ts", import.meta.url),
    "utf8"
  );
}

test("01 preflight no llama sendEvolutionText", async () => {
  const base = await createBase("preflight-no-send");
  let calls = 0;

  await preflight(base, {
    sendText: async () => {
      calls += 1;
      throw new Error("sender must not run in preflight");
    }
  });

  assert.equal(calls, 0);
});

test("02 preflight no crea Notification", async () => {
  const base = await createBase("preflight-no-notification");
  const before = await prisma.notification.count({ where: { tenantId: base.tenant.id } });

  await preflight(base);

  assert.equal(
    await prisma.notification.count({ where: { tenantId: base.tenant.id } }),
    before
  );
});

test("03 preflight no crea NotificationDelivery", async () => {
  const base = await createBase("preflight-no-delivery");
  const before = await prisma.notificationDelivery.count({
    where: { tenantId: base.tenant.id }
  });

  await preflight(base);

  assert.equal(
    await prisma.notificationDelivery.count({ where: { tenantId: base.tenant.id } }),
    before
  );
});

test("04 preflight mantiene snapshot read-only de todas las tablas sensibles", async () => {
  const base = await createBase("preflight-read-only");
  const before = await trackedSnapshot(base);

  await preflight(base);

  assert.deepEqual(await trackedSnapshot(base), before);
});

test("05 preflight genera testRunId UUID", async () => {
  const result = await preflight(await createBase("preflight-uuid"));

  assert.match(result.testRunId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test("06 preflight enmascara teléfono", async () => {
  const result = await preflight(await createBase("preflight-mask"));

  assert.equal(result.destinationMasked, "*********5678");
});

test("07 preflight no muestra API key", async () => {
  const result = await preflight(await createBase("preflight-no-key"));

  assert.equal(JSON.stringify(result).includes(sentinelApiKey), false);
});

test("08 preflight no muestra URL completa", async () => {
  const result = await preflight(await createBase("preflight-no-url"));

  assert.equal(JSON.stringify(result).includes(sentinelUrl), false);
});

test("09 preflight rechaza actor AGENT", async () => {
  const base = await createBase("preflight-agent-actor");

  await assert.rejects(
    () => preflight(base, { actorUserId: base.agent.id }),
    /OWNER or ADMIN/
  );
});

test("10 preflight rechaza actor VIEWER", async () => {
  const base = await createBase("preflight-viewer-actor");

  await assert.rejects(
    () => preflight(base, { actorUserId: base.viewer.id }),
    /OWNER or ADMIN/
  );
});

test("11 preflight acepta OWNER", async () => {
  const base = await createBase("preflight-owner");
  const result = await preflight(base, { actorUserId: base.owner.id });

  assert.equal(result.actor.role, MembershipRole.OWNER);
});

test("12 preflight acepta ADMIN", async () => {
  const base = await createBase("preflight-admin");
  const result = await preflight(base, { actorUserId: base.admin.id });

  assert.equal(result.actor.role, MembershipRole.ADMIN);
});

test("13 preflight rechaza destinatario de otro tenant", async () => {
  const base = await createBase("preflight-other-tenant-target");

  await assert.rejects(
    () => preflight(base, { targetUserId: base.otherUser.id }),
    /operational member/
  );
});

test("14 preflight rechaza destinatario VIEWER", async () => {
  const base = await createBase("preflight-viewer-target");

  await assert.rejects(
    () => preflight(base, { targetUserId: base.viewer.id }),
    /operational member/
  );
});

test("15 preflight rechaza preferencia desactivada", async () => {
  const base = await createBase("preflight-disabled-preference");

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

test("16 el modelo impide configurar cuenta dedicada de otro tenant", async () => {
  const base = await createBase("preflight-other-tenant-account");
  const otherAccount = await prisma.whatsAppAccount.create({
    data: {
      tenantId: base.otherTenant.id,
      name: "Alertas otro tenant",
      phoneNumber: `+52222${sequence.toString().padStart(8, "0")}`,
      normalizedPhoneNumber: `+52222${sequence.toString().padStart(8, "0")}`,
      provider: WhatsAppProvider.EVOLUTION,
      status: WhatsAppAccountStatus.CONNECTED,
      instanceName: `other-tenant-${sequence}`,
      providerInstanceId: `other-tenant-${sequence}`
    }
  });

  await assert.rejects(
    () =>
      prisma.tenantNotificationSettings.update({
        where: { tenantId: base.tenant.id },
        data: { whatsappAlertsAccountId: otherAccount.id }
      }),
    /Foreign key constraint|No 'WhatsAppAccount' record/
  );
});

test("17 preflight rechaza cuenta desconectada", async () => {
  const base = await createBase("preflight-disconnected");

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
});

test("18 preflight advierte confirmación manual del webhook", async () => {
  const result = await preflight(await createBase("preflight-manual-webhook"));

  assert.equal(
    result.pendingConfirmations.some((item) =>
      item.includes("Confirmacion manual requerida")
    ),
    true
  );
});

test("19 live rechaza WHATSAPP_ALERT_TEST_ENABLED=false", async () => {
  const base = await createBase("live-test-disabled");

  await assert.rejects(
    () =>
      live(base, {
        envOverrides: { WHATSAPP_ALERT_TEST_ENABLED: "false" }
      }),
    /TEST_ENABLED/
  );
});

test("20 live rechaza alertas generales habilitadas", async () => {
  const base = await createBase("live-alerts-enabled");

  await assert.rejects(
    () =>
      live(base, {
        envOverrides: { WHATSAPP_ALERTS_ENABLED: "true" }
      }),
    /ALERTS_ENABLED/
  );
});

test("21 live rechaza dry-run general desactivado", async () => {
  const base = await createBase("live-dryrun-disabled");

  await assert.rejects(
    () =>
      live(base, {
        envOverrides: { WHATSAPP_ALERTS_DRY_RUN: "false" }
      }),
    /DRY_RUN/
  );
});

test("22 live rechaza frase de confirmación incorrecta", async () => {
  const base = await createBase("live-bad-confirm");

  await assert.rejects(
    () => live(base, { confirm: "SEND" }),
    /confirmation phrase/
  );
});

test("23 live rechaza ausencia de confirmDedicatedNoWebhook", async () => {
  const base = await createBase("live-missing-no-webhook");

  await assert.rejects(
    () =>
      live(base, {
        confirmDedicatedNoWebhook: false
      }),
    /no-webhook/
  );
});

test("24 live rechaza testRunId inválido", async () => {
  const base = await createBase("live-invalid-uuid");

  await assert.rejects(
    () => live(base, { testRunId: "invalid" }),
    /valid testRunId/
  );
});

test("25 live con fake llama exactamente una vez", async () => {
  assert.equal((await successfulLiveCase("live-one-call")).calls, 1);
});

test("26 live crea una Notification", async () => {
  const state = await successfulLiveCase("live-notification");

  assert.equal(state.after.notifications, state.before.notifications + 1);
});

test("27 live crea una NotificationDelivery", async () => {
  const state = await successfulLiveCase("live-delivery");

  assert.equal(state.after.notificationDeliveries, state.before.notificationDeliveries + 1);
});

test("28 live no crea Contact", async () => {
  const state = await successfulLiveCase("live-no-contact");

  assert.equal(state.after.contacts, state.before.contacts);
});

test("29 live no crea Conversation", async () => {
  const state = await successfulLiveCase("live-no-conversation");

  assert.equal(state.after.conversations, state.before.conversations);
});

test("30 live no crea Message", async () => {
  const state = await successfulLiveCase("live-no-message");

  assert.equal(state.after.messages, state.before.messages);
});

test("31 live no crea CustomerMemory", async () => {
  const state = await successfulLiveCase("live-no-memory");

  assert.equal(state.after.customerMemories, state.before.customerMemories);
});

test("32 live no crea AIClassification", async () => {
  const state = await successfulLiveCase("live-no-ai");

  assert.equal(state.after.aiClassifications, state.before.aiClassifications);
});

test("33 live exitoso termina SENT", async () => {
  const state = await successfulLiveCase("live-sent");

  assert.equal(state.result.status, "sent");
  assert.equal(state.delivery.status, NotificationDeliveryStatus.SENT);
});

test("34 live guarda providerMessageId", async () => {
  const state = await successfulLiveCase("live-provider-id");

  assert.equal(state.delivery.providerMessageId, "provider-controlled-success");
});

test("35 TIMEOUT_UNKNOWN termina UNKNOWN con una llamada", async () => {
  const base = await createBase("live-timeout");
  let calls = 0;
  const result = await live(base, {
    sendText: async () => {
      calls += 1;
      throw new EvolutionOutboundError({
        category: "TIMEOUT_UNKNOWN",
        retryable: false,
        deliveryUnknown: true,
        safeMessage: "Timeout unknown."
      });
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.delivery.status, NotificationDeliveryStatus.UNKNOWN);
});

test("36 error transitorio termina FAILED sin segundo intento", async () => {
  const base = await createBase("live-retryable");
  let calls = 0;
  const result = await live(base, {
    sendText: async () => {
      calls += 1;
      throw new EvolutionOutboundError({
        category: "RATE_LIMITED",
        retryable: true,
        deliveryUnknown: false,
        httpStatus: 429,
        safeMessage: "Rate limited."
      });
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.delivery.status, NotificationDeliveryStatus.FAILED);
  assert.equal(result.delivery.attemptCount, 1);
  assert.equal(result.delivery.nextAttemptAt, null);
});

test("37 error permanente termina FAILED sin segundo intento", async () => {
  const base = await createBase("live-permanent");
  let calls = 0;
  const result = await live(base, {
    sendText: async () => {
      calls += 1;
      throw new EvolutionOutboundError({
        category: "AUTHENTICATION",
        retryable: false,
        deliveryUnknown: false,
        httpStatus: 401,
        safeMessage: "Authentication failed."
      });
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.delivery.status, NotificationDeliveryStatus.FAILED);
  assert.equal(result.delivery.attemptCount, 1);
  assert.equal(result.delivery.nextAttemptAt, null);
});

test("38 testRunId reutilizado no vuelve a enviar", async () => {
  const base = await createBase("live-reused");
  const testRunId = uuid();
  let calls = 0;
  const sendText = async () => {
    calls += 1;

    return {
      providerMessageId: "provider-reused",
      providerStatus: "PENDING",
      httpStatus: 201,
      responseReceived: true
    };
  };

  await live(base, { testRunId, sendText });
  const duplicate = await live(base, { testRunId, sendText });

  assert.equal(calls, 1);
  assert.equal(duplicate.status, "duplicate");
});

test("39 dos ejecuciones concurrentes permiten un solo envío respaldado por unique key", async () => {
  const base = await createBase("live-concurrent");
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
  const results = await Promise.all([
    live(base, { testRunId, sendText }),
    live(base, { testRunId, sendText })
  ]);

  assert.equal(calls, 1);
  assert.deepEqual(
    results.map((result) => result.status).sort(),
    ["duplicate", "sent"]
  );
  assert.equal(
    await prisma.notification.count({ where: { tenantId: base.tenant.id } }),
    1
  );
  assert.equal(
    await prisma.notificationDelivery.count({ where: { tenantId: base.tenant.id } }),
    1
  );
  assert.equal(
    await prisma.notification.count({
      where: {
        tenantId: base.tenant.id,
        deduplicationKey: {
          startsWith: `internal-whatsapp-test:v1:${base.tenant.id}:${base.agent.id}:${testRunId}`
        }
      }
    }),
    1
  );
});

test("40 metadata no contiene texto completo", async () => {
  const state = await successfulLiveCase("live-metadata-text");

  assert.equal(JSON.stringify(state.delivery.metadata).includes("Prueba controlada"), false);
  assert.equal(JSON.stringify(state.notification.metadata).includes("Este es un mensaje"), false);
});

test("41 metadata no contiene API key", async () => {
  const state = await successfulLiveCase("live-metadata-key");

  assert.equal(JSON.stringify(state.delivery.metadata).includes(sentinelApiKey), false);
  assert.equal(JSON.stringify(state.notification.metadata).includes(sentinelApiKey), false);
});

test("42 logs usan destino enmascarado", async () => {
  const state = await successfulLiveCase("live-logs");
  const serializedLogs = JSON.stringify(state.logs);

  assert.equal(serializedLogs.includes(sentinelPhone), false);
  assert.equal(serializedLogs.includes("****5678"), true);
});

test("43 dos tenants permanecen aislados", async () => {
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

test("44 la prueba controlada no usa BullMQ ni backoff para reintentar", () => {
  const source = controlledSource();

  assert.equal(source.includes("bullmq"), false);
  assert.equal(source.includes("new Queue"), false);
  assert.equal(source.includes(".add("), false);
  assert.equal(source.includes("setTimeout"), false);
  assert.equal(source.includes("backoff"), false);
  assert.equal(source.includes("nextAttemptAt: null"), true);
});

test("45 no existe fallback de payload legacy en la herramienta controlada", () => {
  const source = controlledSource();

  assert.equal(source.includes("textMessage"), false);
  assert.equal(source.includes("extendedTextMessage"), false);
  assert.equal(source.includes("legacy"), false);
});

test("46 preflight no usa fetch ni POST directo", () => {
  const source = controlledSource();

  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes('method: "POST"'), false);
  assert.equal(source.includes("method: 'POST'"), false);
});

test("47 salida preflight segura no expone secretos centinela", async () => {
  const result = await preflight(await createBase("preflight-safe-output"));

  assertSafeSerializedOutput(JSON.stringify(result));
});

test("48 comando CLI preflight parsea el contrato exacto", () => {
  const input = readControlledWhatsappCliInput([
    "--mode",
    "preflight",
    "--tenantId",
    "tenant-id",
    "--actorUserId",
    "owner-or-admin-id",
    "--targetUserId",
    "recipient-id"
  ]);

  assert.deepEqual(input, {
    mode: "preflight",
    tenantId: "tenant-id",
    actorUserId: "owner-or-admin-id",
    targetUserId: "recipient-id",
    testRunId: undefined,
    confirm: undefined,
    confirmDedicatedNoWebhook: false
  });
});

test("49 CLI falla si falta --mode", () => {
  assert.throws(
    () =>
      readControlledWhatsappCliInput([
        "--tenantId",
        "tenant-id",
        "--actorUserId",
        "owner-id",
        "--targetUserId",
        "target-id"
      ]),
    /Use --mode preflight or --mode live/
  );
});

test("50 CLI falla si --mode es inválido", () => {
  assert.throws(
    () =>
      readControlledWhatsappCliInput([
        "--mode",
        "invalid",
        "--tenantId",
        "tenant-id",
        "--actorUserId",
        "owner-id",
        "--targetUserId",
        "target-id"
      ]),
    /Use --mode preflight or --mode live/
  );
});

test("51 CLI falla si faltan argumentos requeridos sin imprimir secretos", () => {
  assert.throws(
    () =>
      readControlledWhatsappCliInput([
        "--mode",
        "preflight",
        "--tenantId",
        "tenant-id"
      ]),
    (error) => {
      const serialized = JSON.stringify(error);

      assert.equal(serialized.includes(sentinelApiKey), false);
      assert.equal(serialized.includes(sentinelUrl), false);

      return /tenantId, --actorUserId and --targetUserId/.test(
        error instanceof Error ? error.message : ""
      );
    }
  );
});

test("52 preflight no necesita WHATSAPP_ALERT_TEST_ENABLED=true", async () => {
  const result = await preflight(await createBase("preflight-test-disabled"), {
    envOverrides: { WHATSAPP_ALERT_TEST_ENABLED: "false" }
  });

  assert.equal(result.env.whatsappAlertTestEnabled, false);
});

test("53 preflight requiere WHATSAPP_ALERTS_ENABLED=false", async () => {
  const base = await createBase("preflight-alerts-enabled");

  await assert.rejects(
    () =>
      preflight(base, {
        envOverrides: { WHATSAPP_ALERTS_ENABLED: "true" }
      }),
    /ALERTS_ENABLED/
  );
});

test("54 preflight requiere WHATSAPP_ALERTS_DRY_RUN=true", async () => {
  const base = await createBase("preflight-dryrun-disabled");

  await assert.rejects(
    () =>
      preflight(base, {
        envOverrides: { WHATSAPP_ALERTS_DRY_RUN: "false" }
      }),
    /DRY_RUN/
  );
});

test("55 CLI preflight real no expone secretos en stdout ni stderr", async () => {
  const base = await createBase("cli-preflight-safe");
  const { stdout, stderr } = await execFileAsync(
    fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url)),
    [
      fileURLToPath(
        new URL("../scripts/controlled-whatsapp-alert-test.ts", import.meta.url)
      ),
      "--mode",
      "preflight",
      "--tenantId",
      base.tenant.id,
      "--actorUserId",
      base.owner.id,
      "--targetUserId",
      base.agent.id
    ],
    {
      env: {
        ...env(),
        PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`
      },
      cwd: fileURLToPath(new URL("..", import.meta.url))
    }
  );

  assertSafeSerializedOutput(`${stdout}\n${stderr}`);
});
