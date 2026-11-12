import localFont from "next/font/local";

// The font files are in the repository, so a build never depends on reaching Google Fonts. See files/README.md.
export const publicSans = localFont({
  src: [
    { path: "./files/public-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./files/public-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./files/public-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-public-sans",
  display: "swap",
});
