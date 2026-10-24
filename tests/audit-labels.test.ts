import { describe, it, expect } from "vitest";
import { TEXT } from "../lib/activity";

// Every action string that can appear in audit logs.
// Add to this list whenever a new audit() call is introduced.
const KNOWN_ACTIONS = [
  // Client lifecycle
  "client.create",
  "client.invite",
  "client.invite.link",
  "client.reset.send",
  "client.reset.link",
  "client.account.create",
  "client.reset.request",
  "client.password.reset",
  "client.signin",
  "client.signin.failed",
  "client.signout",
  "client.portal.view",
  "client.close",
  "client.reopen",
  "client.delete",
  "client.reminder",
  "client.reminder.redo",
  "client.reminder.failed",
  // Staff auth
  "staff.signin",
  "staff.signin.failed",
  "staff.signout",
  "staff.password.set",
  "staff.2fa.failed",
  "staff.2fa.enrol",
  "staff.2fa.recovery",
  // Staff case
  "staff.case.view",
  "staff.case.submissionDate",
  "staff.case.stageChange.DOCUMENTS",
  "staff.case.stageChange.CHECKING",
  "staff.case.stageChange.READY",
  "staff.case.stageChange.SUBMITTED",
  "staff.case.stageChange.DECISION",
  // Documents
  "document.upload",
  "document.approve",
  "document.redo",
  "document.view",
  "document.virus",
  "document.missing",
  "document.missing.respond",
  // Storage
  "storage.retry",
  // Reminders
  "reminders.pause",
  "reminders.resume",
  // Admin
  "admin.firm.update",
  "admin.user.add",
  "admin.user.disable",
  "admin.user.enable",
  "admin.user.reset2fa",
  "admin.user.sendLink",
  "admin.user.role",
  "admin.route.add",
  "admin.item.add",
  "admin.item.edit",
  "admin.item.remove",
];

describe("audit labels", () => {
  it("every known audit action has a label in TEXT", () => {
    const missing = KNOWN_ACTIONS.filter((a) => !(a in TEXT));
    expect(missing, `Missing labels for: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("TEXT contains no duplicate values for distinct actions", () => {
    const values = Object.values(TEXT);
    const dupes = values.filter((v, i) => values.indexOf(v) !== i);
    expect(dupes, `Duplicate label text: ${dupes.join(", ")}`).toHaveLength(0);
  });
});
