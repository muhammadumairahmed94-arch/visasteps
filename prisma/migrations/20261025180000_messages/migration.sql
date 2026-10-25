CREATE TABLE "Message" (
  "id"         TEXT         NOT NULL,
  "clientId"   TEXT         NOT NULL,
  "senderKind" TEXT         NOT NULL,
  "staffId"    TEXT,
  "body"       TEXT         NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt"     TIMESTAMP(3),
  CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Message_clientId_idx" ON "Message"("clientId");
ALTER TABLE "Message" ADD CONSTRAINT "Message_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
