-- Temporary state for a chunked upload in progress.
-- One session = one client + one document slot. Expires 24 hours after creation.
-- Chunks are stored encrypted on disk; deleted when complete, cancelled, or expired.
CREATE TABLE "UploadSession" (
    "id"        TEXT         NOT NULL,
    "clientId"  TEXT         NOT NULL,
    "docId"     TEXT         NOT NULL,
    "pages"     JSONB        NOT NULL,
    "multiPage" BOOLEAN      NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UploadSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UploadSession_clientId_idx" ON "UploadSession"("clientId");
