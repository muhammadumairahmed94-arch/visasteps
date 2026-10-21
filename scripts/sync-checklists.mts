/**
 * Updates the standard visa checklists to the current wording in lib/checklists (GOV.UK-checked).
 * Shows what would change; add --apply to make the changes.   docker compose run --rm tools npm run checklists:sync -- --apply
 */
import { db } from "../lib/db";
import { syncRoutes } from "../lib/checklists/sync";

const apply = process.argv.includes("--apply");
const firm = await db.firm.findFirst({ orderBy: { createdAt: "asc" } });
if (!firm) throw new Error("No firm — run init:production first.");
for (const line of await syncRoutes(firm.id, apply)) console.log(line);
console.log(apply ? "✓ Checklists updated" : "\nNothing changed yet. Run again with --apply to make these changes.");
await db.$disconnect();
