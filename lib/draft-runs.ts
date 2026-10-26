import { db } from "./db";
import { ai } from "./adapters/ai";
import { decrypt } from "./crypto";
import type { RequirementDraft } from "./adapters/ai";

const PURPOSE = "guidance-text";
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").replace(/­/g, "").toLowerCase();
}

function verifyQuote(quote: string, sections: Array<{ locator: string; text: string }>): boolean {
  const normQuote = normalise(quote);
  return sections.some((s) => normalise(s.text).includes(normQuote));
}

function filterVerified(drafts: RequirementDraft[], sections: Array<{ locator: string; text: string }>): RequirementDraft[] {
  const sectionMap = new Map(sections.map((s) => [s.locator, normalise(s.text)]));
  return drafts.filter((d) => {
    const page = sectionMap.get(d.citationLocator);
    return !!page && page.includes(normalise(d.citationQuote));
  });
}

/**
 * Processes one QUEUED DraftRun per call (the 60-second job timer calls this every tick).
 * On startup, RUNNING sources are reset to PENDING so they can be retried.
 */
export async function processDraftRuns(): Promise<void> {
  // Recovery: reset any sources stuck in RUNNING state (server restart mid-job)
  await db.draftRunSource.updateMany({
    where: { status: "RUNNING" },
    data: { status: "PENDING" },
  });
  // Also reset runs stuck in RUNNING with no PENDING/RUNNING sources — shouldn't happen, but guard it
  await db.draftRun.updateMany({
    where: { status: "RUNNING", sources: { none: { status: { in: ["PENDING", "RUNNING"] } } } },
    data: { status: "COMPLETE", completedAt: new Date() },
  });

  const run = await db.draftRun.findFirst({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { createdAt: "asc" },
    include: {
      route: { select: { name: true } },
      sources: {
        where: { status: { in: ["PENDING", "RUNNING"] } },
        include: { source: { select: { title: true, extractionWarning: true } } },
      },
    },
  });

  if (!run) return;

  await db.draftRun.update({
    where: { id: run.id },
    data: { status: "RUNNING", startedAt: run.startedAt ?? new Date() },
  });

  for (const runSource of run.sources) {
    await db.draftRunSource.update({ where: { id: runSource.id }, data: { status: "RUNNING" } });

    try {
      const pages = await db.guidancePage.findMany({
        where: { sourceId: runSource.sourceId },
        orderBy: { locator: "asc" },
      });

      if (pages.length === 0) {
        await db.draftRunSource.update({ where: { id: runSource.id }, data: { status: "NO_TEXT", requirementsFound: 0 } });
        continue;
      }

      const sections = pages.map((p) => ({ locator: p.locator, text: decrypt(p.encryptedText, PURPOSE) }));
      const output = await ai().draftRequirements(run.route.name, runSource.source.title, sections);

      const verified = filterVerified(output.requirements, sections);
      let count = 0;

      for (const draft of verified) {
        await db.requirement.create({
          data: {
            firmId: run.firmId,
            routeId: run.routeId,
            runId: run.id,
            whatIsChecked: draft.whatIsChecked,
            ruleType: draft.ruleType,
            limitOrThreshold: draft.limitOrThreshold ?? null,
            evidenceNeeded: draft.evidenceNeeded,
            citationSourceId: runSource.sourceId,
            citationLocator: draft.citationLocator,
            citationQuote: draft.citationQuote,
          },
        });
        count++;
      }

      for (const ref of output.mentionedSources) {
        if (!ref.title) continue;
        await db.mentionedSource.create({
          data: {
            firmId: run.firmId,
            runId: run.id,
            title: ref.title,
            url: ref.url ?? null,
            locator: ref.locator,
            foundInSourceId: runSource.sourceId,
          },
        });
      }

      await db.draftRunSource.update({
        where: { id: runSource.id },
        data: { status: "DONE", requirementsFound: count },
      });
    } catch (e) {
      await db.draftRunSource.update({
        where: { id: runSource.id },
        data: { status: "FAILED", errorMessage: errText(e) },
      });
    }
  }

  // Mark run complete/failed based on source outcomes
  const remaining = await db.draftRunSource.count({
    where: { runId: run.id, status: { in: ["PENDING", "RUNNING"] } },
  });
  const doneCount = await db.draftRunSource.count({ where: { runId: run.id, status: "DONE" } });

  await db.draftRun.update({
    where: { id: run.id },
    data: {
      status: remaining === 0 ? (doneCount === 0 ? "FAILED" : "COMPLETE") : "RUNNING",
      completedAt: remaining === 0 ? new Date() : null,
    },
  });
}

export { verifyQuote, filterVerified };
