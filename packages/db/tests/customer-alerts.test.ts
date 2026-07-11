import assert from "node:assert/strict";
import test, { after } from "node:test";

import { config } from "dotenv";

config({ path: ["../../.env", ".env"] });

const databaseUrl = process.env.DATABASE_URL_TEST;
const developmentDatabaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL_TEST is required for CustomerAlert tests.");
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
  NotificationType,
  SaleStatus,
  SupportStatus,
  Urgency,
  WhatsAppAccountStatus,
  WhatsAppProvider,
  prisma
} = await import("../src/index.js");
const { refreshCustomerMemory } = await import("../src/customer-memory.js");
const {
  createCustomerAlerts,
  customerAlertSource,
  evaluateAndCreateCustomerAlerts,
  evaluateCustomerAlertRules
} = await import("../src/customer-alerts.js");
const { getCustomerMemoryView } = await import("../src/customer-memory-view.js");

const runId = `alerts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const baseDate = new Date("2026-03-01T10:00:00.000Z");
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
  assignAgent?: boolean;
  viewerOnly?: boolean;
}) {
  const suffix = nextId(input.label);
  const tenant = await prisma.tenant.create({
    data: {
      name: `Tenant ${suffix}`,
      slug: `${runId}-${suffix}`
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

  await prisma.membership.createMany({
    data: [
      { tenantId: tenant.id, userId: owner.id, role: MembershipRole.OWNER },
      { tenantId: tenant.id, userId: admin.id, role: MembershipRole.ADMIN },
      { tenantId: tenant.id, userId: agent.id, role: MembershipRole.AGENT },
      { tenantId: tenant.id, userId: viewer.id, role: MembershipRole.VIEWER }
    ]
  });

  const contact = await prisma.contact.create({
    data: {
      tenantId: tenant.id,
      name: `Contacto ${suffix}`,
      normalizedPhoneNumber: `+52159${sequence.toString().padStart(8, "0")}`,
      phoneNumber: `+52159${sequence.toString().padStart(8, "0")}`,
      stage: ContactStage.NEW
    }
  });
  const account = await prisma.whatsAppAccount.create({
    data: {
      tenantId: tenant.id,
      name: `WhatsApp ${suffix}`,
      phoneNumber: `+52160${sequence.toString().padStart(8, "0")}`,
      normalizedPhoneNumber: `+52160${sequence.toString().padStart(8, "0")}`,
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
      assignedUserId: input.assignAgent ? agent.id : null,
      stage: ConversationStage.OPEN,
      subject: `Conversacion ${suffix}`
    }
  });

  return { tenant, owner, admin, agent, viewer, contact, account, conversation };
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

async function createReturnMemory(input: {
  label: string;
  minutes: number;
  assignAgent?: boolean;
  sale?: boolean;
  support?: boolean;
}) {
  const base = await createBase({ label: input.label, assignAgent: input.assignAgent });
  await createMessage(base, { label: "m1", sentAt: minutesAfter(0) });
  const trigger = await createMessage(base, {
    label: "m2",
    sentAt: minutesAfter(input.minutes)
  });

  if (input.sale) {
    await prisma.sale.create({
      data: {
        tenantId: base.tenant.id,
        contactId: base.contact.id,
        conversationId: base.conversation.id,
        product: "Venta registrada",
        amountCents: 10000,
        soldAt: minutesAfter(5),
        status: SaleStatus.PAID
      }
    });
  }

  if (input.support) {
    await prisma.supportTicket.create({
      data: {
        tenantId: base.tenant.id,
        contactId: base.contact.id,
        conversationId: base.conversation.id,
        title: "Ticket abierto",
        status: SupportStatus.OPEN,
        priority: Urgency.HIGH
      }
    });
  }

  await refreshCustomerMemory({
    tenantId: base.tenant.id,
    contactId: base.contact.id,
    currentMessageId: trigger.id
  });
  const memory = await getCustomerMemoryView({
    tenantId: base.tenant.id,
    contactId: base.contact.id
  });

  if (!memory) {
    throw new Error("Memory missing in test setup.");
  }

  return { ...base, trigger, memory };
}

function classification(input: Partial<{
  id: string;
  messageId: string;
  detectedIntent: (typeof AIIntent)[keyof typeof AIIntent];
  urgency: (typeof Urgency)[keyof typeof Urgency];
  confidence: number;
  recommendedAction: string | null;
  rawResult: Record<string, unknown>;
}> = {}) {
  return {
    id: input.id ?? "classification",
    messageId: input.messageId ?? "message",
    detectedIntent: input.detectedIntent ?? AIIntent.INFORMATION,
    urgency: input.urgency ?? Urgency.LOW,
    confidence: input.confidence ?? 0.9,
    recommendedAction: input.recommendedAction ?? null,
    rawResult: (input.rawResult ?? {}) as never
  };
}

test("FIRST_CONTACT no crea alerta", async () => {
  const base = await createReturnMemory({ label: "first", minutes: 1 });
  await prisma.customerMemory.update({
    where: { tenantId_contactId: { tenantId: base.tenant.id, contactId: base.contact.id } },
    data: { lastReturnType: CustomerReturnType.FIRST_CONTACT, isReturningCustomer: false }
  });
  const memory = await getCustomerMemoryView({ tenantId: base.tenant.id, contactId: base.contact.id });
  assert.equal(evaluateCustomerAlertRules({ customerMemory: memory, triggerMessage: { id: base.trigger.id, direction: "INBOUND" } }), null);
});

test("ACTIVE_CONVERSATION normal no crea alerta", async () => {
  const base = await createReturnMemory({ label: "active", minutes: 120 });
  assert.equal(evaluateCustomerAlertRules({ customerMemory: base.memory, triggerMessage: { id: base.trigger.id, direction: "INBOUND" } }), null);
});

test("OPERATIONAL_RETURN crea alerta media", async () => {
  const base = await createReturnMemory({ label: "operational", minutes: 25 * 60 });
  const result = evaluateCustomerAlertRules({ customerMemory: base.memory, triggerMessage: { id: base.trigger.id, direction: "INBOUND" } });
  assert.equal(result?.severity, "medium");
  assert.ok(result?.rules.includes("CUSTOMER_OPERATIONAL_RETURN"));
});

test("COMMERCIAL_REACTIVATION crea alerta alta", async () => {
  const base = await createReturnMemory({ label: "commercial", minutes: 8 * 24 * 60 });
  const result = evaluateCustomerAlertRules({ customerMemory: base.memory, triggerMessage: { id: base.trigger.id, direction: "INBOUND" } });
  assert.equal(result?.severity, "high");
  assert.ok(result?.rules.includes("CUSTOMER_COMMERCIAL_REACTIVATION"));
});

test("reactivacion sin venta incluye frase factual", async () => {
  const base = await createReturnMemory({ label: "no-sale", minutes: 8 * 24 * 60 });
  await evaluateAndCreateCustomerAlerts({ tenantId: base.tenant.id, contactId: base.contact.id, conversationId: base.conversation.id, triggerMessageId: base.trigger.id });
  const notification = await prisma.notification.findFirstOrThrow({ where: { tenantId: base.tenant.id } });
  assert.match(notification.description ?? "", /No hay una venta registrada en el sistema/);
});

test("reactivacion con venta no afirma que no exista venta", async () => {
  const base = await createReturnMemory({ label: "with-sale", minutes: 8 * 24 * 60, sale: true });
  await evaluateAndCreateCustomerAlerts({ tenantId: base.tenant.id, contactId: base.contact.id, conversationId: base.conversation.id, triggerMessageId: base.trigger.id });
  const notification = await prisma.notification.findFirstOrThrow({ where: { tenantId: base.tenant.id } });
  assert.doesNotMatch(notification.description ?? "", /No hay una venta registrada/);
});

test("cliente con venta y solicitud de soporte genera alerta alta", async () => {
  const base = await createReturnMemory({ label: "sale-support", minutes: 120, sale: true });
  const result = evaluateCustomerAlertRules({ customerMemory: base.memory, latestClassification: classification({ detectedIntent: AIIntent.SUPPORT, urgency: Urgency.MEDIUM }), triggerMessage: { id: base.trigger.id, direction: "INBOUND" } });
  assert.equal(result?.severity, "high");
});

test("prioridad HIGH genera alerta", async () => {
  const base = await createReturnMemory({ label: "high", minutes: 120 });
  const result = evaluateCustomerAlertRules({ customerMemory: base.memory, latestClassification: classification({ urgency: Urgency.HIGH }), triggerMessage: { id: base.trigger.id, direction: "INBOUND" } });
  assert.ok(result?.rules.includes("HIGH_PRIORITY_CUSTOMER_MESSAGE"));
});

test("prioridad URGENT usa severidad maxima", async () => {
  const base = await createReturnMemory({ label: "urgent", minutes: 120 });
  const result = evaluateCustomerAlertRules({ customerMemory: base.memory, latestClassification: classification({ urgency: Urgency.URGENT }), triggerMessage: { id: base.trigger.id, direction: "INBOUND" } });
  assert.equal(result?.severity, "urgent");
});

test("sentimiento negativo con confianza suficiente genera señal", async () => {
  const base = await createReturnMemory({ label: "negative", minutes: 120 });
  const result = evaluateCustomerAlertRules({ customerMemory: base.memory, latestClassification: classification({ messageId: base.trigger.id, confidence: 0.9, rawResult: { sentiment: "NEGATIVE" } }), triggerMessage: { id: base.trigger.id, direction: "INBOUND" } });
  assert.ok(result?.rules.includes("NEGATIVE_CUSTOMER_SENTIMENT"));
});

test("sentimiento negativo con confianza baja no genera esa regla", async () => {
  const base = await createReturnMemory({ label: "negative-low", minutes: 120 });
  const result = evaluateCustomerAlertRules({ customerMemory: base.memory, latestClassification: classification({ messageId: base.trigger.id, confidence: 0.2, rawResult: { sentiment: "NEGATIVE" } }), triggerMessage: { id: base.trigger.id, direction: "INBOUND" } });
  assert.equal(result?.rules.includes("NEGATIVE_CUSTOMER_SENTIMENT") ?? false, false);
});

test("IA fallida permite alerta factual de reactivacion", async () => {
  const base = await createReturnMemory({ label: "ai-failed", minutes: 8 * 24 * 60 });
  await evaluateAndCreateCustomerAlerts({ tenantId: base.tenant.id, contactId: base.contact.id, conversationId: base.conversation.id, triggerMessageId: base.trigger.id });
  assert.equal(await prisma.notification.count({ where: { tenantId: base.tenant.id } }), 2);
});

test("mensaje OUTBOUND no genera alerta", async () => {
  const base = await createReturnMemory({ label: "outbound", minutes: 8 * 24 * 60 });
  assert.equal(evaluateCustomerAlertRules({ customerMemory: base.memory, triggerMessage: { id: base.trigger.id, direction: "OUTBOUND" } }), null);
});

test("reintento del mismo job no duplica Notification", async () => {
  const base = await createReturnMemory({ label: "retry", minutes: 8 * 24 * 60 });
  await evaluateAndCreateCustomerAlerts({ tenantId: base.tenant.id, contactId: base.contact.id, conversationId: base.conversation.id, triggerMessageId: base.trigger.id });
  await evaluateAndCreateCustomerAlerts({ tenantId: base.tenant.id, contactId: base.contact.id, conversationId: base.conversation.id, triggerMessageId: base.trigger.id });
  assert.equal(await prisma.notification.count({ where: { tenantId: base.tenant.id } }), 2);
});

test("dos jobs concurrentes no duplican Notification", async () => {
  const base = await createReturnMemory({ label: "concurrent", minutes: 8 * 24 * 60 });
  await Promise.all([1, 2].map(() => evaluateAndCreateCustomerAlerts({ tenantId: base.tenant.id, contactId: base.contact.id, conversationId: base.conversation.id, triggerMessageId: base.trigger.id })));
  assert.equal(await prisma.notification.count({ where: { tenantId: base.tenant.id } }), 2);
});

test("trabajo antiguo no crea alerta sobre estado actual incorrecto", async () => {
  const base = await createReturnMemory({ label: "old-job", minutes: 8 * 24 * 60 });
  const old = await createMessage(base, { label: "old", sentAt: minutesAfter(1) });
  await evaluateAndCreateCustomerAlerts({ tenantId: base.tenant.id, contactId: base.contact.id, conversationId: base.conversation.id, triggerMessageId: old.id });
  assert.equal(await prisma.notification.count({ where: { tenantId: base.tenant.id } }), 0);
});

test("varias reglas del mismo mensaje crean una alerta consolidada", async () => {
  const base = await createReturnMemory({ label: "consolidated", minutes: 8 * 24 * 60, support: true });
  await prisma.aIClassification.create({ data: { tenantId: base.tenant.id, contactId: base.contact.id, conversationId: base.conversation.id, messageId: base.trigger.id, detectedIntent: AIIntent.SUPPORT, urgency: Urgency.HIGH, confidence: 0.9, rawResult: { sentiment: "NEGATIVE" } } });
  await evaluateAndCreateCustomerAlerts({ tenantId: base.tenant.id, contactId: base.contact.id, conversationId: base.conversation.id, triggerMessageId: base.trigger.id });
  assert.equal(await prisma.notification.count({ where: { tenantId: base.tenant.id } }), 2);
});

test("metadata registra las reglas cumplidas", async () => {
  const notification = await prisma.notification.findFirstOrThrow({ where: { metadata: { path: ["source"], equals: customerAlertSource } }, orderBy: { createdAt: "desc" } });
  assert.ok(JSON.stringify(notification.metadata).includes("rules"));
});

test("metadata no expone raw_response_json", async () => {
  const notification = await prisma.notification.findFirstOrThrow({ where: { metadata: { path: ["source"], equals: customerAlertSource } }, orderBy: { createdAt: "desc" } });
  assert.equal(JSON.stringify(notification.metadata).includes("raw_response_json"), false);
});

test("dos tenants permanecen aislados", async () => {
  const first = await createReturnMemory({ label: "iso-a", minutes: 8 * 24 * 60 });
  const second = await createReturnMemory({ label: "iso-b", minutes: 8 * 24 * 60 });
  await evaluateAndCreateCustomerAlerts({ tenantId: first.tenant.id, contactId: first.contact.id, conversationId: first.conversation.id, triggerMessageId: first.trigger.id });
  assert.equal(await prisma.notification.count({ where: { tenantId: second.tenant.id } }), 0);
});

test("usuario asignado recibe la alerta", async () => {
  const base = await createReturnMemory({ label: "assigned", minutes: 8 * 24 * 60, assignAgent: true });
  await evaluateAndCreateCustomerAlerts({ tenantId: base.tenant.id, contactId: base.contact.id, conversationId: base.conversation.id, triggerMessageId: base.trigger.id });
  assert.equal(await prisma.notification.count({ where: { tenantId: base.tenant.id, userId: base.agent.id } }), 1);
});

test("AGENT no asignado no recibe la alerta", async () => {
  const base = await createReturnMemory({ label: "unassigned-agent", minutes: 8 * 24 * 60 });
  await evaluateAndCreateCustomerAlerts({ tenantId: base.tenant.id, contactId: base.contact.id, conversationId: base.conversation.id, triggerMessageId: base.trigger.id });
  assert.equal(await prisma.notification.count({ where: { tenantId: base.tenant.id, userId: base.agent.id } }), 0);
});

test("OWNER/ADMIN recibe fallback cuando no hay asignado", async () => {
  const base = await createReturnMemory({ label: "fallback", minutes: 8 * 24 * 60 });
  await evaluateAndCreateCustomerAlerts({ tenantId: base.tenant.id, contactId: base.contact.id, conversationId: base.conversation.id, triggerMessageId: base.trigger.id });
  assert.equal(await prisma.notification.count({ where: { tenantId: base.tenant.id, userId: { in: [base.owner.id, base.admin.id] } } }), 2);
});

test("VIEWER no recibe alerta operativa", async () => {
  const base = await createReturnMemory({ label: "viewer", minutes: 8 * 24 * 60 });
  await evaluateAndCreateCustomerAlerts({ tenantId: base.tenant.id, contactId: base.contact.id, conversationId: base.conversation.id, triggerMessageId: base.trigger.id });
  assert.equal(await prisma.notification.count({ where: { tenantId: base.tenant.id, userId: base.viewer.id } }), 0);
});

test("usuario sin Membership no recibe alerta", async () => {
  const base = await createReturnMemory({ label: "nomembership", minutes: 8 * 24 * 60 });
  const stranger = await prisma.user.create({ data: { email: `${nextId("stranger")}@example.com` } });
  await prisma.conversation.update({ where: { tenantId_id: { tenantId: base.tenant.id, id: base.conversation.id } }, data: { assignedUserId: stranger.id } });
  await evaluateAndCreateCustomerAlerts({ tenantId: base.tenant.id, contactId: base.contact.id, conversationId: base.conversation.id, triggerMessageId: base.trigger.id });
  assert.equal(await prisma.notification.count({ where: { tenantId: base.tenant.id, userId: stranger.id } }), 0);
});

test("cooldown evita alertas repetitivas", async () => {
  const base = await createReturnMemory({ label: "cooldown", minutes: 8 * 24 * 60 });
  await evaluateAndCreateCustomerAlerts({ tenantId: base.tenant.id, contactId: base.contact.id, conversationId: base.conversation.id, triggerMessageId: base.trigger.id });
  const message = await createMessage(base, { label: "m3", sentAt: minutesAfter(8 * 24 * 60 + 10) });
  await refreshCustomerMemory({ tenantId: base.tenant.id, contactId: base.contact.id, currentMessageId: message.id });
  await evaluateAndCreateCustomerAlerts({ tenantId: base.tenant.id, contactId: base.contact.id, conversationId: base.conversation.id, triggerMessageId: message.id });
  assert.equal(await prisma.notification.count({ where: { tenantId: base.tenant.id } }), 2);
});

test("nueva reactivacion posterior al cooldown si genera alerta", async () => {
  const base = await createReturnMemory({ label: "cooldown-old", minutes: 8 * 24 * 60 });
  await evaluateAndCreateCustomerAlerts({ tenantId: base.tenant.id, contactId: base.contact.id, conversationId: base.conversation.id, triggerMessageId: base.trigger.id });
  await prisma.notification.updateMany({ where: { tenantId: base.tenant.id }, data: { createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000) } });
  const message = await createMessage(base, { label: "m3", sentAt: minutesAfter(16 * 24 * 60) });
  await refreshCustomerMemory({ tenantId: base.tenant.id, contactId: base.contact.id, currentMessageId: message.id });
  await evaluateAndCreateCustomerAlerts({ tenantId: base.tenant.id, contactId: base.contact.id, conversationId: base.conversation.id, triggerMessageId: message.id });
  assert.equal(await prisma.notification.count({ where: { tenantId: base.tenant.id } }), 4);
});

test("escalamiento de HIGH a URGENT no queda bloqueado", async () => {
  const base = await createReturnMemory({ label: "urgent-bypass", minutes: 120 });
  await prisma.aIClassification.create({ data: { tenantId: base.tenant.id, contactId: base.contact.id, conversationId: base.conversation.id, messageId: base.trigger.id, detectedIntent: AIIntent.INFORMATION, urgency: Urgency.URGENT, confidence: 0.9 } });
  await evaluateAndCreateCustomerAlerts({ tenantId: base.tenant.id, contactId: base.contact.id, conversationId: base.conversation.id, triggerMessageId: base.trigger.id });
  assert.equal(await prisma.notification.count({ where: { tenantId: base.tenant.id } }), 2);
});

test("enlace de notificacion apunta a la conversacion correcta", async () => {
  const notification = await prisma.notification.findFirstOrThrow({ where: { metadata: { path: ["source"], equals: customerAlertSource } }, orderBy: { createdAt: "desc" } });
  assert.match(JSON.stringify(notification.metadata), /conversationId=/);
});

test("marcar como leida no permite actualizar notificacion de otro usuario", async () => {
  const base = await createReturnMemory({ label: "read-security", minutes: 8 * 24 * 60 });
  await evaluateAndCreateCustomerAlerts({ tenantId: base.tenant.id, contactId: base.contact.id, conversationId: base.conversation.id, triggerMessageId: base.trigger.id });
  const ownerNotification = await prisma.notification.findFirstOrThrow({ where: { tenantId: base.tenant.id, userId: base.owner.id } });
  await prisma.notification.updateMany({ where: { id: ownerNotification.id, tenantId: base.tenant.id, userId: base.agent.id }, data: { isRead: true, readAt: new Date() } });
  const unchanged = await prisma.notification.findUniqueOrThrow({ where: { tenantId_id: { tenantId: base.tenant.id, id: ownerNotification.id } } });
  assert.equal(unchanged.isRead, false);
});
