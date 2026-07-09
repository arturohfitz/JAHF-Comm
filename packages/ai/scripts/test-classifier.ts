import { PaymentStatus, SaleStatus, SupportStatus, Urgency } from "@jahf-comm/db";
import { config } from "dotenv";

import { classifyConversation, DEFAULT_OPENAI_MODEL } from "../src/index";
import type { AiClassificationContext } from "../src/index";

config({ path: [".env", "../.env", "../../.env", "../../../.env"] });

const context: AiClassificationContext = {
  tenantId: "demo-test-tenant",
  contact: {
    id: "demo-contact",
    name: "Bruno Martinez",
    phoneNumber: "55 1234 0002",
    normalizedPhoneNumber: "+525512340002",
    stage: "PENDING_PAYMENT"
  },
  conversation: {
    id: "demo-conversation",
    stage: "OPEN"
  },
  messages: [
    {
      direction: "INBOUND",
      type: "TEXT",
      text: "Puedo pagar mañana? Me pasan la referencia de nuevo.",
      sentAt: new Date().toISOString()
    }
  ],
  sales: [
    {
      product: "Configuracion inicial demo",
      status: SaleStatus.PENDING,
      amountCents: 45000,
      currency: "MXN",
      soldAt: new Date().toISOString()
    }
  ],
  payments: [
    {
      status: PaymentStatus.PENDING,
      amountDueCents: 45000,
      amountPaidCents: 0,
      currency: "MXN",
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    }
  ],
  openSupportTickets: [
    {
      title: "Revision demo",
      status: SupportStatus.OPEN,
      priority: Urgency.MEDIUM,
      openedAt: new Date().toISOString()
    }
  ]
};

const hasApiKey = Boolean(process.env.OPENAI_API_KEY);
const result = await classifyConversation(context, {
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
  forceMock: !hasApiKey
});

console.log(
  JSON.stringify(
    {
      mode: result.metadata.mode,
      model: result.metadata.model,
      note: hasApiKey
        ? "Clasificacion real con OpenAI ejecutada."
        : "OPENAI_API_KEY no existe; se uso clasificador mock controlado.",
      classification: result.classification
    },
    null,
    2
  )
);
