/**
 * First run on the live server: creates the firm and every visa checklist. No demo data.
 * Safe to run again — it only adds what is missing.   docker compose run --rm tools npm run init:production
 */
import { db } from "../lib/db";
import { addMissingRoutes } from "../lib/checklists/install";

let firm = await db.firm.findFirst({ orderBy: { createdAt: "asc" } });
if (!firm) {
  firm = await db.firm.create({ data: { name: "UHA Legal", phone: "+92 334 116 1664", whatsapp: "923341161664", nextCaseNumber: 1001 } });
  console.log(`✓ Created firm ${firm.name} (first case reference will be IM-1001)`);
} else console.log(`✓ Firm already set up: ${firm.name}`);

const added = await addMissingRoutes(firm.id);
for (const a of added) console.log(`✓ Added checklist: ${a}`);
if (!added.length) console.log("✓ All visa checklists already present");

const admins = await db.user.count({ where: { firmId: firm.id, role: "ADMIN", disabledAt: null } });
console.log(admins ? `✓ ${admins} admin account(s) exist` : "Next: create the admin account →  docker compose run --rm tools npm run admin:create");
await db.$disconnect();
