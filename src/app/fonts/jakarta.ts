import localFont from "next/font/local";

// The font file is in the repository, so a build never depends on reaching Google Fonts. See files/README.md.
export const jakarta = localFont({
  src: [{ path: "./files/plus-jakarta-sans-latin-700-normal.woff2", weight: "700", style: "normal" }],
  variable: "--font-jakarta",
  display: "swap",
});
