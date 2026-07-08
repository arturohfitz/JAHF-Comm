export type WhatsAppProviderMessage = {
  provider: string;
  externalMessageId: string;
  externalConversationId: string | null;
  from: string;
  to: string;
  receivedAt: Date;
  text: string | null;
};

export interface WhatsAppProviderAdapter {
  readonly provider: string;
}
