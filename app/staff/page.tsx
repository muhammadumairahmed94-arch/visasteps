import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import StaffPortal from "@/components/StaffPortal";

export const metadata: Metadata = { title: "UHA Legal · Caseworker" };

// Rendered per request so the page's scripts carry this request's CSP nonce (proxy.ts)
async function Staff() {
  await connection();
  return <StaffPortal />;
}

export default function StaffPage() {
  return (
    <Suspense fallback={null}>
      <Staff />
    </Suspense>
  );
}
