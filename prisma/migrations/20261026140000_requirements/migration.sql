-- CreateEnum
CREATE TYPE "DraftRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETE', 'FAILED');
CREATE TYPE "DraftSourceStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'NO_TEXT');
CREATE TYPE "RequirementRuleType" AS ENUM ('DATE_LIMIT', 'MONEY_THRESHOLD', 'DOCUMENT_PRESENT', 'NAME_MATCH', 'OTHER');
CREATE TYPE "RequirementStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

-- AlterTable: GuidanceSource — add per-page extraction warning and warning flag
ALTER TABLE "GuidanceSource" ADD COLUMN "extractionWarning" TEXT;

-- CreateTable: GuidancePage (one row per page or HTML section)
CREATE TABLE "GuidancePage" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "locator" TEXT NOT NULL,
    "encryptedText" TEXT NOT NULL,
    CONSTRAINT "GuidancePage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GuidancePage_sourceId_locator_key" ON "GuidancePage"("sourceId", "locator");

-- CreateTable: DraftRun (one drafting job per route)
CREATE TABLE "DraftRun" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "initiatedById" TEXT NOT NULL,
    "status" "DraftRunStatus" NOT NULL DEFAULT 'QUEUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    CONSTRAINT "DraftRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DraftRun_firmId_routeId_createdAt_idx" ON "DraftRun"("firmId", "routeId", "createdAt");
CREATE INDEX "DraftRun_status_idx" ON "DraftRun"("status");

-- CreateTable: DraftRunSource (one row per guidance source in a run)
CREATE TABLE "DraftRunSource" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "DraftSourceStatus" NOT NULL DEFAULT 'PENDING',
    "requirementsFound" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    CONSTRAINT "DraftRunSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Requirement (one per compliance rule extracted from guidance)
CREATE TABLE "Requirement" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "whatIsChecked" TEXT NOT NULL,
    "ruleType" "RequirementRuleType" NOT NULL,
    "limitOrThreshold" TEXT,
    "evidenceNeeded" TEXT NOT NULL,
    "citationSourceId" TEXT NOT NULL,
    "citationLocator" TEXT NOT NULL,
    "citationQuote" TEXT NOT NULL,
    "status" "RequirementStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    CONSTRAINT "Requirement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Requirement_routeId_status_idx" ON "Requirement"("routeId", "status");
CREATE INDEX "Requirement_citationSourceId_idx" ON "Requirement"("citationSourceId");
CREATE INDEX "Requirement_firmId_status_idx" ON "Requirement"("firmId", "status");

-- CreateTable: MentionedSource (guidance docs referenced in text but not in the library)
CREATE TABLE "MentionedSource" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "locator" TEXT NOT NULL,
    "foundInSourceId" TEXT NOT NULL,
    CONSTRAINT "MentionedSource_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MentionedSource_runId_idx" ON "MentionedSource"("runId");

-- CreateTable: ChecklistSuggestion (from approved DOCUMENT_PRESENT requirements)
CREATE TABLE "ChecklistSuggestion" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "documentName" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChecklistSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChecklistSuggestion_firmId_status_idx" ON "ChecklistSuggestion"("firmId", "status");

-- AddForeignKey: GuidancePage → GuidanceSource
ALTER TABLE "GuidancePage" ADD CONSTRAINT "GuidancePage_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "GuidanceSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: DraftRun → Firm, Route, User
ALTER TABLE "DraftRun" ADD CONSTRAINT "DraftRun_firmId_fkey"
    FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DraftRun" ADD CONSTRAINT "DraftRun_routeId_fkey"
    FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DraftRun" ADD CONSTRAINT "DraftRun_initiatedById_fkey"
    FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: DraftRunSource → DraftRun, GuidanceSource
ALTER TABLE "DraftRunSource" ADD CONSTRAINT "DraftRunSource_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "DraftRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DraftRunSource" ADD CONSTRAINT "DraftRunSource_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "GuidanceSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: Requirement → Firm, Route, DraftRun, GuidanceSource, User
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_firmId_fkey"
    FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_routeId_fkey"
    FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "DraftRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_citationSourceId_fkey"
    FOREIGN KEY ("citationSourceId") REFERENCES "GuidanceSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: MentionedSource → Firm, DraftRun
ALTER TABLE "MentionedSource" ADD CONSTRAINT "MentionedSource_firmId_fkey"
    FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MentionedSource" ADD CONSTRAINT "MentionedSource_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "DraftRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: ChecklistSuggestion → Firm, Requirement
ALTER TABLE "ChecklistSuggestion" ADD CONSTRAINT "ChecklistSuggestion_firmId_fkey"
    FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChecklistSuggestion" ADD CONSTRAINT "ChecklistSuggestion_requirementId_fkey"
    FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
