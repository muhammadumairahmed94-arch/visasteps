-- Single-use 6-digit codes for client OTP sign-in.
-- Codes are stored hashed (HMAC-SHA256 keyed to AUTH_SECRET) and expire after 10 minutes.
CREATE TABLE "SignInCode" (
    "id"        TEXT        NOT NULL,
    "clientId"  TEXT        NOT NULL,
    "codeHash"  TEXT        NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt"    TIMESTAMP(3),
    "attempts"  INTEGER     NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SignInCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SignInCode_clientId_idx" ON "SignInCode"("clientId");

ALTER TABLE "SignInCode"
    ADD CONSTRAINT "SignInCode_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
