import type { Client, User } from "@prisma/client";
import { db } from "./db";
import { storage } from "./adapters/storage";
import { caseFolder } from "./naming";
import { UserError } from "./errors";

/** Creates the whole OneDrive folder tree for a case: one folder per checklist folder plus the route's extras. */
export async function createCaseFolders(client: Client, routeId: string) {
  const route = await db.route.findUniqueOrThrow({ where: { id: routeId }, include: { items: true } });
  const root = caseFolder(client);
  const folders = [...new Set([...route.items.map((i) => i.folder), ...route.extraFolders])].sort();
  await storage().ensureFolders(root, folders);
}

export async function createClient(
  firmId: string,
  input: { email: string; routeId: string; caseworkerId: string },
) {
  // Route and caseworker must belong to the same firm
  const [route, cw] = await Promise.all([
    db.route.findFirst({ where: { id: input.routeId, firmId }, include: { items: true } }),
    db.user.findFirst({ where: { id: input.caseworkerId, firmId } }),
  ]);
  if (!route || !cw) throw new Error("Unknown route or caseworker");

  const client = await db.$transaction(async (tx) => {
    const firm = await tx.firm.update({ where: { id: firmId }, data: { nextCaseNumber: { increment: 1 } } });
    return tx.client.create({
      data: {
        ...input,
        firmId,
        caseRef: `IM-${firm.nextCaseNumber - 1}`,
        documents: { create: route.items.map((i) => ({ checklistItemId: i.id })) },
      },
    });
  });
  // Folders are named after the client, so they are created when the client sets up their account
  return client;
}

/**
 * Create or reactivate a sponsor sub-account for a case.
 * If a sponsor row (even a closed one) already exists for this case, it is reactivated and a new
 * invite link is created rather than creating a duplicate row.
 * caseworker is the requesting staff member; the sponsor row's caseworkerId is set to the parent's
 * caseworker so lookups always use sponsorForClient.caseworker (change 3 in approval).
 */
export async function createSponsor(
  parentClientId: string,
  input: { email: string; label: string },
  requestingUser: User,
): Promise<Client> {
  const parent = await db.client.findFirst({
    where: { id: parentClientId, firmId: requestingUser.firmId, sponsorForClientId: null },
  });
  if (!parent) throw new UserError("Case not found.");

  const email = input.email.trim().toLowerCase();

  // Reactivate an existing sponsor row (even if closed) rather than creating a duplicate
  const existing = await db.client.findFirst({
    where: { sponsorForClientId: parentClientId },
  });
  if (existing) {
    // If the caller changed the email address, verify it is not taken by another account
    if (existing.email !== email) {
      const conflict = await db.client.findUnique({ where: { email } });
      if (conflict) throw new UserError("That email address is already in use. Check that you have the right address, or contact us if you need help.");
    }
    return db.client.update({
      where: { id: existing.id },
      data: { closedAt: null, sponsorLabel: input.label.trim(), email },
    });
  }

  // New sponsor: verify email is not already taken
  const conflict = await db.client.findUnique({ where: { email } });
  if (conflict) throw new UserError("That email address is already in use. Check that you have the right address, or contact us if you need help.");

  return db.client.create({
    data: {
      firmId: parent.firmId,
      email,
      caseRef: `${parent.caseRef}-SP`,
      routeId: parent.routeId,
      caseworkerId: parent.caseworkerId, // always the parent's caseworker
      sponsorForClientId: parentClientId,
      sponsorLabel: input.label.trim(),
    },
  });
}

/** Groups checklist items by folder; folder names start with "01 ", "02 " so sorting gives the right order. */
export function groupItems<T extends { folder: string; groupLabel: string; order: number }>(items: T[]) {
  const map = new Map<string, { folder: string; label: string; items: T[] }>();
  for (const i of [...items].sort((a, b) => a.folder.localeCompare(b.folder) || a.order - b.order)) {
    if (!map.has(i.folder)) map.set(i.folder, { folder: i.folder, label: i.groupLabel, items: [] });
    map.get(i.folder)!.items.push(i);
  }
  return [...map.values()];
}
