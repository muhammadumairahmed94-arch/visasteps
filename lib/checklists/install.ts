import { db } from "../db";
import { allRoutes } from ".";

/** Adds any of the firm's standard routes that are missing (matched by name). Never changes existing ones. */
export async function addMissingRoutes(firmId: string) {
  const existing = new Set((await db.route.findMany({ where: { firmId }, select: { name: true } })).map((r) => r.name));
  const added: string[] = [];
  for (const r of allRoutes) {
    if (existing.has(r.name)) continue;
    await db.route.create({
      data: { firmId, name: r.name, extraFolders: r.extraFolders, items: { create: r.items.map((i, order) => ({ ...i, order })) } },
    });
    added.push(`${r.name} (${r.items.length} documents)`);
  }
  return added;
}
