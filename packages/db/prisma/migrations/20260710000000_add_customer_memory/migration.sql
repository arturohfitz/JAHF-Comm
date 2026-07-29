-- CreateEnum
CREATE TYPE "CustomerReturnType" AS ENUM ('FIRST_CONTACT', 'ACTIVE_CONVERSATION', 'OPERATIONAL_RETURN', 'COMMERCIAL_REACTIVATION');

-- CreateEnum
CREATE TYPE "MemorySummarySource" AS ENUM ('HEURISTIC', 'AI');

-- CreateTable
CREATE TABLE "CustomerMemory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3),
    "lastInteractionAt" TIMESTAMP(3),
    "previousInteractionAt" TIMESTAMP(3),
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "inboundMessageCount" INTEGER NOT NULL DEFAULT 0,
    "conversationCount" INTEGER NOT NULL DEFAULT 0,
    "hasPreviousInteractions" BOOLEAN NOT NULL DEFAULT false,
    "isReturningCustomer" BOOLEAN NOT NULL DEFAULT false,
    "lastReturnType" "CustomerReturnType" NOT NULL DEFAULT 'FIRST_CONTACT',
    "lastInactivityMinutes" INTEGER,
    "lastReactivatedAt" TIMESTAMP(3),
    "salesCount" INTEGER NOT NULL DEFAULT 0,
    "hasRegisteredSale" BOOLEAN NOT NULL DEFAULT false,
    "lastSaleAt" TIMESTAMP(3),
    "paymentsCount" INTEGER NOT NULL DEFAULT 0,
    "openSupportTicketsCount" INTEGER NOT NULL DEFAULT 0,
    "commercialSummary" TEXT,
    "summarySource" "MemorySummarySource" NOT NULL DEFAULT 'HEURISTIC',
    "memoryVersion" INTEGER NOT NULL DEFAULT 1,
    "signals" JSONB,
    "lastIntent" "AIIntent",
    "lastPriority" "Urgency",
    "lastSentiment" TEXT,
    "recommendedNextAction" TEXT,
    "lastAIClassificationId" TEXT,
    "lastAIMessageAt" TIMESTAMP(3),
    "lastProcessedMessageId" TEXT,
    "lastProcessedMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerMemory_tenantId_id_key" ON "CustomerMemory"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerMemory_tenantId_contactId_key" ON "CustomerMemory"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX "CustomerMemory_tenantId_idx" ON "CustomerMemory"("tenantId");

-- CreateIndex
CREATE INDEX "CustomerMemory_tenantId_lastInteractionAt_idx" ON "CustomerMemory"("tenantId", "lastInteractionAt");

-- CreateIndex
CREATE INDEX "CustomerMemory_tenantId_isReturningCustomer_idx" ON "CustomerMemory"("tenantId", "isReturningCustomer");

-- CreateIndex
CREATE INDEX "CustomerMemory_tenantId_lastReturnType_idx" ON "CustomerMemory"("tenantId", "lastReturnType");

-- CreateIndex
CREATE INDEX "CustomerMemory_tenantId_lastProcessedMessageAt_idx" ON "CustomerMemory"("tenantId", "lastProcessedMessageAt");

-- CreateIndex
CREATE INDEX "CustomerMemory_tenantId_lastAIMessageAt_idx" ON "CustomerMemory"("tenantId", "lastAIMessageAt");

-- AddForeignKey
ALTER TABLE "CustomerMemory" ADD CONSTRAINT "CustomerMemory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMemory" ADD CONSTRAINT "CustomerMemory_tenantId_contactId_fkey" FOREIGN KEY ("tenantId", "contactId") REFERENCES "Contact"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
