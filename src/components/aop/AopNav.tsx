import type { ReactNode } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import type { CycleLite } from "@/server/aop/model";
import { CycleSwitcher } from "./CycleSwitcher";

export type AopTab = "overview" | "plan" | "inputs" | "review" | "packaging" | "processing" | "functions" | "warehouse" | "logistics" | "cost" | "analysis" | "data" | "import" | "setup";
// Leadership tabs only; entry, uploads, controls and setup live under Data.
const GROUPS: { label: string; tabs: { key: AopTab; label: string; path: string }[] }[] = [
  { label: "Plan", tabs: [
    { key: "overview", label: "Overview", path: "/aop" },
    { key: "review", label: "Review", path: "/aop/review" },
  ] },
  { label: "Cost detail", tabs: [
    { key: "functions", label: "Functions", path: "/aop/functions" },
    { key: "warehouse", label: "Warehouse", path: "/aop/warehouse" },
    { key: "logistics", label: "Logistics", path: "/aop/logistics" },
    { key: "packaging", label: "Packaging", path: "/aop/packaging" },
    { key: "processing", label: "Processing", path: "/aop/processing" },
    { key: "cost", label: "Unit costs", path: "/aop/cost" },
  ] },
  { label: "What-if", tabs: [{ key: "analysis", label: "Levers", path: "/aop/analysis" }] },
];
const UTIL: { key: AopTab; label: string; path: string }[] = [
  { key: "inputs", label: "Enter figures", path: "/aop/inputs" },
  { key: "data", label: "Data", path: "/aop/data" },
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
      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2">
        <nav aria-label="AOP sections" className="flex flex-1 flex-wrap items-center gap-2">
          {GROUPS.map((g) => (
            <div key={g.label} className="seg">
              <span className="seg-label">{g.label}</span>
              {g.tabs.map((t) => (
                <Link key={t.key} href={`${t.path}${qs}`} scroll={false} data-on={t.key === active} aria-current={t.key === active ? "page" : undefined} className="seg-item gap-1.5">
                  {t.label}
                  {!!counts?.[t.key] && <span className="rounded-md bg-accent-soft px-1.5 text-[11px] font-semibold tabular text-accent-ink">{counts[t.key]}</span>}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="flex items-center gap-1 text-[12px] text-ink-4">
          {UTIL.map((t) => (
            <Link key={t.key} href={`${t.path}${qs}`} className={active === t.key || (t.key === "data" && (active === "import" || active === "setup")) ? "rounded-md bg-muted px-2 py-1 font-medium text-ink" : "rounded-md px-2 py-1 hover:bg-subtle hover:text-ink-2"}>{t.label}</Link>
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
