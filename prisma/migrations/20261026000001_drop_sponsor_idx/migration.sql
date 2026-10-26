-- DropIndex
-- Migration 20261026000000 created Client_sponsorForClientId_idx but the schema
-- does not define @@index([sponsorForClientId]); drop it to match.
DROP INDEX IF EXISTS "Client_sponsorForClientId_idx";
