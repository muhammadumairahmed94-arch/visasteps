-- CreateEnum
CREATE TYPE "StorageStatus" AS ENUM ('SAVED', 'PENDING', 'FAILED');

-- CreateEnum
CREATE TYPE "StorageJobKind" AS ENUM ('UPLOAD', 'MOVE');

-- AlterTable
ALTER TABLE "FileUpload" ADD COLUMN     "folderPath" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "storageStatus" "StorageStatus" NOT NULL DEFAULT 'SAVED',
ADD COLUMN     "webUrl" TEXT,
ALTER COLUMN "oneDriveItemId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "StorageJob" (
    "id" TEXT NOT NULL,
    "kind" "StorageJobKind" NOT NULL,
    "fileUploadId" TEXT NOT NULL,
    "folderPath" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tempPath" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorageJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StorageJob_nextAttemptAt_idx" ON "StorageJob"("nextAttemptAt");

-- AddForeignKey
ALTER TABLE "StorageJob" ADD CONSTRAINT "StorageJob_fileUploadId_fkey" FOREIGN KEY ("fileUploadId") REFERENCES "FileUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

