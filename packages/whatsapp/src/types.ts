export type NormalizedWhatsAppMessageType =
  | "TEXT"
  | "IMAGE"
  | "AUDIO"
  | "VIDEO"
  | "DOCUMENT"
  | "LOCATION"
  | "UNKNOWN";

export type NormalizedInboundMessage = {
  providerMessageId: string | null;
  fromPhone: string;
  toPhone: string | null;
  instanceName: string | null;
  providerInstanceId: string | null;
  contactName: string | null;
  text: string | null;
  type: NormalizedWhatsAppMessageType;
  timestamp: Date;
  rawPayload: unknown;
};

export type WhatsAppProviderAdapter = {
  readonly provider: string;
  normalizeInboundMessage(payload: unknown): NormalizedInboundMessage;
};
