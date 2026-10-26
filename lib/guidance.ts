import { z } from "zod";
import type { User } from "@prisma/client";
import { db } from "./db";
import { audit } from "./audit";
import { storage, cleanSegment } from "./adapters/storage";
import { scan, scanningEnabled } from "./virus";
import { detectKind } from "./files";
import { UserError } from "./errors";
import { extractAndStorePages } from "./guidance-pages";

const MAX_BYTES = 50 * 1024 * 1024;

/** Strip scripts, styles and all HTML tags; decode basic entities; collapse whitespace. */
export function extractHtmlText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 10)))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100_000);
}

/** A source is stale when it hasn't been reviewed for more than reviewMonths calendar months. */
export function isStale(
  source: { uploadedAt: Date; lastReviewedAt: Date | null; status: string },
  reviewMonths: number,
): boolean {
  if (source.status !== "ACTIVE") return false;
  const baseline = source.lastReviewedAt ?? source.uploadedAt;
  const cutoff = new Date(baseline);
  cutoff.setMonth(cutoff.getMonth() + reviewMonths);
  return new Date() > cutoff;
}

/* ---------- input validation ---------- */

const UploadMetaInput = z.object({
  title: z.string().trim().min(2, "Title must be at least 2 characters").max(200, "Title must be 200 characters or fewer"),
  govukUrl: z
    .string()
    .url("Enter a valid URL")
    .refine((u) => {
      const host = new URL(u).hostname;
      return host === "gov.uk" || host.endsWith(".gov.uk");
    }, "URL must be from a gov.uk address"),
  publishedAt: z.string().datetime({ offset: true }).nullable().optional(),
  lastUpdatedAt: z.string().datetime({ offset: true }).nullable().optional(),
  typeId: z.string().nullable().optional(),
  routeIds: z.array(z.string()).min(1, "Choose at least one visa route"),
});

export interface GuidanceFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/* ---------- helpers ---------- */

/** Detect MIME type from file contents; never trusts the browser-supplied type. */
async function detectGuidanceMime(buffer: Buffer): Promise<string> {
  const kind = await detectKind(buffer);
  if (kind === "pdf") return "application/pdf";
  if (kind !== null) {
    // A known binary format (image, etc.) — not accepted
    throw new UserError("Only PDF and HTML files are accepted. Best: on the gov.uk page, use Print → Save as PDF.");
  }
  // kind is null: file-type couldn't identify a binary signature. Check for HTML.
  const peek = buffer.slice(0, 4096).toString("utf8").replace(/^﻿/, "").trimStart().toLowerCase();
  if (peek.startsWith("<!doctype") || peek.startsWith("<html") || peek.startsWith("<?xml")) {
    return "text/html";
  }
  throw new UserError("Only PDF and HTML files are accepted. Best: on the gov.uk page, use Print → Save as PDF.");
}

/** Validate file and return the content-detected MIME type. */
async function validateFile(file: GuidanceFile): Promise<string> {
  if (file.buffer.length > MAX_BYTES) {
    throw new UserError("File must be 50 MB or smaller.");
  }
  const mimeType = await detectGuidanceMime(file.buffer);
  if (scanningEnabled()) {
    const result = await scan(file.buffer).catch(() => {
      throw new UserError("Virus scanner is not available right now. Please try again shortly.");
    });
    if (!result.clean) throw new UserError("This file was blocked because it may contain a virus. Please contact support if you believe this is a mistake.");
  }
  return mimeType;
}

async function validateRoutes(firmId: string, routeIds: string[]): Promise<void> {
  const found = await db.route.findMany({ where: { id: { in: routeIds }, firmId }, select: { id: true } });
  if (found.length !== routeIds.length) throw new UserError("One or more selected routes are not valid.");
}

async function storeFile(firmId: string, file: GuidanceFile): Promise<{ itemId: string; webUrl?: string | null }> {
  const safeName = `${Date.now()}-${cleanSegment(file.name)}`;
  const item = await storage().save(["Guidance", firmId], safeName, file.buffer);
  return { itemId: item.itemId, webUrl: item.webUrl };
}

/* ---------- public API ---------- */

export async function uploadGuidance(admin: User, file: GuidanceFile, rawMeta: unknown): Promise<string> {
  const v = UploadMetaInput.safeParse(rawMeta);
  if (!v.success) throw new UserError(v.error.issues[0].message);
  const meta = v.data;

  await validateRoutes(admin.firmId, meta.routeIds);
  const mimeType = await validateFile(file);

  const extractedText = mimeType === "text/html" ? extractHtmlText(file.buffer.toString("utf8")) : null;
  const { itemId, webUrl } = await storeFile(admin.firmId, file);

  const source = await db.guidanceSource.create({
    data: {
      firmId: admin.firmId,
      title: meta.title,
      govukUrl: meta.govukUrl,
      publishedAt: meta.publishedAt ? new Date(meta.publishedAt) : null,
      lastUpdatedAt: meta.lastUpdatedAt ? new Date(meta.lastUpdatedAt) : null,
      oneDriveItemId: itemId,
      webUrl: webUrl ?? null,
      sizeBytes: file.buffer.length,
      mimeType,
      fileName: file.name,
      extractedText,
      uploadedById: admin.id,
      typeId: meta.typeId ?? null,
      routes: { create: meta.routeIds.map((routeId) => ({ routeId })) },
    },
  });

  await audit({ firmId: admin.firmId, actorType: "USER", actorId: admin.id, action: "guidance.upload", targetId: source.id });
  void extractAndStorePages(source.id, file.buffer, mimeType).catch((e) =>
    console.error(`guidance-pages extraction failed for ${source.id}:`, e),
  );
  return source.id;
}

export async function supersedeGuidance(admin: User, oldId: string, file: GuidanceFile, rawMeta: unknown): Promise<string> {
  const v = UploadMetaInput.safeParse(rawMeta);
  if (!v.success) throw new UserError(v.error.issues[0].message);
  const meta = v.data;

  const old = await db.guidanceSource.findFirst({
    where: { id: oldId, firmId: admin.firmId, status: "ACTIVE" },
  });
  if (!old) throw new UserError("This guidance source could not be found or is already superseded.");

  await validateRoutes(admin.firmId, meta.routeIds);
  const mimeType = await validateFile(file);

  const extractedText = mimeType === "text/html" ? extractHtmlText(file.buffer.toString("utf8")) : null;
  const { itemId, webUrl } = await storeFile(admin.firmId, file);

  const [newSource] = await db.$transaction([
    db.guidanceSource.create({
      data: {
        firmId: admin.firmId,
        title: meta.title,
        govukUrl: meta.govukUrl,
        publishedAt: meta.publishedAt ? new Date(meta.publishedAt) : null,
        lastUpdatedAt: meta.lastUpdatedAt ? new Date(meta.lastUpdatedAt) : null,
        oneDriveItemId: itemId,
        webUrl: webUrl ?? null,
        sizeBytes: file.buffer.length,
        mimeType,
        fileName: file.name,
        extractedText,
        uploadedById: admin.id,
        typeId: meta.typeId ?? null,
        previousVersionId: oldId,
        routes: { create: meta.routeIds.map((routeId) => ({ routeId })) },
      },
    }),
    db.guidanceSource.update({ where: { id: oldId }, data: { status: "SUPERSEDED" } }),
    // Archive any draft/approved requirements that cited the superseded source — they need re-review
    db.requirement.updateMany({
      where: { citationSourceId: oldId, archivedAt: null },
      data: { archivedAt: new Date() },
    }),
  ]);

  await audit({ firmId: admin.firmId, actorType: "USER", actorId: admin.id, action: "guidance.supersede", targetId: oldId });
  await audit({ firmId: admin.firmId, actorType: "USER", actorId: admin.id, action: "guidance.upload", targetId: newSource.id });
  void extractAndStorePages(newSource.id, file.buffer, mimeType).catch((e) =>
    console.error(`guidance-pages extraction failed for ${newSource.id}:`, e),
  );
  return newSource.id;
}

export async function markGuidanceReviewed(admin: User, sourceId: string): Promise<void> {
  const source = await db.guidanceSource.findFirst({
    where: { id: sourceId, firmId: admin.firmId, status: "ACTIVE" },
  });
  if (!source) throw new UserError("Guidance source not found.");

  await db.guidanceSource.update({
    where: { id: sourceId },
    data: { lastReviewedAt: new Date(), lastReviewedById: admin.id },
  });
  await audit({ firmId: admin.firmId, actorType: "USER", actorId: admin.id, action: "guidance.review", targetId: sourceId });
}

export async function addGuidanceType(admin: User, rawInput: unknown): Promise<string> {
  const v = z.object({
    routeId: z.string(),
    name: z.string().trim().min(2, "Type name must be at least 2 characters").max(120, "Type name must be 120 characters or fewer"),
  }).safeParse(rawInput);
  if (!v.success) throw new UserError(v.error.issues[0].message);

  const route = await db.route.findFirst({ where: { id: v.data.routeId, firmId: admin.firmId } });
  if (!route) throw new UserError("Route not found.");

  const maxOrder = await db.guidanceSourceType.aggregate({ where: { routeId: v.data.routeId }, _max: { order: true } });
  const type = await db.guidanceSourceType.create({
    data: { firmId: admin.firmId, routeId: v.data.routeId, name: v.data.name, order: (maxOrder._max.order ?? 0) + 1 },
  });

  await audit({ firmId: admin.firmId, actorType: "USER", actorId: admin.id, action: "guidance.type.add", targetId: type.id });
  return type.id;
}

export async function removeGuidanceType(admin: User, typeId: string): Promise<void> {
  const type = await db.guidanceSourceType.findFirst({ where: { id: typeId, firmId: admin.firmId } });
  if (!type) throw new UserError("This source type could not be found.");

  // Detach sources rather than deleting them
  await db.guidanceSource.updateMany({ where: { typeId, firmId: admin.firmId }, data: { typeId: null } });
  await db.guidanceSourceType.delete({ where: { id: typeId } });
  await audit({ firmId: admin.firmId, actorType: "USER", actorId: admin.id, action: "guidance.type.remove", targetId: typeId });
}

export async function setGuidanceOwner(admin: User, routeId: string, userId: string | null): Promise<void> {
  const route = await db.route.findFirst({ where: { id: routeId, firmId: admin.firmId } });
  if (!route) throw new UserError("Route not found.");

  if (userId !== null) {
    const user = await db.user.findFirst({ where: { id: userId, firmId: admin.firmId, role: "ADMIN", disabledAt: null } });
    if (!user) throw new UserError("The selected user must be an active admin in this firm.");
  }

  await db.route.update({ where: { id: routeId }, data: { guidanceOwnerId: userId } });
  await audit({ firmId: admin.firmId, actorType: "USER", actorId: admin.id, action: "guidance.owner.set", targetId: routeId });
}

export async function readGuidanceFile(staff: User, sourceId: string) {
  const source = await db.guidanceSource.findFirst({
    where: { id: sourceId, firmId: staff.firmId, status: { in: ["ACTIVE", "SUPERSEDED"] } },
    select: { oneDriveItemId: true, mimeType: true, fileName: true },
  });
  if (!source) return null;
  const buffer = await storage().read(source.oneDriveItemId);
  return { buffer, mimeType: source.mimeType, fileName: source.fileName };
}

/* ---------- guidance view ---------- */

export async function guidanceView(staff: User) {
  const firm = await db.firm.findUniqueOrThrow({ where: { id: staff.firmId } });

  const routes = await db.route.findMany({
    where: { firmId: staff.firmId },
    orderBy: { name: "asc" },
    include: {
      guidanceOwner: { select: { id: true, name: true } },
      guidanceTypes: { orderBy: { order: "asc" }, select: { id: true, name: true, order: true } },
      guidanceSources: {
        include: {
          source: {
            include: {
              uploadedBy: { select: { name: true } },
              lastReviewedBy: { select: { name: true } },
              newerVersions: {
                take: 1,
                orderBy: { uploadedAt: "asc" },
                select: { title: true, uploadedAt: true },
              },
            },
          },
        },
      },
    },
  });

  const allAdmins =
    staff.role === "ADMIN"
      ? await db.user.findMany({
          where: { firmId: staff.firmId, role: "ADMIN", disabledAt: null },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [];

  return {
    isAdmin: staff.role === "ADMIN",
    reviewMonths: firm.guidanceReviewMonths,
    routes: routes.map((r) => {
      const sources = r.guidanceSources.map(({ source: s }) => ({
        id: s.id,
        title: s.title,
        govukUrl: s.govukUrl,
        publishedAt: s.publishedAt?.toISOString() ?? null,
        lastUpdatedAt: s.lastUpdatedAt?.toISOString() ?? null,
        mimeType: s.mimeType,
        fileName: s.fileName,
        extractedText: s.extractedText,
        sizeBytes: s.sizeBytes,
        status: s.status as "ACTIVE" | "SUPERSEDED",
        typeId: s.typeId,
        previousVersionId: s.previousVersionId,
        supersededBy: s.newerVersions[0]
          ? { title: s.newerVersions[0].title, uploadedAt: s.newerVersions[0].uploadedAt.toISOString() }
          : null,
        uploadedAt: s.uploadedAt.toISOString(),
        lastReviewedAt: s.lastReviewedAt?.toISOString() ?? null,
        uploadedBy: s.uploadedBy.name,
        lastReviewedBy: s.lastReviewedBy?.name ?? null,
        stale: isStale(s, firm.guidanceReviewMonths),
      }));

      const activeSources = sources.filter((s) => s.status === "ACTIVE");
      const supersededSources = sources.filter((s) => s.status === "SUPERSEDED");
      const covered = r.guidanceTypes.filter((t) => activeSources.some((s) => s.typeId === t.id)).length;

      return {
        id: r.id,
        name: r.name,
        owner: r.guidanceOwner ?? null,
        expectedTypes: r.guidanceTypes,
        coverage: { covered, total: r.guidanceTypes.length },
        activeSources,
        supersededSources,
      };
    }),
    allAdmins,
  };
}

export type GuidanceView = Awaited<ReturnType<typeof guidanceView>>;
export type GuidanceRouteView = GuidanceView["routes"][number];
export type GuidanceSourceView = GuidanceRouteView["activeSources"][number];
