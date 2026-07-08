export type AiSuggestionKind =
  | "classification"
  | "summary"
  | "urgency"
  | "next_action";

export type AiSuggestionDraft = {
  tenantId: string;
  conversationId: string;
  kind: AiSuggestionKind;
  content: string;
  confidence: number | null;
};
