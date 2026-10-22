/**
 * Turns a date-window string (e.g. "last 6 months", "last 28 days") into a human-readable
 * date range anchored to the planned submission date (or today in UK time if none is set).
 *
 * Patterns recognised
 *   "last N months" → "from 1 April to 30 September 2026"
 *   "last N days"   → "on or after 3 September 2026"
 * Anything else is returned unchanged (acts as a plain label).
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function lastDayOfMonth(year: number, month: number): number {
  // month is 0-indexed; new Date(y, m+1, 0) gives the last day of month m
  return new Date(year, month + 1, 0).getDate();
}

function fmt(day: number, month: number, year: number): string {
  return `${day} ${MONTHS[month]} ${year}`;
}

/**
 * Today's date in the UK (Europe/London handles BST/GMT automatically).
 * Returns a UTC midnight Date so arithmetic is day-accurate.
 */
export function ukToday(): Date {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)!.value, 10);
  // Construct as UTC midnight of that calendar date
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
}

export function resolveDateWindow(window: string, anchor: Date): string {
  const monthsMatch = window.match(/^last (\d+) months?$/i);
  if (monthsMatch) {
    const n = parseInt(monthsMatch[1], 10);
    // The N months end on the last day of the month before the anchor month.
    // They start on the 1st of the month N months earlier than that.
    let endMonth = anchor.getUTCMonth() - 1;
    let endYear = anchor.getUTCFullYear();
    if (endMonth < 0) { endMonth = 11; endYear -= 1; }

    let startMonth = endMonth - (n - 1);
    let startYear = endYear;
    if (startMonth < 0) { startMonth += 12; startYear -= 1; }

    const endDay = lastDayOfMonth(endYear, endMonth);
    const startStr = fmt(1, startMonth, startYear);
    const endStr = fmt(endDay, endMonth, endYear);
    // If both in the same year, drop the year from the start
    if (startYear === endYear) {
      return `from 1 ${MONTHS[startMonth]} to ${endDay} ${MONTHS[endMonth]} ${endYear}`;
    }
    return `from ${startStr} to ${endStr}`;
  }

  const daysMatch = window.match(/^last (\d+) days?$/i);
  if (daysMatch) {
    const n = parseInt(daysMatch[1], 10);
    const start = new Date(anchor);
    start.setUTCDate(start.getUTCDate() - n);
    return `on or after ${fmt(start.getUTCDate(), start.getUTCMonth(), start.getUTCFullYear())}`;
  }

  // Unknown pattern — return as-is so admin-entered freeform text is shown verbatim
  return window;
}
