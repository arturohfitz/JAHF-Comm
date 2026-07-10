import {
  AIIntent,
  CustomerReturnType,
  MemorySummarySource,
  MessageDirection,
  Prisma,
  prisma,
  SupportStatus,
  Urgency
} from "./index.js";

const defaultOperationalReturnHours = 24;
const defaultCommercialReactivationDays = 7;
const memoryVersion = 1;
const validSentiments = new Set([
  "POSITIVE",
  "NEUTRAL",
  "NEGATIVE",
  "ANGRY",
  "UNKNOWN"
]);

type PrismaClientLike = typeof prisma;
type TransactionClient = Prisma.TransactionClient;

type MessageOrder = {
  id: string;
  sentAt: Date;
  createdAt: Date;
};

export type CustomerMemoryThresholds = {
  operationalReturnHours: number;
  commercialReactivationDays: number;
};

export type RefreshCustomerMemoryInput = {
  tenantId: string;
  contactId: string;
  currentMessageId?: string | null;
  thresholds?: Partial<CustomerMemoryThresholds>;
};

export type ApplyAIClassificationToMemoryInput = {
  tenantId: string;
  aiClassificationId: string;
};

function readPositiveNumber(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getCustomerMemoryThresholds(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<CustomerMemoryThresholds> = {}
): CustomerMemoryThresholds {
  return {
    operationalReturnHours:
      overrides.operationalReturnHours ??
      readPositiveNumber(
        env.CUSTOMER_OPERATIONAL_RETURN_HOURS,
        defaultOperationalReturnHours
      ),
    commercialReactivationDays:
      overrides.commercialReactivationDays ??
      readPositiveNumber(
        env.CUSTOMER_COMMERCIAL_REACTIVATION_DAYS,
        defaultCommercialReactivationDays
      )
  };
}

function diffMinutes(previous: Date, next: Date) {
  return Math.max(0, Math.floor((next.getTime() - previous.getTime()) / 60000));
}

function isReturningType(returnType: CustomerReturnType) {
  return (
    returnType === CustomerReturnType.OPERATIONAL_RETURN ||
    returnType === CustomerReturnType.COMMERCIAL_REACTIVATION
  );
}

export function calculateCustomerReturn(input: {
  previousInteractionAt: Date | null;
  currentInteractionAt: Date | null;
  thresholds?: Partial<CustomerMemoryThresholds>;
}) {
  if (!input.currentInteractionAt || !input.previousInteractionAt) {
    return {
      returnType: CustomerReturnType.FIRST_CONTACT,
      inactivityMinutes: null,
      isReturningCustomer: false
    };
  }

  const thresholds = getCustomerMemoryThresholds(process.env, input.thresholds);
  const inactivityMinutes = diffMinutes(
    input.previousInteractionAt,
    input.currentInteractionAt
  );
  const operationalReturnMinutes = thresholds.operationalReturnHours * 60;
  const commercialReactivationMinutes =
    thresholds.commercialReactivationDays * 24 * 60;
  const returnType =
    inactivityMinutes <= operationalReturnMinutes
      ? CustomerReturnType.ACTIVE_CONVERSATION
      : inactivityMinutes < commercialReactivationMinutes
        ? CustomerReturnType.OPERATIONAL_RETURN
        : CustomerReturnType.COMMERCIAL_REACTIVATION;

  return {
    returnType,
    inactivityMinutes,
    isReturningCustomer: isReturningType(returnType)
  };
}

function formatInactivity(minutes: number) {
  if (minutes >= 24 * 60) {
    const days = Math.floor(minutes / (24 * 60));

    return `${days} ${days === 1 ? "dia" : "dias"}`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours >= 1) {
    return `${hours} ${hours === 1 ? "hora" : "horas"}`;
  }

  return `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
}

export function buildHeuristicCommercialSummary(input: {
  conversationCount: number;
  salesCount: number;
  openSupportTicketsCount: number;
  lastReactivationInactivityMinutes: number | null;
}) {
  const conversations =
    input.conversationCount === 1
      ? "Cliente con 1 conversacion registrada."
      : `Cliente con ${input.conversationCount} conversaciones registradas.`;
  const sales =
    input.salesCount > 0
      ? `Tiene ${input.salesCount} ${
          input.salesCount === 1 ? "venta registrada" : "ventas registradas"
        } en el sistema.`
      : "No hay una venta registrada en el sistema.";
  const support =
    input.openSupportTicketsCount > 0
      ? `Tiene ${input.openSupportTicketsCount} ${
          input.openSupportTicketsCount === 1
            ? "ticket de soporte abierto"
            : "tickets de soporte abiertos"
        }.`
      : "No tiene tickets de soporte abiertos.";
  const reactivation =
    input.lastReactivationInactivityMinutes === null
      ? null
      : `La ultima reactivacion registrada ocurrio despues de ${formatInactivity(
          input.lastReactivationInactivityMinutes
        )} de inactividad.`;

  return [conversations, sales, support, reactivation].filter(Boolean).join(" ");
}

function compareMessageOrder(left: MessageOrder, right: MessageOrder) {
  const sentAtDifference = left.sentAt.getTime() - right.sentAt.getTime();

  if (sentAtDifference !== 0) {
    return sentAtDifference;
  }

  const createdAtDifference = left.createdAt.getTime() - right.createdAt.getTime();

  if (createdAtDifference !== 0) {
    return createdAtDifference;
  }

  return left.id.localeCompare(right.id);
}

function getLatestReactivation(input: {
  inboundMessages: MessageOrder[];
  thresholds?: Partial<CustomerMemoryThresholds>;
}) {
  let lastReactivatedAt: Date | null = null;
  let lastReactivationInactivityMinutes: number | null = null;

  for (let index = 1; index < input.inboundMessages.length; index += 1) {
    const previous = input.inboundMessages[index - 1];
    const current = input.inboundMessages[index];
    const result = calculateCustomerReturn({
      previousInteractionAt: previous.sentAt,
      currentInteractionAt: current.sentAt,
      thresholds: input.thresholds
    });

    if (isReturningType(result.returnType)) {
      lastReactivatedAt = current.sentAt;
      lastReactivationInactivityMinutes = result.inactivityMinutes;
    }
  }

  return {
    lastReactivatedAt,
    lastReactivationInactivityMinutes
  };
}

function readSentiment(rawResult: Prisma.JsonValue | null | undefined) {
  if (!rawResult || typeof rawResult !== "object" || Array.isArray(rawResult)) {
    return null;
  }

  const sentiment = rawResult.sentiment;

  return typeof sentiment === "string" && validSentiments.has(sentiment)
    ? sentiment
    : null;
}

async function lockCustomerMemory(
  tx: TransactionClient,
  tenantId: string,
  contactId: string
) {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${`customer-memory:${tenantId}:${contactId}`})::bigint)
  `;
}

async function refreshCustomerMemoryWithClient(
  client: PrismaClientLike,
  input: RefreshCustomerMemoryInput
) {
  return client.$transaction(async (tx: TransactionClient) => {
    await lockCustomerMemory(tx, input.tenantId, input.contactId);

    const contact = await tx.contact.findFirstOrThrow({
      where: {
        id: input.contactId,
        tenantId: input.tenantId
      },
      select: {
        id: true
      }
    });
    const currentMessage = input.currentMessageId
      ? await tx.message.findFirst({
          where: {
            id: input.currentMessageId,
            tenantId: input.tenantId,
            contactId: contact.id,
            direction: MessageDirection.INBOUND
          },
          select: {
            id: true,
            sentAt: true,
            createdAt: true
          }
        })
      : null;
    const [messageCount, conversationCount, salesCount, paymentsCount] =
      await Promise.all([
        tx.message.count({
          where: {
            tenantId: input.tenantId,
            contactId: contact.id
          }
        }),
        tx.conversation.count({
          where: {
            tenantId: input.tenantId,
            contactId: contact.id
          }
        }),
        tx.sale.count({
          where: {
            tenantId: input.tenantId,
            contactId: contact.id
          }
        }),
        tx.payment.count({
          where: {
            tenantId: input.tenantId,
            contactId: contact.id
          }
        })
      ]);
    const [lastSale, openSupportTicketsCount, inboundMessages, currentMemory] =
      await Promise.all([
        tx.sale.findFirst({
          where: {
            tenantId: input.tenantId,
            contactId: contact.id
          },
          orderBy: [{ soldAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          select: {
            soldAt: true
          }
        }),
        tx.supportTicket.count({
          where: {
            tenantId: input.tenantId,
            contactId: contact.id,
            status: {
              in: [
                SupportStatus.OPEN,
                SupportStatus.IN_PROGRESS,
                SupportStatus.WAITING_CUSTOMER
              ]
            }
          }
        }),
        tx.message.findMany({
          where: {
            tenantId: input.tenantId,
            contactId: contact.id,
            direction: MessageDirection.INBOUND
          },
          orderBy: [{ sentAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            sentAt: true,
            createdAt: true
          }
        }),
        tx.customerMemory.findUnique({
          where: {
            tenantId_contactId: {
              tenantId: input.tenantId,
              contactId: contact.id
            }
          },
          select: {
            lastProcessedMessageId: true,
            lastProcessedMessageAt: true
          }
        })
      ]);

    const firstInboundMessage = inboundMessages[0] ?? null;
    const latestInboundMessage = inboundMessages[inboundMessages.length - 1] ?? null;
    const previousInboundMessage =
      inboundMessages.length > 1
        ? inboundMessages[inboundMessages.length - 2]
        : null;
    const latestReturn = calculateCustomerReturn({
      previousInteractionAt: previousInboundMessage?.sentAt ?? null,
      currentInteractionAt: latestInboundMessage?.sentAt ?? null,
      thresholds: input.thresholds
    });
    const reactivation = getLatestReactivation({
      inboundMessages,
      thresholds: input.thresholds
    });
    const currentMessageIsLatest =
      currentMessage && latestInboundMessage
        ? compareMessageOrder(currentMessage, latestInboundMessage) === 0
        : false;
    const latestProcessedCandidate =
      !input.currentMessageId || currentMessageIsLatest ? latestInboundMessage : null;
    const existingProcessedMessage = currentMemory?.lastProcessedMessageId
      ? await tx.message.findFirst({
          where: {
            id: currentMemory.lastProcessedMessageId,
            tenantId: input.tenantId,
            contactId: contact.id,
            direction: MessageDirection.INBOUND
          },
          select: {
            id: true,
            sentAt: true,
            createdAt: true
          }
        })
      : null;
    const shouldUpdateProcessed =
      latestProcessedCandidate &&
      (!existingProcessedMessage ||
        compareMessageOrder(latestProcessedCandidate, existingProcessedMessage) >= 0);
    const commercialSummary = buildHeuristicCommercialSummary({
      conversationCount,
      salesCount,
      openSupportTicketsCount,
      lastReactivationInactivityMinutes:
        reactivation.lastReactivationInactivityMinutes
    });
    const data = {
      firstSeenAt: firstInboundMessage?.sentAt ?? null,
      lastInteractionAt: latestInboundMessage?.sentAt ?? null,
      previousInteractionAt: previousInboundMessage?.sentAt ?? null,
      messageCount,
      inboundMessageCount: inboundMessages.length,
      conversationCount,
      hasPreviousInteractions: inboundMessages.length > 1,
      isReturningCustomer: latestReturn.isReturningCustomer,
      lastReturnType: latestReturn.returnType,
      lastInactivityMinutes: latestReturn.inactivityMinutes,
      lastReactivatedAt: reactivation.lastReactivatedAt,
      salesCount,
      hasRegisteredSale: salesCount > 0,
      lastSaleAt: lastSale?.soldAt ?? null,
      paymentsCount,
      openSupportTicketsCount,
      commercialSummary,
      summarySource: MemorySummarySource.HEURISTIC,
      memoryVersion,
      signals: {
        messageOrder: ["sentAt", "createdAt", "id"],
        inboundMessagesOnlyForReturnDetection: true,
        lastReactivationInactivityMinutes:
          reactivation.lastReactivationInactivityMinutes
      } satisfies Prisma.InputJsonObject,
      lastProcessedMessageId: shouldUpdateProcessed
        ? latestProcessedCandidate.id
        : undefined,
      lastProcessedMessageAt: shouldUpdateProcessed
        ? latestProcessedCandidate.sentAt
        : undefined
    };

    return tx.customerMemory.upsert({
      where: {
        tenantId_contactId: {
          tenantId: input.tenantId,
          contactId: contact.id
        }
      },
      create: {
        tenantId: input.tenantId,
        contactId: contact.id,
        ...data,
        lastProcessedMessageId:
          data.lastProcessedMessageId ?? latestInboundMessage?.id ?? null,
        lastProcessedMessageAt:
          data.lastProcessedMessageAt ?? latestInboundMessage?.sentAt ?? null
      },
      update: data
    });
  });
}

export function refreshCustomerMemory(input: RefreshCustomerMemoryInput) {
  return refreshCustomerMemoryWithClient(prisma, input);
}

export async function applyAIClassificationToMemory(
  input: ApplyAIClassificationToMemoryInput
) {
  const classification = await prisma.aIClassification.findFirstOrThrow({
    where: {
      id: input.aiClassificationId,
      tenantId: input.tenantId
    },
    select: {
      id: true,
      tenantId: true,
      contactId: true,
      detectedIntent: true,
      urgency: true,
      recommendedAction: true,
      rawResult: true,
      message: {
        select: {
          id: true,
          sentAt: true,
          createdAt: true
        }
      }
    }
  });

  if (!classification.message) {
    return { status: "skipped_missing_message" as const };
  }

  const classificationMessage = classification.message;

  await refreshCustomerMemory({
    tenantId: classification.tenantId,
    contactId: classification.contactId,
    currentMessageId: classificationMessage.id
  });

  return prisma.$transaction(async (tx: TransactionClient) => {
    await lockCustomerMemory(tx, classification.tenantId, classification.contactId);

    const memory = await tx.customerMemory.findUnique({
      where: {
        tenantId_contactId: {
          tenantId: classification.tenantId,
          contactId: classification.contactId
        }
      },
      select: {
        lastAIClassificationId: true,
        lastAIMessageAt: true
      }
    });
    const existingClassification = memory?.lastAIClassificationId
      ? await tx.aIClassification.findFirst({
          where: {
            id: memory.lastAIClassificationId,
            tenantId: classification.tenantId,
            contactId: classification.contactId
          },
          select: {
            message: {
              select: {
                id: true,
                sentAt: true,
                createdAt: true
              }
            }
          }
        })
      : null;
    const existingMessage =
      existingClassification?.message ??
      (memory?.lastAIMessageAt
        ? {
            id: "",
            sentAt: memory.lastAIMessageAt,
            createdAt: memory.lastAIMessageAt
          }
        : null);

    if (
      existingMessage &&
      compareMessageOrder(classificationMessage, existingMessage) < 0
    ) {
      return { status: "skipped_older_classification" as const };
    }

    await tx.customerMemory.update({
      where: {
        tenantId_contactId: {
          tenantId: classification.tenantId,
          contactId: classification.contactId
        }
      },
      data: {
        lastIntent: classification.detectedIntent as AIIntent,
        lastPriority: classification.urgency as Urgency,
        lastSentiment: readSentiment(classification.rawResult),
        recommendedNextAction: classification.recommendedAction,
        lastAIClassificationId: classification.id,
        lastAIMessageAt: classificationMessage.sentAt
      }
    });

    return { status: "updated" as const };
  });
}
