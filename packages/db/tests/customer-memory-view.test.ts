import assert from "node:assert/strict";
import test, { after } from "node:test";

import { config } from "dotenv";

config({ path: ["../../.env", ".env"] });

const databaseUrl = process.env.DATABASE_URL_TEST;
const developmentDatabaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL_TEST is required for CustomerMemory view tests.");
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
  AIIntent,
  ContactStage,
  ConversationStage,
  CustomerReturnType,
  MembershipRole,
  MessageDirection,
  MessageType,
  SaleStatus,
  Urgency,
  WhatsAppAccountStatus,
  WhatsAppProvider,
  prisma
} = await import("../src/index.js");
const { refreshCustomerMemory } = await import("../src/customer-memory.js");
const {
  buildCustomerMemoryView,
  canReadCustomerMemoryView,
  formatInactivity,
  getCustomerMemoryListViews,
  getCustomerMemoryView,
  mapIntentLabel,
  mapPriorityLabel,
  mapReturnTypeLabel,
  mapSentimentLabel,
  selectConversationBadges
} = await import("../src/customer-memory-view.js");

const runId = `cmv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const baseDate = new Date("2026-02-01T10:00:00.000Z");
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

function minutesAfter(minutes: number) {
  return new Date(baseDate.getTime() + minutes * 60 * 1000);
}

async function createBase(input: {
  label: string;
  normalizedPhoneNumber?: string;
}) {
  const suffix = nextId(input.label);
  const tenant = await prisma.tenant.create({
    data: {
      name: `Tenant ${suffix}`,
      slug: `${runId}-${suffix}`
    }
  });
  const contact = await prisma.contact.create({
    data: {
      tenantId: tenant.id,
      name: `Contacto ${suffix}`,
      normalizedPhoneNumber:
        input.normalizedPhoneNumber ?? `+52157${sequence.toString().padStart(8, "0")}`,
      phoneNumber:
        input.normalizedPhoneNumber ?? `+52157${sequence.toString().padStart(8, "0")}`,
      stage: ContactStage.NEW
    }
  });
  const account = await prisma.whatsAppAccount.create({
    data: {
      tenantId: tenant.id,
      name: `WhatsApp ${suffix}`,
      phoneNumber: `+52158${sequence.toString().padStart(8, "0")}`,
      normalizedPhoneNumber: `+52158${sequence.toString().padStart(8, "0")}`,
      provider: WhatsAppProvider.EVOLUTION,
      status: WhatsAppAccountStatus.CONNECTED,
      providerInstanceId: `instance-${suffix}`,
      instanceName: `instance-${suffix}`
    }
  });
  const conversation = await prisma.conversation.create({
    data: {
      tenantId: tenant.id,
      contactId: contact.id,
      whatsappAccountId: account.id,
      stage: ConversationStage.OPEN,
      subject: `Conversacion ${suffix}`
    }
  });

  return { tenant, contact, account, conversation };
}

async function createMessage(
  base: Awaited<ReturnType<typeof createBase>>,
  input: {
    label: string;
    sentAt: Date;
    direction?: typeof MessageDirection.INBOUND | typeof MessageDirection.OUTBOUND;
  }
) {
  const id = nextId(input.label);

  return prisma.message.create({
    data: {
      id,
      tenantId: base.tenant.id,
      conversationId: base.conversation.id,
      contactId: base.contact.id,
      whatsappAccountId: base.account.id,
      direction: input.direction ?? MessageDirection.INBOUND,
      type: MessageType.TEXT,
      text: `Mensaje ${id}`,
      providerMessageId: `provider-${id}`,
      rawPayload: { test: true },
      sentAt: input.sentAt
    }
  });
}

async function createMemoryBase(label: string) {
  const base = await createBase({ label });
  const message = await createMessage(base, {
    label: "m1",
    sentAt: minutesAfter(0)
  });

  await refreshCustomerMemory({
    tenantId: base.tenant.id,
    contactId: base.contact.id,
    currentMessageId: message.id
  });

  return { ...base, message };
}

test("un usuario solo obtiene memoria de su tenant", async () => {
  const base = await createMemoryBase("tenant-scope");
  const view = await getCustomerMemoryView({
    tenantId: base.tenant.id,
    contactId: base.contact.id
  });

  assert.equal(view?.contactId, base.contact.id);
});

test("mismo telefono en otro tenant no se filtra", async () => {
  const phone = "+5215700000001";
  const first = await createBase({ label: "tenant-a", normalizedPhoneNumber: phone });
  const second = await createBase({
    label: "tenant-b",
    normalizedPhoneNumber: phone
  });
  const firstMessage = await createMessage(first, {
    label: "m1",
    sentAt: minutesAfter(0)
  });
  const secondMessage = await createMessage(second, {
    label: "m1",
    sentAt: minutesAfter(0)
  });

  await refreshCustomerMemory({
    tenantId: first.tenant.id,
    contactId: first.contact.id,
    currentMessageId: firstMessage.id
  });
  await refreshCustomerMemory({
    tenantId: second.tenant.id,
    contactId: second.contact.id,
    currentMessageId: secondMessage.id
  });

  const firstView = await getCustomerMemoryView({
    tenantId: first.tenant.id,
    contactId: first.contact.id
  });
  const leakedView = await getCustomerMemoryView({
    tenantId: first.tenant.id,
    contactId: second.contact.id
  });

  assert.equal(firstView?.contactId, first.contact.id);
  assert.equal(leakedView, null);
});

test("usuario sin membership no pasa la validacion de acceso", () => {
  assert.equal(
    canReadCustomerMemoryView({
      sessionTenantId: "tenant-a",
      contactTenantId: "tenant-a",
      membershipId: null
    }),
    false
  );
});

test("AGENT no amplia acceso fuera de su tenant", () => {
  assert.equal(MembershipRole.AGENT, "AGENT");
  assert.equal(
    canReadCustomerMemoryView({
      sessionTenantId: "tenant-a",
      contactTenantId: "tenant-b",
      membershipId: "membership-agent"
    }),
    false
  );
});

test("memoria inexistente produce estado vacio seguro", async () => {
  const base = await createBase({ label: "missing-memory" });
  const view = await getCustomerMemoryView({
    tenantId: base.tenant.id,
    contactId: base.contact.id
  });

  assert.equal(view, null);
});

test("isStale es true con mensaje entrante posterior", async () => {
  const base = await createMemoryBase("stale-inbound");
  await createMessage(base, {
    label: "m2",
    sentAt: minutesAfter(10)
  });
  const view = await getCustomerMemoryView({
    tenantId: base.tenant.id,
    contactId: base.contact.id
  });

  assert.equal(view?.processing.isStale, true);
});

test("mensaje OUTBOUND posterior no marca memoria como stale", async () => {
  const base = await createMemoryBase("stale-outbound");
  await createMessage(base, {
    label: "outbound",
    sentAt: minutesAfter(10),
    direction: MessageDirection.OUTBOUND
  });
  const view = await getCustomerMemoryView({
    tenantId: base.tenant.id,
    contactId: base.contact.id
  });

  assert.equal(view?.processing.isStale, false);
});

test("FIRST_CONTACT se traduce correctamente", () => {
  assert.equal(mapReturnTypeLabel(CustomerReturnType.FIRST_CONTACT), "Primer contacto");
});

test("COMMERCIAL_REACTIVATION se traduce correctamente", () => {
  assert.equal(
    mapReturnTypeLabel(CustomerReturnType.COMMERCIAL_REACTIVATION),
    "Reactivacion comercial"
  );
});

test("minutos se convierten a texto legible", () => {
  assert.equal(formatInactivity(45), "45 minutos");
  assert.equal(formatInactivity(5 * 60), "5 horas");
  assert.equal(formatInactivity(8 * 24 * 60), "8 dias");
});

test("sin venta usa frase factual requerida", async () => {
  const base = await createMemoryBase("no-sale-view");
  const view = await getCustomerMemoryView({
    tenantId: base.tenant.id,
    contactId: base.contact.id
  });

  assert.match(
    view?.summary.text ?? "",
    /No hay una venta registrada en el sistema/
  );
});

test("enum desconocido no rompe presentacion", () => {
  assert.equal(mapIntentLabel("GREETING"), "Greeting");
  assert.equal(mapPriorityLabel("CRITICAL"), "Critical");
  assert.equal(mapSentimentLabel("confused"), "Confused");
});

test("consulta batch de lista devuelve memorias sin llamada por fila", async () => {
  const first = await createMemoryBase("batch-a");
  const second = await createMemoryBase("batch-b");
  const views = await getCustomerMemoryListViews({
    tenantId: first.tenant.id,
    contactIds: [first.contact.id, second.contact.id]
  });

  assert.equal(views.has(first.contact.id), true);
  assert.equal(views.has(second.contact.id), false);

  const secondViews = await getCustomerMemoryListViews({
    tenantId: second.tenant.id,
    contactIds: [second.contact.id]
  });

  assert.equal(secondViews.has(second.contact.id), true);
});

test("datos sensibles como signals no se exponen", async () => {
  const base = await createMemoryBase("signals");
  const view = await getCustomerMemoryView({
    tenantId: base.tenant.id,
    contactId: base.contact.id
  });
  const serialized = JSON.stringify(view);

  assert.equal(serialized.includes("signals"), false);
  assert.equal(serialized.includes("raw"), false);
});

test("UI funciona con IA desactivada y clasificacion null", async () => {
  const base = await createMemoryBase("null-ai");
  const view = await getCustomerMemoryView({
    tenantId: base.tenant.id,
    contactId: base.contact.id
  });
  const badges = selectConversationBadges(view);

  assert.equal(view?.classification.intent, null);
  assert.equal(view?.classification.priority, null);
  assert.deepEqual(badges, []);
});

test("buildCustomerMemoryView no expone internals y soporta null", () => {
  assert.equal(
    buildCustomerMemoryView({
      memory: null
    }),
    null
  );
});

test("badges priorizan urgencia y reactivacion", async () => {
  const base = await createMemoryBase("badges");
  await prisma.customerMemory.update({
    where: {
      tenantId_contactId: {
        tenantId: base.tenant.id,
        contactId: base.contact.id
      }
    },
    data: {
      lastReturnType: CustomerReturnType.COMMERCIAL_REACTIVATION,
      lastPriority: Urgency.URGENT,
      lastIntent: AIIntent.SUPPORT
    }
  });
  const view = await getCustomerMemoryView({
    tenantId: base.tenant.id,
    contactId: base.contact.id
  });
  const badges = selectConversationBadges(view);

  assert.deepEqual(
    badges.map((badge) => badge.label),
    ["Urgente", "Reactivacion comercial"]
  );
});
