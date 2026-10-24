export type CaseStageKey = "DOCUMENTS" | "CHECKING" | "READY" | "SUBMITTED" | "DECISION";

export const STAGES: { key: CaseStageKey; label: string; detail: string }[] = [
  { key: "DOCUMENTS", label: "Sending documents", detail: "You are sending us your documents." },
  { key: "CHECKING",  label: "Lawyer checking",   detail: "Your lawyer is reviewing your documents." },
  { key: "READY",     label: "Ready to submit",   detail: "Your application is ready. Your lawyer will send it to the Home Office soon." },
  { key: "SUBMITTED", label: "Submitted",          detail: "Your application has been sent to the Home Office. They are now making a decision. This can take several weeks." },
  { key: "DECISION",  label: "Decision",           detail: "The Home Office has made a decision. Your caseworker will contact you about it." },
];

/** Returns the first REDO doc, then the first required NEED doc, or null when nothing is left to do. */
export function findNextDoc<T extends { status: string; required: boolean }>(docs: T[]): T | null {
  return docs.find((d) => d.status === "REDO") ?? docs.find((d) => d.required && d.status === "NEED") ?? null;
}
