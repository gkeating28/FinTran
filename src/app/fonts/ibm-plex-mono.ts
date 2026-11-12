import localFont from "next/font/local";

// The font file is in the repository, so a build never depends on reaching Google Fonts. See files/README.md.
export const ibmPlexMono = localFont({
  src: [{ path: "./files/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" }],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});
