import { normalizePhoneNumber } from "./evolution";

export type EvolutionOutboundErrorCategory =
  | "VALIDATION"
  | "AUTHENTICATION"
  | "INSTANCE_NOT_FOUND"
  | "DESTINATION_INVALID"
  | "RATE_LIMITED"
  | "TRANSIENT_PROVIDER_ERROR"
  | "PERMANENT_PROVIDER_ERROR"
  | "TIMEOUT_UNKNOWN"
  | "INVALID_PROVIDER_RESPONSE"
  | "NETWORK_ERROR";

export type SendEvolutionTextInput = {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
  number: string;
  text: string;
  timeoutMs?: number;
  delay?: number;
  linkPreview?: boolean;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, "warn" | "error">;
};

export type SendEvolutionTextResult = {
  providerMessageId: string;
  providerStatus: string | null;
  httpStatus: number;
  responseReceived: true;
};

export type BuildEvolutionSendTextUrlInput = {
  baseUrl: string;
  instanceName: string;
};

export class EvolutionOutboundError extends Error {
  readonly category: EvolutionOutboundErrorCategory;
  readonly retryable: boolean;
  readonly deliveryUnknown: boolean;
  readonly httpStatus: number | null;
  readonly safeMessage: string;

  constructor(input: {
    category: EvolutionOutboundErrorCategory;
    retryable: boolean;
    deliveryUnknown: boolean;
    safeMessage: string;
    httpStatus?: number | null;
  }) {
    super(input.safeMessage);
    this.name = "EvolutionOutboundError";
    this.category = input.category;
    this.retryable = input.retryable;
    this.deliveryUnknown = input.deliveryUnknown;
    this.httpStatus = input.httpStatus ?? null;
    this.safeMessage = input.safeMessage;
  }
}

const defaultTimeoutMs = 10_000;
const maxTextLength = 4_096;

function assertNonEmpty(value: string, field: string) {
  if (!value.trim()) {
    throw new EvolutionOutboundError({
      category: "VALIDATION",
      retryable: false,
      deliveryUnknown: false,
      safeMessage: `${field} is required.`
    });
  }
}

function createValidationError(safeMessage: string) {
  return new EvolutionOutboundError({
    category: "VALIDATION",
    retryable: false,
    deliveryUnknown: false,
    safeMessage
  });
}

function parseBaseUrl(baseUrl: string) {
  assertNonEmpty(baseUrl, "baseUrl");

  let parsed: URL;

  try {
    parsed = new URL(baseUrl);
  } catch {
    throw createValidationError("baseUrl must be a valid URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw createValidationError("baseUrl must use http or https.");
  }

  return parsed;
}

export function buildEvolutionSendTextUrl(input: BuildEvolutionSendTextUrlInput) {
  const parsed = parseBaseUrl(input.baseUrl);

  assertNonEmpty(input.instanceName, "instanceName");

  const basePath = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = `${basePath}/message/sendText/${encodeURIComponent(
    input.instanceName.trim()
  )}`;
  parsed.search = "";
  parsed.hash = "";

  return parsed.toString();
}

function normalizeDestinationPhone(number: string) {
  try {
    return normalizePhoneNumber(number).replace(/^\+/, "");
  } catch {
    throw new EvolutionOutboundError({
      category: "DESTINATION_INVALID",
      retryable: false,
      deliveryUnknown: false,
      safeMessage: "Destination phone number is invalid."
    });
  }
}

export function maskPhoneNumber(value: string) {
  const digits = value.replace(/\D/g, "");

  if (digits.length <= 4) {
    return "****";
  }

  return `${"*".repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];

  return typeof value === "string" && value.trim() ? value : null;
}

function buildPayload(input: {
  number: string;
  text: string;
  delay?: number;
  linkPreview?: boolean;
}) {
  const payload: {
    number: string;
    text: string;
    delay?: number;
    linkPreview?: boolean;
  } = {
    number: input.number,
    text: input.text
  };

  if (typeof input.delay === "number") {
    payload.delay = input.delay;
  }

  if (typeof input.linkPreview === "boolean") {
    payload.linkPreview = input.linkPreview;
  }

  return payload;
}

function classifyProviderError(input: {
  httpStatus: number;
  responseBody: unknown;
}) {
  const safeBody = JSON.stringify(input.responseBody ?? {}).toLowerCase();

  if (input.httpStatus === 401 || input.httpStatus === 403) {
    return {
      category: "AUTHENTICATION" as const,
      retryable: false,
      deliveryUnknown: false,
      safeMessage: "Evolution API authentication failed."
    };
  }

  if (input.httpStatus === 404) {
    return {
      category: "INSTANCE_NOT_FOUND" as const,
      retryable: false,
      deliveryUnknown: false,
      safeMessage: "Evolution API instance or route was not found."
    };
  }

  if (input.httpStatus === 429) {
    return {
      category: "RATE_LIMITED" as const,
      retryable: true,
      deliveryUnknown: false,
      safeMessage: "Evolution API rate limit reached."
    };
  }

  if ([500, 502, 503, 504].includes(input.httpStatus)) {
    return {
      category: "TRANSIENT_PROVIDER_ERROR" as const,
      retryable: true,
      deliveryUnknown: false,
      safeMessage: "Evolution API returned a transient provider error."
    };
  }

  if (input.httpStatus === 400 && /number|phone|jid|destination/.test(safeBody)) {
    return {
      category: "DESTINATION_INVALID" as const,
      retryable: false,
      deliveryUnknown: false,
      safeMessage: "Evolution API rejected the destination."
    };
  }

  return {
    category: "PERMANENT_PROVIDER_ERROR" as const,
    retryable: false,
    deliveryUnknown: false,
    safeMessage: "Evolution API rejected the request."
  };
}

function validateResponseBody(input: {
  httpStatus: number;
  body: unknown;
}): SendEvolutionTextResult {
  const body = readRecord(input.body);
  const key = readRecord(body?.key);
  const providerMessageId = key ? readString(key, "id") : null;
  const providerStatus = body ? readString(body, "status") : null;

  if (!providerMessageId) {
    throw new EvolutionOutboundError({
      category: "INVALID_PROVIDER_RESPONSE",
      retryable: false,
      deliveryUnknown: true,
      httpStatus: input.httpStatus,
      safeMessage: "Evolution API returned a successful response without key.id."
    });
  }

  return {
    providerMessageId,
    providerStatus,
    httpStatus: input.httpStatus,
    responseReceived: true
  };
}

function logSafeFailure(input: {
  logger?: Pick<Console, "warn" | "error">;
  message: string;
  phone: string;
  httpStatus?: number | null;
}) {
  input.logger?.warn(input.message, {
    phone: maskPhoneNumber(input.phone),
    httpStatus: input.httpStatus ?? null
  });
}

export async function sendEvolutionText(
  input: SendEvolutionTextInput
): Promise<SendEvolutionTextResult> {
  assertNonEmpty(input.apiKey, "apiKey");
  assertNonEmpty(input.instanceName, "instanceName");
  assertNonEmpty(input.text, "text");

  if (input.text.length > maxTextLength) {
    throw createValidationError(`text must be ${maxTextLength} characters or less.`);
  }

  if (typeof input.delay === "number" && input.delay < 0) {
    throw createValidationError("delay must be zero or greater.");
  }

  const number = normalizeDestinationPhone(input.number);
  const url = buildEvolutionSendTextUrl({
    baseUrl: input.baseUrl,
    instanceName: input.instanceName
  });
  const payload = buildPayload({
    number,
    text: input.text,
    delay: input.delay,
    linkPreview: input.linkPreview
  });
  const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const fetchImpl = input.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: input.apiKey
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    let responseBody: unknown;

    try {
      responseBody = await response.json();
    } catch {
      throw new EvolutionOutboundError({
        category: "INVALID_PROVIDER_RESPONSE",
        retryable: false,
        deliveryUnknown: response.ok,
        httpStatus: response.status,
        safeMessage: "Evolution API returned invalid JSON."
      });
    }

    if (!response.ok) {
      const classified = classifyProviderError({
        httpStatus: response.status,
        responseBody
      });

      throw new EvolutionOutboundError({
        ...classified,
        httpStatus: response.status
      });
    }

    return validateResponseBody({
      httpStatus: response.status,
      body: responseBody
    });
  } catch (error) {
    if (error instanceof EvolutionOutboundError) {
      logSafeFailure({
        logger: input.logger,
        message: error.safeMessage,
        phone: number,
        httpStatus: error.httpStatus
      });
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      const timeoutError = new EvolutionOutboundError({
        category: "TIMEOUT_UNKNOWN",
        retryable: false,
        deliveryUnknown: true,
        safeMessage: "Evolution API request timed out."
      });

      logSafeFailure({
        logger: input.logger,
        message: timeoutError.safeMessage,
        phone: number
      });
      throw timeoutError;
    }

    const networkError = new EvolutionOutboundError({
      category: "NETWORK_ERROR",
      retryable: true,
      deliveryUnknown: false,
      safeMessage: "Evolution API network request failed."
    });

    logSafeFailure({
      logger: input.logger,
      message: networkError.safeMessage,
      phone: number
    });
    throw networkError;
  } finally {
    clearTimeout(timeout);
  }
}
