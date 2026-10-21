import { cleanSegment } from "./adapters/storage";

/** UK-friendly mobile normaliser: "07700 900121" → "+447700900121". Returns null if it does not look like a phone number. */
export function normaliseMobile(input: string): string | null {
  let s = input.replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (/^0\d{9,10}$/.test(s)) s = "+44" + s.slice(1);
  if (/^44\d{9,10}$/.test(s)) s = "+" + s;
  return /^\+\d{10,15}$/.test(s) ? s : null;
}

/** "2026-10-17" in UK time. */
export function ukDate(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
}

export function caseFolder(c: { firstName: string | null; lastName: string | null; caseRef: string }): string[] {
  if (!c.firstName || !c.lastName) throw new Error("Client has not set up their account yet");
  return ["Clients", cleanSegment(`${c.lastName}_${c.firstName}_${c.caseRef}`).replace(/ /g, "-")];
}

/** {Surname}_{DocumentType}[_n]_{YYYY-MM-DD}.{ext} — n is added for the 2nd file onwards. */
export function storedFileName(surname: string, typeKey: string, n: number, date: string, ext = "pdf"): string {
  const s = cleanSegment(surname).replace(/ /g, "-");
  return `${s}_${typeKey}${n > 1 ? `_${n}` : ""}_${date}.${ext}`;
}

export const OLD_VERSIONS = "_Old versions";
