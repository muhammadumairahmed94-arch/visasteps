import type { DocStatus, User } from "@prisma/client";
import { db } from "./db";
import { UserError } from "./errors";
import { resolvedOwner, visibleFiles } from "./sponsor";
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
      sponsorAccounts: { where: { closedAt: null }, select: { id: true, visibleToClient: true } },
    },
  });
  const unreadMessages = await db.message.count({
    where: { clientId, senderKind: "STAFF", readAt: null },
  });
  const anchor = c.plannedSubmissionDate ?? ukToday();
  const sponsorActive = c.sponsorAccounts.length > 0;
  const sponsorVisibleToClient = c.sponsorAccounts.some((s) => s.visibleToClient);

  // Docs the client can interact with: those resolved to CLIENT, plus SPONSOR docs shown read-only
  const visibleDocs = c.documents.filter(shown).filter((d) => {
    const owner = resolvedOwner(d, sponsorActive);
    if (owner === "CLIENT") return true;
    // SPONSOR-assigned doc: show read-only if visibleToClient is enabled
    return sponsorVisibleToClient;
  });

  const docs = visibleDocs.map((d) => ({ ...d.checklistItem, doc: d }));
  const sponsorReadOnly = (d: (typeof visibleDocs)[number]) =>
    resolvedOwner(d, sponsorActive) === "SPONSOR";

  return {
    firstName: c.firstName,
    route: c.route.name,
    caseStage: c.caseStage,
    unreadMessages,
    isSponsor: false,
    firm: { name: c.firm.name, phone: c.firm.phone, whatsapp: c.firm.whatsapp, reviewDays: c.firm.reviewDays },
    details: { name: `${c.firstName} ${c.lastName}`, mobile: c.mobile, email: c.email },
    groups: groupItems(docs).map((g) => ({
      id: g.folder,
      label: g.label,
      docs: g.items.map((i) => {
        const readOnly = sponsorReadOnly(i.doc);
        const myFiles = visibleFiles(i.doc.files, "CLIENT", i.doc.filesShared);
        return {
          id: i.doc.id,
          typeKey: i.typeKey,
          title: i.title,
          why: i.why,
          dates: i.dateWindow ? resolveDateWindow(i.dateWindow, anchor) : null,
          exampleImage: i.exampleImage ?? null,
          howToGet: i.howToGet ?? null,
          required: i.required,
          status: i.doc.status,
          // Never show the REDO note to the main client for a SPONSOR-assigned doc
          note: i.doc.status === "REDO" && !readOnly ? i.doc.note : null,
          missingAt: !readOnly && i.doc.missingAt ? i.doc.missingAt.toISOString() : null,
          missingResponse: !readOnly ? (i.doc.missingResponse ?? null) : null,
          readOnly,
          files: myFiles.map((f) => ({ orig: f.originalName, date: ukDate(f.uploadedAt) })),
        };
      }),
    })),
  };
}

/** Portal view for a sponsor account. Reads the parent case's SPONSOR-assigned documents. */
export async function sponsorPortalView(sponsorClientId: string) {
  const sponsor = await db.client.findUniqueOrThrow({
    where: { id: sponsorClientId },
    include: {
      sponsorForClient: {
        include: {
          firm: true,
          route: true,
          caseworker: true,
          documents: { include: { checklistItem: true, files: current } },
        },
      },
    },
  });
  if (!sponsor.sponsorForClient) throw new UserError("Account not found.");
  const parent = sponsor.sponsorForClient;

  const anchor = parent.plannedSubmissionDate ?? ukToday();
  const sponsorDocs = parent.documents.filter(shown).filter((d) =>
    resolvedOwner(d, true) === "SPONSOR",
  );
  const docs = sponsorDocs.map((d) => ({ ...d.checklistItem, doc: d }));

  return {
    firstName: sponsor.firstName,
    sponsorLabel: sponsor.sponsorLabel ?? "Partner/Sponsor",
    route: parent.route.name,
    caseStage: null,
    unreadMessages: 0,
    isSponsor: true,
    firm: { name: parent.firm.name, phone: parent.firm.phone, whatsapp: parent.firm.whatsapp, reviewDays: parent.firm.reviewDays },
    details: { name: `${sponsor.firstName} ${sponsor.lastName}`, mobile: sponsor.mobile, email: sponsor.email },
    groups: groupItems(docs).map((g) => ({
      id: g.folder,
      label: g.label,
      docs: g.items.map((i) => {
        const myFiles = visibleFiles(i.doc.files, "SPONSOR", i.doc.filesShared);
        return {
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
          readOnly: false,
          files: myFiles.map((f) => ({ orig: f.originalName, date: ukDate(f.uploadedAt) })),
        };
      }),
    })),
  };
}

export type ClientPortalView = Awaited<ReturnType<typeof clientPortalView>>;
export type SponsorPortalView = Awaited<ReturnType<typeof sponsorPortalView>>;
export type PortalView = ClientPortalView | SponsorPortalView;

/** Admins see every case in the firm; caseworkers see the cases assigned to them.
 *  sponsorForClientId: null ensures sponsor sub-accounts never surface as cases. */
export const visibleCases = (u: User) =>
  u.role === "ADMIN"
    ? { firmId: u.firmId, sponsorForClientId: null }
    : { firmId: u.firmId, caseworkerId: u.id, sponsorForClientId: null };

export async function staffCaseList(u: User) {
  const clients = await db.client.findMany({
    where: visibleCases(u),
    include: { route: true, documents: { include: { checklistItem: true } } },
    orderBy: { createdAt: "desc" },
  });
  const clientIds = clients.map((c) => c.id);
  const unreadMap = new Map<string, number>();
  if (clientIds.length > 0) {
    const rows = await db.message.groupBy({
      by: ["clientId"],
      where: { clientId: { in: clientIds }, senderKind: "CLIENT", readAt: null },
      _count: { _all: true },
    });
    for (const r of rows) unreadMap.set(r.clientId, r._count._all);
  }
  return clients.map((c) => ({
    id: c.id,
    name: fullName(c),
    accountCreated: !!c.accountCreatedAt,
    closed: !!c.closedAt,
    caseRef: c.caseRef,
    route: c.route.name,
    toReview: c.documents.filter((d) => d.status === "SENT").length,
    missing: c.documents.filter((d) => shown(d) && d.status === "NEED" && d.checklistItem.required).length,
    unread: unreadMap.get(c.id) ?? 0,
  }));
}

export async function staffCaseView(u: User, clientId: string) {
  const c = await db.client.findFirst({
    where: { id: clientId, ...visibleCases(u) },
    include: {
      route: true,
      caseworker: true,
      documents: { include: { checklistItem: true, files: current } },
      sponsorAccounts: { select: { id: true, email: true, sponsorLabel: true, closedAt: true, visibleToClient: true } },
    },
  });
  if (!c) return null;
  const unreadMessages = await db.message.count({
    where: { clientId: c.id, senderKind: "CLIENT", readAt: null },
  });
  const sponsorActive = c.sponsorAccounts.some((s) => !s.closedAt);
  const activeSponsor = c.sponsorAccounts.find((s) => !s.closedAt) ?? null;
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
      reminders: reminderSummary(c, c.documents.filter((d) => shown(d) && d.status === "NEED" && d.checklistItem.required && resolvedOwner(d, sponsorActive) === "CLIENT").length),
      storageRoot: c.accountCreatedAt ? caseFolder(c).join(" / ") : null,
      unreadMessages,
      sponsor: activeSponsor
        ? { id: activeSponsor.id, label: activeSponsor.sponsorLabel ?? "", email: activeSponsor.email, visibleToClient: activeSponsor.visibleToClient }
        : null,
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
        assignedTo: resolvedOwner(i.doc, sponsorActive),
        assignedToOverride: i.doc.assignedToOverride as "CLIENT" | "SPONSOR" | null,
        filesShared: i.doc.filesShared,
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

/* ---------- client / sponsor upload ---------- */

export type FileInput = { name: string; data: Buffer };

/**
 * Resolve who is uploading (main client or sponsor) and return the document, the parent case client,
 * and the uploaderKind to stamp on FileUpload rows.
 * Throws UserError if the uploader is not authorised for this document.
 */
async function resolveUploadAuth(uploaderId: string, docId: string) {
  const uploader = await db.client.findUnique({
    where: { id: uploaderId },
    select: { sponsorForClientId: true, closedAt: true },
  });
  if (!uploader) throw new UserError("We could not find this document. Please go back and try again.");

  const isSponsorUpload = uploader.sponsorForClientId !== null;
  const parentId = isSponsorUpload ? uploader.sponsorForClientId! : uploaderId;

  const doc = await db.clientDocument.findFirst({
    where: { id: docId, clientId: parentId },
    include: {
      checklistItem: true,
      files: current,
      client: {
        include: {
          caseworker: true,
          firm: true,
          sponsorAccounts: { where: { closedAt: null }, select: { id: true } },
        },
      },
    },
  });
  if (!doc) throw new UserError("We could not find this document. Please go back and try again.");
  if (doc.client.closedAt) throw new UserError("This case is closed. Please contact us if you need to send more documents.");

  const sponsorActive = doc.client.sponsorAccounts.length > 0;
  const owner = resolvedOwner(doc, sponsorActive);

  if (isSponsorUpload && owner !== "SPONSOR")
    throw new UserError("We could not find this document. Please go back and try again.");
  if (!isSponsorUpload && owner !== "CLIENT")
    throw new UserError("We could not find this document. Please go back and try again.");

  const uploaderKind: "CLIENT" | "SPONSOR" = isSponsorUpload ? "SPONSOR" : "CLIENT";
  return { doc, caseClient: doc.client, uploaderKind, uploaderId };
}

export async function uploadDocument(
  uploaderId: string,
  docId: string,
  files: FileInput[],
  options?: { multiPage?: boolean },
) {
  const { doc, caseClient: client, uploaderKind, uploaderId: actorId } = await resolveUploadAuth(uploaderId, docId);

  if (doc.status === "OK") throw new UserError("This document is already approved. You do not need to send it again.");
  if (!files.length) throw new UserError("Please choose a file to send.");

  const actorType = uploaderKind === "SPONSOR" ? "SPONSOR" : "CLIENT";

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
        await audit({ firmId: client.firmId, actorType, actorId, action: "document.virus", targetId: doc.id });
        console.error(`Upload refused for ${actorType} ${actorId}: ${result.virus}`);
        throw new UserError("This file could not be accepted. Please upload a different copy of the document.");
      }
    }
    checked.push({ name: f.name || "file", data: f.data, kind });
  }

  const { checklistItem: item } = doc;
  // Always derive the folder from the parent case client (sponsors have no folder of their own)
  const folderPath = [...caseFolder(client), item.folder].join("/");

  // A redo replaces what was there: old files move to "_Old versions", never deleted
  let n = doc.files.length;
  if (doc.status === "REDO") {
    for (const f of doc.files) await moveToOldVersions(f);
    n = 0;
  }

  const date = ukDate();

  if (options?.multiPage && checked.length > 1) {
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
        uploaderKind,
      },
    });
    await storeUpload(upload, merged);
    await audit({ firmId: client.firmId, actorType, actorId, action: "document.upload", targetId: upload.id });
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
          uploaderKind,
        },
      });
      await storeUpload(upload, out.data);
      await audit({ firmId: client.firmId, actorType, actorId, action: "document.upload", targetId: upload.id });
    }
  }

  await db.clientDocument.update({ where: { id: doc.id }, data: { status: "SENT", note: null, redoSince: null, redoRemindedAt: null, missingReason: null, missingAt: null, missingResponse: null } });
  // Always notify the parent case's caseworker (sponsorForClient.caseworker)
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

/* ---------- client / sponsor "I don't have this" ---------- */

export async function reportMissing(uploaderId: string, docId: string, reason: string) {
  const trimmed = reason.trim().slice(0, 500);
  if (!trimmed) throw new UserError("Please tell us why in a few words.");

  const uploader = await db.client.findUnique({
    where: { id: uploaderId },
    select: { sponsorForClientId: true },
  });
  if (!uploader) throw new UserError("We could not find this document. Please go back and try again.");

  const isSponsor = uploader.sponsorForClientId !== null;
  const parentId = isSponsor ? uploader.sponsorForClientId! : uploaderId;

  const doc = await db.clientDocument.findFirst({
    where: { id: docId, clientId: parentId },
    include: {
      checklistItem: true,
      client: {
        include: {
          caseworker: true,
          firm: true,
          sponsorAccounts: { where: { closedAt: null }, select: { id: true } },
        },
      },
    },
  });
  if (!doc) throw new UserError("We could not find this document. Please go back and try again.");
  if (doc.client.closedAt) throw new UserError("This case is closed. Please contact us if you have questions.");
  if (doc.status !== "NEED") throw new UserError("You have already sent this document.");

  const sponsorActive = doc.client.sponsorAccounts.length > 0;
  const owner = resolvedOwner(doc, sponsorActive);
  if (isSponsor && owner !== "SPONSOR")
    throw new UserError("We could not find this document. Please go back and try again.");
  if (!isSponsor && owner !== "CLIENT")
    throw new UserError("We could not find this document. Please go back and try again.");

  const actorType = isSponsor ? "SPONSOR" : "CLIENT";
  await db.clientDocument.update({ where: { id: doc.id }, data: { missingReason: trimmed, missingAt: new Date() } });
  await audit({ firmId: doc.client.firmId, actorType, actorId: uploaderId, action: "document.missing", targetId: doc.id });
  const { client, checklistItem: item } = doc;
  // Always use the parent case's caseworker for notifications
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
