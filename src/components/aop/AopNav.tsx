import type { ReactNode } from "react";
import Link from "next/link";
import { PageHeader, Tabs } from "@/components/ui";
import type { CycleLite } from "@/server/aop/model";
import { CycleSwitcher } from "./CycleSwitcher";

export type AopTab = "overview" | "plan" | "inputs" | "review" | "insights" | "savings" | "import" | "setup";
// Three working tabs; Import / Setup sit at the right as admin utilities.
const TABS: { key: AopTab; label: string; path: string }[] = [
  { key: "overview", label: "Summary", path: "/aop" },
  { key: "inputs", label: "Inputs", path: "/aop/inputs" },
  { key: "review", label: "Review", path: "/aop/review" },
];
const UTIL: { key: AopTab; label: string; path: string }[] = [
  { key: "import", label: "Import", path: "/aop/import" },
  { key: "setup", label: "Setup", path: "/aop/setup" },
];

/** Shared AOP page header: title, cycle switcher, sub-nav. */
export function AopHeader({ active, cycleId, cycles, title, subtitle, eyebrow, actions, counts }: {
  active: AopTab; cycleId: string | null; cycles: CycleLite[]; title: ReactNode; subtitle?: ReactNode; eyebrow?: ReactNode; actions?: ReactNode;
  counts?: Partial<Record<AopTab, number>>;
}) {
  const qs = cycleId && cycles.length > 1 ? `?cycle=${cycleId}` : "";
  return (
    <>
      <PageHeader
        eyebrow={eyebrow ?? "Annual operating plan"}
        title={title}
        subtitle={subtitle}
        className="mb-4"
        actions={<>{cycles.length > 1 && <CycleSwitcher cycles={cycles} current={cycleId} />}{actions}</>}
      />
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Tabs className="flex-1" active={active} items={TABS.map((t) => ({ key: t.key, label: t.label, href: `${t.path}${qs}`, count: counts?.[t.key] }))} />
        <div className="flex items-center gap-1 rounded-xl border border-line px-1.5 py-1 text-[12px]"><span className="px-1.5 text-[10.5px] uppercase tracking-[0.14em] text-ink-4">Admin</span>
          {UTIL.map((t) => (
            <Link key={t.key} href={`${t.path}${qs}`} className={active === t.key ? "rounded-md bg-muted px-2 py-1 font-medium text-ink" : "rounded-md px-2 py-1 text-ink-3 hover:bg-subtle hover:text-ink-2"}>{t.label}</Link>
          ))}
        </div>
      </div>
    </>
  );
}

export const cycleQs = (cycleId: string, cycles: CycleLite[], extra = "") => {
  const parts = [cycles.length > 1 ? `cycle=${cycleId}` : "", extra].filter(Boolean);
  return parts.length ? `?${parts.join("&")}` : "";
};
