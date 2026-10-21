import "server-only";
import { q } from "../db";
import { addMonths, today } from "@/lib/dates";
import { monthlyReview } from "./monthly";
import { dailyDeviation, DAY_BAND, type DailyView } from "./daily";
import { lastRuns } from "./sync";

export type ProblemType = "Monthly miss" | "Day-to-day swings" | "Unplanned volume" | "Warehouse skew" | "Capacity" | "Data gap";
export interface Problem { type: ProblemType; tone: "bad" | "warn" | "info"; title: string; detail: string; score: number; href?: string }

const pc = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const k = (v: number) => (Math.abs(v) >= 100000 ? `${(v / 100000).toFixed(1)}L` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}K` : `${Math.round(v)}`);
const ord = (d: number) => (d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th");
const MON = (p: string) => new Date(`${p}T00:00:00Z`).toLocaleString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });

/** Everything the Summary needs for a set of months: overall, problems ranked, day-level swings, forward look. */
export async function leaderBrief(months: string[], label: string) {
  const [d, daily, runs] = await Promise.all([monthlyReview(months, label), dailyDeviation(months), lastRuns()]);
  const problems: Problem[] = [];
  const outward = d.overall.find((r) => r.key === "Outwards:total"), inward = d.overall.find((r) => r.key === "Inwards:total");
  const flowDaily = (key: string) => daily.views.find((v) => v.key === key);

  // monthly misses (each flow)
  for (const r of d.overall.filter((x) => !x.kind && x.acc != null)) {
    if (r.ta === 0 && r.tp > 0) { problems.push({ type: "Data gap", tone: "warn", score: 10, title: `${r.label}: no actuals for the period`, detail: `Planned ${k(r.tp)} — either nothing moved or there is no actual feed yet${r.key === "liquidation" ? " (liquidation has no Snowflake query yet)" : ""}.`, href: "/sop/data" }); continue; }
    if (r.acc! < 0.85) problems.push({ type: "Monthly miss", tone: r.acc! < 0.7 ? "bad" : "warn", score: (1 - r.acc!) * 100,
      title: `${r.label}: ${pc(r.acc)} accurate (${r.devPct! > 0 ? "+" : ""}${pc(r.devPct)} vs plan)`,
      detail: `Plan ${k(r.tp)}, actual ${k(r.ta)} — ${r.dev > 0 ? `${k(r.dev)} more than planned` : `${k(-r.dev)} short`}. South ${pc(r.sAcc)}, North ${pc(r.nAcc)}.`, href: "/sop/monthly" });
  }
  // day-to-day swings, incl. the ones hidden by an on-plan month
  const swing = (name: string, s: DailyView["total"], monthAcc: number | null, href: string) => {
    if (s.judged < 4) return;
    const off = s.up + s.down, share = off / s.judged;
    if (share < 0.3) return;
    const hidden = monthAcc != null && monthAcc >= 0.9;
    problems.push({ type: "Day-to-day swings", tone: share >= 0.5 ? "bad" : "warn", score: share * 60 + (hidden ? 15 : 0),
      title: `${name}: off plan on ${off} of ${s.judged} days (${s.up} above, ${s.down} below by >${Math.round(DAY_BAND * 100)}%)`,
      detail: [hidden ? `The month is on plan (${pc(monthAcc)} accurate) but the days aren't — uneven days strain pick/pack staffing and SLA.` : "Uneven days strain pick/pack staffing and SLA.",
        [s.worstUp ? `Highest +${pc(s.worstUp.dev)} on the ${Number(s.worstUp.day.slice(8))}${ord(Number(s.worstUp.day.slice(8)))}` : "", s.worstDown ? `lowest ${pc(s.worstDown.dev)} on the ${Number(s.worstDown.day.slice(8))}${ord(Number(s.worstDown.day.slice(8)))}` : ""].filter(Boolean).join(", ").replace(/^(.+)$/, "$1."),
        `Day plan: ${s.basis === "daily" ? "from the projection sheet" : `${s.basis} plan spread evenly`}.`].filter(Boolean).join(" "), href: "/sop/monthly#daily" });
    if (s.unplanned > 0) problems.push({ type: "Unplanned volume", tone: "warn", score: 20 + s.unplanned, title: `${name}: volume on ${s.unplanned} day${s.unplanned > 1 ? "s" : ""} with no plan`, detail: "Dispatch happened on days the projection had none — add them to the plan so capacity is staffed.", href: "/sop/monthly#daily" });
  };
  for (const v of daily.views) {
    const accRow = d.overall.find((r) => r.key === v.key);
    swing(v.title, v.total, accRow?.acc ?? null, "/sop/monthly#daily");
    const rv = d.views.find((x) => x.def.key === v.key);
    for (const row of v.rows.slice(0, 2)) {
      const r = rv?.rows.find((x) => x.label === row.label);
      swing(`${v.title} · ${row.label}`, row.series, r && r.tp > 0 ? Math.max(0, 1 - Math.abs(r.ta - r.tp) / r.tp) : null, "/sop/monthly#daily");
    }
  }
  // warehouse skew (strongest per view)
  for (const v of d.views) for (const i of v.insights.filter((x) => x.key.endsWith(":skew")).slice(0, 1))
    problems.push({ type: "Warehouse skew", tone: i.tone === "bad" ? "bad" : "warn", score: 12, title: `${v.def.title}: ${i.title.map((s) => (typeof s === "string" ? s : s.b)).join("")}`, detail: i.impact.map((s) => (typeof s === "string" ? s : s.b)).join(""), href: "/sop/monthly" });
  // capacity
  for (const f of d.flowNow) if (f.utilClose >= 0.9)
    problems.push({ type: "Capacity", tone: f.utilClose >= 1 ? "bad" : "warn", score: f.utilClose * 40, title: `${f.warehouse} WH closes ${MON(f.period)} at ${pc(f.utilClose)} of capacity`, detail: `Inward ${k(f.inward)} vs outward ${k(f.outward)}. Pre-pack stock is held separately and not counted here.`, href: "/sop/monthly" });
  // data gaps
  const failed = runs.filter((r) => r.status === "failed");
  if (!runs.length) problems.push({ type: "Data gap", tone: "info", score: 5, title: "Actuals still come from the workbook", detail: "Connect Snowflake (Settings › Integrations) for daily actuals and day-level alerts.", href: "/sop/data" });
  else if (failed.length) problems.push({ type: "Data gap", tone: "warn", score: 18, title: `${failed.length} data feed${failed.length > 1 ? "s" : ""} failed on the last refresh`, detail: failed.map((f) => `${f.feed}: ${(f.message ?? "").slice(0, 80)}`).join(" · "), href: "/sop/data" });
  if (daily.hasActuals && daily.views.some((v) => v.total.basis === "monthly")) problems.push({ type: "Data gap", tone: "info", score: 4, title: "No day-level plan for some flows", detail: `${daily.views.filter((v) => v.total.basis !== "daily").map((v) => `${v.title} (${v.total.basis})`).join(", ")} — their daily plan is the ${"week/month"} spread evenly.`, href: "/sop/data" });

  problems.sort((a, b) => b.score - a.score);
  // headline: the flow with the most deviation (monthly gap + day swings)
  // rank by units off plan (what moves capacity), boosted by day swings; flows with no actuals at all are a data gap, not the headline
  const flows = d.overall.filter((r) => !r.kind && r.acc != null && r.ta > 0).map((r) => {
    const dv = flowDaily(r.key)?.total;
    const off = dv && dv.judged ? (dv.up + dv.down) / dv.judged : 0;
    return { r, off, dv, score: Math.abs(r.dev) * (1 + off) };
  }).sort((a, b) => b.score - a.score);
  const worst = flows[0];
  const headline = worst ? `${worst.r.label} has the most deviation: ${worst.r.dev > 0 ? "+" : "−"}${k(Math.abs(worst.r.dev))} vs plan (${pc(worst.r.acc)} accurate)${worst.dv && worst.dv.judged ? `, off plan on ${worst.dv.up + worst.dv.down} of ${worst.dv.judged} days` : ""}.` : null;
  return { d, daily, problems, headline, outward, inward };
}

/** Next months: projections by flow from the stream inputs, and where warehouse stock heads if they hold. */
export async function forwardLook(n = 3) {
  const cur = `${today().slice(0, 7)}-01`;
  const months = Array.from({ length: n + 1 }, (_, i) => addMonths(cur, i));
  const rows = await q<{ period: string; stream: string; metric: string | null; line: string; projection: number }>(
    `select v.period::text as period, s.name as stream, l.metric, l.name as line, sum(coalesce(v.revised_projection, v.projection))::float8 as projection
     from sop_values v join sop_lines l on l.id = v.line_id join sop_streams s on s.id = l.stream_id
     where v.period = any($1::date[]) group by 1, 2, 3, 4`, [months]);
  const sum = (p: string, f: (r: (typeof rows)[number]) => boolean) => rows.filter((r) => r.period === p && f(r)).reduce((a, r) => a + (r.projection || 0), 0) || null;
  const FLOWS: { key: string; label: string; dir: "out" | "in"; pick: (r: (typeof rows)[number]) => boolean }[] = [
    { key: "b2c", label: "B2C outward (items)", dir: "out", pick: (r) => (r.stream === "B2C-SF" || r.stream === "B2C-MP") && r.metric === "items" },
    { key: "b2b_mp", label: "B2B · Marketplace", dir: "out", pick: (r) => r.stream === "B2B-MP" },
    { key: "retail", label: "B2B · Retail stores", dir: "out", pick: (r) => r.stream === "Retail-Forward" && r.metric !== "nso" },
    { key: "liquidation", label: "Liquidation", dir: "out", pick: (r) => r.stream === "Liquidation" },
    { key: "inward", label: "Category inward", dir: "in", pick: (r) => r.stream === "Inbound-Category Wise" },
    { key: "returns", label: "B2C returns", dir: "in", pick: (r) => (r.stream === "B2C-SF" || r.stream === "B2C-MP") && r.metric === "returns" },
  ];
  const table = FLOWS.map((f) => ({ ...f, values: months.map((p) => sum(p, f.pick)) }));
  // stock roll-forward from the latest closing (both WHs), against total capacity
  const last = await q<{ closing: number; capacity: number; period: string }>(`select sum(closing)::float8 as closing, sum(capacity)::float8 as capacity, max(period)::text as period from sop_inventory_flow where period = (select max(period) from sop_inventory_flow)`);
  let stock = last[0]?.closing ?? null;
  const cap = last[0]?.capacity ?? 2800000;
  const roll = months.slice(1).map((p, i) => {
    const inw = table.filter((t) => t.dir === "in").reduce((a, t) => a + (t.values[i + 1] ?? 0), 0);
    const out = table.filter((t) => t.dir === "out").reduce((a, t) => a + (t.values[i + 1] ?? 0), 0);
    if (stock != null) stock = stock + inw - out;
    return { period: p, inward: inw, outward: out, stock, util: stock != null ? stock / cap : null, complete: table.every((t) => t.values[i + 1] != null) };
  });
  return { months, table, roll, from: last[0]?.period ?? null };
}
