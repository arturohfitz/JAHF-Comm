import type {
  NormalizedInboundMessage,
  NormalizedWhatsAppMessageType,
  WhatsAppProviderAdapter
} from "../types";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, path: string[]): JsonRecord | null {
  let current: unknown = value;

  for (const key of path) {
    if (!isRecord(current)) {
      return null;
    }

    current = current[key];
  }

  return isRecord(current) ? current : null;
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

function readNumber(value: unknown, path: string[]): number | null {
  let current: unknown = value;

  for (const key of path) {
    if (!isRecord(current)) {
      return null;
    }

    current = current[key];
  }

  return typeof current === "number" && Number.isFinite(current) ? current : null;
}

function firstString(value: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    const found = readString(value, path);

    if (found) {
      return found;
    }
  }

  return null;
}

function firstNumber(value: unknown, paths: string[][]): number | null {
  for (const path of paths) {
    const found = readNumber(value, path);

    if (found !== null) {
      return found;
    }
  }

  return null;
}

export function normalizePhoneNumber(value: string): string {
  const withoutWhatsappSuffix = value
    .replace(/@s\.whatsapp\.net$/i, "")
    .replace(/@c\.us$/i, "")
    .replace(/@g\.us$/i, "");
  const digits = withoutWhatsappSuffix.replace(/\D/g, "");

  if (!digits) {
    throw new Error("Phone number is required.");
  }

  return `+${digits}`;
}

function getMessageType(payload: unknown): NormalizedWhatsAppMessageType {
  const explicitType = firstString(payload, [
    ["data", "messageType"],
    ["messageType"],
    ["data", "message", "messageType"]
  ])?.toLowerCase();
  const message = readRecord(payload, ["data", "message"]) ?? readRecord(payload, ["message"]);

  if (explicitType?.includes("image") || message?.imageMessage) {
    return "IMAGE";
  }

  if (explicitType?.includes("audio") || message?.audioMessage) {
    return "AUDIO";
  }

  if (explicitType?.includes("video") || message?.videoMessage) {
    return "VIDEO";
  }

  if (explicitType?.includes("document") || message?.documentMessage) {
    return "DOCUMENT";
  }

  if (explicitType?.includes("location") || message?.locationMessage) {
    return "LOCATION";
  }

  if (
    explicitType?.includes("text") ||
    message?.conversation ||
    message?.extendedTextMessage
  ) {
    return "TEXT";
  }

  return "UNKNOWN";
}

function getMessageText(payload: unknown): string | null {
  return firstString(payload, [
    ["data", "message", "conversation"],
    ["data", "message", "extendedTextMessage", "text"],
    ["data", "message", "imageMessage", "caption"],
    ["data", "message", "videoMessage", "caption"],
    ["data", "message", "documentMessage", "caption"],
    ["message", "conversation"],
    ["message", "extendedTextMessage", "text"],
    ["message", "imageMessage", "caption"],
    ["message", "videoMessage", "caption"],
    ["text"],
    ["body"],
    ["message"]
  ]);
}

function getTimestamp(payload: unknown): Date {
  const numericTimestamp = firstNumber(payload, [
    ["data", "messageTimestamp"],
    ["messageTimestamp"],
    ["timestamp"],
    ["data", "key", "messageTimestamp"]
  ]);

  if (numericTimestamp !== null) {
    const milliseconds =
      numericTimestamp > 10_000_000_000 ? numericTimestamp : numericTimestamp * 1000;

    return new Date(milliseconds);
  }

  const stringTimestamp = firstString(payload, [
    ["data", "messageTimestamp"],
    ["messageTimestamp"],
    ["timestamp"],
    ["createdAt"],
    ["date"]
  ]);

  if (stringTimestamp) {
    const date = new Date(stringTimestamp);

    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return new Date();
}

export function normalizeEvolutionInboundMessage(
  payload: unknown
): NormalizedInboundMessage {
  const providerMessageId = firstString(payload, [
    ["data", "key", "id"],
    ["key", "id"],
    ["messageId"],
    ["id"]
  ]);
  const remoteJid = firstString(payload, [
    ["data", "key", "remoteJid"],
    ["key", "remoteJid"],
    ["remoteJid"],
    ["from"]
  ]);
  const participant = firstString(payload, [
    ["data", "key", "participant"],
    ["key", "participant"],
    ["participant"]
  ]);
  const fromPhone = normalizePhoneNumber(participant ?? remoteJid ?? "");
  const toPhone = firstString(payload, [
    ["data", "owner"],
    ["owner"],
    ["to"],
    ["data", "to"]
  ]);
  const instanceName = firstString(payload, [
    ["instance"],
    ["instanceName"],
    ["data", "instance"],
    ["data", "instanceName"]
  ]);
  const providerInstanceId = firstString(payload, [
    ["serverUrl"],
    ["data", "serverUrl"],
    ["instanceId"],
    ["data", "instanceId"],
    ["instance"]
  ]);

  return {
    providerMessageId,
    fromPhone,
    toPhone: toPhone ? normalizePhoneNumber(toPhone) : null,
    instanceName,
    providerInstanceId,
    contactName: firstString(payload, [
      ["data", "pushName"],
      ["pushName"],
      ["sender", "pushName"],
      ["contact", "name"],
      ["name"]
    ]),
    text: getMessageText(payload),
    type: getMessageType(payload),
    timestamp: getTimestamp(payload),
    rawPayload: payload
  };
}

export const evolutionProvider: WhatsAppProviderAdapter = {
  provider: "EVOLUTION",
  normalizeInboundMessage: normalizeEvolutionInboundMessage
};
