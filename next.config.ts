import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "3mb",
    },
  },
  // Schematron SEF files are read with readFileSync, which the bundler does not follow.
  // Include them on the routes that validate or generate an e-invoice.
  outputFileTracingIncludes: {
    "/api/einvoice/inbound": ["./einvoice/rules/3.0.21/*.sef.json"],
    "/api/einvoice/outbound/[headerId]": ["./einvoice/rules/3.0.21/*.sef.json"],
    "/transactions/[code]": ["./einvoice/rules/3.0.21/*.sef.json"],
  },
};

export default nextConfig;
