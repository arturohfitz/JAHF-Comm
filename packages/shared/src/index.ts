export const APP_NAME = "JAHF Comm";

export type TenantId = string & { readonly __brand: "TenantId" };

export type TenantScoped = {
  tenantId: string;
};

export {
  AI_CLASSIFICATION_QUEUE_NAME,
  CLASSIFY_CONVERSATION_MESSAGE_JOB,
  DELIVER_NOTIFICATION_WHATSAPP_JOB,
  NOTIFICATION_DELIVERY_QUEUE_NAME,
  createAiClassificationJobId,
  createAiClassificationQueue,
  createAiClassificationWorker,
  createNotificationDeliveryJobId,
  createNotificationDeliveryQueue,
  createNotificationDeliveryWorker,
  createQueueConnection,
  defaultAiClassificationJobOptions,
  defaultNotificationDeliveryJobOptions,
  getRedisUrl
} from "./queues";
export type {
  AiClassificationJobName,
  AiClassificationJobPayload,
  NotificationDeliveryChannel,
  NotificationDeliveryJobName,
  NotificationDeliveryJobPayload
} from "./queues";
export { hashPassword, verifyPassword } from "./passwords";
