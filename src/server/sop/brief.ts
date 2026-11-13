import "server-only";
import { q } from "../db";
import { addMonths, today } from "@/lib/dates";
import { monthlyReview } from "./monthly";
import { dailyDeviation, DAY_BAND, type DailyView } from "./daily";
import { lastRuns } from "./sync";

export type ProblemType = "Monthly miss" | "MTD miss" | "Day-to-day swings" | "Unplanned volume" | "Warehouse skew" | "Capacity" | "Data gap";
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
    if (r.ta === 0 && r.tp > 0) { problems.push({ type: "Data gap", tone: "warn", score: 10, title: `${r.label}: no actuals for the period`, detail: `Planned ${k(r.tp)} — either nothing moved or there is no actual feed yet${r.key === "liquidation" ? " (liquidation: Malhar uploads the gatepass actuals under Inputs)" : ""}.`, href: "/settings?tab=integrations" }); continue; }
    // a month still running is judged on its MTD plan (plan through the last day with actuals)
    const P = d.mtd ? `MTD plan (1–${d.through})` : "plan";
    if (r.acc! < 0.85) problems.push({ type: d.mtd ? "MTD miss" : "Monthly miss", tone: r.acc! < 0.7 ? "bad" : "warn", score: (1 - r.acc!) * 100,
      title: `${r.label}: ${pc(r.acc)} accurate (${r.devPct! > 0 ? "+" : ""}${pc(r.devPct)} vs ${P})`,
      detail: `${d.mtd ? "MTD plan" : "Plan"} ${k(r.tp)}${d.mtd && r.ftp != null ? ` of ${k(r.ftp)} for the month` : ""}, actual ${k(r.ta)} — ${r.dev > 0 ? `${k(r.dev)} more than planned` : `${k(-r.dev)} short`}. South ${pc(r.sAcc)}, North ${pc(r.nAcc)}.`, href: "/sop/monthly" });
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
    const rv = d.views.find((x) => x.def.key === (v.key.startsWith("b2c") ? "b2c" : v.key));
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
  if (!runs.length) problems.push({ type: "Data gap", tone: "info", score: 5, title: "No actuals yet", detail: "Apr–Aug come from the workbook; Sep onwards needs the Snowflake refresh (Settings › Integrations).", href: "/settings?tab=integrations" });
  else if (failed.length) problems.push({ type: "Data gap", tone: "warn", score: 18, title: `${failed.length} data feed${failed.length > 1 ? "s" : ""} failed on the last refresh`, detail: failed.map((f) => `${f.feed}: ${(f.message ?? "").slice(0, 80)}`).join(" · "), href: "/settings?tab=integrations" });
  if (daily.hasActuals && daily.views.some((v) => v.total.basis === "monthly")) problems.push({ type: "Data gap", tone: "info", score: 4, title: "No day-level plan for some flows", detail: `${daily.views.filter((v) => v.total.basis !== "daily").map((v) => `${v.title} (${v.total.basis})`).join(", ")} — their daily plan is the ${"week/month"} spread evenly.`, href: "/settings?tab=integrations" });

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

/**
 * Forward look. Projections by flow (stream inputs), and an inventory outlook per warehouse:
 * current month = latest actual stock + projected inward/returns for the days still to come − every outward flow for those days;
 * later months roll forward. Flows without a South/North split use that flow's latest planned split.
 */
export async function forwardLook(n = 3) {
  const cur = `${today().slice(0, 7)}-01`;
  const months = Array.from({ length: n + 1 }, (_, i) => addMonths(cur, i));
  const daysIn = (p: string) => new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0)).getUTCDate();
  const [vals, retailPlan, reviewSplit, retSplit, invDaily, invMonth, period] = await Promise.all([
    q<{ period: string; stream: string; metric: string | null; dimension: string; projection: number }>(
      `select v.period::text as period, s.name as stream, l.metric, v.dimension, sum(coalesce(v.revised_projection, v.projection))::float8 as projection
       from sop_values v join sop_lines l on l.id = v.line_id join sop_streams s on s.id = l.stream_id where v.period = any($1::date[]) group by 1, 2, 3, 4`, [months]),
    q<{ day: string; south: number; north: number }>(`select day::text as day, south::float8 as south, north::float8 as north from sop_plan_daily where view_key = 'retail_fwd' and day >= $1`, [cur]),
    q<{ view_key: string; shopify: boolean; sp: number; np: number }>(
      `select view_key, row_label ilike 'shopify%' as shopify, sum(coalesce(south_plan,0))::float8 as sp, sum(coalesce(north_plan,0))::float8 as np from sop_review_rows
       where period = (select max(period) from sop_review_rows where view_key in ('b2c','b2b_mp') and south_plan is not null) and view_key in ('b2c','b2b_mp') group by 1, 2`),
    q<{ south: number; north: number }>(`select sum(case when warehouse = 'South' then coalesce(b2c,0) end)::float8 as south, sum(case when warehouse = 'North' then coalesce(b2c,0) end)::float8 as north from sop_returns where period = (select max(period) from sop_returns)`),
    q<{ day: string; region: string; units: number }>(`select day::text as day, region, sum(units)::float8 as units from sop_inventory_daily where day = (select max(day) from sop_inventory_daily) group by 1, 2`),
    q<{ warehouse: "South" | "North"; inventory: number | null; capacity: number }>(`select warehouse, inventory::float8 as inventory, capacity::float8 as capacity from sop_wh_capacity where period = $1`, [cur]),
    q<{ through_day: number }>(`select through_day from sop_review_periods where period = $1`, [cur]),
  ]);
  const through = invDaily.length ? Number(invDaily[0].day.slice(8, 10)) : period[0]?.through_day ?? new Date().getUTCDate();
  const remain = (p: string) => (p === cur ? Math.max(0, daysIn(p) - through) / daysIn(p) : 1);
  const share = (sp: number, np: number, dflt = 16 / 28) => (sp + np > 0 ? sp / (sp + np) : dflt);
  const split = {
    b2c_sf: share(...(((r) => [r?.sp ?? 0, r?.np ?? 0])(reviewSplit.find((r) => r.view_key === "b2c" && r.shopify)) as [number, number])),
    b2c_mp: share(...(((r) => [r?.sp ?? 0, r?.np ?? 0])(reviewSplit.find((r) => r.view_key === "b2c" && !r.shopify)) as [number, number])),
    b2b_mp: share(reviewSplit.filter((r) => r.view_key === "b2b_mp").reduce((a, r) => a + r.sp, 0), reviewSplit.filter((r) => r.view_key === "b2b_mp").reduce((a, r) => a + r.np, 0)),
    returns: share(retSplit[0]?.south ?? 0, retSplit[0]?.north ?? 0),
  };
  const sum = (p: string, f: (r: (typeof vals)[number]) => boolean) => { const rs = vals.filter((r) => r.period === p && f(r)); return rs.length ? rs.reduce((a, r) => a + (r.projection || 0), 0) : null; };
  const dimSum = (p: string, f: (r: (typeof vals)[number]) => boolean, wh: "South" | "North") => { const rs = vals.filter((r) => r.period === p && f(r) && r.dimension === wh); return rs.length ? rs.reduce((a, r) => a + (r.projection || 0), 0) : null; };
  // each flow: month total + South/North for the days still to come
  type Flow = { key: string; label: string; dir: "out" | "in"; month: (p: string) => { total: number | null; south: number | null; north: number | null } };
  const bySplit = (total: number | null, sh: number, p: string) => (total == null ? { total: null, south: null, north: null } : { total, south: total * sh * remain(p), north: total * (1 - sh) * remain(p) });
  // a flow projected for one warehouse only (e.g. liquidation from North) counts as 0 at the other
  const byDims = (p: string, f: (r: (typeof vals)[number]) => boolean) => { const s_ = dimSum(p, f, "South"), n_ = dimSum(p, f, "North"); const t = s_ == null && n_ == null ? null : (s_ ?? 0) + (n_ ?? 0); return t == null ? { total: null, south: null, north: null } : { total: t, south: (s_ ?? 0) * remain(p), north: (n_ ?? 0) * remain(p) }; };
  const FLOWS: Flow[] = [
    { key: "b2c_sf", label: "B2C · Shopify", dir: "out", month: (p) => bySplit(sum(p, (r) => r.stream === "B2C-SF" && r.metric === "items"), split.b2c_sf, p) },
    { key: "b2c_mp", label: "B2C · Marketplaces", dir: "out", month: (p) => bySplit(sum(p, (r) => r.stream === "B2C-MP" && r.metric === "items"), split.b2c_mp, p) },
    { key: "b2b_mp", label: "B2B · Marketplace", dir: "out", month: (p) => bySplit(sum(p, (r) => r.stream === "B2B-MP"), split.b2b_mp, p) },
    { key: "retail", label: "B2B · Retail stores", dir: "out", month: (p) => {
      const ds = retailPlan.filter((d) => d.day.startsWith(p.slice(0, 7)));
      if (!ds.length) return { total: null, south: null, north: null };
      const left = ds.filter((d) => p !== cur || Number(d.day.slice(8, 10)) > through);
      return { total: ds.reduce((a, d) => a + d.south + d.north, 0), south: left.reduce((a, d) => a + d.south, 0), north: left.reduce((a, d) => a + d.north, 0) };
    } },
    { key: "liquidation", label: "Liquidation", dir: "out", month: (p) => byDims(p, (r) => r.stream === "Liquidation") },
    { key: "inward", label: "Category inward", dir: "in", month: (p) => byDims(p, (r) => r.stream === "Inbound-Category Wise") },
    { key: "returns", label: "B2C returns", dir: "in", month: (p) => bySplit(sum(p, (r) => (r.stream === "B2C-SF" || r.stream === "B2C-MP") && r.metric === "returns"), split.returns, p) },
  ];
  const table = FLOWS.map((f) => ({ key: f.key, label: f.label, dir: f.dir, values: months.map((p) => f.month(p).total) }));

  // inventory outlook per warehouse
  const start: Record<"South" | "North", number | null> = {
    South: invDaily.find((r) => r.region === "south")?.units ?? invMonth.find((r) => r.warehouse === "South")?.inventory ?? null,
    North: invDaily.find((r) => r.region === "north")?.units ?? invMonth.find((r) => r.warehouse === "North")?.inventory ?? null,
  };
  const cap = { South: invMonth.find((r) => r.warehouse === "South")?.capacity ?? 1600000, North: invMonth.find((r) => r.warehouse === "North")?.capacity ?? 1200000 };
  const outlook = (["South", "North"] as const).map((wh) => {
    let stock = start[wh];
    const rows = months.map((p) => {
      const parts = FLOWS.map((f) => ({ f, v: f.month(p)[wh === "South" ? "south" : "north"] }));
      const inward = parts.filter((x) => x.f.dir === "in").reduce((a, x) => a + (x.v ?? 0), 0);
      const outward = parts.filter((x) => x.f.dir === "out").reduce((a, x) => a + (x.v ?? 0), 0);
      const missing = parts.filter((x) => x.v == null).map((x) => x.f.label);
      const missingOut = parts.some((x) => x.v == null && x.f.dir === "out");
      const opening = stock;
      if (stock != null) stock = stock + inward - outward;
      return { period: p, opening, inward, outward, closing: stock, util: stock != null ? stock / cap[wh] : null, missing, missingOut, partial: p === cur };
    });
    return { wh, capacity: cap[wh], rows };
  });
  return { months, table, outlook, through, cur, startSource: invDaily.length ? `stock on ${invDaily[0].day} (Snowflake)` : `${new Date(`${cur}T00:00:00Z`).toLocaleString("en-IN", { month: "short", timeZone: "UTC" })} inventory from the workbook, taken as of day ${through}` };
}
