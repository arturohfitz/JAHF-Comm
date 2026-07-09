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
  WebhookLogStatus,
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

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, path: string[]): string | null {
  let current: unknown = value;

  for (const key of path) {
    if (!isRecord(current)) {
      return null;
    }

    current = current[key];
  }

  if (typeof current !== "string") {
    return null;
  }

  const trimmed = current.trim();

  return trimmed.length > 0 ? trimmed : null;
}

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

function isDemoFallbackAllowed() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.EVOLUTION_ALLOW_DEMO_FALLBACK === "true"
  );
}

function getEventType(payload: unknown) {
  return (
    readString(payload, ["event"]) ??
    readString(payload, ["eventType"]) ??
    readString(payload, ["data", "event"])
  );
}

function getProviderMessageId(payload: unknown) {
  return (
    readString(payload, ["data", "key", "id"]) ??
    readString(payload, ["key", "id"]) ??
    readString(payload, ["messageId"]) ??
    readString(payload, ["id"])
  );
}

function getInstanceCandidates(input: {
  instanceName?: string | null;
  providerInstanceId?: string | null;
}) {
  return [input.instanceName, input.providerInstanceId].filter(
    (value): value is string => Boolean(value)
  );
}

function getPayloadInstanceFields(payload: unknown) {
  const instanceName =
    readString(payload, ["instance"]) ??
    readString(payload, ["instanceName"]) ??
    readString(payload, ["data", "instance"]) ??
    readString(payload, ["data", "instanceName"]);
  const providerInstanceId =
    readString(payload, ["instanceId"]) ??
    readString(payload, ["data", "instanceId"]) ??
    readString(payload, ["serverUrl"]) ??
    readString(payload, ["data", "serverUrl"]) ??
    instanceName;

  return {
    instanceName,
    providerInstanceId
  };
}

async function createWebhookLog(input: {
  payload: unknown;
  status: WebhookLogStatus;
  httpStatus: number;
  tenantId?: string | null;
  whatsappAccountId?: string | null;
  errorMessage?: string | null;
}) {
  const instance = getPayloadInstanceFields(input.payload);

  return prisma.webhookLog.create({
    data: {
      tenantId: input.tenantId ?? null,
      whatsappAccountId: input.whatsappAccountId ?? null,
      provider: WhatsAppProvider.EVOLUTION,
      eventType: getEventType(input.payload),
      providerInstanceId: instance.providerInstanceId ?? instance.instanceName,
      providerMessageId: getProviderMessageId(input.payload),
      status: input.status,
      httpStatus: input.httpStatus,
      errorMessage: input.errorMessage ?? null,
      rawPayload: isRecord(input.payload)
        ? (input.payload as Prisma.InputJsonValue)
        : undefined
    }
  });
}

async function resolveWhatsAppAccount(input: {
  instanceName: string | null;
  providerInstanceId: string | null;
}) {
  const instanceCandidates = getInstanceCandidates(input);

  const whatsappAccount =
    instanceCandidates.length > 0
      ? await prisma.whatsAppAccount.findFirst({
          where: {
            provider: WhatsAppProvider.EVOLUTION,
            OR: [
              {
                providerInstanceId: {
                  in: instanceCandidates
                }
              },
              {
                instanceName: {
                  in: instanceCandidates
                }
              },
              {
                providerAccountId: {
                  in: instanceCandidates
                }
              }
            ]
          },
          select: {
            id: true,
            tenantId: true,
            name: true,
            displayName: true
          }
        })
      : null;

  return (
    whatsappAccount ??
    (instanceCandidates.length === 0 && isDemoFallbackAllowed()
      ? prisma.whatsAppAccount.findFirst({
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
            name: true,
            displayName: true
          }
        })
      : null)
  );
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
  let payload: unknown;

  if (!webhookSecret || providedSecret !== webhookSecret) {
    try {
      payload = await request.json();
    } catch {
      payload = null;
    }

    await createWebhookLog({
      payload,
      status: WebhookLogStatus.UNAUTHORIZED,
      httpStatus: 401,
      errorMessage: "Invalid webhook secret."
    });

    return NextResponse.json({ error: "Unauthorized webhook." }, { status: 401 });
  }

  try {
    payload = await request.json();
  } catch {
    await createWebhookLog({
      payload: null,
      status: WebhookLogStatus.FAILED,
      httpStatus: 400,
      errorMessage: "Invalid JSON payload."
    });

    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const webhookLog = await createWebhookLog({
    payload,
    status: WebhookLogStatus.RECEIVED,
    httpStatus: 202
  });
  let normalized;

  try {
    normalized = normalizeEvolutionInboundMessage(payload);
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unable to normalize Evolution payload.";

    await prisma.webhookLog.update({
      where: { id: webhookLog.id },
      data: {
        status: WebhookLogStatus.FAILED,
        httpStatus: 400,
        errorMessage
      }
    });

    return NextResponse.json(
      {
        error: errorMessage
      },
      { status: 400 }
    );
  }

  const resolvedWhatsAppAccount = await resolveWhatsAppAccount({
    instanceName: normalized.instanceName,
    providerInstanceId: normalized.providerInstanceId
  });

  if (!resolvedWhatsAppAccount) {
    await prisma.webhookLog.update({
      where: { id: webhookLog.id },
      data: {
        status: WebhookLogStatus.FAILED,
        httpStatus: 404,
        errorMessage: "No tenant WhatsApp account resolved for webhook."
      }
    });

    return NextResponse.json(
      {
        error: "No tenant WhatsApp account resolved for webhook.",
        instanceName: normalized.instanceName,
        providerInstanceId: normalized.providerInstanceId
      },
      { status: 404 }
    );
  }

  await prisma.webhookLog.update({
    where: { id: webhookLog.id },
    data: {
      tenantId: resolvedWhatsAppAccount.tenantId,
      whatsappAccountId: resolvedWhatsAppAccount.id,
      providerInstanceId:
        normalized.providerInstanceId ?? normalized.instanceName ?? null,
      providerMessageId: normalized.providerMessageId
    }
  });

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
      await prisma.webhookLog.update({
        where: { id: webhookLog.id },
        data: {
          status: WebhookLogStatus.DUPLICATE,
          httpStatus: 200
        }
      });

      return NextResponse.json({
        ok: true,
        duplicate: true,
        webhookLogId: webhookLog.id,
        messageId: existingMessage.id,
        conversationId: existingMessage.conversationId
      });
    }
  }

  try {
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
          description: `${contact.name} escribio a ${
            resolvedWhatsAppAccount.displayName ?? resolvedWhatsAppAccount.name
          }.`
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

    await prisma.webhookLog.update({
      where: { id: webhookLog.id },
      data: {
        status: WebhookLogStatus.PROCESSED,
        httpStatus: 200
      }
    });

    return NextResponse.json({
      ok: true,
      duplicate: false,
      webhookLogId: webhookLog.id,
      ...result,
      aiQueue
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown webhook processing error.";

    await prisma.webhookLog.update({
      where: { id: webhookLog.id },
      data: {
        status: WebhookLogStatus.FAILED,
        httpStatus: 500,
        errorMessage
      }
    });

    return NextResponse.json(
      {
        error: "Evolution webhook processing failed.",
        webhookLogId: webhookLog.id
      },
      { status: 500 }
    );
  }
}
