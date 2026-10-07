import "server-only";
import { q } from "../db";
import { today } from "@/lib/dates";
import { inr, pct } from "@/lib/format";
import { goodWord, impactOf, monLabel, varianceWord, type Direction } from "./calc";
import { allItemsOf, sectionOwner, type ItemRow, type Model, type SectionNode } from "./model";
import { dueFor } from "./inputs";

/* Insight engine. Rules are data (insight_rules, module 'aop'); each rule's `rule.metric` picks an evaluator,
   thresholds/periods come from the row. Output is exception-first and every insight carries a suggested action. */

export type Severity = "critical" | "warning" | "info";
export interface InsightRule {
  id: string; key: string | null; name: string; description: string | null; severity: Severity; enabled: boolean; builtin: boolean;
  rule: { metric: string; threshold?: number; periods?: number; min_amount?: number; level?: "item" | "group" | "both" };
}
export interface Insight {
  key: string; ruleKey: string; ruleName: string; severity: Severity; title: string; detail: string;
  entity: { type: "aop_item" | "aop_section" | "aop_cycle"; id: string; name: string; href: string };
  metrics: { label: string; value: string }[]; suggestedAction: string; amount: number;
  ownerId: string | null; ownerName: string | null; itemId: string | null; sectionId: string | null;
}

export const METRIC_KINDS: Record<string, { label: string; hasThreshold: boolean; hasPeriods: boolean }> = {
  actual_vs_plan: { label: "Actual vs plan (YTD; consecutive months when periods ≥ 2)", hasThreshold: true, hasPeriods: true },
  missing_actual: { label: "Missing actuals after cut-off", hasThreshold: false, hasPeriods: false },
  actual_vs_forecast: { label: "Provision / forecast accuracy (last N months)", hasThreshold: true, hasPeriods: true },
  fy_projection: { label: "Full-year projection vs plan (run-rate)", hasThreshold: true, hasPeriods: false },
};

export const listRules = () =>
  q<InsightRule>(`select id, key, name, description, severity, enabled, builtin, rule from insight_rules where module = 'aop' order by builtin desc, created_at`);

const SEV_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
const planHref = (m: Model, itemId?: string | null, fn?: string | null) =>
  `/aop/plan?cycle=${m.cycle.id}${itemId ? `&item=${itemId}` : ""}${fn ? `&fn=${fn}` : ""}`;
const path = (m: Model, s: SectionNode) => (s.fn && s.fn.id !== s.id ? `${s.fn.name} ${s.name}` : s.name);

export function evaluate(m: Model, rules: InsightRule[]): Insight[] {
  const L = m.cycle.labels;
  const out: Insight[] = [];
  const materiality = Math.max(10_000, Math.abs(m.totals.ytdPlan) * 0.002);
  const lastName = m.lastClosed ? monLabel(m.lastClosed) : "";
  const groups: SectionNode[] = m.functions.flatMap((f) => (f.children.length ? f.children : [f]));

  for (const r of rules.filter((x) => x.enabled)) {
    const t = Number(r.rule.threshold ?? 0.05);
    const periods = Math.max(1, Number(r.rule.periods ?? 1));
    const minAmt = Number(r.rule.min_amount ?? materiality);
    const base = { ruleKey: r.key ?? r.id, ruleName: r.name, severity: r.severity };

    if (r.rule.metric === "actual_vs_plan" && periods <= 1) {
      // YTD deviation at group level, then material lines
      const level = r.rule.level ?? "both";
      if (level !== "item") for (const g of groups) {
        const x = g.m;
        if (x.impactPct == null || x.impactPct > -t || Math.abs(x.impact) < minAmt) continue;
        const dir = allItemsOf(g)[0]?.direction ?? m.direction;
        const owner = sectionOwner(g.fn ?? g);
        out.push({
          ...base, key: `${base.ruleKey}:s:${g.id}`,
          title: `${path(m, g)} ${varianceWord(dir, L, false).toLowerCase()} by ${inr(Math.abs(x.impact))} YTD`,
          detail: `${L.actual} ${inr(x.ytdActual)} against ${L.plan.toLowerCase()} ${inr(x.ytdPlanReported)} for reported months through ${lastName} (${pct(Math.abs(x.impactPct), 1)}).`,
          entity: { type: "aop_section", id: g.id, name: path(m, g), href: planHref(m, null, (g.fn ?? g).id) },
          metrics: [{ label: "Variance", value: inr(x.variance, { sign: true }) }, { label: "Variance %", value: pct(x.ytdPlanReported ? x.variance / Math.abs(x.ytdPlanReported) : null, 1, true) }, { label: "FY projection", value: inr(x.projection) }],
          suggestedAction: `Ask ${owner?.name ?? "the owner"} for the variance reason and a corrective plan on the top lines.`,
          amount: Math.abs(x.impact), ownerId: owner?.id ?? null, ownerName: owner?.name ?? null, itemId: null, sectionId: g.id,
        });
      }
      if (level !== "group") for (const it of m.items) {
        const x = it.m;
        if (x.impactPct == null || x.impactPct > -t || Math.abs(x.impact) < minAmt) continue;
        const sec = m.sectionById.get(it.section_id)!;
        out.push({
          ...base, key: `${base.ruleKey}:i:${it.id}`,
          title: `${it.name} (${path(m, sec)}) ${varianceWord(it.direction, L, false).toLowerCase()} by ${inr(Math.abs(x.impact))} YTD`,
          detail: `${pct(Math.abs(x.impactPct), 1)} ${it.direction === "lower_better" ? "over" : "below"} ${L.plan.toLowerCase()} on reported months.`,
          entity: { type: "aop_item", id: it.id, name: it.name, href: planHref(m, it.id) },
          metrics: [{ label: "YTD " + L.actual.toLowerCase(), value: inr(x.ytdActual) }, { label: "Variance", value: inr(x.variance, { sign: true }) }, { label: "%", value: pct(x.ytdPlanReported ? x.variance / Math.abs(x.ytdPlanReported) : null, 1, true) }],
          suggestedAction: "Record the variance reason and a corrective action on the line.",
          amount: Math.abs(x.impact), ownerId: it.owner_id, ownerName: it.owner_name, itemId: it.id, sectionId: it.section_id,
        });
      }
    }

    if (r.rule.metric === "actual_vs_plan" && periods >= 2) {
      for (const it of m.items) {
        let streak = 0, sum = 0;
        for (const p of [...m.closed].reverse()) {
          const v = it.vals[p];
          if (!v || v.actual == null || !v.plan) { if (streak === 0) continue; break; }
          const imp = impactOf(it.direction, v.plan, v.actual);
          if (imp / Math.abs(v.plan) < -t) { streak++; sum += imp; } else break;
        }
        if (streak < periods || Math.abs(sum) < minAmt / 2) continue;
        out.push({
          ...base, key: `${base.ruleKey}:i:${it.id}`,
          title: `${it.name} ${varianceWord(it.direction, L, false).toLowerCase()} ${streak} months running`,
          detail: `Missed ${L.plan.toLowerCase()} by more than ${pct(t)} in each of the last ${streak} reported months — ${inr(Math.abs(sum))} in total. This looks structural, not timing.`,
          entity: { type: "aop_item", id: it.id, name: it.name, href: planHref(m, it.id) },
          metrics: [{ label: "Months", value: String(streak) }, { label: "Cumulative", value: inr(it.direction === "lower_better" ? -sum : sum, { sign: true }) }],
          suggestedAction: `Re-base the ${L.forecast.toLowerCase()} or agree a corrective action with ${it.owner_name ?? "the owner"}.`,
          amount: Math.abs(sum) * 1.2, ownerId: it.owner_id, ownerName: it.owner_name, itemId: it.id, sectionId: it.section_id,
        });
      }
    }

    if (r.rule.metric === "missing_actual") {
      const td = today();
      for (const f of m.functions) {
        const missing: { it: ItemRow; p: string }[] = [];
        for (const p of m.closed) {
          if (dueFor(m, p, "actuals") >= td) continue; // not past cut-off yet
          for (const it of allItemsOf(f)) {
            const v = it.vals[p];
            if (v && ((v.plan ?? 0) !== 0 || (v.forecast ?? 0) !== 0) && v.actual == null) missing.push({ it, p });
          }
        }
        if (!missing.length) continue;
        const owner = sectionOwner(f);
        const months = [...new Set(missing.map((x) => x.p))].sort();
        const atStake = missing.reduce((a, x) => a + (x.it.vals[x.p].forecast ?? x.it.vals[x.p].plan ?? 0), 0);
        out.push({
          ...base, key: `${base.ruleKey}:s:${f.id}`,
          title: `${f.name}: ${missing.length} ${L.actual.toLowerCase()} missing after cut-off`,
          detail: `${months.map((p) => monLabel(p)).join(", ")} — ${[...new Set(missing.map((x) => x.it.name))].slice(0, 4).join(", ")}${missing.length > 4 ? "…" : ""}. ${inr(atStake)} of ${L.plan.toLowerCase()} can't be verified.`,
          entity: { type: "aop_section", id: f.id, name: f.name, href: `/aop/inputs?cycle=${m.cycle.id}` },
          metrics: [{ label: "Lines", value: String(missing.length) }, { label: "Unverified", value: inr(atStake) }],
          suggestedAction: `Send ${owner?.name ?? "the owner"} a reminder to submit ${L.actual.toLowerCase()}.`,
          amount: atStake * 0.5, ownerId: owner?.id ?? null, ownerName: owner?.name ?? null, itemId: null, sectionId: f.id,
        });
      }
    }

    if (r.rule.metric === "actual_vs_forecast") {
      const window = m.closed.slice(-Math.max(periods, 3));
      for (const f of m.functions) {
        let absErr = 0, base2 = 0, worst: { it: ItemRow; err: number; p: string } | null = null;
        for (const it of allItemsOf(f)) for (const p of window) {
          const v = it.vals[p];
          if (!v || v.actual == null || !v.forecast) continue;
          const e = v.actual - v.forecast;
          absErr += Math.abs(e); base2 += Math.abs(v.forecast);
          if (!worst || Math.abs(e) > Math.abs(worst.err)) worst = { it, err: e, p };
        }
        if (!base2) continue;
        const err = absErr / base2;
        if (err <= t) continue;
        const owner = sectionOwner(f);
        out.push({
          ...base, key: `${base.ruleKey}:s:${f.id}`,
          title: `${f.name} ${L.forecast.toLowerCase()} accuracy ${pct(Math.max(0, 1 - err))} over the last ${window.length} months`,
          detail: `${L.actual} differed from ${L.forecast.toLowerCase()} by ${pct(err)} on average.${worst ? ` Largest miss: ${worst.it.name} in ${monLabel(worst.p)} (${inr(worst.err, { sign: true })}).` : ""}`,
          entity: { type: "aop_section", id: f.id, name: f.name, href: planHref(m, worst?.it.id ?? null, f.id) },
          metrics: [{ label: "Accuracy", value: pct(Math.max(0, 1 - err)) }, { label: "Avg miss", value: inr(absErr / window.length) }],
          suggestedAction: `Review how ${L.forecast.toLowerCase()}s are built with ${owner?.name ?? "the owner"} (invoices, arrears, timing).`,
          amount: absErr / Math.max(1, window.length) * 0.4, ownerId: owner?.id ?? null, ownerName: owner?.name ?? null, itemId: worst?.it.id ?? null, sectionId: f.id,
        });
      }
    }

    if (r.rule.metric === "fy_projection") {
      const n = m.remaining.length;
      const runRate = (x: { gapImpact: number }, dir: Direction) => {
        const need = Math.abs(x.gapImpact);
        return n ? `${inr(need)} additional ${goodWord(dir)} required over the next ${n} month${n === 1 ? "" : "s"} (${inr(need / n)}/month).` : `Plan year closed ${inr(need)} adverse.`;
      };
      const T = m.totals;
      if (T.gapImpactPct != null && T.gapImpactPct < -t) {
        out.push({
          ...base, key: `${base.ruleKey}:c:${m.cycle.id}`,
          title: `Full-year projection ${varianceWord(m.direction, L, false).toLowerCase()} by ${inr(Math.abs(T.gapImpact))}`,
          detail: `Projected ${inr(T.projection)} vs ${L.plan.toLowerCase()} ${inr(T.fyPlan)} (${pct(Math.abs(T.gapImpactPct), 1)}). ${runRate(T, m.direction)}`,
          entity: { type: "aop_cycle", id: m.cycle.id, name: m.cycle.name, href: planHref(m) },
          metrics: [{ label: "Projection", value: inr(T.projection) }, { label: "Gap", value: inr(T.gap, { sign: true }) }],
          suggestedAction: "Agree recovery levers by function in the monthly review.",
          amount: Math.abs(T.gapImpact) * 2, ownerId: null, ownerName: null, itemId: null, sectionId: null,
        });
      }
      for (const f of m.functions) {
        const x = f.m;
        if (x.gapImpactPct == null || x.gapImpactPct > -t || Math.abs(x.gapImpact) < minAmt) continue;
        const dir = allItemsOf(f)[0]?.direction ?? m.direction;
        const owner = sectionOwner(f);
        out.push({
          ...base, key: `${base.ruleKey}:s:${f.id}`,
          title: `${f.name} on course to finish ${varianceWord(dir, L, false).toLowerCase()} by ${inr(Math.abs(x.gapImpact))}`,
          detail: `Projected ${inr(x.projection)} vs ${L.plan.toLowerCase()} ${inr(x.fyPlan)}. ${runRate(x, dir)}`,
          entity: { type: "aop_section", id: f.id, name: f.name, href: planHref(m, null, f.id) },
          metrics: [{ label: "Projection", value: inr(x.projection) }, { label: "Gap", value: inr(x.gap, { sign: true }) }, { label: "%", value: pct(x.fyPlan ? x.gap / Math.abs(x.fyPlan) : null, 1, true) }],
          suggestedAction: `Ask ${owner?.name ?? "the owner"} for a recovery plan and updated ${L.forecast.toLowerCase()}s.`,
          amount: Math.abs(x.gapImpact) * 1.5, ownerId: owner?.id ?? null, ownerName: owner?.name ?? null, itemId: null, sectionId: f.id,
        });
      }
    }
  }
  // one insight per key; strongest first
  const seen = new Set<string>();
  return out
    .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.amount - a.amount)
    .filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)));
}

export async function insightsFor(m: Model) {
  return evaluate(m, await listRules());
}
