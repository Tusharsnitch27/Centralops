"use client";
import { useEffect, useState } from "react";
import { Check, Palette } from "lucide-react";
import { Popover } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import { THEME_COOKIE, THEMES, type ThemeKey } from "@/lib/themes";

/** Colour theme switcher; persists in a cookie so the server renders the right theme. */
export function ThemePicker() {
  const [cur, setCur] = useState<ThemeKey>("emerald");
  useEffect(() => { setCur((document.documentElement.dataset.theme as ThemeKey) || "emerald"); }, []);
  const apply = (k: ThemeKey) => {
    document.documentElement.dataset.theme = k;
    document.cookie = `${THEME_COOKIE}=${k}; path=/; max-age=31536000; samesite=lax`;
    setCur(k);
  };
  return (
    <Popover align="end" className="w-[300px] p-1.5" trigger={({ toggle }) => (
      <button onClick={toggle} title="Colour theme" className="flex size-9 items-center justify-center rounded-full border border-line bg-white text-ink-3 hover:border-line-strong hover:text-ink">
        <Palette size={16} />
      </button>
    )}>
      <div className="px-2 pb-1.5 pt-1 text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink-4">Colour theme</div>
      {THEMES.map((t) => (
        <button key={t.key} onClick={() => apply(t.key)}
          className={cn("flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors", cur === t.key ? "bg-subtle" : "hover:bg-subtle/70")}>
          <span className="flex overflow-hidden rounded-md ring-1 ring-line">
            {t.swatch.map((c) => <span key={c} className="h-7 w-4" style={{ background: c }} />)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-ink">{t.name}</span>
            <span className="block truncate text-[11.5px] text-ink-3">{t.note}</span>
          </span>
          {cur === t.key && <Check size={14} className="text-accent" />}
        </button>
      ))}
    </Popover>
  );
}
