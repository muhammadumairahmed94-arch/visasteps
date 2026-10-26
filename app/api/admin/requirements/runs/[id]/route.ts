import { currentAdmin } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { db } from "@/lib/db";

export const GET = handler(async (_req, { params }: { params: Promise<{ id: string }> }) => {
  const me = await currentAdmin();
  if (!me) return fail("Admins only", 403);

  const { id } = await params;
  const run = await db.draftRun.findFirst({
    where: { id, firmId: me.firmId },
    include: {
      sources: { include: { source: { select: { title: true } } } },
      initiatedBy: { select: { name: true } },
    },
  });
  if (!run) return fail("Run not found", 404);

  return json({
    id: run.id,
    status: run.status,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    initiatedBy: run.initiatedBy.name,
    sources: run.sources.map((s) => ({
      id: s.id,
      title: s.source.title,
      status: s.status,
      requirementsFound: s.requirementsFound,
      errorMessage: s.errorMessage,
    })),
  });
});
