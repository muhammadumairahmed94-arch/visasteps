import { Suspense } from "react";
import ClientPortal from "@/components/ClientPortal";

async function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ClientPortal token={token} />;
}

/** Invite link from the text message / email. */
export default function InvitePage({ params }: PageProps<"/i/[token]">) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <Invite params={params} />
    </Suspense>
  );
}
