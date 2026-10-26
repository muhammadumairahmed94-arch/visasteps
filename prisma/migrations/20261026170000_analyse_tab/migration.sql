-- Add AI analysis history flag to Firm
ALTER TABLE "Firm" ADD COLUMN "analysisHistoryEnabled" BOOLEAN NOT NULL DEFAULT true;

-- Cache of extracted text / image flags per page of a client file upload
CREATE TABLE "ClientFilePage" (
  "id"            TEXT NOT NULL,
  "fileId"        TEXT NOT NULL,
  "pageNumber"    INTEGER NOT NULL,
  "encryptedText" TEXT,
  "isImage"       BOOLEAN NOT NULL DEFAULT false,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientFilePage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientFilePage_fileId_pageNumber_key" ON "ClientFilePage"("fileId", "pageNumber");
CREATE INDEX "ClientFilePage_fileId_idx" ON "ClientFilePage"("fileId");

ALTER TABLE "ClientFilePage" ADD CONSTRAINT "ClientFilePage_fileId_fkey"
  FOREIGN KEY ("fileId") REFERENCES "FileUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Encrypted AI question/answer history per client
CREATE TABLE "AiQuestion" (
  "id"          TEXT NOT NULL,
  "clientId"    TEXT NOT NULL,
  "firmId"      TEXT NOT NULL,
  "askedById"   TEXT NOT NULL,
  "encryptedQ"  TEXT NOT NULL,
  "encryptedA"  TEXT NOT NULL,
  "foldersUsed" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiQuestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiQuestion_clientId_createdAt_idx" ON "AiQuestion"("clientId", "createdAt");

ALTER TABLE "AiQuestion" ADD CONSTRAINT "AiQuestion_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiQuestion" ADD CONSTRAINT "AiQuestion_firmId_fkey"
  FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiQuestion" ADD CONSTRAINT "AiQuestion_askedById_fkey"
  FOREIGN KEY ("askedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
