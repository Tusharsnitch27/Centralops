// Colour themes — same bento layout (light canvas, white cards, bold ink); each swaps the accent family.
// Values live in globals.css (html[data-theme]); this list drives the picker.
export const THEMES = [
  { key: "emerald", name: "Emerald", note: "Fresh green accent — the default", swatch: ["#eceef1", "#111214", "#16a34a"] },
  { key: "indigo", name: "Indigo", note: "Calm, corporate blue-violet", swatch: ["#eceef1", "#111214", "#4f46e5"] },
  { key: "teal", name: "Teal", note: "Cool, clinical teal", swatch: ["#eceef1", "#111214", "#0d9488"] },
  { key: "coral", name: "Coral", note: "Warm, energetic orange", swatch: ["#eceef1", "#111214", "#ea580c"] },
  { key: "violet", name: "Violet", note: "Rich purple accent", swatch: ["#eceef1", "#111214", "#7c3aed"] },
  { key: "mono", name: "Monochrome", note: "Black & grey, no colour accent", swatch: ["#eceef1", "#111214", "#6b7280"] },
] as const;
export type ThemeKey = (typeof THEMES)[number]["key"];
export const THEME_COOKIE = "co_theme";
export const isTheme = (v: string | undefined | null): v is ThemeKey => THEMES.some((t) => t.key === v);
