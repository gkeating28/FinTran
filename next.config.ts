import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    authInterrupts: true,
    serverActions: {
      bodySizeLimit: "3mb",
    },
  },
  // xmllint-wasm finds its worker script and its .wasm file from its own folder (__dirname). Bundled, that folder
  // becomes a placeholder that does not exist, and every XSD check fails. Loaded from node_modules it works.
  serverExternalPackages: ["xmllint-wasm"],
  // Schematron SEF files are read with readFileSync, which the bundler does not follow, and xmllint-wasm loads its
  // worker and .wasm file at run time. Include them on the routes that validate or generate an e-invoice.
  outputFileTracingIncludes: Object.fromEntries(
    ["/api/einvoice/inbound", "/api/einvoice/outbound/[headerId]", "/transactions/[code]", "/api/ask-qula", "/api/ask-qula/action"].map((route) => [
      route,
      [
        "./einvoice/rules/3.0.21/*.sef.json",
        "./einvoice/rules/3.0.21/xsd/**/*.xsd",
        "./node_modules/xmllint-wasm/xmllint-node.js",
        "./node_modules/xmllint-wasm/xmllint.wasm",
      ],
    ]),
  ),
};

export default nextConfig;
