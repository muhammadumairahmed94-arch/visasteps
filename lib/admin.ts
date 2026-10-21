import type { Role, User } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { audit } from "./audit";
import { sendStaffLink } from "./accounts";
import { getConnection } from "./onedrive-connection";
import { UserError } from "./errors";

/** Everything the admin screen shows. Scoped to the admin's firm. */
export async function adminView(admin: User) {
  const [firm, users, routes, conn] = await Promise.all([
    db.firm.findUniqueOrThrow({ where: { id: admin.firmId } }),
    db.user.findMany({ where: { firmId: admin.firmId }, orderBy: [{ disabledAt: "asc" }, { name: "asc" }], include: { _count: { select: { clients: true } } } }),
    db.route.findMany({
      where: { firmId: admin.firmId },
      orderBy: { name: "asc" },
      include: { items: { where: { archivedAt: null }, orderBy: [{ folder: "asc" }, { order: "asc" }] }, _count: { select: { clients: true } } },
    }),
    getConnection().catch(() => null),
  ]);
  return {
    me: admin.id,
    firm: { name: firm.name, phone: firm.phone, whatsapp: firm.whatsapp ?? "" },
    storage: {
      provider: process.env.STORAGE_PROVIDER ?? "fake",
      account: conn?.account ?? null,
      status: conn?.status ?? null,
      connectedAt: conn?.connectedAt ?? null,
    },
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      clients: u._count.clients,
      disabled: !!u.disabledAt,
      passwordSet: !!u.passwordHash,
      twoFactor: !!u.totpEnabledAt,
    })),
    routes: routes.map((r) => ({
      id: r.id,
      name: r.name,
      clients: r._count.clients,
      folders: [...new Set(r.items.map((i) => i.folder))].sort(),
      items: r.items.map((i) => ({ id: i.id, folder: i.folder, groupLabel: i.groupLabel, title: i.title, why: i.why, typeKey: i.typeKey, required: i.required })),
    })),
  };
}

export type AdminView = Awaited<ReturnType<typeof adminView>>;

/* ---------- firm ---------- */

const FirmInput = z.object({
  name: z.string().trim().min(2, "Enter the firm name").max(120),
  phone: z.string().trim().min(5, "Enter a phone number").max(40),
  whatsapp: z.string().trim().max(20).regex(/^\d*$/, "WhatsApp: digits only, with country code, e.g. 923341161664"),
});

export async function updateFirm(admin: User, input: unknown) {
  const v = FirmInput.safeParse(input);
  if (!v.success) throw new UserError(v.error.issues[0].message);
  await db.firm.update({ where: { id: admin.firmId }, data: { ...v.data, whatsapp: v.data.whatsapp || null } });
  await audit({ firmId: admin.firmId, actorType: "USER", actorId: admin.id, action: "admin.firm.update" });
}

/* ---------- team ---------- */

const NewUser = z.object({
  name: z.string().trim().min(2, "Enter the caseworker's name").max(80),
  email: z.email("Enter a valid email address").trim().toLowerCase(),
  role: z.enum(["CASEWORKER", "ADMIN"]),
});

export async function addUser(admin: User, input: unknown) {
  const v = NewUser.safeParse(input);
  if (!v.success) throw new UserError(v.error.issues[0].message);
  if (await db.user.findUnique({ where: { email: v.data.email } })) throw new UserError("Someone already uses this email.");
  const user = await db.user.create({ data: { ...v.data, firmId: admin.firmId } });
  const firm = await db.firm.findUniqueOrThrow({ where: { id: admin.firmId } });
  const sent = await sendStaffLink(user, firm);
  await audit({ firmId: admin.firmId, actorType: "USER", actorId: admin.id, action: "admin.user.add", targetId: user.id });
  return { sent };
}

type UserAction =
  | { action: "disable"; reassignTo?: string }
  | { action: "enable" }
  | { action: "reset2fa" }
  | { action: "sendLink" }
  | { action: "role"; role: Role };

export async function changeUser(admin: User, userId: string, input: UserAction) {
  const user = await db.user.findFirst({ where: { id: userId, firmId: admin.firmId }, include: { _count: { select: { clients: true } } } });
  if (!user) throw new UserError("Not found.");
  const self = user.id === admin.id;
  let message = "";

  switch (input.action) {
    case "disable": {
      if (self) throw new UserError("You cannot remove your own account.");
      if (user._count.clients) {
        const to = input.reassignTo ? await db.user.findFirst({ where: { id: input.reassignTo, firmId: admin.firmId, disabledAt: null } }) : null;
        if (!to || to.id === user.id) throw new UserError(`${user.name} has ${user._count.clients} client(s). Choose who takes them over.`);
        await db.client.updateMany({ where: { caseworkerId: user.id }, data: { caseworkerId: to.id } });
        message = `${user._count.clients} client(s) moved to ${to.name}. `;
      }
      await db.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
      await db.session.deleteMany({ where: { userId: user.id } }); // signed out everywhere
      message += `${user.name} can no longer sign in.`;
      break;
    }
    case "enable":
      await db.user.update({ where: { id: user.id }, data: { disabledAt: null, failedLogins: 0, lockedUntil: null } });
      message = `${user.name} can sign in again.`;
      break;
    case "reset2fa":
      await db.user.update({ where: { id: user.id }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] } });
      await db.session.deleteMany({ where: { userId: user.id } });
      message = `${user.name} will set up two-step sign-in again at their next sign-in.`;
      break;
    case "sendLink": {
      if (user.disabledAt) throw new UserError("This person has been removed. Restore them first.");
      const firm = await db.firm.findUniqueOrThrow({ where: { id: admin.firmId } });
      if (!(await sendStaffLink(user, firm))) throw new UserError("The email could not be sent. Check the email settings.");
      message = `Password link sent to ${user.email}.`;
      break;
    }
    case "role": {
      if (self && input.role !== "ADMIN") throw new UserError("You cannot remove your own admin rights.");
      await db.user.update({ where: { id: user.id }, data: { role: input.role } });
      message = `${user.name} is now ${input.role === "ADMIN" ? "an admin" : "a caseworker"}.`;
      break;
    }
  }
  await audit({ firmId: admin.firmId, actorType: "USER", actorId: admin.id, action: `admin.user.${input.action}`, targetId: user.id });
  return message;
}

/* ---------- checklists ---------- */

/** "Bank statements (6 months)" → "Bank-statements-6-months" — used in stored file names. */
export const typeKeyFrom = (title: string) =>
  title
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w.toLowerCase()))
    .join("-") || "Document";

/** "Tax returns" → "07 Tax returns" (next number after the route's folders). */
export function nextFolderName(existing: string[], name: string) {
  const n = Math.max(0, ...existing.map((f) => Number(f.slice(0, 2)) || 0)) + 1;
  return `${String(n).padStart(2, "0")} ${name.trim()}`;
}

const RouteInput = z.object({ name: z.string().trim().min(2, "Enter the visa route name").max(80), copyFrom: z.string().optional() });

export async function addRoute(admin: User, input: unknown) {
  const v = RouteInput.safeParse(input);
  if (!v.success) throw new UserError(v.error.issues[0].message);
  if (await db.route.findFirst({ where: { firmId: admin.firmId, name: v.data.name } })) throw new UserError("A route with this name already exists.");
  const source = v.data.copyFrom
    ? await db.route.findFirst({ where: { id: v.data.copyFrom, firmId: admin.firmId }, include: { items: { where: { archivedAt: null } } } })
    : null;
  const route = await db.route.create({
    data: {
      firmId: admin.firmId,
      name: v.data.name,
      extraFolders: source?.extraFolders ?? ["Translations", "Correspondence"].map((f, i) => `${String(90 + i)} ${f}`),
      items: source ? { create: source.items.map(({ folder, groupLabel, title, why, typeKey, required, order }) => ({ folder, groupLabel, title, why, typeKey, required, order })) } : undefined,
    },
  });
  await audit({ firmId: admin.firmId, actorType: "USER", actorId: admin.id, action: "admin.route.add", targetId: route.id });
  return route.id;
}

const ItemInput = z.object({
  title: z.string().trim().min(2, "Enter the document name").max(100),
  why: z.string().trim().min(5, "Add one plain sentence explaining the document").max(300),
  required: z.boolean(),
  folder: z.string().trim().max(60).optional(), // existing folder, or empty to create one
  newFolder: z.string().trim().max(50).optional(), // name for a new folder / group
  groupLabel: z.string().trim().max(50).optional(),
  addToExisting: z.boolean().optional(),
});

async function routeOf(admin: User, routeId: string) {
  const route = await db.route.findFirst({ where: { id: routeId, firmId: admin.firmId }, include: { items: true } });
  if (!route) throw new UserError("Route not found.");
  return route;
}

export async function addItem(admin: User, routeId: string, input: unknown) {
  const v = ItemInput.safeParse(input);
  if (!v.success) throw new UserError(v.error.issues[0].message);
  const route = await routeOf(admin, routeId);
  const folders = [...new Set(route.items.map((i) => i.folder))];
  let folder = v.data.folder && folders.includes(v.data.folder) ? v.data.folder : "";
  let groupLabel = route.items.find((i) => i.folder === folder)?.groupLabel ?? "";
  if (!folder) {
    if (!v.data.newFolder) throw new UserError("Choose a section or name a new one.");
    folder = nextFolderName([...folders, ...route.extraFolders.filter((f) => /^\d\d /.test(f) && Number(f.slice(0, 2)) < 90)], v.data.newFolder);
    groupLabel = v.data.groupLabel || v.data.newFolder;
  }
  let typeKey = typeKeyFrom(v.data.title);
  for (let k = 2; route.items.some((i) => i.typeKey === typeKey); k++) typeKey = `${typeKeyFrom(v.data.title)}-${k}`;
  const order = Math.max(-1, ...route.items.filter((i) => i.folder === folder).map((i) => i.order)) + 1;
  const item = await db.checklistItem.create({ data: { routeId, folder, groupLabel, title: v.data.title, why: v.data.why, required: v.data.required, typeKey, order } });

  let added = 0;
  if (v.data.addToExisting !== false) {
    const clients = await db.client.findMany({ where: { routeId }, select: { id: true } });
    const r = await db.clientDocument.createMany({ data: clients.map((c) => ({ clientId: c.id, checklistItemId: item.id })), skipDuplicates: true });
    added = r.count;
  }
  await audit({ firmId: admin.firmId, actorType: "USER", actorId: admin.id, action: "admin.item.add", targetId: item.id });
  return { added };
}

const ItemChange = z.object({
  title: z.string().trim().min(2).max(100).optional(),
  why: z.string().trim().min(5).max(300).optional(),
  required: z.boolean().optional(),
  move: z.enum(["up", "down"]).optional(),
  remove: z.boolean().optional(),
});

export async function changeItem(admin: User, itemId: string, input: unknown) {
  const v = ItemChange.safeParse(input);
  if (!v.success) throw new UserError(v.error.issues[0].message);
  const item = await db.checklistItem.findFirst({ where: { id: itemId, route: { firmId: admin.firmId } } });
  if (!item) throw new UserError("Not found.");

  if (v.data.remove) {
    // Kept for clients who already sent it; disappears for everyone else
    await db.checklistItem.update({ where: { id: item.id }, data: { archivedAt: new Date() } });
  } else if (v.data.move) {
    const siblings = await db.checklistItem.findMany({ where: { routeId: item.routeId, folder: item.folder, archivedAt: null }, orderBy: { order: "asc" } });
    const i = siblings.findIndex((s) => s.id === item.id);
    const j = v.data.move === "up" ? i - 1 : i + 1;
    if (j >= 0 && j < siblings.length) {
      const reordered = [...siblings];
      [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
      await db.$transaction(reordered.map((s, k) => db.checklistItem.update({ where: { id: s.id }, data: { order: k } })));
    }
  } else {
    await db.checklistItem.update({ where: { id: item.id }, data: { title: v.data.title, why: v.data.why, required: v.data.required } });
  }
  await audit({ firmId: admin.firmId, actorType: "USER", actorId: admin.id, action: v.data.remove ? "admin.item.remove" : "admin.item.edit", targetId: item.id });
}
