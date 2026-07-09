import type { Job } from "bullmq";

import {
  CLASSIFY_CONVERSATION_MESSAGE_JOB,
  createAiClassificationWorker,
  getRedisUrl,
  type AiClassificationJobPayload
} from "@jahf-comm/shared";

import { processAiClassificationJob } from "./ai-classification";

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

export async function main(): Promise<void> {
  createWorkerConfig();

  const worker = createAiClassificationWorker(processJob);

  worker.on("ready", () => {
    console.log("JAHF Comm worker ready: ai-classification queue.");
  });

  worker.on("completed", (job, result) => {
    console.log("AI classification job completed.", {
      jobId: job.id,
      result
    });
  });

  worker.on("failed", (job, error) => {
    console.error("AI classification job failed.", {
      jobId: job?.id,
      message: error.message
    });
  });

  worker.on("error", (error) => {
    console.error("AI classification worker error.", {
      message: error.message
    });
  });

  const shutdown = async () => {
    console.log("Stopping JAHF Comm worker.");
    await worker.close();
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
