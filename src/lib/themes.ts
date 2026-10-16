// Colour themes — same minimal layout (warm off-white canvas, white cards, hairline borders); each swaps the accent family.
// Values live in globals.css (html[data-theme]); this list drives the picker.
export const THEMES = [
  { key: "emerald", name: "Emerald", note: "Deep green — the default", swatch: ["#f6f6f4", "#121212", "#157347"] },
  { key: "indigo", name: "Indigo", note: "Quiet ink blue", swatch: ["#f6f6f4", "#121212", "#3f46b8"] },
  { key: "teal", name: "Teal", note: "Muted teal", swatch: ["#f6f6f4", "#121212", "#0f6e68"] },
  { key: "coral", name: "Terracotta", note: "Terracotta", swatch: ["#f6f6f4", "#121212", "#b4532a"] },
  { key: "violet", name: "Plum", note: "Muted plum", swatch: ["#f6f6f4", "#121212", "#5b3fae"] },
  { key: "mono", name: "Monochrome", note: "Black & grey only", swatch: ["#f6f6f4", "#121212", "#6b7280"] },
] as const;
export type ThemeKey = (typeof THEMES)[number]["key"];
export const THEME_COOKIE = "co_theme";
export const isTheme = (v: string | undefined | null): v is ThemeKey => THEMES.some((t) => t.key === v);
