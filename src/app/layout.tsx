import type { Metadata } from "next";
import { ibmPlexMono } from "./fonts/ibm-plex-mono";
import { jakarta } from "./fonts/jakarta";
import { publicSans } from "./fonts/public-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Qula Plus",
    template: "%s · Qula Plus",
  },
  description: "Define and manage financial transactions for each organisation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${jakarta.variable} ${publicSans.variable} ${ibmPlexMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
