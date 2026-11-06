import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    authInterrupts: true,
    serverActions: {
      bodySizeLimit: "3mb",
    },
  },
  // Schematron SEF files are read with readFileSync, which the bundler does not follow.
  // Include them on the routes that validate or generate an e-invoice.
  outputFileTracingIncludes: {
    "/api/einvoice/inbound": ["./einvoice/rules/3.0.21/*.sef.json", "./einvoice/rules/3.0.21/xsd/**/*.xsd"],
    "/api/einvoice/outbound/[headerId]": ["./einvoice/rules/3.0.21/*.sef.json", "./einvoice/rules/3.0.21/xsd/**/*.xsd"],
    "/transactions/[code]": ["./einvoice/rules/3.0.21/*.sef.json", "./einvoice/rules/3.0.21/xsd/**/*.xsd"],
  },
};

export default nextConfig;
