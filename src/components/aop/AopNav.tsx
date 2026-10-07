import type { ReactNode } from "react";
import { PageHeader, Tabs } from "@/components/ui";
import type { CycleLite } from "@/server/aop/model";
import { CycleSwitcher } from "./CycleSwitcher";

export type AopTab = "overview" | "plan" | "inputs" | "insights" | "savings" | "import" | "setup";
const TABS: { key: AopTab; label: string; path: string }[] = [
  { key: "overview", label: "Overview", path: "/aop" },
  { key: "plan", label: "Plan", path: "/aop/plan" },
  { key: "inputs", label: "Inputs", path: "/aop/inputs" },
  { key: "insights", label: "Insights", path: "/aop/insights" },
  { key: "savings", label: "Cost savings", path: "/aop/savings" },
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
      <Tabs className="mb-6" active={active} items={TABS.map((t) => ({ key: t.key, label: t.label, href: `${t.path}${qs}`, count: counts?.[t.key] }))} />
    </>
  );
}

export const cycleQs = (cycleId: string, cycles: CycleLite[], extra = "") => {
  const parts = [cycles.length > 1 ? `cycle=${cycleId}` : "", extra].filter(Boolean);
  return parts.length ? `?${parts.join("&")}` : "";
};
