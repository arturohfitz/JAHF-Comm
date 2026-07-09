import { DEFAULT_OPENAI_MODEL, classifyConversation } from "@jahf-comm/ai";
import {
  AuditAction,
  CustomerEventType,
  NotificationType,
  type Prisma,
  prisma,
  SupportStatus
} from "@jahf-comm/db";
import type { AiClassificationJobPayload } from "@jahf-comm/shared";

type ClassificationOutcome =
  | {
      status: "skipped_existing";
      aiClassificationId: string;
    }
  | {
      status: "created";
      aiClassificationId: string;
      mode: string;
    };

async function loadClassificationContext(payload: AiClassificationJobPayload) {
  const message = await prisma.message.findFirstOrThrow({
    where: {
      id: payload.messageId,
      tenantId: payload.tenantId,
      conversationId: payload.conversationId,
      contactId: payload.contactId
    },
    select: {
      id: true
    }
  });

  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: {
      tenantId_id: {
        tenantId: payload.tenantId,
        id: payload.conversationId
      }
    },
    select: {
      id: true,
      stage: true,
      assignedUserId: true,
      contact: {
        select: {
          id: true,
          name: true,
          phoneNumber: true,
          normalizedPhoneNumber: true,
          stage: true,
          sales: {
            orderBy: { soldAt: "desc" },
            take: 10,
            select: {
              product: true,
              status: true,
              amountCents: true,
              currency: true,
              soldAt: true
            }
          },
          payments: {
            orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
            take: 10,
            select: {
              status: true,
              amountDueCents: true,
              amountPaidCents: true,
              currency: true,
              dueDate: true
            }
          },
          supportTickets: {
            where: {
              status: {
                in: [
                  SupportStatus.OPEN,
                  SupportStatus.IN_PROGRESS,
                  SupportStatus.WAITING_CUSTOMER
                ]
              }
            },
            orderBy: { openedAt: "desc" },
            take: 10,
            select: {
              title: true,
              status: true,
              priority: true,
              openedAt: true
            }
          }
        }
      },
      messages: {
        orderBy: { sentAt: "desc" },
        take: 20,
        select: {
          direction: true,
          type: true,
          text: true,
          sentAt: true
        }
      }
    }
  });

  return { message, conversation };
}

export async function processAiClassificationJob(
  payload: AiClassificationJobPayload
): Promise<ClassificationOutcome> {
  const existing = await prisma.aIClassification.findFirst({
    where: {
      tenantId: payload.tenantId,
      messageId: payload.messageId
    },
    select: {
      id: true
    }
  });

  if (existing) {
    return {
      status: "skipped_existing",
      aiClassificationId: existing.id
    };
  }

  const { conversation } = await loadClassificationContext(payload);
  const result = await classifyConversation(
    {
      tenantId: payload.tenantId,
      contact: {
        id: conversation.contact.id,
        name: conversation.contact.name,
        phoneNumber: conversation.contact.phoneNumber,
        normalizedPhoneNumber: conversation.contact.normalizedPhoneNumber,
        stage: conversation.contact.stage
      },
      conversation: {
        id: conversation.id,
        stage: conversation.stage
      },
      messages: conversation.messages
        .slice()
        .reverse()
        .map((message) => ({
          direction: message.direction,
          type: message.type,
          text: message.text,
          sentAt: message.sentAt.toISOString()
        })),
      sales: conversation.contact.sales.map((sale) => ({
        product: sale.product,
        status: sale.status,
        amountCents: sale.amountCents,
        currency: sale.currency,
        soldAt: sale.soldAt.toISOString()
      })),
      payments: conversation.contact.payments.map((payment) => ({
        status: payment.status,
        amountDueCents: payment.amountDueCents,
        amountPaidCents: payment.amountPaidCents,
        currency: payment.currency,
        dueDate: payment.dueDate?.toISOString() ?? null
      })),
      openSupportTickets: conversation.contact.supportTickets.map((ticket) => ({
        title: ticket.title,
        status: ticket.status,
        priority: ticket.priority,
        openedAt: ticket.openedAt.toISOString()
      }))
    },
    {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
      forceMock: !process.env.OPENAI_API_KEY,
      timeoutMs: 8000
    }
  );
  const classification = result.classification;

  const saved = await prisma.$transaction(async (tx) => {
    const existingInsideTransaction = await tx.aIClassification.findFirst({
      where: {
        tenantId: payload.tenantId,
        messageId: payload.messageId
      },
      select: {
        id: true
      }
    });

    if (existingInsideTransaction) {
      return {
        status: "skipped_existing" as const,
        id: existingInsideTransaction.id
      };
    }

    const savedClassification = await tx.aIClassification.create({
      data: {
        tenantId: payload.tenantId,
        conversationId: payload.conversationId,
        contactId: payload.contactId,
        messageId: payload.messageId,
        detectedIntent: classification.intent,
        urgency: classification.urgency,
        confidence: classification.confidence,
        summary: classification.summaryForAgent,
        recommendedAction: classification.recommendedAction,
        rawResult: {
          ...classification,
          metadata: result.metadata
        } as Prisma.InputJsonValue
      },
      select: {
        id: true
      }
    });

    await tx.customerEvent.create({
      data: {
        tenantId: payload.tenantId,
        contactId: payload.contactId,
        conversationId: payload.conversationId,
        type: CustomerEventType.AI_CLASSIFIED,
        title: "IA clasificada",
        description: `${classification.intent} · ${classification.urgency}`,
        metadata: {
          aiClassificationId: savedClassification.id,
          messageId: payload.messageId,
          mode: result.metadata.mode,
          model: result.metadata.model,
          source: "worker-ai-classification"
        }
      }
    });

    await tx.auditLog.create({
      data: {
        tenantId: payload.tenantId,
        action: AuditAction.AI_CLASSIFIED,
        entityType: "AIClassification",
        entityId: savedClassification.id,
        after: {
          intent: classification.intent,
          urgency: classification.urgency,
          confidence: classification.confidence,
          mode: result.metadata.mode,
          source: "worker_queue",
          messageId: payload.messageId
        }
      }
    });

    if (classification.shouldCreateNotification) {
      await tx.notification.create({
        data: {
          tenantId: payload.tenantId,
          userId: conversation.assignedUserId,
          type: NotificationType.AI_SUGGESTION,
          title: classification.notificationTitle ?? "Sugerencia IA",
          description:
            classification.notificationDescription ??
            classification.recommendedAction
        }
      });
    }

    return {
      status: "created" as const,
      id: savedClassification.id
    };
  });

  if (saved.status === "skipped_existing") {
    return {
      status: "skipped_existing",
      aiClassificationId: saved.id
    };
  }

  return {
    status: "created",
    aiClassificationId: saved.id,
    mode: result.metadata.mode
  };
}
