import assert from "node:assert/strict";
import test, { after } from "node:test";

import { config } from "dotenv";

config({ path: ["../../.env", ".env"] });

const databaseUrl = process.env.DATABASE_URL_TEST;
const developmentDatabaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL_TEST is required for CustomerMemory tests.");
}

const testDatabase = new URL(databaseUrl);
const databaseName = testDatabase.pathname.replace("/", "");
const acceptedTestDatabaseMarkers = ["test", "testing"];

if (
  !acceptedTestDatabaseMarkers.some((marker) =>
    databaseName.toLowerCase().includes(marker)
  )
) {
  throw new Error("DATABASE_URL_TEST must point to a database marked as test.");
}

if (developmentDatabaseUrl) {
  const developmentDatabase = new URL(developmentDatabaseUrl);
  const sameDatabase =
    developmentDatabase.host === testDatabase.host &&
    developmentDatabase.pathname === testDatabase.pathname;

  if (sameDatabase) {
    throw new Error("DATABASE_URL_TEST must not point to the same database as DATABASE_URL.");
  }
}

process.env.DATABASE_URL = databaseUrl;

const {
  AIIntent,
  ContactStage,
  ConversationStage,
  CustomerReturnType,
  MessageDirection,
  MessageType,
  PaymentStatus,
  SaleStatus,
  Urgency,
  WhatsAppAccountStatus,
  WhatsAppProvider,
  prisma
} = await import("../src/index.js");
const {
  applyAIClassificationToMemory,
  buildHeuristicCommercialSummary,
  refreshCustomerMemory
} = await import("../src/customer-memory.js");
const { runCustomerMemoryBackfill } = await import(
  "../scripts/backfill-customer-memory.js"
);

const runId = `cm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const baseDate = new Date("2026-01-01T10:00:00.000Z");
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
        input.normalizedPhoneNumber ?? `+52155${sequence.toString().padStart(8, "0")}`,
      phoneNumber:
        input.normalizedPhoneNumber ?? `+52155${sequence.toString().padStart(8, "0")}`,
      stage: ContactStage.NEW
    }
  });
  const account = await prisma.whatsAppAccount.create({
    data: {
      tenantId: tenant.id,
      name: `WhatsApp ${suffix}`,
      phoneNumber: `+52156${sequence.toString().padStart(8, "0")}`,
      normalizedPhoneNumber: `+52156${sequence.toString().padStart(8, "0")}`,
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
    createdAt?: Date;
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
      sentAt: input.sentAt,
      createdAt: input.createdAt
    }
  });
}

async function createSale(base: Awaited<ReturnType<typeof createBase>>) {
  return prisma.sale.create({
    data: {
      tenantId: base.tenant.id,
      contactId: base.contact.id,
      conversationId: base.conversation.id,
      product: "Producto confirmado",
      amountCents: 10000,
      currency: "MXN",
      soldAt: minutesAfter(15),
      status: SaleStatus.PAID
    }
  });
}

test("primer mensaje entrante crea FIRST_CONTACT", async () => {
  const base = await createBase({ label: "first" });
  const message = await createMessage(base, {
    label: "m1",
    sentAt: minutesAfter(0)
  });
  const memory = await refreshCustomerMemory({
    tenantId: base.tenant.id,
    contactId: base.contact.id,
    currentMessageId: message.id
  });

  assert.equal(memory.lastReturnType, CustomerReturnType.FIRST_CONTACT);
  assert.equal(memory.messageCount, 1);
  assert.equal(memory.inboundMessageCount, 1);
  assert.equal(memory.hasPreviousInteractions, false);
  assert.equal(memory.isReturningCustomer, false);
});

test("segundo mensaje despues de dos horas queda ACTIVE_CONVERSATION", async () => {
  const base = await createBase({ label: "active" });
  await createMessage(base, { label: "m1", sentAt: minutesAfter(0) });
  const message = await createMessage(base, {
    label: "m2",
    sentAt: minutesAfter(120)
  });
  const memory = await refreshCustomerMemory({
    tenantId: base.tenant.id,
    contactId: base.contact.id,
    currentMessageId: message.id
  });

  assert.equal(memory.lastReturnType, CustomerReturnType.ACTIVE_CONVERSATION);
  assert.equal(memory.hasPreviousInteractions, true);
  assert.equal(memory.isReturningCustomer, false);
});

test("regreso despues de 25 horas queda OPERATIONAL_RETURN", async () => {
  const base = await createBase({ label: "operational" });
  await createMessage(base, { label: "m1", sentAt: minutesAfter(0) });
  const message = await createMessage(base, {
    label: "m2",
    sentAt: minutesAfter(25 * 60)
  });
  const memory = await refreshCustomerMemory({
    tenantId: base.tenant.id,
    contactId: base.contact.id,
    currentMessageId: message.id
  });

  assert.equal(memory.lastReturnType, CustomerReturnType.OPERATIONAL_RETURN);
  assert.equal(memory.isReturningCustomer, true);
});

test("regreso despues de ocho dias queda COMMERCIAL_REACTIVATION", async () => {
  const base = await createBase({ label: "reactivation" });
  await createMessage(base, { label: "m1", sentAt: minutesAfter(0) });
  const message = await createMessage(base, {
    label: "m2",
    sentAt: minutesAfter(8 * 24 * 60)
  });
  const memory = await refreshCustomerMemory({
    tenantId: base.tenant.id,
    contactId: base.contact.id,
    currentMessageId: message.id
  });

  assert.equal(
    memory.lastReturnType,
    CustomerReturnType.COMMERCIAL_REACTIVATION
  );
  assert.equal(memory.isReturningCustomer, true);
});

test("mensaje saliente del agente no reinicia inactividad", async () => {
  const base = await createBase({ label: "outbound" });
  await createMessage(base, { label: "m1", sentAt: minutesAfter(0) });
  await createMessage(base, {
    label: "agent",
    sentAt: minutesAfter(8 * 24 * 60),
    direction: MessageDirection.OUTBOUND
  });
  const message = await createMessage(base, {
    label: "m2",
    sentAt: minutesAfter(8 * 24 * 60 + 5)
  });
  const memory = await refreshCustomerMemory({
    tenantId: base.tenant.id,
    contactId: base.contact.id,
    currentMessageId: message.id
  });

  assert.equal(
    memory.lastReturnType,
    CustomerReturnType.COMMERCIAL_REACTIVATION
  );
  assert.equal(memory.messageCount, 3);
  assert.equal(memory.inboundMessageCount, 2);
});

test("dos mensajes con mismo sentAt usan orden deterministico", async () => {
  const base = await createBase({ label: "same-time" });
  const sentAt = minutesAfter(0);
  await createMessage(base, {
    label: "same-a",
    sentAt,
    createdAt: sentAt
  });
  const latest = await createMessage(base, {
    label: "same-b",
    sentAt,
    createdAt: sentAt
  });
  const memory = await refreshCustomerMemory({
    tenantId: base.tenant.id,
    contactId: base.contact.id,
    currentMessageId: latest.id
  });

  assert.equal(memory.lastProcessedMessageId, latest.id);
  assert.equal(memory.lastInactivityMinutes, 0);
});

test("mensaje duplicado y reintento no duplican memoria ni contadores", async () => {
  const base = await createBase({ label: "duplicate" });
  const message = await createMessage(base, {
    label: "m1",
    sentAt: minutesAfter(0)
  });

  await refreshCustomerMemory({
    tenantId: base.tenant.id,
    contactId: base.contact.id,
    currentMessageId: message.id
  });
  const memory = await refreshCustomerMemory({
    tenantId: base.tenant.id,
    contactId: base.contact.id,
    currentMessageId: message.id
  });
  const memoryCount = await prisma.customerMemory.count({
    where: {
      tenantId: base.tenant.id,
      contactId: base.contact.id
    }
  });

  assert.equal(memory.messageCount, 1);
  assert.equal(memoryCount, 1);
});

test("job antiguo despues de uno reciente no degrada estado", async () => {
  const base = await createBase({ label: "old-job" });
  const oldMessage = await createMessage(base, {
    label: "m1",
    sentAt: minutesAfter(0)
  });
  const latestMessage = await createMessage(base, {
    label: "m2",
    sentAt: minutesAfter(60)
  });

  await refreshCustomerMemory({
    tenantId: base.tenant.id,
    contactId: base.contact.id,
    currentMessageId: latestMessage.id
  });
  const memory = await refreshCustomerMemory({
    tenantId: base.tenant.id,
    contactId: base.contact.id,
    currentMessageId: oldMessage.id
  });

  assert.equal(memory.lastProcessedMessageId, latestMessage.id);
  assert.equal(memory.lastInteractionAt?.getTime(), latestMessage.sentAt.getTime());
});

test("dos jobs concurrentes terminan con snapshot real", async () => {
  const base = await createBase({ label: "concurrent" });
  const messages = [
    await createMessage(base, { label: "m1", sentAt: minutesAfter(0) }),
    await createMessage(base, { label: "m2", sentAt: minutesAfter(60) }),
    await createMessage(base, { label: "m3", sentAt: minutesAfter(120) })
  ];

  await Promise.all(
    messages.map((message) =>
      refreshCustomerMemory({
        tenantId: base.tenant.id,
        contactId: base.contact.id,
        currentMessageId: message.id
      })
    )
  );

  const memory = await prisma.customerMemory.findUniqueOrThrow({
    where: {
      tenantId_contactId: {
        tenantId: base.tenant.id,
        contactId: base.contact.id
      }
    }
  });

  assert.equal(memory.messageCount, 3);
  assert.equal(memory.lastInteractionAt?.getTime(), messages[2].sentAt.getTime());
});

test("dos tenants con el mismo telefono tienen memorias separadas", async () => {
  const phone = "+5215599990000";
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
    sentAt: minutesAfter(60)
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

  assert.equal(
    await prisma.customerMemory.count({
      where: {
        contact: {
          normalizedPhoneNumber: phone
        }
      }
    }),
    2
  );
});

test("cambio de nombre del contacto no crea otra memoria", async () => {
  const base = await createBase({ label: "rename" });
  const message = await createMessage(base, {
    label: "m1",
    sentAt: minutesAfter(0)
  });

  await refreshCustomerMemory({
    tenantId: base.tenant.id,
    contactId: base.contact.id,
    currentMessageId: message.id
  });
  await prisma.contact.update({
    where: {
      tenantId_id: {
        tenantId: base.tenant.id,
        id: base.contact.id
      }
    },
    data: {
      name: "Nombre actualizado"
    }
  });
  await refreshCustomerMemory({
    tenantId: base.tenant.id,
    contactId: base.contact.id,
    currentMessageId: message.id
  });

  assert.equal(
    await prisma.customerMemory.count({
      where: {
        tenantId: base.tenant.id,
        contactId: base.contact.id
      }
    }),
    1
  );
});

test("cliente con venta registrada actualiza contadores comerciales", async () => {
  const withSale = await createBase({ label: "with-sale" });
  const saleMessage = await createMessage(withSale, {
    label: "m1",
    sentAt: minutesAfter(0)
  });

  await createSale(withSale);
  const saleMemory = await refreshCustomerMemory({
    tenantId: withSale.tenant.id,
    contactId: withSale.contact.id,
    currentMessageId: saleMessage.id
  });

  assert.equal(saleMemory.hasRegisteredSale, true);
  assert.equal(saleMemory.salesCount, 1);
});

test("cliente sin venta registrada usa frase factual requerida", async () => {
  const withoutSale = await createBase({ label: "without-sale" });
  const noSaleMessage = await createMessage(withoutSale, {
    label: "m1",
    sentAt: minutesAfter(0)
  });
  const noSaleMemory = await refreshCustomerMemory({
    tenantId: withoutSale.tenant.id,
    contactId: withoutSale.contact.id,
    currentMessageId: noSaleMessage.id
  });

  assert.match(
    noSaleMemory.commercialSummary ?? "",
    /No hay una venta registrada en el sistema/
  );
  assert.equal(
    buildHeuristicCommercialSummary({
      conversationCount: 1,
      salesCount: 0,
      openSupportTicketsCount: 0,
      lastReactivationInactivityMinutes: null
    }).includes("nunca compro"),
    false
  );
});

test("falla de clasificacion IA no impide memoria factual", async () => {
  const base = await createBase({ label: "ai-fail" });
  const message = await createMessage(base, {
    label: "m1",
    sentAt: minutesAfter(0)
  });

  await refreshCustomerMemory({
    tenantId: base.tenant.id,
    contactId: base.contact.id,
    currentMessageId: message.id
  });
  await assert.rejects(async () => {
    throw new Error("Simulated AI failure");
  });

  const memory = await prisma.customerMemory.findUniqueOrThrow({
    where: {
      tenantId_contactId: {
        tenantId: base.tenant.id,
        contactId: base.contact.id
      }
    }
  });

  assert.equal(memory.messageCount, 1);
});

test("clasificacion antigua no sobrescribe una mas reciente", async () => {
  const base = await createBase({ label: "ai-order" });
  const oldMessage = await createMessage(base, {
    label: "m1",
    sentAt: minutesAfter(0)
  });
  const newMessage = await createMessage(base, {
    label: "m2",
    sentAt: minutesAfter(60)
  });
  const newer = await prisma.aIClassification.create({
    data: {
      tenantId: base.tenant.id,
      conversationId: base.conversation.id,
      contactId: base.contact.id,
      messageId: newMessage.id,
      detectedIntent: AIIntent.SUPPORT,
      urgency: Urgency.HIGH,
      confidence: 0.9,
      summary: "Resumen factual de prueba",
      recommendedAction: "Revisar soporte registrado.",
      rawResult: {
        sentiment: "NEGATIVE"
      }
    }
  });
  const older = await prisma.aIClassification.create({
    data: {
      tenantId: base.tenant.id,
      conversationId: base.conversation.id,
      contactId: base.contact.id,
      messageId: oldMessage.id,
      detectedIntent: AIIntent.SALES,
      urgency: Urgency.LOW,
      confidence: 0.8,
      summary: "Resumen anterior",
      recommendedAction: "Accion anterior.",
      rawResult: {
        sentiment: "NEUTRAL"
      }
    }
  });

  await applyAIClassificationToMemory({
    tenantId: base.tenant.id,
    aiClassificationId: newer.id
  });
  await applyAIClassificationToMemory({
    tenantId: base.tenant.id,
    aiClassificationId: older.id
  });

  const memory = await prisma.customerMemory.findUniqueOrThrow({
    where: {
      tenantId_contactId: {
        tenantId: base.tenant.id,
        contactId: base.contact.id
      }
    }
  });

  assert.equal(memory.lastAIClassificationId, newer.id);
  assert.equal(memory.lastIntent, AIIntent.SUPPORT);
  assert.equal(memory.lastPriority, Urgency.HIGH);
  assert.equal(memory.lastSentiment, "NEGATIVE");
});

test("backfill ejecutado dos veces no duplica registros", async () => {
  const first = await createBase({ label: "backfill-a" });
  const second = await createBase({ label: "backfill-b" });
  await createMessage(first, { label: "m1", sentAt: minutesAfter(0) });
  await createMessage(second, { label: "m1", sentAt: minutesAfter(60) });

  await runCustomerMemoryBackfill({
    tenantId: first.tenant.id,
    batchSize: 1
  });
  await runCustomerMemoryBackfill({
    tenantId: first.tenant.id,
    batchSize: 1
  });

  assert.equal(
    await prisma.customerMemory.count({
      where: {
        tenantId: first.tenant.id
      }
    }),
    1
  );
});

test("lastReactivatedAt se conserva despues de mensajes activos posteriores", async () => {
  const base = await createBase({ label: "reactivated-at" });
  await createMessage(base, { label: "m1", sentAt: minutesAfter(0) });
  const reactivation = await createMessage(base, {
    label: "m2",
    sentAt: minutesAfter(8 * 24 * 60)
  });
  const active = await createMessage(base, {
    label: "m3",
    sentAt: minutesAfter(8 * 24 * 60 + 5)
  });
  const memory = await refreshCustomerMemory({
    tenantId: base.tenant.id,
    contactId: base.contact.id,
    currentMessageId: active.id
  });

  assert.equal(memory.lastReturnType, CustomerReturnType.ACTIVE_CONVERSATION);
  assert.equal(memory.isReturningCustomer, false);
  assert.equal(memory.lastReactivatedAt?.getTime(), reactivation.sentAt.getTime());
});
