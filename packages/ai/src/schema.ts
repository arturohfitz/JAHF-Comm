import {
  AIIntent,
  ContactStage,
  ConversationStage,
  Urgency
} from "@jahf-comm/db";

import type {
  ClassificationInterestStatus,
  ClassificationSentiment,
  ConversationClassification
} from "./types";

const sentiments: ClassificationSentiment[] = [
  "POSITIVE",
  "NEUTRAL",
  "NEGATIVE",
  "ANGRY",
  "UNKNOWN"
];
const interestStatuses: ClassificationInterestStatus[] = [
  "INTERESTED",
  "QUOTED",
  "PURCHASED",
  "NOT_INTERESTED",
  "FOLLOW_UP",
  "UNKNOWN"
];

export const conversationClassificationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "intent",
    "urgency",
    "confidence",
    "contactStageSuggestion",
    "conversationStageSuggestion",
    "summaryForAgent",
    "recommendedAction",
    "requiresHuman",
    "detectedPaymentConcern",
    "detectedSupportConcern",
    "detectedConfigurationConcern",
    "sentiment",
    "previousTopic",
    "currentRequest",
    "interestStatus",
    "interestSummary",
    "shortRecommendedAction",
    "shouldCreateNotification",
    "notificationTitle",
    "notificationDescription"
  ],
  properties: {
    intent: { type: "string", enum: Object.values(AIIntent) },
    urgency: { type: "string", enum: Object.values(Urgency) },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    contactStageSuggestion: { type: "string", enum: Object.values(ContactStage) },
    conversationStageSuggestion: {
      type: "string",
      enum: Object.values(ConversationStage)
    },
    summaryForAgent: { type: "string", minLength: 1, maxLength: 800 },
    recommendedAction: { type: "string", minLength: 1, maxLength: 800 },
    requiresHuman: { type: "boolean" },
    detectedPaymentConcern: { type: "boolean" },
    detectedSupportConcern: { type: "boolean" },
    detectedConfigurationConcern: { type: "boolean" },
    sentiment: { type: "string", enum: sentiments },
    previousTopic: {
      anyOf: [{ type: "string", minLength: 1, maxLength: 160 }, { type: "null" }]
    },
    currentRequest: { type: "string", minLength: 1, maxLength: 160 },
    interestStatus: { type: "string", enum: interestStatuses },
    interestSummary: {
      anyOf: [{ type: "string", minLength: 1, maxLength: 140 }, { type: "null" }]
    },
    shortRecommendedAction: { type: "string", minLength: 1, maxLength: 160 },
    shouldCreateNotification: { type: "boolean" },
    notificationTitle: {
      anyOf: [{ type: "string", minLength: 1, maxLength: 120 }, { type: "null" }]
    },
    notificationDescription: {
      anyOf: [{ type: "string", minLength: 1, maxLength: 300 }, { type: "null" }]
    }
  }
} as const;

function isEnumValue<T extends string>(
  value: unknown,
  values: readonly T[]
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function validateNullableStringLength(
  value: unknown,
  fieldName: string,
  maxLength: number
) {
  if (value === null) {
    return;
  }

  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(`AI classification ${fieldName} is invalid.`);
  }
}

function validateStringLength(value: unknown, fieldName: string, maxLength: number) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(`AI classification ${fieldName} is invalid.`);
  }
}

export function validateConversationClassification(
  value: unknown
): ConversationClassification {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AI classification must be an object.");
  }

  const record = value as Record<string, unknown>;

  if (!isEnumValue(record.intent, Object.values(AIIntent))) {
    throw new Error("AI classification has invalid intent.");
  }

  if (!isEnumValue(record.urgency, Object.values(Urgency))) {
    throw new Error("AI classification has invalid urgency.");
  }

  if (
    typeof record.confidence !== "number" ||
    record.confidence < 0 ||
    record.confidence > 1
  ) {
    throw new Error("AI classification has invalid confidence.");
  }

  if (!isEnumValue(record.contactStageSuggestion, Object.values(ContactStage))) {
    throw new Error("AI classification has invalid contact stage suggestion.");
  }

  if (
    !isEnumValue(
      record.conversationStageSuggestion,
      Object.values(ConversationStage)
    )
  ) {
    throw new Error(
      "AI classification has invalid conversation stage suggestion."
    );
  }

  if (typeof record.summaryForAgent !== "string" || !record.summaryForAgent) {
    throw new Error("AI classification summary is required.");
  }

  if (typeof record.recommendedAction !== "string" || !record.recommendedAction) {
    throw new Error("AI classification recommended action is required.");
  }

  if (typeof record.requiresHuman !== "boolean") {
    throw new Error("AI classification requiresHuman must be boolean.");
  }

  if (typeof record.detectedPaymentConcern !== "boolean") {
    throw new Error("AI classification detectedPaymentConcern must be boolean.");
  }

  if (typeof record.detectedSupportConcern !== "boolean") {
    throw new Error("AI classification detectedSupportConcern must be boolean.");
  }

  if (typeof record.detectedConfigurationConcern !== "boolean") {
    throw new Error(
      "AI classification detectedConfigurationConcern must be boolean."
    );
  }

  if (!isEnumValue(record.sentiment, sentiments)) {
    throw new Error("AI classification has invalid sentiment.");
  }

  validateNullableStringLength(record.previousTopic, "previousTopic", 160);
  validateStringLength(record.currentRequest, "currentRequest", 160);

  if (!isEnumValue(record.interestStatus, interestStatuses)) {
    throw new Error("AI classification has invalid interest status.");
  }

  validateNullableStringLength(record.interestSummary, "interestSummary", 140);
  validateStringLength(
    record.shortRecommendedAction,
    "shortRecommendedAction",
    160
  );

  if (typeof record.shouldCreateNotification !== "boolean") {
    throw new Error("AI classification shouldCreateNotification must be boolean.");
  }

  if (
    record.notificationTitle !== null &&
    typeof record.notificationTitle !== "string"
  ) {
    throw new Error("AI classification notificationTitle must be string or null.");
  }

  if (
    record.notificationDescription !== null &&
    typeof record.notificationDescription !== "string"
  ) {
    throw new Error(
      "AI classification notificationDescription must be string or null."
    );
  }

  return record as ConversationClassification;
}
