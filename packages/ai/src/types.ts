import type {
  AIIntent,
  ContactStage,
  ConversationStage,
  PaymentStatus,
  SaleStatus,
  SupportStatus,
  Urgency
} from "@jahf-comm/db";

export const DEFAULT_OPENAI_MODEL = "gpt-5.5";

export type ClassificationSentiment =
  | "POSITIVE"
  | "NEUTRAL"
  | "NEGATIVE"
  | "ANGRY"
  | "UNKNOWN";

export type ConversationClassification = {
  intent: AIIntent;
  urgency: Urgency;
  confidence: number;
  contactStageSuggestion: ContactStage;
  conversationStageSuggestion: ConversationStage;
  summaryForAgent: string;
  recommendedAction: string;
  requiresHuman: boolean;
  detectedPaymentConcern: boolean;
  detectedSupportConcern: boolean;
  detectedConfigurationConcern: boolean;
  sentiment: ClassificationSentiment;
  shouldCreateNotification: boolean;
  notificationTitle: string | null;
  notificationDescription: string | null;
};

export type AiMessageContext = {
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  text: string | null;
  sentAt: string;
};

export type AiSaleContext = {
  product: string;
  status: SaleStatus;
  amountCents: number;
  currency: string;
  soldAt: string;
};

export type AiPaymentContext = {
  status: PaymentStatus;
  amountDueCents: number;
  amountPaidCents: number;
  currency: string;
  dueDate: string | null;
};

export type AiSupportTicketContext = {
  title: string;
  status: SupportStatus;
  priority: Urgency;
  openedAt: string;
};

export type AiClassificationContext = {
  tenantId: string;
  contact: {
    id: string;
    name: string;
    phoneNumber: string | null;
    normalizedPhoneNumber: string;
    stage: ContactStage;
  };
  conversation: {
    id: string;
    stage: ConversationStage;
  };
  messages: AiMessageContext[];
  sales: AiSaleContext[];
  payments: AiPaymentContext[];
  openSupportTickets: AiSupportTicketContext[];
};

export type ClassificationMode = "mock" | "openai";

export type ClassificationResult = {
  classification: ConversationClassification;
  metadata: {
    mode: ClassificationMode;
    model: string;
    durationMs: number;
  };
};

export type ClassifierOptions = {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  forceMock?: boolean;
};
