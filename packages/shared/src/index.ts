export const APP_NAME = "JAHF Comm";

export type TenantId = string & { readonly __brand: "TenantId" };

export type TenantScoped = {
  tenantId: string;
};

export {
  AI_CLASSIFICATION_QUEUE_NAME,
  CLASSIFY_CONVERSATION_MESSAGE_JOB,
  createAiClassificationJobId,
  createAiClassificationQueue,
  createAiClassificationWorker,
  createQueueConnection,
  defaultAiClassificationJobOptions,
  getRedisUrl
} from "./queues";
export type {
  AiClassificationJobName,
  AiClassificationJobPayload
} from "./queues";
