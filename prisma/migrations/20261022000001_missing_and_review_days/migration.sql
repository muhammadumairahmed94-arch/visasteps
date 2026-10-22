-- Client can flag a document as "I don't have this", with a short reason
ALTER TABLE "ClientDocument"
  ADD COLUMN "missingReason" TEXT,
  ADD COLUMN "missingAt"     TIMESTAMP(3);

-- Firm setting: how many working days the caseworker usually takes to review an upload
ALTER TABLE "Firm"
  ADD COLUMN "reviewDays" INTEGER NOT NULL DEFAULT 2;
