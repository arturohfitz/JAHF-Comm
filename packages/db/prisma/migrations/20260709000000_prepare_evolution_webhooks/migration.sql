-- CreateEnum
CREATE TYPE "WebhookLogStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'DUPLICATE', 'FAILED', 'UNAUTHORIZED');

-- AlterTable
ALTER TABLE "WhatsAppAccount" ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "instanceName" TEXT,
ADD COLUMN     "providerInstanceId" TEXT;

-- CreateTable
CREATE TABLE "WebhookLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "whatsappAccountId" TEXT,
    "provider" "WhatsAppProvider" NOT NULL,
    "eventType" TEXT,
    "providerInstanceId" TEXT,
    "providerMessageId" TEXT,
    "status" "WebhookLogStatus" NOT NULL,
    "httpStatus" INTEGER NOT NULL,
    "errorMessage" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookLog_tenantId_idx" ON "WebhookLog"("tenantId");

-- CreateIndex
CREATE INDEX "WebhookLog_whatsappAccountId_idx" ON "WebhookLog"("whatsappAccountId");

-- CreateIndex
CREATE INDEX "WebhookLog_provider_idx" ON "WebhookLog"("provider");

-- CreateIndex
CREATE INDEX "WebhookLog_provider_providerInstanceId_idx" ON "WebhookLog"("provider", "providerInstanceId");

-- CreateIndex
CREATE INDEX "WebhookLog_providerMessageId_idx" ON "WebhookLog"("providerMessageId");

-- CreateIndex
CREATE INDEX "WebhookLog_status_idx" ON "WebhookLog"("status");

-- CreateIndex
CREATE INDEX "WebhookLog_createdAt_idx" ON "WebhookLog"("createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppAccount_tenantId_provider_providerAccountId_idx" ON "WhatsAppAccount"("tenantId", "provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppAccount_tenantId_provider_providerInstanceId_key" ON "WhatsAppAccount"("tenantId", "provider", "providerInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppAccount_tenantId_provider_instanceName_key" ON "WhatsAppAccount"("tenantId", "provider", "instanceName");

-- AddForeignKey
ALTER TABLE "WebhookLog" ADD CONSTRAINT "WebhookLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookLog" ADD CONSTRAINT "WebhookLog_whatsappAccountId_fkey" FOREIGN KEY ("whatsappAccountId") REFERENCES "WhatsAppAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
