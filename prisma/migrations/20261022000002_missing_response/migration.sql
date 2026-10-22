-- Stores the caseworker's reply to a client's "I don't have this" flag.
-- Shown on the client's document screen until the client uploads the document.
ALTER TABLE "ClientDocument"
  ADD COLUMN "missingResponse" TEXT;
