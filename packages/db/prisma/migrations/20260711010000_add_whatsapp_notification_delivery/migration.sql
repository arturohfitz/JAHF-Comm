-- Additive migration for WhatsApp internal alert delivery in dry-run mode.

CREATE TYPE "NotificationSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

CREATE TYPE "NotificationChannel" AS ENUM ('WHATSAPP');

CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED', 'DRY_RUN', 'UNKNOWN');

ALTER TABLE "Notification"
ADD COLUMN "severity" "NotificationSeverity" NOT NULL DEFAULT 'MEDIUM';

CREATE TABLE "TenantNotificationSettings" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "whatsappAlertsAccountId" TEXT,
  "whatsappAlertsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TenantNotificationSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationPreference" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
  "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
  "whatsappPhone" TEXT,
  "minimumSeverity" "NotificationSeverity" NOT NULL DEFAULT 'HIGH',
  "returningCustomerEnabled" BOOLEAN NOT NULL DEFAULT true,
  "supportEnabled" BOOLEAN NOT NULL DEFAULT true,
  "highPriorityEnabled" BOOLEAN NOT NULL DEFAULT true,
  "negativeSentimentEnabled" BOOLEAN NOT NULL DEFAULT false,
  "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
  "quietHoursStart" TEXT,
  "quietHoursEnd" TEXT,
  "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "allowUrgentDuringQuietHours" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationDelivery" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "destination" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'EVOLUTION',
  "providerMessageId" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantNotificationSettings_tenantId_key" ON "TenantNotificationSettings"("tenantId");
CREATE UNIQUE INDEX "TenantNotificationSettings_tenantId_id_key" ON "TenantNotificationSettings"("tenantId", "id");
CREATE INDEX "TenantNotificationSettings_tenantId_whatsappAlertsEnabled_idx" ON "TenantNotificationSettings"("tenantId", "whatsappAlertsEnabled");
CREATE INDEX "TenantNotificationSettings_tenantId_whatsappAlertsAccountId_idx" ON "TenantNotificationSettings"("tenantId", "whatsappAlertsAccountId");

CREATE UNIQUE INDEX "NotificationPreference_tenantId_userId_key" ON "NotificationPreference"("tenantId", "userId");
CREATE UNIQUE INDEX "NotificationPreference_tenantId_id_key" ON "NotificationPreference"("tenantId", "id");
CREATE INDEX "NotificationPreference_tenantId_whatsappEnabled_idx" ON "NotificationPreference"("tenantId", "whatsappEnabled");
CREATE INDEX "NotificationPreference_tenantId_userId_idx" ON "NotificationPreference"("tenantId", "userId");

CREATE UNIQUE INDEX "NotificationDelivery_tenantId_notificationId_channel_key" ON "NotificationDelivery"("tenantId", "notificationId", "channel");
CREATE UNIQUE INDEX "NotificationDelivery_tenantId_id_key" ON "NotificationDelivery"("tenantId", "id");
CREATE INDEX "NotificationDelivery_tenantId_userId_status_idx" ON "NotificationDelivery"("tenantId", "userId", "status");
CREATE INDEX "NotificationDelivery_tenantId_status_nextAttemptAt_idx" ON "NotificationDelivery"("tenantId", "status", "nextAttemptAt");
CREATE INDEX "NotificationDelivery_tenantId_notificationId_idx" ON "NotificationDelivery"("tenantId", "notificationId");

CREATE INDEX "Notification_tenantId_userId_severity_isRead_idx" ON "Notification"("tenantId", "userId", "severity", "isRead");

ALTER TABLE "TenantNotificationSettings"
ADD CONSTRAINT "TenantNotificationSettings_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TenantNotificationSettings"
ADD CONSTRAINT "TenantNotificationSettings_tenantId_whatsappAlertsAccountId_fkey"
FOREIGN KEY ("tenantId", "whatsappAlertsAccountId") REFERENCES "WhatsAppAccount"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationPreference"
ADD CONSTRAINT "NotificationPreference_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationPreference"
ADD CONSTRAINT "NotificationPreference_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationDelivery"
ADD CONSTRAINT "NotificationDelivery_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationDelivery"
ADD CONSTRAINT "NotificationDelivery_tenantId_notificationId_fkey"
FOREIGN KEY ("tenantId", "notificationId") REFERENCES "Notification"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationDelivery"
ADD CONSTRAINT "NotificationDelivery_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
