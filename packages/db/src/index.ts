import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

function loadLocalEnv() {
  if (process.env.DATABASE_URL) {
    return;
  }

  config({ path: [".env", "../.env", "../../.env"] });
}

loadLocalEnv();

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export function createPrismaClient(
  databaseUrl = process.env.DATABASE_URL
): PrismaClient {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to create a Prisma client.");
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl })
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export {
  AIIntent,
  AuditAction,
  ContactStage,
  ConversationStage,
  CustomerReturnType,
  CustomerEventType,
  MembershipRole,
  MemorySummarySource,
  MessageDirection,
  MessageType,
  NotificationType,
  PaymentStatus,
  Prisma,
  PrismaClient,
  SaleStatus,
  SupportStatus,
  Urgency,
  WebhookLogStatus,
  WhatsAppAccountStatus,
  WhatsAppProvider
} from "@prisma/client";
