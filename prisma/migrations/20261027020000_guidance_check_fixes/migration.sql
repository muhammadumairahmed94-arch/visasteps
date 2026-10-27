-- Change GuidanceCheckItem.requirementId FK from CASCADE to RESTRICT
-- (so archived/deleted requirements don't silently remove run history)
ALTER TABLE "GuidanceCheckItem" DROP CONSTRAINT "GuidanceCheckItem_requirementId_fkey";
ALTER TABLE "GuidanceCheckItem" ADD CONSTRAINT "GuidanceCheckItem_requirementId_fkey"
  FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Snapshot of the requirement fields at run time (plain JSON, policy data — not client data)
ALTER TABLE "GuidanceCheckItem" ADD COLUMN "requirementSnapshot" TEXT;

-- JSON array of {id, title, govukUrl} for guidance sources in use at run time
ALTER TABLE "GuidanceCheckRun" ADD COLUMN "sourceVersionSnapshot" TEXT;

-- CreateTable: explicit link from a requirement to the checklist items it applies to
CREATE TABLE "RequirementChecklistItem" (
    "requirementId" TEXT NOT NULL,
    "checklistItemId" TEXT NOT NULL,

    CONSTRAINT "RequirementChecklistItem_pkey" PRIMARY KEY ("requirementId","checklistItemId")
);

-- CreateTable: caseworker agree/disagree response on a single guidance-check item
CREATE TABLE "GuidanceCheckResponse" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuidanceCheckResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuidanceCheckResponse_itemId_staffId_key" ON "GuidanceCheckResponse"("itemId", "staffId");

-- AddForeignKey
ALTER TABLE "RequirementChecklistItem" ADD CONSTRAINT "RequirementChecklistItem_requirementId_fkey"
  FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RequirementChecklistItem" ADD CONSTRAINT "RequirementChecklistItem_checklistItemId_fkey"
  FOREIGN KEY ("checklistItemId") REFERENCES "ChecklistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GuidanceCheckResponse" ADD CONSTRAINT "GuidanceCheckResponse_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "GuidanceCheckItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GuidanceCheckResponse" ADD CONSTRAINT "GuidanceCheckResponse_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
