import type { Metadata, Viewport } from "next";
import { Geist_Mono, Instrument_Serif, Inter } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { isTheme, THEME_COOKIE } from "@/lib/themes";

const sans = Inter({ subsets: ["latin"], variable: "--font-geist" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", variable: "--font-serif-display" });

export const metadata: Metadata = {
  title: { default: "Central Ops", template: "%s · Central Ops" },
  description: "Central Ops — Program Manager 2.0",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f6f6f4" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const t = (await cookies()).get(THEME_COOKIE)?.value;
  return (
    <html lang="en" data-theme={isTheme(t) ? t : "emerald"} className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
