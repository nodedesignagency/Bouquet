import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

/**
 * Three roles, three faces. Fraunces is the botanical-plate display face, Plex
 * Sans carries the interface, and Plex Mono is reserved for measurements — every
 * millimetre figure in this app is set in it, because the millimetre is the one
 * number the whole builder is built on.
 */
const display = Fraunces({
  subsets: ["latin"],
  // Variable, with the softness and wonk axes on — that slight irregularity is
  // what keeps the headings from reading as stock high-contrast serif.
  axes: ["SOFT", "WONK"],
  variable: "--font-display",
  display: "swap",
});

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Bouquet Builder",
  description: "Arrange a hand-tied bouquet stem by stem, sized from real millimetres.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-full font-sans antialiased">{children}</body>
    </html>
  );
}
