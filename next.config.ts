import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

// A nonce-based CSP was tried in Phase 5 but cannot cover Cache Components' prerendered shell (scripts were
// blocked), so inline scripts stay allowed. React escapes all content; the only raw HTML is the server-made QR SVG.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${dev ? " ws:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
// API responses never render HTML: allow nothing.
const apiCsp = "default-src 'none'; frame-ancestors 'none'";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/client", "pdfjs-dist"],
  // pdfjs-dist must be loaded at runtime (not bundled by turbopack) so it can read files
  // via node:fs and properly spawn its worker. The legacy pdf.mjs is not auto-traced because
  // it is referenced only via a dynamic import string — add it explicitly.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/pdfjs-dist/legacy/build/pdf.mjs"],
  },
  output: "standalone", // self-contained server for the Docker image
  async headers() {
    return [
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: apiCsp }] },
      {
        source: "/((?!api/).*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" }, // invite tokens live in the URL
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
