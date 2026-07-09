import { Queue, Worker } from "bullmq";
import type {
  ConnectionOptions,
  JobsOptions,
  Processor,
  QueueOptions,
  WorkerOptions
} from "bullmq";
import IORedis from "ioredis";

export const AI_CLASSIFICATION_QUEUE_NAME = "ai-classification";
export const CLASSIFY_CONVERSATION_MESSAGE_JOB =
  "CLASSIFY_CONVERSATION_MESSAGE";

export type AiClassificationJobName =
  typeof CLASSIFY_CONVERSATION_MESSAGE_JOB;

export type AiClassificationJobPayload = {
  tenantId: string;
  messageId: string;
  conversationId: string;
  contactId: string;
};

export const defaultAiClassificationJobOptions: JobsOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 5000
  },
  removeOnComplete: {
    age: 60 * 60,
    count: 1000
  },
  removeOnFail: {
    age: 7 * 24 * 60 * 60,
    count: 1000
  }
};

export function getRedisUrl(env: NodeJS.ProcessEnv = process.env) {
  const redisUrl = env.REDIS_URL;

  if (!redisUrl) {
    throw new Error("REDIS_URL is required for BullMQ queues.");
  }

  return redisUrl;
}

export function createQueueConnection(redisUrl = getRedisUrl()): IORedis {
  return new IORedis(redisUrl, {
    maxRetriesPerRequest: null
  });
}

export function createAiClassificationQueue(
  options: Partial<QueueOptions> = {}
) {
  return new Queue<AiClassificationJobPayload, unknown, AiClassificationJobName>(
    AI_CLASSIFICATION_QUEUE_NAME,
    {
      connection: createQueueConnection() as unknown as ConnectionOptions,
      defaultJobOptions: defaultAiClassificationJobOptions,
      ...options
    }
  );
}

export function createAiClassificationWorker(
  processor: Processor<
    AiClassificationJobPayload,
    unknown,
    AiClassificationJobName
  >,
  options: Partial<WorkerOptions> = {}
) {
  return new Worker<AiClassificationJobPayload, unknown, AiClassificationJobName>(
    AI_CLASSIFICATION_QUEUE_NAME,
    processor,
    {
      connection: createQueueConnection() as unknown as ConnectionOptions,
      concurrency: 2,
      ...options
    }
  );
}

export function createAiClassificationJobId(
  payload: Pick<AiClassificationJobPayload, "tenantId" | "messageId">
) {
  return `ai-classify:${payload.tenantId}:${payload.messageId}`;
}
