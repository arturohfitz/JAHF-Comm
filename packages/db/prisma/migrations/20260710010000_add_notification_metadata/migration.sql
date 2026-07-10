-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "metadata" JSONB,
ADD COLUMN "deduplicationKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Notification_tenantId_deduplicationKey_key" ON "Notification"("tenantId", "deduplicationKey");

-- CreateIndex
CREATE INDEX "Notification_tenantId_userId_isRead_idx" ON "Notification"("tenantId", "userId", "isRead");

-- CreateIndex
CREATE INDEX "Notification_tenantId_deduplicationKey_idx" ON "Notification"("tenantId", "deduplicationKey");
