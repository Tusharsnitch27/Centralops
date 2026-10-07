import type { Metadata } from "next";
import { Geist_Mono, Instrument_Serif, Plus_Jakarta_Sans } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { isTheme, THEME_COOKIE } from "@/lib/themes";

const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-geist", weight: ["400", "500", "600", "700", "800"] });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", variable: "--font-serif-display" });

export const metadata: Metadata = {
  title: { default: "Central Ops", template: "%s · Central Ops" },
  description: "Central Ops — Program Manager 2.0",
  icons: { icon: "/icon.svg" },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const t = (await cookies()).get(THEME_COOKIE)?.value;
  return (
    <html lang="en" data-theme={isTheme(t) ? t : "emerald"} className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
