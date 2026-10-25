// Tests the visibility guard used in MessageThread's polling interval.
// No JSDOM or React required — we exercise the same conditional that
// the component's setInterval callback uses, with a stubbed document.
import { describe, it, expect, vi, afterEach } from "vitest";

function makeGuardedInterval(refresh: () => void, ms: number) {
  return setInterval(() => {
    if ((document as { visibilityState: string }).visibilityState === "visible") refresh();
  }, ms);
}

describe("MessageThread polling interval visibility guard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does not call refresh when the document is hidden", () => {
    vi.stubGlobal("document", { visibilityState: "hidden" });
    vi.useFakeTimers();

    const refresh = vi.fn();
    const id = makeGuardedInterval(refresh, 30_000);

    vi.advanceTimersByTime(90_000); // three ticks
    expect(refresh).not.toHaveBeenCalled();
    clearInterval(id);
  });

  it("calls refresh each tick when the document is visible", () => {
    vi.stubGlobal("document", { visibilityState: "visible" });
    vi.useFakeTimers();

    const refresh = vi.fn();
    const id = makeGuardedInterval(refresh, 30_000);

    vi.advanceTimersByTime(60_000); // two ticks
    expect(refresh).toHaveBeenCalledTimes(2);
    clearInterval(id);
  });

  it("resumes calling refresh after the document becomes visible again", () => {
    const doc = { visibilityState: "hidden" };
    vi.stubGlobal("document", doc);
    vi.useFakeTimers();

    const refresh = vi.fn();
    const id = makeGuardedInterval(refresh, 30_000);

    vi.advanceTimersByTime(30_000); // hidden — skipped
    expect(refresh).not.toHaveBeenCalled();

    doc.visibilityState = "visible";
    vi.advanceTimersByTime(30_000); // now visible — fires
    expect(refresh).toHaveBeenCalledOnce();

    clearInterval(id);
  });
});
