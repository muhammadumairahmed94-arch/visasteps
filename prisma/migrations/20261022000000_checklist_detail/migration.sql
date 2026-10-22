-- AlterTable: richer per-document guidance fields
ALTER TABLE "ChecklistItem"
  ADD COLUMN "howToGet"     TEXT,
  ADD COLUMN "exampleImage" TEXT,
  ADD COLUMN "dateWindow"   TEXT;

-- AlterTable: caseworker can record when the client plans to submit
ALTER TABLE "Client"
  ADD COLUMN "plannedSubmissionDate" TIMESTAMP(3);
