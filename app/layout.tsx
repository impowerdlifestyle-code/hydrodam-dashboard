import type { Metadata } from "next";
import { Montserrat, Inter } from "next/font/google";
import "./globals.css";

const display = Montserrat({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-display-loaded" });
const sans = Inter({ subsets: ["latin"], variable: "--font-sans-loaded" });

export const metadata: Metadata = {
  title: "HydroDam Ops",
  description: "AI command center for the HydroDam team — CRM, calendar, email, workflows & SOPs.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
