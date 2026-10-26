-- DropIndex (IF EXISTS: this index may not exist on fresh deployments where
-- migration 20261025101840 runs before 20261026000000 creates it)
DROP INDEX IF EXISTS "Client_sponsorForClientId_idx";
