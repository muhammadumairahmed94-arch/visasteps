-- CreateEnum
CREATE TYPE "LinkKind" AS ENUM ('SETUP', 'RESET');

-- DropForeignKey
ALTER TABLE "OtpCode" DROP CONSTRAINT "OtpCode_clientId_fkey";

-- DropIndex
DROP INDEX "Client_mobile_idx";

-- AlterTable
ALTER TABLE "Client" DROP COLUMN "otpLockedUntil",
ADD COLUMN     "accountCreatedAt" TIMESTAMP(3),
ADD COLUMN     "failedLogins" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "passwordHash" TEXT,
ALTER COLUMN "firstName" DROP NOT NULL,
ALTER COLUMN "lastName" DROP NOT NULL,
ALTER COLUMN "mobile" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Firm" DROP COLUMN "hours";

-- AlterTable
ALTER TABLE "Invite" ADD COLUMN     "kind" "LinkKind" NOT NULL DEFAULT 'SETUP';

-- DropTable
DROP TABLE "OtpCode";

-- CreateIndex
CREATE UNIQUE INDEX "Client_email_key" ON "Client"("email");

