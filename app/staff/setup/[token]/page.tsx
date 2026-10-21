import { Suspense } from "react";
import type { Metadata } from "next";
import StaffSetup from "@/components/StaffSetup";

export const metadata: Metadata = { title: "UHA Legal · Set your password" };

async function Setup({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <StaffSetup token={token} />;
}

/** Link from the "Set your password" email sent when an admin adds a caseworker. */
export default function StaffSetupPage({ params }: PageProps<"/staff/setup/[token]">) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <Setup params={params} />
    </Suspense>
  );
}
