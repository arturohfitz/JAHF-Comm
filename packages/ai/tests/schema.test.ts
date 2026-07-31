import assert from "node:assert/strict";
import test from "node:test";

import {
  AIIntent,
  ContactStage,
  ConversationStage,
  PaymentStatus,
  SupportStatus,
  Urgency
} from "@jahf-comm/db";

import {
  buildClassificationUserPrompt,
  classifyConversation,
  validateConversationClassification
} from "../src/index";
import { normalizeClassificationFacts } from "../src/classifier";
import type { AiClassificationContext } from "../src/index";

const validClassification = {
  intent: AIIntent.QUOTE,
  urgency: Urgency.MEDIUM,
  confidence: 0.88,
  contactStageSuggestion: ContactStage.QUOTED,
  conversationStageSuggestion: ConversationStage.WAITING_AGENT,
  summaryForAgent: "Cliente retoma una solicitud comercial.",
  recommendedAction: "Confirmar modelo y forma de pago.",
  requiresHuman: true,
  detectedPaymentConcern: false,
  detectedSupportConcern: false,
  detectedConfigurationConcern: false,
  sentiment: "NEUTRAL",
  previousTopic: "Pregunto por laptop con Nexiq y programas Cummins.",
  currentRequest: "Quiere continuar con la compra en linea.",
  interestStatus: "QUOTED",
  interestSummary: "Cotizacion enviada; compra no registrada.",
  shortRecommendedAction: "Confirmar modelo y forma de pago.",
  shouldCreateNotification: true,
  notificationTitle: "Cliente reactivado",
  notificationDescription: "Requiere seguimiento comercial."
};

test("schema valida campos estructurados compactos", () => {
  const result = validateConversationClassification(validClassification);

  assert.equal(result.previousTopic, validClassification.previousTopic);
  assert.equal(result.currentRequest, validClassification.currentRequest);
  assert.equal(result.interestStatus, "QUOTED");
  assert.equal(result.shortRecommendedAction, "Confirmar modelo y forma de pago.");
});

test("schema rechaza previousTopic demasiado largo", () => {
  assert.throws(
    () =>
      validateConversationClassification({
        ...validClassification,
        previousTopic: "x".repeat(161)
      }),
    /previousTopic/
  );
});

test("schema rechaza interestStatus invalido", () => {
  assert.throws(
    () =>
      validateConversationClassification({
        ...validClassification,
        interestStatus: "BOUGHT"
      }),
    /interest status/
  );
});

test("PURCHASED no se conserva sin Sale registrada", async () => {
  const context: AiClassificationContext = {
    tenantId: "tenant-test",
    contact: {
      id: "contact-test",
      name: "Cliente Demo",
      phoneNumber: "+5215512345678",
      normalizedPhoneNumber: "+5215512345678",
      stage: ContactStage.PROSPECT
    },
    conversation: {
      id: "conversation-test",
      stage: ConversationStage.OPEN
    },
    messages: [
      {
        direction: "INBOUND",
        type: "TEXT",
        text: "Quiero comprar en linea",
        sentAt: "2026-07-30T10:00:00.000Z"
      }
    ],
    sales: [],
    payments: [
      {
        status: PaymentStatus.PENDING,
        amountDueCents: 0,
        amountPaidCents: 0,
        currency: "MXN",
        dueDate: null
      }
    ],
    openSupportTickets: [
      {
        title: "Demo",
        status: SupportStatus.OPEN,
        priority: Urgency.MEDIUM,
        openedAt: "2026-07-30T10:00:00.000Z"
      }
    ]
  };
  const result = await classifyConversation(context, { forceMock: true });

  assert.notEqual(result.classification.interestStatus, "PURCHASED");
});

test("PURCHASED sin Sale deja interestSummary null", () => {
  const context: AiClassificationContext = {
    tenantId: "tenant-test",
    contact: {
      id: "contact-test",
      name: "Cliente Demo",
      phoneNumber: "+5215512345678",
      normalizedPhoneNumber: "+5215512345678",
      stage: ContactStage.PROSPECT
    },
    conversation: {
      id: "conversation-test",
      stage: ConversationStage.OPEN
    },
    messages: [],
    sales: [],
    payments: [],
    openSupportTickets: []
  };
  const result = normalizeClassificationFacts(context, {
    ...validClassification,
    interestStatus: "PURCHASED",
    interestSummary: "Compró una laptop Nexiq."
  });

  assert.equal(result.interestStatus, "UNKNOWN");
  assert.equal(result.interestSummary, null);
});

test("prompt conserva mensajes inbound y outbound con fecha y texto", () => {
  const context: AiClassificationContext = {
    tenantId: "tenant-test",
    contact: {
      id: "contact-test",
      name: "Cliente Demo",
      phoneNumber: "+5215512345678",
      normalizedPhoneNumber: "+5215512345678",
      stage: ContactStage.PROSPECT
    },
    conversation: {
      id: "conversation-test",
      stage: ConversationStage.OPEN
    },
    messages: [
      {
        direction: "INBOUND",
        type: "TEXT",
        text: "Me interesa la laptop con Nexiq",
        sentAt: "2026-07-22T10:00:00.000Z"
      },
      {
        direction: "OUTBOUND",
        type: "DOCUMENT",
        text: "[Documento enviado: Cotizacion_Nexiq.pdf]",
        sentAt: "2026-07-22T11:00:00.000Z"
      }
    ],
    sales: [],
    payments: [],
    openSupportTickets: []
  };
  const prompt = buildClassificationUserPrompt(context);

  assert.match(prompt, /"direction": "INBOUND"/);
  assert.match(prompt, /"direction": "OUTBOUND"/);
  assert.match(prompt, /Cotizacion_Nexiq\.pdf/);
  assert.match(prompt, /2026-07-22T11:00:00.000Z/);
});
