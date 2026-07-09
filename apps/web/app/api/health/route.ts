import { prisma } from "@jahf-comm/db";
import { APP_NAME, createQueueConnection, getRedisUrl } from "@jahf-comm/shared";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type DependencyStatus = "ok" | "error";

async function checkDatabase(): Promise<DependencyStatus> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return "ok";
  } catch {
    return "error";
  }
}

async function checkRedis(): Promise<DependencyStatus> {
  let connection: ReturnType<typeof createQueueConnection> | null = null;

  try {
    connection = createQueueConnection(getRedisUrl());
    await connection.ping();
    return "ok";
  } catch {
    return "error";
  } finally {
    connection?.disconnect();
  }
}

export async function GET() {
  const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);
  const healthy = database === "ok" && redis === "ok";

  return NextResponse.json(
    {
      status: healthy ? "ok" : "error",
      app: APP_NAME,
      timestamp: new Date().toISOString(),
      database,
      redis
    },
    { status: healthy ? 200 : 503 }
  );
}
