import {
  AIIntent,
  ContactStage,
  ConversationStage,
  PaymentStatus,
  Urgency
} from "@jahf-comm/db";
import OpenAI from "openai";

import {
  buildClassificationUserPrompt,
  classificationSystemPrompt
} from "./prompts";
import {
  conversationClassificationJsonSchema,
  validateConversationClassification
} from "./schema";
import type {
  AiClassificationContext,
  ClassificationResult,
  ClassifierOptions,
  ConversationClassification
} from "./types";
import { DEFAULT_OPENAI_MODEL } from "./types";

function latestInboundText(context: AiClassificationContext) {
  return [...context.messages]
    .reverse()
    .find((message) => message.direction === "INBOUND")?.text?.toLowerCase();
}

const pendingPaymentStatuses: PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.PARTIAL,
  PaymentStatus.OVERDUE
];

function mockClassification(
  context: AiClassificationContext
): ConversationClassification {
  const text = latestInboundText(context) ?? "";
  const hasPendingPayment = context.payments.some((payment) =>
    pendingPaymentStatuses.includes(payment.status)
  );
  const paymentConcern =
    hasPendingPayment || /pagar|pago|referencia|mañana|manana|adeudo/.test(text);
  const supportConcern =
    /soporte|ayuda|falla|problema|configur|no funciona|reclamo/.test(text);
  const configurationConcern = /configur|instalar|instalacion|activar/.test(text);
  const angry = /molest|enoj|reclamo|urgente|no me resolvieron|mal servicio/.test(
    text
  );
  const quote = /precio|costo|cotiz|cuanto|cuánto|plan/.test(text);
  const intent = paymentConcern
    ? AIIntent.PAYMENT
    : supportConcern
      ? configurationConcern
        ? AIIntent.CONFIGURATION
        : AIIntent.SUPPORT
      : quote
        ? AIIntent.QUOTE
        : AIIntent.INFORMATION;
  const urgency = angry
    ? Urgency.URGENT
    : supportConcern
      ? Urgency.HIGH
      : paymentConcern
        ? Urgency.MEDIUM
        : Urgency.LOW;

  return {
    intent,
    urgency,
    confidence: 0.72,
    contactStageSuggestion: paymentConcern
      ? ContactStage.PENDING_PAYMENT
      : supportConcern
        ? ContactStage.SUPPORT_REQUESTED
        : quote
          ? ContactStage.QUOTED
          : context.contact.stage,
    conversationStageSuggestion:
      urgency === Urgency.URGENT
        ? ConversationStage.ESCALATED
        : ConversationStage.WAITING_AGENT,
    summaryForAgent: `Clasificacion mock basada en el ultimo mensaje de ${context.contact.name}.`,
    recommendedAction: paymentConcern
      ? "Revisar saldo y responder con opciones de pago sin registrar pagos nuevos."
      : supportConcern
        ? "Revisar el caso y pedir detalles antes de abrir o modificar tickets."
        : quote
          ? "Dar seguimiento comercial y preparar informacion de precio."
          : "Revisar la conversacion y responder manualmente.",
    requiresHuman: urgency === Urgency.URGENT || supportConcern || paymentConcern,
    detectedPaymentConcern: paymentConcern,
    detectedSupportConcern: supportConcern,
    detectedConfigurationConcern: configurationConcern,
    sentiment: angry ? "ANGRY" : supportConcern ? "NEGATIVE" : "NEUTRAL",
    shouldCreateNotification: urgency !== Urgency.LOW || paymentConcern,
    notificationTitle:
      urgency === Urgency.LOW ? null : `IA sugiere ${intent.toLowerCase()}`,
    notificationDescription:
      urgency === Urgency.LOW
        ? null
        : "La clasificacion IA requiere revision humana."
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`AI classification timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function classifyWithOpenAI(
  context: AiClassificationContext,
  apiKey: string,
  model: string,
  timeoutMs: number
) {
  const client = new OpenAI({ apiKey });
  const response = await withTimeout(
    client.responses.create({
      model,
      input: [
        {
          role: "system",
          content: classificationSystemPrompt
        },
        {
          role: "user",
          content: buildClassificationUserPrompt(context)
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "conversation_classification",
          schema: conversationClassificationJsonSchema,
          strict: true
        }
      }
    }),
    timeoutMs
  );
  const outputText = response.output_text;

  if (!outputText) {
    throw new Error("OpenAI returned an empty classification response.");
  }

  return validateConversationClassification(JSON.parse(outputText));
}

export async function classifyConversation(
  context: AiClassificationContext,
  options: ClassifierOptions = {}
): Promise<ClassificationResult> {
  const startedAt = Date.now();
  const model = options.model ?? DEFAULT_OPENAI_MODEL;
  const timeoutMs = options.timeoutMs ?? 8000;
  const useMock = options.forceMock || !options.apiKey;

  if (useMock) {
    const classification = validateConversationClassification(
      mockClassification(context)
    );

    return {
      classification,
      metadata: {
        mode: "mock",
        model,
        durationMs: Date.now() - startedAt
      }
    };
  }

  const classification = await classifyWithOpenAI(
    context,
    options.apiKey as string,
    model,
    timeoutMs
  );

  return {
    classification,
    metadata: {
      mode: "openai",
      model,
      durationMs: Date.now() - startedAt
    }
  };
}
