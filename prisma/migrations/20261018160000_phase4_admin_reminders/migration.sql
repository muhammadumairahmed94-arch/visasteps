-- AlterEnum
ALTER TYPE "LinkKind" ADD VALUE 'STAFF';

-- AlterTable
ALTER TABLE "ChecklistItem" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "lastReminderAt" TIMESTAMP(3),
ADD COLUMN     "reminderCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ClientDocument" ADD COLUMN     "redoRemindedAt" TIMESTAMP(3),
ADD COLUMN     "redoSince" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Invite" ADD COLUMN     "userId" TEXT,
ALTER COLUMN "clientId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "disabledAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

