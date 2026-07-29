import {
  RetryableWhatsappDeliveryError,
  buildClaimedWhatsappDeliveryContext,
  claimWhatsappNotificationDelivery,
  getWhatsappAlertRuntimeConfig,
  markWhatsappDeliveryFailed,
  markWhatsappDeliveryProviderAttempt,
  markWhatsappDeliverySent,
  prepareWhatsappNotificationDelivery
} from "@jahf-comm/db/notification-deliveries";
import type { NotificationDeliveryJobPayload } from "@jahf-comm/shared";
import {
  EvolutionOutboundError,
  sendEvolutionText
} from "@jahf-comm/whatsapp";

export type EvolutionTextSender = typeof sendEvolutionText;

export async function processNotificationDeliveryJob(
  payload: NotificationDeliveryJobPayload,
  options: {
    sendText?: EvolutionTextSender;
    env?: NodeJS.ProcessEnv;
    now?: Date;
    logger?: Pick<Console, "info" | "warn" | "error">;
  } = {}
) {
  if (payload.channel !== "WHATSAPP") {
    throw new Error(`Unsupported notification delivery channel: ${payload.channel}`);
  }

  const env = options.env ?? process.env;
  const runtime = getWhatsappAlertRuntimeConfig(env);
  const logger = options.logger ?? console;
  const prepared = await prepareWhatsappNotificationDelivery({
    tenantId: payload.tenantId,
    notificationId: payload.notificationId,
    env,
    now: options.now
  });

  if (runtime.mode !== "LIVE") {
    logger.info("WhatsApp notification delivery not live.", {
      tenantId: payload.tenantId,
      notificationId: payload.notificationId,
      mode: runtime.mode,
      status: prepared.delivery?.status ?? prepared.status
    });

    return prepared;
  }

  if (
    prepared.delivery &&
    ["SENT", "DRY_RUN", "SKIPPED", "UNKNOWN", "PROCESSING"].includes(
      prepared.delivery.status
    )
  ) {
    logger.info("WhatsApp notification delivery is not claimable.", {
      tenantId: payload.tenantId,
      notificationId: payload.notificationId,
      status: prepared.delivery.status
    });

    return prepared;
  }

  const claimed = await claimWhatsappNotificationDelivery({
    tenantId: payload.tenantId,
    notificationId: payload.notificationId,
    now: options.now,
    maxRetries: runtime.maxRetries
  });

  if (!claimed) {
    logger.info("WhatsApp notification delivery was not claimed.", {
      tenantId: payload.tenantId,
      notificationId: payload.notificationId
    });

    return { status: "not_claimed" as const };
  }

  const contextResult = await buildClaimedWhatsappDeliveryContext({
    tenantId: payload.tenantId,
    deliveryId: claimed.id,
    now: options.now
  });

  if (!contextResult.context) {
    logger.info("WhatsApp notification delivery not ready after claim.", {
      tenantId: payload.tenantId,
      notificationId: payload.notificationId,
      deliveryId: claimed.id,
      status: contextResult.status
    });

    return contextResult;
  }

  const baseUrl = env.EVOLUTION_API_URL;
  const apiKey = env.EVOLUTION_API_KEY;

  if (!baseUrl || !apiKey) {
    const failed = await markWhatsappDeliveryFailed({
      tenantId: payload.tenantId,
      deliveryId: claimed.id,
      category: "PROVIDER_CONFIGURATION_MISSING",
      safeMessage: "Evolution outbound configuration is incomplete.",
      httpStatus: null,
      retryable: false,
      deliveryUnknown: false,
      attemptCount: claimed.attemptCount,
      maxRetries: runtime.maxRetries,
      backoffSeconds: runtime.backoffSeconds,
      metadata: contextResult.context.metadata,
      now: options.now
    });

    logger.warn("WhatsApp notification delivery configuration missing.", {
      tenantId: payload.tenantId,
      notificationId: payload.notificationId,
      deliveryId: claimed.id,
      status: failed.status
    });

    return { status: "failed_configuration" as const, delivery: failed };
  }

  const attempted = await markWhatsappDeliveryProviderAttempt({
    tenantId: payload.tenantId,
    deliveryId: claimed.id,
    now: options.now
  });
  const sendText = options.sendText ?? sendEvolutionText;
  const startedAt = Date.now();

  try {
    const result = await sendText({
      baseUrl,
      apiKey,
      instanceName: contextResult.context.instanceName,
      number: contextResult.context.destination,
      text: contextResult.context.text,
      timeoutMs: runtime.timeoutMs,
      logger
    });
    const sent = await markWhatsappDeliverySent({
      tenantId: payload.tenantId,
      deliveryId: claimed.id,
      providerMessageId: result.providerMessageId,
      providerStatus: result.providerStatus,
      httpStatus: result.httpStatus,
      metadata: contextResult.context.metadata,
      now: options.now
    });

    logger.info("WhatsApp notification delivery accepted by provider.", {
      tenantId: payload.tenantId,
      notificationId: payload.notificationId,
      deliveryId: claimed.id,
      status: sent.status,
      attemptCount: sent.attemptCount,
      httpStatus: result.httpStatus,
      providerStatus: result.providerStatus,
      durationMs: Date.now() - startedAt
    });

    return { status: "sent" as const, delivery: sent };
  } catch (error) {
    const outboundError =
      error instanceof EvolutionOutboundError
        ? error
        : new EvolutionOutboundError({
            category: "NETWORK_ERROR",
            retryable: true,
            deliveryUnknown: false,
            safeMessage: "Unexpected WhatsApp sender error."
          });
    const failed = await markWhatsappDeliveryFailed({
      tenantId: payload.tenantId,
      deliveryId: claimed.id,
      category: outboundError.category,
      safeMessage: outboundError.safeMessage,
      httpStatus: outboundError.httpStatus,
      retryable: outboundError.retryable,
      deliveryUnknown: outboundError.deliveryUnknown,
      attemptCount: attempted.attemptCount,
      maxRetries: runtime.maxRetries,
      backoffSeconds: runtime.backoffSeconds,
      metadata: contextResult.context.metadata,
      now: options.now
    });

    logger.warn("WhatsApp notification delivery failed.", {
      tenantId: payload.tenantId,
      notificationId: payload.notificationId,
      deliveryId: claimed.id,
      status: failed.status,
      attemptCount: failed.attemptCount,
      errorCategory: outboundError.category,
      httpStatus: outboundError.httpStatus,
      durationMs: Date.now() - startedAt
    });

    if (
      outboundError.retryable &&
      !outboundError.deliveryUnknown &&
      attempted.attemptCount < runtime.maxRetries
    ) {
      throw new RetryableWhatsappDeliveryError(outboundError.safeMessage);
    }

    return {
      status: outboundError.deliveryUnknown
        ? ("unknown" as const)
        : ("failed" as const),
      delivery: failed
    };
  }
}
