-- GuidanceStatus enum
CREATE TYPE "GuidanceStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');

-- GuidanceSource
CREATE TABLE "GuidanceSource" (
  "id"                TEXT NOT NULL,
  "firmId"            TEXT NOT NULL,
  "title"             TEXT NOT NULL,
  "govukUrl"          TEXT NOT NULL,
  "publishedAt"       TIMESTAMP(3),
  "lastUpdatedAt"     TIMESTAMP(3),
  "oneDriveItemId"    TEXT NOT NULL,
  "webUrl"            TEXT,
  "sizeBytes"         INTEGER NOT NULL,
  "mimeType"          TEXT NOT NULL,
  "fileName"          TEXT NOT NULL,
  "extractedText"     TEXT,
  "uploadedById"      TEXT NOT NULL,
  "uploadedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastReviewedAt"    TIMESTAMP(3),
  "lastReviewedById"  TEXT,
  "status"            "GuidanceStatus" NOT NULL DEFAULT 'ACTIVE',
  "previousVersionId" TEXT,
  "typeId"            TEXT,
  CONSTRAINT "GuidanceSource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GuidanceSource_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GuidanceSource_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GuidanceSource_lastReviewedById_fkey" FOREIGN KEY ("lastReviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "GuidanceSource_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "GuidanceSource"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "GuidanceSource_firmId_status_idx" ON "GuidanceSource"("firmId", "status");

-- GuidanceSourceType
CREATE TABLE "GuidanceSourceType" (
  "id"      TEXT NOT NULL,
  "firmId"  TEXT NOT NULL,
  "routeId" TEXT NOT NULL,
  "name"    TEXT NOT NULL,
  "order"   INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "GuidanceSourceType_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GuidanceSourceType_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GuidanceSourceType_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Add FK from GuidanceSource to GuidanceSourceType (after both tables exist)
ALTER TABLE "GuidanceSource"
  ADD CONSTRAINT "GuidanceSource_typeId_fkey"
  FOREIGN KEY ("typeId") REFERENCES "GuidanceSourceType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- GuidanceSourceOnRoute (join table)
CREATE TABLE "GuidanceSourceOnRoute" (
  "sourceId" TEXT NOT NULL,
  "routeId"  TEXT NOT NULL,
  CONSTRAINT "GuidanceSourceOnRoute_pkey" PRIMARY KEY ("sourceId", "routeId"),
  CONSTRAINT "GuidanceSourceOnRoute_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "GuidanceSource"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GuidanceSourceOnRoute_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Route: add guidance owner
ALTER TABLE "Route"
  ADD COLUMN "guidanceOwnerId" TEXT,
  ADD CONSTRAINT "Route_guidanceOwnerId_fkey"
  FOREIGN KEY ("guidanceOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Firm: add guidance review months setting
ALTER TABLE "Firm"
  ADD COLUMN "guidanceReviewMonths" INTEGER NOT NULL DEFAULT 3;
