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
  WhatsAppProvider
} from "@jahf-comm/db";
import {
  CLASSIFY_CONVERSATION_MESSAGE_JOB,
  createAiClassificationJobId,
  createAiClassificationQueue
} from "@jahf-comm/shared";
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

async function enqueueAiClassification(input: {
  tenantId: string;
  contactId: string;
  conversationId: string;
  messageId: string;
}) {
  if (process.env.AI_CLASSIFICATION_ENABLED === "false") {
    return { status: "disabled" as const };
  }

  const queue = createAiClassificationQueue();
  const jobId = createAiClassificationJobId(input);

  try {
    const existingJob = await queue.getJob(jobId);

    if (existingJob) {
      return { status: "exists" as const, jobId };
    }

    await queue.add(CLASSIFY_CONVERSATION_MESSAGE_JOB, input, {
      jobId
    });

    return { status: "queued" as const, jobId };
  } catch (error) {
    console.warn("AI classification queue enqueue failed.", {
      message: error instanceof Error ? error.message : "Unknown error"
    });

    return { status: "enqueue_failed" as const, jobId };
  } finally {
    await queue.close();
    await queue.disconnect();
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
      messageId: message.id
    };
  });
  // La IA se procesa en background por apps/worker para que el webhook responda rapido.
  const aiQueue = await enqueueAiClassification({
    tenantId: resolvedWhatsAppAccount.tenantId,
    contactId: result.contactId,
    conversationId: result.conversationId,
    messageId: result.messageId
  });

  return NextResponse.json({
    ok: true,
    duplicate: false,
    ...result,
    aiQueue
  });
}
