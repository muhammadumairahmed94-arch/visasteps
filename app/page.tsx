import { Suspense } from "react";
import { connection } from "next/server";
import ClientPortal from "@/components/ClientPortal";

// Rendered per request so the page's scripts carry this request's CSP nonce (proxy.ts)
async function Portal() {
  await connection();
  return <ClientPortal />;
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <Portal />
    </Suspense>
  );
}
