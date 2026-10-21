import type { Client } from "@prisma/client";
import { db } from "./db";
import { storage } from "./adapters/storage";
import { caseFolder } from "./naming";

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

/** Groups checklist items by folder; folder names start with "01 ", "02 " so sorting gives the right order. */
export function groupItems<T extends { folder: string; groupLabel: string; order: number }>(items: T[]) {
  const map = new Map<string, { folder: string; label: string; items: T[] }>();
  for (const i of [...items].sort((a, b) => a.folder.localeCompare(b.folder) || a.order - b.order)) {
    if (!map.has(i.folder)) map.set(i.folder, { folder: i.folder, label: i.groupLabel, items: [] });
    map.get(i.folder)!.items.push(i);
  }
  return [...map.values()];
}
