import type { DocStatus, User } from "@prisma/client";
import { db } from "./db";
import { UserError } from "./errors";
import { sha256 } from "./crypto";
import { storage } from "./adapters/storage";
import { moveToOldVersions, readQueued, storeUpload } from "./storage-queue";
import { sms } from "./adapters/sms";
import { sendSafely } from "./adapters/email";
import { audit } from "./audit";
import { groupItems } from "./cases";
import { appUrl } from "./accounts";
import { reminderSummary } from "./reminders";
import { MAX_BYTES, detectKind, mergePdf, toPdf } from "./files";
import { scan, scanningEnabled } from "./virus";
import { notifyOps } from "./alerts";
import { caseFolder, storedFileName, ukDate } from "./naming";
import { resolveDateWindow, ukToday } from "./date-window";

export { UserError };

/** Items an admin removed from the route stay visible only where the client had already done something. */
const shown = (d: { status: string; checklistItem: { archivedAt: Date | null } }) => !(d.checklistItem.archivedAt && d.status === "NEED");

/** Before the client sets up their account we only know their email. */
export const fullName = (c: { firstName: string | null; lastName: string | null; email: string }) =>
  c.firstName && c.lastName ? `${c.firstName} ${c.lastName}` : c.email;

const current = { where: { supersededAt: null }, orderBy: { uploadedAt: "asc" as const } };

/* ---------- views (always scoped by the caller's client or firm) ---------- */

export async function clientPortalView(clientId: string) {
  const c = await db.client.findUniqueOrThrow({
    where: { id: clientId },
    include: {
      firm: true,
      route: true,
      documents: { include: { checklistItem: true, files: current } },
    },
  });
  const anchor = c.plannedSubmissionDate ?? ukToday();
  const docs = c.documents.filter(shown).map((d) => ({ ...d.checklistItem, doc: d }));
  return {
    firstName: c.firstName,
    route: c.route.name,
    caseStage: c.caseStage,
    firm: { name: c.firm.name, phone: c.firm.phone, whatsapp: c.firm.whatsapp, reviewDays: c.firm.reviewDays },
    details: { name: `${c.firstName} ${c.lastName}`, mobile: c.mobile, email: c.email },
    groups: groupItems(docs).map((g) => ({
      id: g.folder,
      label: g.label,
      docs: g.items.map((i) => ({
        id: i.doc.id,
        typeKey: i.typeKey,
        title: i.title,
        why: i.why,
        dates: i.dateWindow ? resolveDateWindow(i.dateWindow, anchor) : null,
        exampleImage: i.exampleImage ?? null,
        howToGet: i.howToGet ?? null,
        required: i.required,
        status: i.doc.status,
        note: i.doc.status === "REDO" ? i.doc.note : null,
        missingAt: i.doc.missingAt ? i.doc.missingAt.toISOString() : null,
        missingResponse: i.doc.missingResponse ?? null,
        files: i.doc.files.map((f) => ({ orig: f.originalName, date: ukDate(f.uploadedAt) })),
      })),
    })),
  };
}

export type ClientPortalView = Awaited<ReturnType<typeof clientPortalView>>;

/** Admins see every case in the firm; caseworkers see the cases assigned to them. */
export const visibleCases = (u: User) => (u.role === "ADMIN" ? { firmId: u.firmId } : { firmId: u.firmId, caseworkerId: u.id });

export async function staffCaseList(u: User) {
  const clients = await db.client.findMany({
    where: visibleCases(u),
    include: { route: true, documents: { include: { checklistItem: true } } },
    orderBy: { createdAt: "desc" },
  });
  return clients.map((c) => ({
    id: c.id,
    name: fullName(c),
    accountCreated: !!c.accountCreatedAt,
    closed: !!c.closedAt,
    caseRef: c.caseRef,
    route: c.route.name,
    toReview: c.documents.filter((d) => d.status === "SENT").length,
    missing: c.documents.filter((d) => shown(d) && d.status === "NEED" && d.checklistItem.required).length,
  }));
}

export async function staffCaseView(u: User, clientId: string) {
  const c = await db.client.findFirst({
    where: { id: clientId, ...visibleCases(u) },
    include: { route: true, caseworker: true, documents: { include: { checklistItem: true, files: current } } },
  });
  if (!c) return null;
  const docs = c.documents.filter(shown).map((d) => ({ ...d.checklistItem, doc: d }));
  return {
    client: {
      id: c.id,
      name: fullName(c),
      caseRef: c.caseRef,
      route: c.route.name,
      caseworker: c.caseworker.name,
      mobile: c.mobile,
      email: c.email,
      accountCreated: !!c.accountCreatedAt,
      closedAt: c.closedAt ? ukDate(c.closedAt) : null,
      plannedSubmissionDate: c.plannedSubmissionDate ? c.plannedSubmissionDate.toISOString().slice(0, 10) : null,
      caseStage: c.caseStage,
      reminders: reminderSummary(c, c.documents.filter((d) => shown(d) && d.status === "NEED" && d.checklistItem.required).length),
      storageRoot: c.accountCreatedAt ? caseFolder(c).join(" / ") : null,
    },
    groups: groupItems(docs).map((g) => ({
      id: g.folder,
      label: g.label,
      docs: g.items.map((i) => ({
        id: i.doc.id,
        title: i.title,
        required: i.required,
        status: i.doc.status,
        note: i.doc.note,
        missingReason: i.doc.missingReason ?? null,
        missingAt: i.doc.missingAt ? i.doc.missingAt.toISOString() : null,
        files: i.doc.files.map((f) => ({
          id: f.id,
          storedName: f.storedName,
          orig: f.originalName,
          date: ukDate(f.uploadedAt),
          storage: f.storageStatus,
          webUrl: f.webUrl,
        })),
      })),
    })),
  };
}

export type StaffCaseView = NonNullable<Awaited<ReturnType<typeof staffCaseView>>>;

/* ---------- client upload ---------- */

export type FileInput = { name: string; data: Buffer };

export async function uploadDocument(
  clientId: string,
  docId: string,
  files: FileInput[],
  options?: { multiPage?: boolean },
) {
  const doc = await db.clientDocument.findFirst({
    where: { id: docId, clientId },
    include: { checklistItem: true, files: current, client: { include: { caseworker: true, firm: true } } },
  });
  if (!doc) throw new UserError("We could not find this document. Please go back and try again.");
  if (doc.client.closedAt) throw new UserError("This case is closed. Please contact us if you need to send more documents.");
  if (doc.status === "OK") throw new UserError("This document is already approved. You do not need to send it again.");
  if (!files.length) throw new UserError("Please choose a file to send.");

  // Check every file before saving any of them
  const checked: { name: string; data: Buffer; kind: Awaited<ReturnType<typeof detectKind>> & {} }[] = [];
  for (const f of files) {
    if (f.data.length > MAX_BYTES) throw new UserError("This file is too big. Please send a file under 20 MB.");
    const kind = await detectKind(f.data);
    if (!kind) throw new UserError("We cannot open this file. Please send a photo or a PDF.");
    if (scanningEnabled()) {
      let result;
      try {
        result = await scan(f.data);
      } catch (e) {
        console.error(e instanceof Error ? e.message : e);
        void notifyOps("scanner", "virus scanner unavailable — uploads are being refused", `Client uploads are refused until the virus scanner answers again (${e instanceof Error ? e.message : e}).\nOn the server: docker compose ps clamav ; docker compose restart clamav`);
        throw new UserError("Uploads are paused for a moment. Please try again in a few minutes.");
      }
      if (!result.clean) {
        await audit({ firmId: doc.client.firmId, actorType: "CLIENT", actorId: clientId, action: "document.virus", targetId: doc.id });
        console.error(`Upload refused for client ${clientId}: ${result.virus}`);
        throw new UserError("This file could not be accepted. Please upload a different copy of the document.");
      }
    }
    checked.push({ name: f.name || "file", data: f.data, kind });
  }

  const { client, checklistItem: item } = doc;
  const folderPath = [...caseFolder(client), item.folder].join("/");

  // A redo replaces what was there: old files move to "_Old versions", never deleted
  let n = doc.files.length;
  if (doc.status === "REDO") {
    for (const f of doc.files) await moveToOldVersions(f);
    n = 0;
  }

  // Saved straight to OneDrive / SharePoint; if Microsoft is unreachable, queued and retried (lib/storage-queue.ts)
  const date = ukDate();

  if (options?.multiPage && checked.length > 1) {
    // Merge all pages into one PDF, then create a single FileUpload record
    const pdfPages = await Promise.all(checked.map((f) => toPdf(f.data, f.kind).then((r) => r.data)));
    const merged = await mergePdf(pdfPages);
    const upload = await db.fileUpload.create({
      data: {
        clientDocumentId: doc.id,
        originalName: `scan-${checked.length}-pages.pdf`,
        storedName: storedFileName(client.lastName!, item.typeKey, ++n, date, "pdf"),
        folderPath,
        storageStatus: "PENDING",
        sizeBytes: merged.length,
        sha256: sha256(merged),
      },
    });
    await storeUpload(upload, merged);
    await audit({ firmId: client.firmId, actorType: "CLIENT", actorId: client.id, action: "document.upload", targetId: upload.id });
  } else {
    for (const f of checked) {
      const out = await toPdf(f.data, f.kind);
      const upload = await db.fileUpload.create({
        data: {
          clientDocumentId: doc.id,
          originalName: f.name.slice(0, 200),
          storedName: storedFileName(client.lastName!, item.typeKey, ++n, date, out.ext),
          folderPath,
          storageStatus: "PENDING",
          sizeBytes: out.data.length,
          sha256: sha256(out.data),
        },
      });
      await storeUpload(upload, out.data);
      await audit({ firmId: client.firmId, actorType: "CLIENT", actorId: client.id, action: "document.upload", targetId: upload.id });
    }
  }

  await db.clientDocument.update({ where: { id: doc.id }, data: { status: "SENT", note: null, redoSince: null, redoRemindedAt: null, missingReason: null, missingAt: null, missingResponse: null } });
  await sendSafely({
    to: client.caseworker.email,
    brand: client.firm.name,
    subject: `${fullName(client)} (${client.caseRef}) sent: ${item.title}`,
    text: `${checked.length} file${checked.length === 1 ? "" : "s"} ready to review in ${item.folder}.`,
    action: { label: "Review in portal", url: `${appUrl()}/staff#c/${client.id}/review` },
  });
  return { ok: true, reviewDays: client.firm.reviewDays };
}

/* ---------- caseworker review ---------- */

export async function reviewDocument(u: User, docId: string, action: "approve" | "redo", note?: string) {
  const doc = await db.clientDocument.findFirst({
    where: { id: docId, client: visibleCases(u) },
    include: { checklistItem: true, client: { include: { firm: true } } },
  });
  if (!doc) throw new UserError("Document not found.");
  if (doc.status !== "SENT") throw new UserError("Only documents waiting for review can be approved or sent back.");

  const status: DocStatus = action === "approve" ? "OK" : "REDO";
  const text = note?.trim();
  if (action === "redo" && !text) throw new UserError("Write a short note first.");

  await db.clientDocument.update({
    where: { id: doc.id },
    data: { status, note: action === "redo" ? text!.slice(0, 1000) : null, redoSince: action === "redo" ? new Date() : null, redoRemindedAt: null },
  });
  await audit({ firmId: u.firmId, actorType: "USER", actorId: u.id, action: `document.${action}`, targetId: doc.id });

  if (action === "redo") {
    const msg = `${doc.client.firm.name}: please re-upload ${doc.checklistItem.title}. Client portal: ${appUrl()}/`;
    if (doc.client.mobile) await sms().send(doc.client.mobile, msg);
    const sent = await sendSafely({
      to: doc.client.email,
      brand: doc.client.firm.name,
      subject: `${doc.client.firm.name}: please re-upload ${doc.checklistItem.title}`,
      text: `Please upload ${doc.checklistItem.title} again.\n\nCaseworker note: ${text}`,
      action: { label: "Open client portal", url: `${appUrl()}/` },
    });
    if (!sent) return { warning: "Saved, but the email to the client could not be sent. Please contact the client directly." };
  }
  return {};
}

/* ---------- client "I don't have this" ---------- */

export async function reportMissing(clientId: string, docId: string, reason: string) {
  const trimmed = reason.trim().slice(0, 500);
  if (!trimmed) throw new UserError("Please tell us why in a few words.");
  const doc = await db.clientDocument.findFirst({
    where: { id: docId, clientId },
    include: { checklistItem: true, client: { include: { caseworker: true, firm: true } } },
  });
  if (!doc) throw new UserError("We could not find this document. Please go back and try again.");
  if (doc.client.closedAt) throw new UserError("This case is closed. Please contact us if you have questions.");
  if (doc.status !== "NEED") throw new UserError("You have already sent this document.");
  await db.clientDocument.update({ where: { id: doc.id }, data: { missingReason: trimmed, missingAt: new Date() } });
  await audit({ firmId: doc.client.firmId, actorType: "CLIENT", actorId: clientId, action: "document.missing", targetId: doc.id });
  const { client, checklistItem: item } = doc;
  await sendSafely({
    to: client.caseworker.email,
    brand: client.firm.name,
    subject: `${fullName(client)} (${client.caseRef}) cannot find: ${item.title}`,
    text: `${fullName(client)} has left a note about ${item.title}. Open the portal to read it and reply.`,
    action: { label: "View in portal", url: `${appUrl()}/staff#c/${client.id}/missing` },
  });
}

/* ---------- caseworker response to "I don't have this" ---------- */

export async function respondToMissing(u: User, docId: string, note: string) {
  const doc = await db.clientDocument.findFirst({
    where: { id: docId, client: visibleCases(u) },
    include: { checklistItem: true, client: { include: { firm: true } } },
  });
  if (!doc) throw new UserError("Document not found.");
  if (!doc.missingAt) throw new UserError("This document has not been flagged as missing.");
  const trimmed = note?.trim() || null;
  await db.clientDocument.update({ where: { id: doc.id }, data: { missingReason: null, missingAt: null, missingResponse: trimmed } });
  await audit({ firmId: u.firmId, actorType: "USER", actorId: u.id, action: "document.missing.respond", targetId: doc.id });
  if (trimmed) {
    await sendSafely({
      to: doc.client.email,
      brand: doc.client.firm.name,
      subject: `${doc.client.firm.name}: your caseworker left a note about ${doc.checklistItem.title}`,
      text: `Your caseworker has left a note about ${doc.checklistItem.title}. Open the portal to read it.`,
      action: { label: "Open client portal", url: `${appUrl()}/` },
    });
  }
}

export async function staffReadFile(u: User, fileId: string) {
  const f = await db.fileUpload.findFirst({ where: { id: fileId, clientDocument: { client: visibleCases(u) } }, include: { clientDocument: true } });
  if (!f) return null;
  await audit({ firmId: u.firmId, actorType: "USER", actorId: u.id, action: "document.view", targetId: f.id });
  const data = f.storageStatus === "SAVED" && f.oneDriveItemId ? await storage().read(f.oneDriveItemId) : await readQueued(f.id);
  return data ? { name: f.storedName, data } : null;
}
