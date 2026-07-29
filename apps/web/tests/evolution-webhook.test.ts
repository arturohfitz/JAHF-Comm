import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test, { after, beforeEach } from "node:test";

function loadEnvFile(path: string) {
  if (!existsSync(path)) {
    return;
  }

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());

    if (!match || process.env[match[1]]) {
      continue;
    }

    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

loadEnvFile("../../.env");
loadEnvFile(".env");

const databaseUrl = process.env.DATABASE_URL_TEST;
const developmentDatabaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL_TEST is required for Evolution webhook tests.");
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
process.env.WEBHOOK_SECRET = "test-webhook-secret";
process.env.AI_CLASSIFICATION_ENABLED = "false";

const {
  ContactStage,
  MembershipRole,
  WhatsAppAccountStatus,
  WhatsAppProvider,
  prisma
} = await import("@jahf-comm/db");
const { POST } = await import("../app/api/webhooks/evolution/route");

const runId = `webhook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let sequence = 0;

beforeEach(() => {
  process.env.WHATSAPP_ALERTS_ALLOW_SHARED_ACCOUNT = "false";
});

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

async function createTenantAccount(label: string) {
  const suffix = nextId(label);
  const tenant = await prisma.tenant.create({
    data: {
      name: `Tenant ${suffix}`,
      slug: `${runId}-${suffix}`
    }
  });
  const account = await prisma.whatsAppAccount.create({
    data: {
      tenantId: tenant.id,
      name: `JAHF Services ${suffix}`,
      phoneNumber: `+52156${sequence.toString().padStart(8, "0")}`,
      normalizedPhoneNumber: `+52156${sequence.toString().padStart(8, "0")}`,
      provider: WhatsAppProvider.EVOLUTION,
      status: WhatsAppAccountStatus.CONNECTED,
      instanceName: `instance-${suffix}`,
      providerInstanceId: `instance-${suffix}`
    }
  });

  return { tenant, account };
}

function payload(input: {
  instanceName: string;
  fromPhone: string;
  providerMessageId: string;
  fromMe?: boolean;
}) {
  return {
    instance: input.instanceName,
    data: {
      key: {
        id: input.providerMessageId,
        remoteJid: `${input.fromPhone.replace(/\D/g, "")}@s.whatsapp.net`,
        fromMe: input.fromMe
      },
      pushName: "Cliente Prueba",
      message: {
        conversation: "Hola, necesito informacion"
      },
      messageTimestamp: 1760000000
    }
  };
}

async function postEvolutionWebhook(body: unknown) {
  const response = await POST(
    new Request("http://localhost/api/webhooks/evolution", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": "test-webhook-secret"
      },
      body: JSON.stringify(body)
    })
  );

  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>
  };
}

async function businessCounts(tenantId: string) {
  const [contacts, conversations, messages, aiClassifications] =
    await Promise.all([
      prisma.contact.count({ where: { tenantId } }),
      prisma.conversation.count({ where: { tenantId } }),
      prisma.message.count({ where: { tenantId } }),
      prisma.aIClassification.count({ where: { tenantId } })
    ]);

  return { contacts, conversations, messages, aiClassifications };
}

test("webhook ignora fromMe=true sin crear datos de negocio ni IA", async () => {
  const { tenant, account } = await createTenantAccount("from-me");
  const before = await businessCounts(tenant.id);
  const result = await postEvolutionWebhook(
    payload({
      instanceName: account.instanceName!,
      fromPhone: "+5215511111111",
      providerMessageId: "from-me-message",
      fromMe: true
    })
  );
  const afterCounts = await businessCounts(tenant.id);

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    ok: true,
    ignored: true,
    reason: "OUTBOUND_FROM_ME"
  });
  assert.deepEqual(afterCounts, before);
  assert.equal("aiQueue" in result.body, false);
});

test("webhook ignora respuesta interna solo en modo compartido", async () => {
  process.env.WHATSAPP_ALERTS_ALLOW_SHARED_ACCOUNT = "true";
  const { tenant, account } = await createTenantAccount("internal-reply");
  const user = await prisma.user.create({
    data: {
      email: `${nextId("user")}@example.com`
    }
  });

  await prisma.membership.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      role: MembershipRole.OWNER
    }
  });
  await prisma.tenantNotificationSettings.create({
    data: {
      tenantId: tenant.id,
      whatsappAlertsAccountId: account.id,
      whatsappAlertsEnabled: true
    }
  });
  await prisma.notificationPreference.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      whatsappEnabled: true,
      whatsappPhone: "+52 1 55 2222 3333"
    }
  });

  const before = await businessCounts(tenant.id);
  const result = await postEvolutionWebhook(
    payload({
      instanceName: account.instanceName!,
      fromPhone: "+5215522223333",
      providerMessageId: "internal-reply-message",
      fromMe: false
    })
  );
  const afterCounts = await businessCounts(tenant.id);

  assert.equal(result.status, 200);
  assert.equal(result.body.ignored, true);
  assert.equal(result.body.reason, "INTERNAL_ALERT_REPLY");
  assert.deepEqual(afterCounts, before);
});

test("cliente normal no se ignora y crea contacto conversacion y mensaje", async () => {
  const { tenant, account } = await createTenantAccount("normal-customer");
  const result = await postEvolutionWebhook(
    payload({
      instanceName: account.instanceName!,
      fromPhone: "+5215533334444",
      providerMessageId: "normal-customer-message",
      fromMe: false
    })
  );
  const contact = await prisma.contact.findFirst({
    where: {
      tenantId: tenant.id,
      normalizedPhoneNumber: "+5215533334444"
    }
  });
  const counts = await businessCounts(tenant.id);

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.ignored, undefined);
  assert.equal(contact?.stage, ContactStage.NEW);
  assert.equal(counts.contacts, 1);
  assert.equal(counts.conversations, 1);
  assert.equal(counts.messages, 1);
});

test("respuesta interna no se ignora cuando shared mode esta apagado", async () => {
  const { tenant, account } = await createTenantAccount("internal-disabled");
  const user = await prisma.user.create({
    data: {
      email: `${nextId("disabled-user")}@example.com`
    }
  });

  await prisma.membership.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      role: MembershipRole.OWNER
    }
  });
  await prisma.tenantNotificationSettings.create({
    data: {
      tenantId: tenant.id,
      whatsappAlertsAccountId: account.id,
      whatsappAlertsEnabled: true
    }
  });
  await prisma.notificationPreference.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      whatsappEnabled: true,
      whatsappPhone: "+52 1 55 4444 5555"
    }
  });

  const result = await postEvolutionWebhook(
    payload({
      instanceName: account.instanceName!,
      fromPhone: "+5215544445555",
      providerMessageId: "internal-disabled-message",
      fromMe: false
    })
  );
  const counts = await businessCounts(tenant.id);

  assert.equal(result.status, 200);
  assert.equal(result.body.ignored, undefined);
  assert.equal(counts.contacts, 1);
  assert.equal(counts.conversations, 1);
  assert.equal(counts.messages, 1);
});
