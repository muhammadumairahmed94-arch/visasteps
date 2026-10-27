-- CreateEnum
CREATE TYPE "DocCheckRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "DocCheckItemStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'NO_TEXT');

-- CreateTable
CREATE TABLE "DocCheckRun" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "initiatedById" TEXT NOT NULL,
    "status" "DocCheckRunStatus" NOT NULL DEFAULT 'QUEUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DocCheckRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocCheckItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "status" "DocCheckItemStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "encryptedResult" TEXT,

    CONSTRAINT "DocCheckItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocCheckRun_clientId_createdAt_idx" ON "DocCheckRun"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "DocCheckRun_status_idx" ON "DocCheckRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DocCheckItem_runId_docId_key" ON "DocCheckItem"("runId", "docId");

-- AddForeignKey
ALTER TABLE "DocCheckRun" ADD CONSTRAINT "DocCheckRun_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocCheckRun" ADD CONSTRAINT "DocCheckRun_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocCheckRun" ADD CONSTRAINT "DocCheckRun_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocCheckItem" ADD CONSTRAINT "DocCheckItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DocCheckRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocCheckItem" ADD CONSTRAINT "DocCheckItem_docId_fkey" FOREIGN KEY ("docId") REFERENCES "ClientDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
