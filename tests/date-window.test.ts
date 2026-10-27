import { describe, expect, it } from "vitest";
import { resolveDateWindow, isDateInWindow, ukToday } from "../lib/date-window";

// Anchor dates used across tests — constructed as UTC midnight to match resolveDateWindow's output
const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));

describe("resolveDateWindow — last N months", () => {
  it("standard case: last 6 months from 1 October 2026 → April–September", () => {
    expect(resolveDateWindow("last 6 months", d(2026, 10, 1))).toBe("from 1 April to 30 September 2026");
  });

  it("month count is 1", () => {
    expect(resolveDateWindow("last 1 month", d(2026, 10, 1))).toBe("from 1 September to 30 September 2026");
  });

  it("wraps across a year boundary (anchor = February)", () => {
    // last 6 months back from Feb 2026 = Aug–Jan
    expect(resolveDateWindow("last 6 months", d(2026, 2, 1))).toBe("from 1 August 2025 to 31 January 2026");
  });

  it("wraps across a year boundary (anchor = January)", () => {
    // last 3 months back from Jan 2026 = Oct–Dec 2025
    expect(resolveDateWindow("last 3 months", d(2026, 1, 1))).toBe("from 1 October to 31 December 2025");
  });

  it("leap year — end month is February in a leap year", () => {
    // last 1 month from March 2024 → February 2024 (29 days)
    expect(resolveDateWindow("last 1 month", d(2024, 3, 1))).toBe("from 1 February to 29 February 2024");
  });

  it("leap year — end month is February in a non-leap year", () => {
    // last 1 month from March 2025 → February 2025 (28 days)
    expect(resolveDateWindow("last 1 month", d(2025, 3, 1))).toBe("from 1 February to 28 February 2025");
  });

  it("end month is a 31-day month", () => {
    // last 1 month from August 2026 → July (31 days)
    expect(resolveDateWindow("last 1 month", d(2026, 8, 1))).toBe("from 1 July to 31 July 2026");
  });

  it("end month is a 30-day month", () => {
    // last 1 month from July 2026 → June (30 days)
    expect(resolveDateWindow("last 1 month", d(2026, 7, 1))).toBe("from 1 June to 30 June 2026");
  });

  it("anchor mid-month still uses full months", () => {
    // The anchor day doesn't matter — we always use complete prior months
    expect(resolveDateWindow("last 6 months", d(2026, 10, 15))).toBe("from 1 April to 30 September 2026");
  });

  it("plural 'months' is accepted", () => {
    expect(resolveDateWindow("last 2 months", d(2026, 10, 1))).toBe("from 1 August to 30 September 2026");
  });

  it("singular 'month' is also accepted", () => {
    expect(resolveDateWindow("last 1 month", d(2026, 10, 1))).toBe("from 1 September to 30 September 2026");
  });

  it("case-insensitive", () => {
    expect(resolveDateWindow("Last 6 Months", d(2026, 10, 1))).toBe("from 1 April to 30 September 2026");
  });

  it("cross-year: start and end year differ → both years are shown", () => {
    const result = resolveDateWindow("last 6 months", d(2026, 2, 1));
    expect(result).toContain("2025");
    expect(result).toContain("2026");
  });

  it("same year: start year is omitted", () => {
    const result = resolveDateWindow("last 6 months", d(2026, 10, 1));
    // "from 1 April to 30 September 2026" — 2026 appears once at the end
    expect(result.match(/2026/g)).toHaveLength(1);
  });
});

describe("resolveDateWindow — last N days", () => {
  it("last 28 days from 1 October 2026 → on or after 3 September 2026", () => {
    expect(resolveDateWindow("last 28 days", d(2026, 10, 1))).toBe("on or after 3 September 2026");
  });

  it("last 1 day", () => {
    expect(resolveDateWindow("last 1 day", d(2026, 10, 1))).toBe("on or after 30 September 2026");
  });

  it("wraps across a month boundary", () => {
    // 1 March - 28 days = 1 February
    expect(resolveDateWindow("last 28 days", d(2026, 3, 1))).toBe("on or after 1 February 2026");
  });

  it("wraps across a month boundary in a leap year", () => {
    // 1 March 2024 - 28 days = 2 February 2024
    expect(resolveDateWindow("last 28 days", d(2024, 3, 1))).toBe("on or after 2 February 2024");
  });

  it("wraps across a year boundary", () => {
    // 1 January 2026 - 28 days = 4 December 2025
    expect(resolveDateWindow("last 28 days", d(2026, 1, 1))).toBe("on or after 4 December 2025");
  });

  it("plural 'days' is accepted", () => {
    expect(resolveDateWindow("last 3 days", d(2026, 10, 1))).toBe("on or after 28 September 2026");
  });

  it("singular 'day' is also accepted", () => {
    expect(resolveDateWindow("last 1 day", d(2026, 10, 4))).toBe("on or after 3 October 2026");
  });

  it("case-insensitive", () => {
    expect(resolveDateWindow("Last 28 Days", d(2026, 10, 1))).toBe("on or after 3 September 2026");
  });
});

describe("resolveDateWindow — unknown / freeform", () => {
  it("returns the string unchanged if the pattern is not recognised", () => {
    expect(resolveDateWindow("last 4 years", d(2026, 10, 1))).toBe("last 4 years");
  });

  it("returns a plain description unchanged", () => {
    expect(resolveDateWindow("valid for 6 months from the date of the x-ray", d(2026, 10, 1))).toBe("valid for 6 months from the date of the x-ray");
  });
});

describe("isDateInWindow — last N months", () => {
  // anchor = 1 Jan 2027 → last 6 months = Jul–Dec 2026
  const anchor = d(2027, 1, 1);

  it("true for date inside the window", () => {
    expect(isDateInWindow(d(2026, 9, 15), "last 6 months", anchor)).toBe(true);
  });

  it("true on the first day of the window", () => {
    expect(isDateInWindow(d(2026, 7, 1), "last 6 months", anchor)).toBe(true);
  });

  it("true on the last day of the window", () => {
    expect(isDateInWindow(d(2026, 12, 31), "last 6 months", anchor)).toBe(true);
  });

  it("false for date before the window starts", () => {
    expect(isDateInWindow(d(2026, 6, 30), "last 6 months", anchor)).toBe(false);
  });

  it("false for date in the anchor month (window ends month before)", () => {
    expect(isDateInWindow(d(2027, 1, 1), "last 6 months", anchor)).toBe(false);
  });

  it("wraps across year boundary: last 6 months from Feb 2027 → Aug 2026–Jan 2027", () => {
    const a = d(2027, 2, 1);
    expect(isDateInWindow(d(2026, 8, 1), "last 6 months", a)).toBe(true);
    expect(isDateInWindow(d(2027, 1, 31), "last 6 months", a)).toBe(true);
    expect(isDateInWindow(d(2026, 7, 31), "last 6 months", a)).toBe(false);
  });
});

describe("isDateInWindow — last N days", () => {
  // anchor = 1 Jan 2027 → last 28 days = 4 Dec 2026 – 1 Jan 2027
  const anchor = d(2027, 1, 1);

  it("true for date inside the window", () => {
    expect(isDateInWindow(d(2026, 12, 15), "last 28 days", anchor)).toBe(true);
  });

  it("true on the earliest day of the window", () => {
    expect(isDateInWindow(d(2026, 12, 4), "last 28 days", anchor)).toBe(true);
  });

  it("true on the anchor date itself", () => {
    expect(isDateInWindow(d(2027, 1, 1), "last 28 days", anchor)).toBe(true);
  });

  it("false for date before the window", () => {
    expect(isDateInWindow(d(2026, 12, 3), "last 28 days", anchor)).toBe(false);
  });

  it("false for date after anchor", () => {
    expect(isDateInWindow(d(2027, 1, 2), "last 28 days", anchor)).toBe(false);
  });
});

describe("isDateInWindow — unknown pattern", () => {
  it("returns null for an unrecognised pattern", () => {
    expect(isDateInWindow(d(2026, 9, 15), "last 4 years", d(2027, 1, 1))).toBeNull();
  });

  it("returns null for a freeform string", () => {
    expect(isDateInWindow(d(2026, 9, 15), "valid for 6 months from date of x-ray", d(2027, 1, 1))).toBeNull();
  });
});

describe("ukToday", () => {
  it("returns a Date", () => {
    const today = ukToday();
    expect(today).toBeInstanceOf(Date);
    expect(isNaN(today.getTime())).toBe(false);
  });

  it("is at UTC midnight of the UK calendar date", () => {
    const today = ukToday();
    // UTC hours/minutes/seconds should all be 0 (midnight UTC)
    expect(today.getUTCHours()).toBe(0);
    expect(today.getUTCMinutes()).toBe(0);
    expect(today.getUTCSeconds()).toBe(0);
  });

  it("falls within a plausible year range", () => {
    const year = ukToday().getUTCFullYear();
    expect(year).toBeGreaterThanOrEqual(2026);
    expect(year).toBeLessThanOrEqual(2050);
  });
});
