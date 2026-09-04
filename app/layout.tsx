import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bouquet Builder",
  description: "Arrange a hand-tied bouquet stem by stem, sized from real millimetres.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
