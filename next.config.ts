import type { NextConfig } from "next";

/** Next.js config for self-hosted Windows (NSSM) + Cloudflare Tunnel.
 * - output: 'standalone' creates a minimal deployment bundle
 * - Cloudflare terminates TLS; Next.js sees HTTP on the internal port
 * - Trust X-Forwarded-* headers from Cloudflare for correct URL generation
 */
const config: NextConfig = {
  serverExternalPackages: ["sharp"],
  outputFileTracingRoot: process.cwd(),
  devIndicators: false,
  // Produce a standalone bundle in .next/standalone for NSSM service deployment
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};
export default config;
