-- ChecklistItem: route-level assignment default
ALTER TABLE "ChecklistItem"
  ADD COLUMN "assignedTo" TEXT NOT NULL DEFAULT 'CLIENT';

-- ClientDocument: per-case override and cross-party file flag
ALTER TABLE "ClientDocument"
  ADD COLUMN "assignedToOverride" TEXT,
  ADD COLUMN "filesShared" BOOLEAN NOT NULL DEFAULT false;

-- FileUpload: uploader provenance
ALTER TABLE "FileUpload"
  ADD COLUMN "uploaderKind" TEXT NOT NULL DEFAULT 'CLIENT';

-- Client: sponsor sub-accounts (self-referential)
ALTER TABLE "Client"
  ADD COLUMN "sponsorForClientId" TEXT,
  ADD COLUMN "sponsorLabel"        TEXT,
  ADD COLUMN "visibleToClient"     BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Client"
  ADD CONSTRAINT "Client_sponsorForClientId_fkey"
  FOREIGN KEY ("sponsorForClientId") REFERENCES "Client"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Client_sponsorForClientId_idx"
  ON "Client" ("sponsorForClientId");

-- ActorType enum
ALTER TYPE "ActorType" ADD VALUE IF NOT EXISTS 'SPONSOR';
