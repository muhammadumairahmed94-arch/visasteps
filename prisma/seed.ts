/**
 * Demo data: one firm, one caseworker, demo client Amina Khan (IM-2041) on the spouse visa route.
 * Wipes the database and the demo client's local-storage folder each time.
 */
import "dotenv/config";

// The seed wipes the database: never against live data, and demo files never go to the firm's SharePoint
if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production");
process.env.STORAGE_PROVIDER = "fake";
import { rm } from "node:fs/promises";
import path from "node:path";
import { PrismaClient, type DocStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { spouseVisa } from "../lib/checklists/spouse-visa";
import { addMissingRoutes } from "../lib/checklists/install";
import { storage } from "../lib/adapters/storage";
import { createCaseFolders, createClient } from "../lib/cases";
import { createLink } from "../lib/accounts";
import { caseFolder, storedFileName } from "../lib/naming";
import { sha256 } from "../lib/crypto";

const db = new PrismaClient();

async function samplePdf(label: string) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  page.drawText(`Demo file: ${label}`, { x: 60, y: 760, size: 20, font: await pdf.embedFont(StandardFonts.Helvetica) });
  return Buffer.from(await pdf.save());
}

// Same starting state as design-reference.html
const DEMO: Record<string, { status: DocStatus; orig?: string; date?: string; note?: string }> = {
  Passport: { status: "OK", orig: "IMG_4412.jpg", date: "2026-10-09" },
  "Marriage-certificate": { status: "OK", orig: "nikah certificate.pdf", date: "2026-10-09" },
  Payslip: { status: "REDO", orig: "payslip may.pdf", date: "2026-10-12", note: "Some months are missing. Please add July to October." },
  "Photos-together": { status: "SENT", orig: "wedding1.jpg", date: "2026-10-14" },
};

async function main() {
  const password = process.env.SEED_STAFF_PASSWORD;
  const clientPassword = process.env.SEED_CLIENT_PASSWORD;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!password || !clientPassword || !adminPassword) throw new Error("Set SEED_STAFF_PASSWORD, SEED_CLIENT_PASSWORD and SEED_ADMIN_PASSWORD in .env");

  // Keep the Microsoft (OneDrive) connection across reseeds — it is real, not demo data
  const keepOneDrive = (await db.firm.findFirst({ orderBy: { createdAt: "asc" } }))?.oneDriveConfig ?? undefined;

  await db.$transaction([
    db.auditLog.deleteMany(),
    db.rateLimit.deleteMany(),
    db.session.deleteMany(),
    db.client.deleteMany(),
    db.checklistItem.deleteMany(),
    db.guidanceSourceOnRoute.deleteMany(),
    db.guidanceSource.deleteMany(),
    db.guidanceSourceType.deleteMany(),
    db.route.deleteMany(),
    db.user.deleteMany(),
    db.firm.deleteMany(),
  ]);

  const firm = await db.firm.create({
    data: {
      name: "UHA Legal",
      phone: "+92 334 116 1664",
      whatsapp: "923341161664",
      nextCaseNumber: 2042,
      oneDriveConfig: keepOneDrive ?? undefined,
    },
  });
  const caseworker = await db.user.create({
    data: { firmId: firm.id, role: "CASEWORKER", name: "Demo Caseworker", email: "caseworker@uhalegal.example", passwordHash: await bcrypt.hash(password, 12) },
  });
  const admin = await db.user.create({
    data: { firmId: firm.id, role: "ADMIN", name: "UHA Legal Admin", email: "info@uhalegal.com", passwordHash: await bcrypt.hash(adminPassword, 12) },
  });
  const route = await db.route.create({
    data: {
      firmId: firm.id,
      name: spouseVisa.name,
      extraFolders: spouseVisa.extraFolders,
      items: { create: spouseVisa.items.map((i, order) => ({ ...i, order })) },
    },
    include: { items: true },
  });
  await addMissingRoutes(firm.id);

  const amina = await db.client.create({
    data: {
      firmId: firm.id,
      firstName: "Amina",
      lastName: "Khan",
      mobile: "+447700900121",
      email: "amina.khan@example.com",
      passwordHash: await bcrypt.hash(clientPassword, 12),
      accountCreatedAt: new Date("2026-10-08T09:00:00Z"),
      caseRef: "IM-2041",
      routeId: route.id,
      caseworkerId: caseworker.id,
    },
  });

  const root = caseFolder(amina);
  await rm(path.resolve(process.env.LOCAL_STORAGE_DIR ?? "./local-storage", ...root), { recursive: true, force: true });
  await rm(path.resolve(process.env.UPLOAD_QUEUE_DIR ?? "./upload-queue"), { recursive: true, force: true }); // queued copies of deleted demo files
  await createCaseFolders(amina, route.id);

  const store = storage();
  for (const item of route.items) {
    const demo = DEMO[item.typeKey];
    const doc = await db.clientDocument.create({
      data: { clientId: amina.id, checklistItemId: item.id, status: demo?.status ?? "NEED", note: demo?.note },
    });
    if (!demo?.orig) continue;
    const data = await samplePdf(item.title);
    const saved = await store.save([...root, item.folder], storedFileName(amina.lastName!, item.typeKey, 1, demo.date!), data);
    await db.fileUpload.create({
      data: {
        clientDocumentId: doc.id,
        originalName: demo.orig,
        storedName: saved.name,
        folderPath: [...root, item.folder].join("/"),
        oneDriveItemId: saved.itemId,
        webUrl: saved.webUrl,
        storageStatus: "SAVED",
        sizeBytes: data.length,
        sha256: sha256(data),
        uploadedAt: new Date(`${demo.date}T10:00:00Z`),
      },
    });
  }

  // A second client who has been invited but has not created an account yet
  const pending = await createClient(firm.id, { email: "new.client@example.com", routeId: route.id, caseworkerId: caseworker.id });
  const link = await createLink(pending.id, "SETUP");

  console.log(`
Seeded ${firm.name}
  Admin:       http://localhost:3000/staff  →  ${admin.email} / SEED_ADMIN_PASSWORD in .env
  Caseworker:  http://localhost:3000/staff  →  ${caseworker.email} / SEED_STAFF_PASSWORD in .env
               (first sign-in asks you to set up an authenticator app)
  Client:      http://localhost:3000        →  ${amina.email} / SEED_CLIENT_PASSWORD in .env
  New client "create your account" link (${pending.email}, ${pending.caseRef}):
               ${link}
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
