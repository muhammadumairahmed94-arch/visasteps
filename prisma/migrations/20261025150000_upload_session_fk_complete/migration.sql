-- Add FK from UploadSession.clientId → Client.id with CASCADE delete
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add FK from UploadSession.docId → ClientDocument.id with CASCADE delete
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_docId_fkey"
  FOREIGN KEY ("docId") REFERENCES "ClientDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add completingAt for double-tap protection on the complete endpoint
ALTER TABLE "UploadSession" ADD COLUMN "completingAt" TIMESTAMP(3);
