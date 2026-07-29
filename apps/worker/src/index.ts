import type { Job } from "bullmq";

import {
  CLASSIFY_CONVERSATION_MESSAGE_JOB,
  DELIVER_NOTIFICATION_WHATSAPP_JOB,
  createAiClassificationWorker,
  createNotificationDeliveryWorker,
  getRedisUrl,
  type AiClassificationJobPayload,
  type NotificationDeliveryJobPayload
} from "@jahf-comm/shared";

import { processAiClassificationJob } from "./ai-classification";
import { processNotificationDeliveryJob } from "./notification-delivery";

export type WorkerConfig = {
  redisUrl: string;
};

export function createWorkerConfig(
  env: NodeJS.ProcessEnv = process.env
): WorkerConfig {
  return {
    redisUrl: getRedisUrl(env)
  };
}

async function processJob(job: Job<AiClassificationJobPayload>) {
  if (job.name !== CLASSIFY_CONVERSATION_MESSAGE_JOB) {
    throw new Error(`Unknown worker job: ${job.name}`);
  }

  return processAiClassificationJob(job.data);
}

async function processDeliveryJob(job: Job<NotificationDeliveryJobPayload>) {
  if (job.name !== DELIVER_NOTIFICATION_WHATSAPP_JOB) {
    throw new Error(`Unknown notification delivery job: ${job.name}`);
  }

  return processNotificationDeliveryJob(job.data);
}

export async function main(): Promise<void> {
  createWorkerConfig();

  const aiWorker = createAiClassificationWorker(processJob);
  const notificationDeliveryWorker =
    createNotificationDeliveryWorker(processDeliveryJob);

  aiWorker.on("ready", () => {
    console.log("JAHF Comm worker ready: ai-classification queue.");
  });

  aiWorker.on("completed", (job, result) => {
    console.log("AI classification job completed.", {
      jobId: job.id,
      result
    });
  });

  aiWorker.on("failed", (job, error) => {
    console.error("AI classification job failed.", {
      jobId: job?.id,
      message: error.message
    });
  });

  aiWorker.on("error", (error) => {
    console.error("AI classification worker error.", {
      message: error.message
    });
  });

  notificationDeliveryWorker.on("ready", () => {
    console.log("JAHF Comm worker ready: notification-delivery queue.");
  });

  notificationDeliveryWorker.on("completed", (job, result) => {
    console.log("Notification delivery job completed.", {
      jobId: job.id,
      result
    });
  });

  notificationDeliveryWorker.on("failed", (job, error) => {
    console.error("Notification delivery job failed.", {
      jobId: job?.id,
      message: error.message
    });
  });

  notificationDeliveryWorker.on("error", (error) => {
    console.error("Notification delivery worker error.", {
      message: error.message
    });
  });

  const shutdown = async () => {
    console.log("Stopping JAHF Comm worker.");
    await Promise.all([aiWorker.close(), notificationDeliveryWorker.close()]);
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
}

void main().catch((error) => {
  console.error("JAHF Comm worker failed to start.", {
    message: error instanceof Error ? error.message : "Unknown error"
  });
  process.exit(1);
});
