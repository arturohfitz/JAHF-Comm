import {
  AuditAction,
  ContactStage,
  ConversationStage,
  CustomerEventType,
  MessageDirection,
  MessageType,
  NotificationType,
  type Prisma,
  prisma,
  SupportStatus,
  WhatsAppProvider
} from "@jahf-comm/db";
import { DEFAULT_OPENAI_MODEL, classifyConversation } from "@jahf-comm/ai";
import { normalizeEvolutionInboundMessage } from "@jahf-comm/whatsapp";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const developmentWebhookSecret = "dev-webhook-secret";

function getWebhookSecret() {
  if (process.env.WEBHOOK_SECRET) {
    return process.env.WEBHOOK_SECRET;
  }

  if (process.env.NODE_ENV !== "production") {
    return developmentWebhookSecret;
  }

  return null;
}

function toMessageType(value: string): MessageType {
  return Object.values(MessageType).includes(value as MessageType)
    ? (value as MessageType)
    : MessageType.UNKNOWN;
}

function isOpenConversationStage(stage: ConversationStage) {
  return stage !== ConversationStage.CLOSED;
}

function isAiClassificationEnabled() {
  return process.env.AI_CLASSIFICATION_ENABLED !== "false";
}

async function runAiClassification(input: {
  tenantId: string;
  contactId: string;
  conversationId: string;
  messageId: string;
  assignedUserId: string | null;
}) {
  if (!isAiClassificationEnabled()) {
    return { status: "disabled" as const };
  }

  try {
    const context = await prisma.conversation.findUniqueOrThrow({
      where: {
        tenantId_id: {
          tenantId: input.tenantId,
          id: input.conversationId
        }
      },
      select: {
        id: true,
        stage: true,
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
    const result = await classifyConversation(
      {
        tenantId: input.tenantId,
        contact: {
          id: context.contact.id,
          name: context.contact.name,
          phoneNumber: context.contact.phoneNumber,
          normalizedPhoneNumber: context.contact.normalizedPhoneNumber,
          stage: context.contact.stage
        },
        conversation: {
          id: context.id,
          stage: context.stage
        },
        messages: context.messages
          .slice()
          .reverse()
          .map((message) => ({
            direction: message.direction,
            type: message.type,
            text: message.text,
            sentAt: message.sentAt.toISOString()
          })),
        sales: context.contact.sales.map((sale) => ({
          product: sale.product,
          status: sale.status,
          amountCents: sale.amountCents,
          currency: sale.currency,
          soldAt: sale.soldAt.toISOString()
        })),
        payments: context.contact.payments.map((payment) => ({
          status: payment.status,
          amountDueCents: payment.amountDueCents,
          amountPaidCents: payment.amountPaidCents,
          currency: payment.currency,
          dueDate: payment.dueDate?.toISOString() ?? null
        })),
        openSupportTickets: context.contact.supportTickets.map((ticket) => ({
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

    await prisma.$transaction(async (tx) => {
      const savedClassification = await tx.aIClassification.create({
        data: {
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          contactId: input.contactId,
          messageId: input.messageId,
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
          tenantId: input.tenantId,
          contactId: input.contactId,
          conversationId: input.conversationId,
          type: CustomerEventType.AI_CLASSIFIED,
          title: "IA clasificada",
          description: `${classification.intent} · ${classification.urgency}`,
          metadata: {
            aiClassificationId: savedClassification.id,
            mode: result.metadata.mode,
            model: result.metadata.model,
            source: "webhook-ai-classification"
          }
        }
      });

      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          action: AuditAction.AI_CLASSIFIED,
          entityType: "AIClassification",
          entityId: savedClassification.id,
          after: {
            intent: classification.intent,
            urgency: classification.urgency,
            confidence: classification.confidence,
            mode: result.metadata.mode
          }
        }
      });

      if (classification.shouldCreateNotification) {
        await tx.notification.create({
          data: {
            tenantId: input.tenantId,
            userId: input.assignedUserId,
            type: NotificationType.AI_SUGGESTION,
            title: classification.notificationTitle ?? "Sugerencia IA",
            description:
              classification.notificationDescription ??
              classification.recommendedAction
          }
        });
      }
    });

    return {
      status: "completed" as const,
      mode: result.metadata.mode
    };
  } catch (error) {
    console.warn(
      "AI classification failed after webhook ingestion.",
      error instanceof Error ? error.message : "Unknown error"
    );

    return { status: "failed" as const };
  }
}

export async function POST(request: Request) {
  const webhookSecret = getWebhookSecret();
  const providedSecret = request.headers.get("x-webhook-secret");

  if (!webhookSecret || providedSecret !== webhookSecret) {
    return NextResponse.json({ error: "Unauthorized webhook." }, { status: 401 });
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  let normalized;

  try {
    normalized = normalizeEvolutionInboundMessage(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to normalize Evolution payload."
      },
      { status: 400 }
    );
  }

  const instanceCandidates = [
    normalized.providerInstanceId,
    normalized.instanceName
  ].filter((value): value is string => Boolean(value));

  const whatsappAccount =
    instanceCandidates.length > 0
      ? await prisma.whatsAppAccount.findFirst({
          where: {
            provider: WhatsAppProvider.EVOLUTION,
            providerAccountId: {
              in: instanceCandidates
            }
          },
          select: {
            id: true,
            tenantId: true,
            name: true
          }
        })
      : null;

  const resolvedWhatsAppAccount =
    whatsappAccount ??
    (process.env.NODE_ENV !== "production"
      ? await prisma.whatsAppAccount.findFirst({
          where: {
            provider: WhatsAppProvider.EVOLUTION,
            tenant: {
              slug: "jahf-demo"
            }
          },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            tenantId: true,
            name: true
          }
        })
      : null);

  if (!resolvedWhatsAppAccount) {
    return NextResponse.json(
      { error: "No tenant WhatsApp account resolved for webhook." },
      { status: 404 }
    );
  }

  if (normalized.providerMessageId) {
    const existingMessage = await prisma.message.findUnique({
      where: {
        tenantId_providerMessageId: {
          tenantId: resolvedWhatsAppAccount.tenantId,
          providerMessageId: normalized.providerMessageId
        }
      },
      select: {
        id: true,
        conversationId: true
      }
    });

    if (existingMessage) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        messageId: existingMessage.id,
        conversationId: existingMessage.conversationId
      });
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const contact = await tx.contact.upsert({
      where: {
        tenantId_normalizedPhoneNumber: {
          tenantId: resolvedWhatsAppAccount.tenantId,
          normalizedPhoneNumber: normalized.fromPhone
        }
      },
      update: {
        name: normalized.contactName ?? undefined,
        phoneNumber: normalized.fromPhone
      },
      create: {
        tenantId: resolvedWhatsAppAccount.tenantId,
        name: normalized.contactName ?? normalized.fromPhone,
        normalizedPhoneNumber: normalized.fromPhone,
        phoneNumber: normalized.fromPhone,
        stage: ContactStage.NEW
      },
      select: {
        id: true,
        name: true
      }
    });

    const existingConversation = await tx.conversation.findFirst({
      where: {
        tenantId: resolvedWhatsAppAccount.tenantId,
        contactId: contact.id,
        whatsappAccountId: resolvedWhatsAppAccount.id,
        stage: {
          not: ConversationStage.CLOSED
        }
      },
      orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        stage: true,
        assignedUserId: true
      }
    });

    const conversation =
      existingConversation ??
      (await tx.conversation.create({
        data: {
          tenantId: resolvedWhatsAppAccount.tenantId,
          contactId: contact.id,
          whatsappAccountId: resolvedWhatsAppAccount.id,
          stage: ConversationStage.OPEN,
          subject: `Conversacion con ${contact.name}`,
          lastMessageAt: normalized.timestamp
        },
        select: {
          id: true,
          stage: true,
          assignedUserId: true
        }
      }));

    const message = await tx.message.create({
      data: {
        tenantId: resolvedWhatsAppAccount.tenantId,
        conversationId: conversation.id,
        contactId: contact.id,
        whatsappAccountId: resolvedWhatsAppAccount.id,
        direction: MessageDirection.INBOUND,
        type: toMessageType(normalized.type),
        text: normalized.text,
        providerMessageId: normalized.providerMessageId,
        rawPayload: normalized.rawPayload as Prisma.InputJsonValue,
        sentAt: normalized.timestamp
      },
      select: {
        id: true
      }
    });

    await tx.conversation.update({
      where: {
        tenantId_id: {
          tenantId: resolvedWhatsAppAccount.tenantId,
          id: conversation.id
        }
      },
      data: {
        lastMessageAt: normalized.timestamp,
        stage: isOpenConversationStage(conversation.stage)
          ? conversation.stage
          : ConversationStage.OPEN
      }
    });

    await tx.customerEvent.create({
      data: {
        tenantId: resolvedWhatsAppAccount.tenantId,
        contactId: contact.id,
        conversationId: conversation.id,
        type: CustomerEventType.NOTIFICATION_CREATED,
        title: "Mensaje recibido",
        description:
          normalized.text ??
          `Mensaje entrante de tipo ${normalized.type.toLowerCase()}.`,
        metadata: {
          messageId: message.id,
          providerMessageId: normalized.providerMessageId,
          source: "evolution-webhook"
        }
      }
    });

    await tx.notification.create({
      data: {
        tenantId: resolvedWhatsAppAccount.tenantId,
        userId: conversation.assignedUserId,
        type: NotificationType.ACTION_REQUIRED,
        title: "Nuevo mensaje entrante",
        description: `${contact.name} escribio a ${resolvedWhatsAppAccount.name}.`
      }
    });

    await tx.auditLog.create({
      data: {
        tenantId: resolvedWhatsAppAccount.tenantId,
        action: AuditAction.CREATE,
        entityType: "Message",
        entityId: message.id,
        after: {
          provider: "EVOLUTION",
          providerMessageId: normalized.providerMessageId,
          conversationId: conversation.id,
          contactId: contact.id
        }
      }
    });

    return {
      contactId: contact.id,
      conversationId: conversation.id,
      messageId: message.id,
      assignedUserId: conversation.assignedUserId
    };
  });
  const ai = await runAiClassification({
    tenantId: resolvedWhatsAppAccount.tenantId,
    contactId: result.contactId,
    conversationId: result.conversationId,
    messageId: result.messageId,
    assignedUserId: result.assignedUserId
  });

  return NextResponse.json({
    ok: true,
    duplicate: false,
    ...result,
    ai
  });
}
