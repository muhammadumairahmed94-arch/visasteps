-- CreateEnum
CREATE TYPE "GuidanceCheckRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "GuidanceCheckItemStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "GuidanceCheckRun" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "initiatedById" TEXT NOT NULL,
    "status" "GuidanceCheckRunStatus" NOT NULL DEFAULT 'QUEUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "GuidanceCheckRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuidanceCheckItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "status" "GuidanceCheckItemStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "encryptedResult" TEXT,

    CONSTRAINT "GuidanceCheckItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuidanceCheckRun_clientId_createdAt_idx" ON "GuidanceCheckRun"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "GuidanceCheckRun_status_idx" ON "GuidanceCheckRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "GuidanceCheckItem_runId_requirementId_key" ON "GuidanceCheckItem"("runId", "requirementId");

-- AddForeignKey
ALTER TABLE "GuidanceCheckRun" ADD CONSTRAINT "GuidanceCheckRun_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuidanceCheckRun" ADD CONSTRAINT "GuidanceCheckRun_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuidanceCheckRun" ADD CONSTRAINT "GuidanceCheckRun_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuidanceCheckItem" ADD CONSTRAINT "GuidanceCheckItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "GuidanceCheckRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuidanceCheckItem" ADD CONSTRAINT "GuidanceCheckItem_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
