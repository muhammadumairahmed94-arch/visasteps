-- Firm: per-firm data retention period (years)
ALTER TABLE "Firm" ADD COLUMN "retentionYears" INTEGER NOT NULL DEFAULT 6;

-- Client: legal hold
ALTER TABLE "Client" ADD COLUMN "legalHold" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Client" ADD COLUMN "legalHoldReason" TEXT;
ALTER TABLE "Client" ADD COLUMN "legalHoldAt" TIMESTAMP(3);

-- Client: explicit retention extension date (overrides closedAt+retentionYears when later)
ALTER TABLE "Client" ADD COLUMN "retainUntil" TIMESTAMP(3);

-- Client: async OneDrive deletion tracking
ALTER TABLE "Client" ADD COLUMN "deletionPendingAt" TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN "deletionPendingTries" INTEGER NOT NULL DEFAULT 0;
