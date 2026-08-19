-- Additive migration for platform administration, explicit active tenant sessions,
-- onboarding completion tracking, and globally unique Evolution identities.

CREATE TYPE "PlatformRole" AS ENUM ('USER', 'SUPER_ADMIN');

ALTER TABLE "Tenant"
ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);

ALTER TABLE "users"
ADD COLUMN "platformRole" "PlatformRole" NOT NULL DEFAULT 'USER',
ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "AuthSession"
ADD COLUMN "activeTenantId" TEXT;

CREATE INDEX "Tenant_onboardingCompletedAt_idx" ON "Tenant"("onboardingCompletedAt");
CREATE INDEX "users_platformRole_idx" ON "users"("platformRole");
CREATE INDEX "AuthSession_activeTenantId_idx" ON "AuthSession"("activeTenantId");

CREATE UNIQUE INDEX "WhatsAppAccount_provider_instanceName_key"
ON "WhatsAppAccount"("provider", "instanceName");

CREATE UNIQUE INDEX "WhatsAppAccount_provider_providerInstanceId_key"
ON "WhatsAppAccount"("provider", "providerInstanceId");

CREATE UNIQUE INDEX "WhatsAppAccount_provider_providerAccountId_key"
ON "WhatsAppAccount"("provider", "providerAccountId");

ALTER TABLE "AuthSession"
ADD CONSTRAINT "AuthSession_activeTenantId_fkey"
FOREIGN KEY ("activeTenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
