import { db } from "../db";
import { allRoutes } from ".";

/**
 * Brings the firm's standard routes in line with lib/checklists (matched by route name, items by typeKey):
 * updates wording, adds new documents (also to existing clients on that route) and retires the route's
 * `retiredKeys`. Documents an admin added themselves are left alone. Dry run unless `apply` is true.
 */
export async function syncRoutes(firmId: string, apply: boolean) {
  const log: string[] = [];
  for (const def of allRoutes) {
    const route = await db.route.findFirst({
      where: { firmId, name: def.name },
      include: { items: { include: { documents: { select: { _count: { select: { files: true } } } } } }, clients: { select: { id: true } } },
    });
    if (!route) { log.push(`${def.name}: not set up yet (run init:production)`); continue; }
    const ops: (() => Promise<unknown>)[] = [];
    const say = (s: string) => log.push(`${def.name}: ${s}`);

    for (const [order, d] of def.items.entries()) {
      const cur = route.items.find((i) => i.typeKey === d.typeKey);
      if (!cur) {
        say(`add "${d.title}"${route.clients.length ? ` (and to ${route.clients.length} client(s))` : ""}`);
        ops.push(async () => {
          const item = await db.checklistItem.create({ data: { routeId: route.id, ...d, order } });
          await db.clientDocument.createMany({ data: route.clients.map((c) => ({ clientId: c.id, checklistItemId: item.id })), skipDuplicates: true });
        });
        continue;
      }
      const hasFiles = cur.documents.some((x) => x._count.files > 0);
      const folder = cur.folder !== d.folder && hasFiles ? cur.folder : d.folder; // never move a section clients have already filled
      if (folder !== d.folder) say(`kept "${d.title}" in ${cur.folder} (files already saved there)`);
      const data = { title: d.title, why: d.why, required: d.required, groupLabel: d.groupLabel, folder, order, archivedAt: null };
      const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => cur[k] !== data[k]);
      if (!changed.length) continue;
      say(`update "${d.title}" (${changed.join(", ")})`);
      ops.push(() => db.checklistItem.update({ where: { id: cur.id }, data }));
    }
    for (const cur of route.items.filter((i) => !i.archivedAt && def.retiredKeys.includes(i.typeKey))) {
      say(`retire "${cur.title}" (kept for clients who already sent it)`);
      ops.push(() => db.checklistItem.update({ where: { id: cur.id }, data: { archivedAt: new Date() } }));
    }
    if (!ops.length) say("already up to date");
    if (apply) for (const op of ops) await op();
  }
  return log;
}
