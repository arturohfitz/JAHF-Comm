import {
  AIIntent,
  CustomerReturnType,
  MembershipRole,
  NotificationType,
  Prisma,
  prisma,
  Urgency
} from "@jahf-comm/db";
import {
  formatInactivity,
  getCustomerMemoryView,
  mapIntentLabel,
  mapPriorityLabel,
  mapSentimentLabel,
  type CustomerMemoryView
} from "@jahf-comm/db/customer-memory-view";

export const customerAlertSource = "CUSTOMER_ALERT_ENGINE";
const customerAlertVersion = 1;
const defaultCooldownHours = 4;
const defaultNegativeConfidence = 0.7;

export type CustomerAlertRule =
  | "CUSTOMER_OPERATIONAL_RETURN"
  | "CUSTOMER_COMMERCIAL_REACTIVATION"
  | "RETURNING_PROSPECT_WITHOUT_REGISTERED_SALE"
  | "PREVIOUS_CUSTOMER_REQUESTS_SUPPORT"
  | "HIGH_PRIORITY_CUSTOMER_MESSAGE"
  | "URGENT_CUSTOMER_MESSAGE"
  | "NEGATIVE_CUSTOMER_SENTIMENT"
  | "HUMAN_INTERVENTION_REQUIRED"
  | "OPEN_SUPPORT_TICKET_AND_CUSTOMER_RETURNED";

type AlertSeverity = "medium" | "high" | "urgent";

type TriggerClassification = {
  id: string;
  messageId: string | null;
  detectedIntent: AIIntent;
  urgency: Urgency;
  confidence: number;
  recommendedAction: string | null;
  rawResult: Prisma.JsonValue | null;
};

export type EvaluateCustomerAlertRulesInput = {
  customerMemory: CustomerMemoryView | null;
  latestClassification?: TriggerClassification | null;
  triggerMessage: {
    id: string;
    direction: "INBOUND" | "OUTBOUND";
  };
};

export type CustomerAlertEvaluation = {
  rules: CustomerAlertRule[];
  severity: AlertSeverity;
  cooldownFamily: string | null;
};

export type CreateCustomerAlertsInput = {
  tenantId: string;
  contactId: string;
  conversationId: string;
  triggerMessageId: string;
  evaluation: CustomerAlertEvaluation | null;
};

function readPositiveNumber(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getAlertCooldownHours(env: NodeJS.ProcessEnv = process.env) {
  return readPositiveNumber(env.CUSTOMER_ALERT_COOLDOWN_HOURS, defaultCooldownHours);
}

function getNegativeConfidenceThreshold(env: NodeJS.ProcessEnv = process.env) {
  return readPositiveNumber(
    env.CUSTOMER_ALERT_NEGATIVE_CONFIDENCE,
    defaultNegativeConfidence
  );
}

function readRawRecord(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : null;
}

function readSentiment(classification?: TriggerClassification | null) {
  const raw = readRawRecord(classification?.rawResult);
  const value = raw?.sentiment;

  return typeof value === "string" ? value.toUpperCase() : null;
}

function readRequiresHuman(classification?: TriggerClassification | null) {
  const raw = readRawRecord(classification?.rawResult);
  const value = raw?.requiresHuman;

  return typeof value === "boolean" ? value : null;
}

function isSupportIntent(intent: AIIntent | null | undefined) {
  return (
    intent === AIIntent.SUPPORT ||
    intent === AIIntent.WARRANTY ||
    intent === AIIntent.CONFIGURATION ||
    intent === AIIntent.COMPLAINT
  );
}

function isReturning(memory: CustomerMemoryView) {
  return (
    memory.returnStatus.returnType === CustomerReturnType.OPERATIONAL_RETURN ||
    memory.returnStatus.returnType === CustomerReturnType.COMMERCIAL_REACTIVATION
  );
}

function maxSeverityForRules(rules: CustomerAlertRule[]): AlertSeverity {
  if (rules.includes("URGENT_CUSTOMER_MESSAGE")) {
    return "urgent";
  }

  if (
    rules.includes("CUSTOMER_COMMERCIAL_REACTIVATION") ||
    rules.includes("PREVIOUS_CUSTOMER_REQUESTS_SUPPORT") ||
    rules.includes("HIGH_PRIORITY_CUSTOMER_MESSAGE") ||
    rules.includes("NEGATIVE_CUSTOMER_SENTIMENT") ||
    rules.includes("HUMAN_INTERVENTION_REQUIRED") ||
    rules.includes("OPEN_SUPPORT_TICKET_AND_CUSTOMER_RETURNED")
  ) {
    return "high";
  }

  return "medium";
}

function getCooldownFamily(rules: CustomerAlertRule[]) {
  if (rules.includes("URGENT_CUSTOMER_MESSAGE")) {
    return null;
  }

  if (rules.includes("CUSTOMER_COMMERCIAL_REACTIVATION")) {
    return "CUSTOMER_COMMERCIAL_REACTIVATION";
  }

  if (rules.includes("CUSTOMER_OPERATIONAL_RETURN")) {
    return "CUSTOMER_OPERATIONAL_RETURN";
  }

  if (rules.includes("HIGH_PRIORITY_CUSTOMER_MESSAGE")) {
    return "HIGH_PRIORITY_CUSTOMER_MESSAGE";
  }

  if (rules.includes("NEGATIVE_CUSTOMER_SENTIMENT")) {
    return "NEGATIVE_CUSTOMER_SENTIMENT";
  }

  if (rules.includes("HUMAN_INTERVENTION_REQUIRED")) {
    return "HUMAN_INTERVENTION_REQUIRED";
  }

  return null;
}

export function evaluateCustomerAlertRules(
  input: EvaluateCustomerAlertRulesInput
): CustomerAlertEvaluation | null {
  const memory = input.customerMemory;

  if (!memory || input.triggerMessage.direction !== "INBOUND") {
    return null;
  }

  if (
    memory.processing.lastProcessedMessageId &&
    memory.processing.lastProcessedMessageId !== input.triggerMessage.id
  ) {
    return null;
  }

  const classification = input.latestClassification;
  const rules: CustomerAlertRule[] = [];

  if (memory.returnStatus.returnType === CustomerReturnType.OPERATIONAL_RETURN) {
    rules.push("CUSTOMER_OPERATIONAL_RETURN");
  }

  if (
    memory.returnStatus.returnType === CustomerReturnType.COMMERCIAL_REACTIVATION
  ) {
    rules.push("CUSTOMER_COMMERCIAL_REACTIVATION");
  }

  if (isReturning(memory) && !memory.commercial.hasRegisteredSale) {
    rules.push("RETURNING_PROSPECT_WITHOUT_REGISTERED_SALE");
  }

  if (
    memory.commercial.hasRegisteredSale &&
    isSupportIntent(classification?.detectedIntent)
  ) {
    rules.push("PREVIOUS_CUSTOMER_REQUESTS_SUPPORT");
  }

  if (classification?.urgency === Urgency.HIGH) {
    rules.push("HIGH_PRIORITY_CUSTOMER_MESSAGE");
  }

  if (classification?.urgency === Urgency.URGENT) {
    rules.push("URGENT_CUSTOMER_MESSAGE");
  }

  const sentiment = readSentiment(classification);

  if (
    classification?.messageId === input.triggerMessage.id &&
    (sentiment === "NEGATIVE" || sentiment === "ANGRY") &&
    classification.confidence >= getNegativeConfidenceThreshold()
  ) {
    rules.push("NEGATIVE_CUSTOMER_SENTIMENT");
  }

  if (readRequiresHuman(classification) === true) {
    rules.push("HUMAN_INTERVENTION_REQUIRED");
  }

  if (isReturning(memory) && memory.commercial.openSupportTicketsCount > 0) {
    rules.push("OPEN_SUPPORT_TICKET_AND_CUSTOMER_RETURNED");
  }

  if (rules.length === 0) {
    return null;
  }

  return {
    rules,
    severity: maxSeverityForRules(rules),
    cooldownFamily: getCooldownFamily(rules)
  };
}

export async function resolveCustomerAlertRecipients(input: {
  tenantId: string;
  conversationId: string;
}) {
  const conversation = await prisma.conversation.findFirstOrThrow({
    where: {
      id: input.conversationId,
      tenantId: input.tenantId
    },
    select: {
      assignedUserId: true
    }
  });

  if (conversation.assignedUserId) {
    const assignedMembership = await prisma.membership.findFirst({
      where: {
        tenantId: input.tenantId,
        userId: conversation.assignedUserId,
        role: {
          in: [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT]
        }
      },
      select: {
        userId: true
      }
    });

    if (assignedMembership) {
      return [assignedMembership.userId];
    }
  }

  const fallbackMemberships = await prisma.membership.findMany({
    where: {
      tenantId: input.tenantId,
      role: {
        in: [MembershipRole.OWNER, MembershipRole.ADMIN]
      }
    },
    orderBy: { createdAt: "asc" },
    select: {
      userId: true
    }
  });

  return fallbackMemberships.map((membership) => membership.userId);
}

function buildAlertTitle(input: { contactName: string; severity: AlertSeverity }) {
  if (input.severity === "urgent") {
    return `Cliente urgente: ${input.contactName}`;
  }

  return `Cliente reactivado: ${input.contactName}`;
}

function buildAlertDescription(input: {
  memory: CustomerMemoryView;
  classification: TriggerClassification | null;
}) {
  const parts: string[] = [];
  const inactivity = formatInactivity(input.memory.returnStatus.inactivityMinutes);

  if (input.memory.returnStatus.isReturningCustomer) {
    parts.push(`Volvio a escribir despues de ${inactivity}.`);
  }

  if (input.memory.commercial.hasRegisteredSale) {
    parts.push(
      input.memory.commercial.salesCount === 1
        ? "Tiene una venta registrada."
        : `Tiene ${input.memory.commercial.salesCount} ventas registradas.`
    );
  } else {
    parts.push("No hay una venta registrada en el sistema.");
  }

  if (input.memory.commercial.openSupportTicketsCount > 0) {
    parts.push(
      `Tiene ${input.memory.commercial.openSupportTicketsCount} ticket${
        input.memory.commercial.openSupportTicketsCount === 1 ? "" : "s"
      } de soporte abierto${input.memory.commercial.openSupportTicketsCount === 1 ? "" : "s"}.`
    );
  }

  if (input.memory.summary.text) {
    parts.push(input.memory.summary.text);
  }

  if (input.classification) {
    parts.push(`Intencion: ${mapIntentLabel(input.classification.detectedIntent)}.`);
    parts.push(`Prioridad: ${mapPriorityLabel(input.classification.urgency)}.`);
    const sentiment = readSentiment(input.classification);

    if (sentiment) {
      parts.push(`Sentimiento: ${mapSentimentLabel(sentiment)}.`);
    }
  } else {
    parts.push("La clasificacion del mensaje esta pendiente.");
  }

  if (input.memory.classification.recommendedNextAction) {
    parts.push(`Se recomienda: ${input.memory.classification.recommendedNextAction}`);
  } else {
    parts.push("Se recomienda revisar la conversacion.");
  }

  return parts.join(" ");
}

function getNotificationType(severity: AlertSeverity) {
  if (severity === "urgent" || severity === "high") {
    return NotificationType.ACTION_REQUIRED;
  }

  return NotificationType.AI_SUGGESTION;
}

function createDeduplicationKey(input: {
  tenantId: string;
  contactId: string;
  triggerMessageId: string;
  userId: string;
}) {
  return `customer-alert:v1:${input.tenantId}:${input.contactId}:${input.triggerMessageId}:${input.userId}`;
}

async function isInCooldown(input: {
  tenantId: string;
  contactId: string;
  userId: string;
  family: string;
  severity: AlertSeverity;
}) {
  if (input.severity === "urgent") {
    return false;
  }

  const cooldownStart = new Date(
    Date.now() - getAlertCooldownHours() * 60 * 60 * 1000
  );
  const existing = await prisma.notification.findFirst({
    where: {
      tenantId: input.tenantId,
      userId: input.userId,
      createdAt: {
        gte: cooldownStart
      },
      metadata: {
        path: ["source"],
        equals: customerAlertSource
      },
      AND: [
        {
          metadata: {
            path: ["contactId"],
            equals: input.contactId
          }
        },
        {
          metadata: {
            path: ["cooldownFamily"],
            equals: input.family
          }
        }
      ]
    },
    select: { id: true }
  });

  return Boolean(existing);
}

export async function createCustomerAlerts(input: CreateCustomerAlertsInput) {
  if (!input.evaluation) {
    return { status: "skipped_no_rules" as const, created: 0 };
  }

  const [memory, conversation] = await Promise.all([
    getCustomerMemoryView({
      tenantId: input.tenantId,
      contactId: input.contactId
    }),
    prisma.conversation.findFirstOrThrow({
      where: {
        id: input.conversationId,
        tenantId: input.tenantId,
        contactId: input.contactId
      },
      select: {
        contact: {
          select: {
            name: true,
            phoneNumber: true,
            normalizedPhoneNumber: true
          }
        }
      }
    })
  ]);

  if (!memory) {
    return { status: "skipped_missing_memory" as const, created: 0 };
  }

  const [recipients, classification] = await Promise.all([
    resolveCustomerAlertRecipients({
      tenantId: input.tenantId,
      conversationId: input.conversationId
    }),
    prisma.aIClassification.findFirst({
      where: {
        tenantId: input.tenantId,
        contactId: input.contactId,
        conversationId: input.conversationId,
        messageId: input.triggerMessageId
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        messageId: true,
        detectedIntent: true,
        urgency: true,
        confidence: true,
        recommendedAction: true,
        rawResult: true
      }
    })
  ]);
  let created = 0;

  for (const userId of recipients) {
    if (
      input.evaluation.cooldownFamily &&
      (await isInCooldown({
        tenantId: input.tenantId,
        contactId: input.contactId,
        userId,
        family: input.evaluation.cooldownFamily,
        severity: input.evaluation.severity
      }))
    ) {
      continue;
    }

    const deduplicationKey = createDeduplicationKey({
      tenantId: input.tenantId,
      contactId: input.contactId,
      triggerMessageId: input.triggerMessageId,
      userId
    });
    const metadata = {
      source: customerAlertSource,
      version: customerAlertVersion,
      rules: input.evaluation.rules,
      cooldownFamily: input.evaluation.cooldownFamily,
      severity: input.evaluation.severity,
      contactId: input.contactId,
      conversationId: input.conversationId,
      triggerMessageId: input.triggerMessageId,
      returnType: memory.returnStatus.returnType,
      inactivityMinutes: memory.returnStatus.inactivityMinutes,
      hasRegisteredSale: memory.commercial.hasRegisteredSale,
      salesCount: memory.commercial.salesCount,
      openSupportTicketsCount: memory.commercial.openSupportTicketsCount,
      intent: classification?.detectedIntent ?? null,
      priority: classification?.urgency ?? null,
      sentiment: readSentiment(classification),
      href: `/inbox?conversationId=${input.conversationId}`
    } satisfies Prisma.InputJsonObject;

    try {
      await prisma.notification.create({
        data: {
          tenantId: input.tenantId,
          userId,
          type: getNotificationType(input.evaluation.severity),
          title: buildAlertTitle({
            contactName:
              conversation.contact.name ??
              conversation.contact.phoneNumber ??
              conversation.contact.normalizedPhoneNumber,
            severity: input.evaluation.severity
          }),
          description: buildAlertDescription({
            memory,
            classification
          }),
          deduplicationKey,
          metadata
        }
      });
      created += 1;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        continue;
      }

      throw error;
    }
  }

  return { status: "created" as const, created };
}

export async function evaluateAndCreateCustomerAlerts(input: {
  tenantId: string;
  contactId: string;
  conversationId: string;
  triggerMessageId: string;
}) {
  const [memory, message, classification] = await Promise.all([
    getCustomerMemoryView({
      tenantId: input.tenantId,
      contactId: input.contactId
    }),
    prisma.message.findFirstOrThrow({
      where: {
        id: input.triggerMessageId,
        tenantId: input.tenantId,
        contactId: input.contactId,
        conversationId: input.conversationId
      },
      select: {
        id: true,
        direction: true
      }
    }),
    prisma.aIClassification.findFirst({
      where: {
        tenantId: input.tenantId,
        contactId: input.contactId,
        conversationId: input.conversationId,
        messageId: input.triggerMessageId
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        messageId: true,
        detectedIntent: true,
        urgency: true,
        confidence: true,
        recommendedAction: true,
        rawResult: true
      }
    })
  ]);
  const evaluation = evaluateCustomerAlertRules({
    customerMemory: memory,
    latestClassification: classification,
    triggerMessage: message
  });

  return createCustomerAlerts({
    tenantId: input.tenantId,
    contactId: input.contactId,
    conversationId: input.conversationId,
    triggerMessageId: input.triggerMessageId,
    evaluation
  });
}
