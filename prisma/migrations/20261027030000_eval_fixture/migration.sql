-- CreateTable
CREATE TABLE "EvalFixture" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "encryptedData" TEXT NOT NULL,

    CONSTRAINT "EvalFixture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvalFixture_firmId_createdAt_idx" ON "EvalFixture"("firmId", "createdAt");

-- AddForeignKey
ALTER TABLE "EvalFixture" ADD CONSTRAINT "EvalFixture_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalFixture" ADD CONSTRAINT "EvalFixture_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
