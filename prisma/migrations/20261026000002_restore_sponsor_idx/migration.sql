-- CreateIndex
-- visibleCases() filters on sponsorForClientId in every staff query; keep the index.
CREATE INDEX IF NOT EXISTS "Client_sponsorForClientId_idx"
  ON "Client" ("sponsorForClientId");
