"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SECTION_TABS } from "@/lib/nav";
import { cn } from "@/lib/cn";

/** Segmented switch between sibling sections (Tasks | Follow-ups, Meetings | Decisions). */
export function SectionTabs({ section, prefix }: { section: keyof typeof SECTION_TABS; prefix?: boolean }) {
  const path = usePathname();
  const tabs = SECTION_TABS[section];
  // only on section roots; detail pages (e.g. /tasks/[id]) keep their own header
  const active = tabs?.find((t) => (prefix ? path === t.href || path.startsWith(`${t.href}/`) : t.href === path))?.href;
  if (!active) return null;
  return (
    <div className="mb-5 inline-flex rounded-lg border border-line bg-subtle/60 p-0.5">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href}
          className={cn("rounded-md px-3 py-1 text-[12.5px] transition-colors", active === t.href ? "bg-surface font-medium text-ink shadow-[0_0_0_1px_var(--color-line),0_1px_2px_rgb(0_0_0/0.05)]" : "text-ink-3 hover:text-ink")}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
