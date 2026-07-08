export type WorkerConfig = {
  redisUrl: string;
};

export function createWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const redisUrl = env.REDIS_URL;

  if (!redisUrl) {
    throw new Error("REDIS_URL is required to start workers.");
  }

  return { redisUrl };
}

export async function main(): Promise<void> {
  createWorkerConfig();
  console.log("JAHF Comm worker initialized. No queues are registered yet.");
}

if (process.env.JAHF_COMM_RUN_WORKER === "true") {
  void main();
}
