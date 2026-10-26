-- Draft requirements that failed quote verification, stored so admins can add them by hand.
CREATE TABLE "RejectedDraft" (
  "id"               TEXT NOT NULL,
  "runId"            TEXT NOT NULL,
  "runSourceId"      TEXT NOT NULL,
  "whatIsChecked"    TEXT NOT NULL,
  "ruleType"         TEXT NOT NULL,
  "limitOrThreshold" TEXT,
  "evidenceNeeded"   TEXT NOT NULL,
  "citationLocator"  TEXT NOT NULL,
  "citationQuote"    TEXT NOT NULL,
  "reason"           TEXT NOT NULL,
  CONSTRAINT "RejectedDraft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RejectedDraft_runId_idx" ON "RejectedDraft"("runId");

ALTER TABLE "RejectedDraft"
  ADD CONSTRAINT "RejectedDraft_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "DraftRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RejectedDraft"
  ADD CONSTRAINT "RejectedDraft_runSourceId_fkey"
  FOREIGN KEY ("runSourceId") REFERENCES "DraftRunSource"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
