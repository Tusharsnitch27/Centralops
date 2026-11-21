import Link from "next/link";
import { AlertTriangle, CheckCircle2, Users } from "lucide-react";
import { requireSopOverview } from "@/server/sop/access";
import { canManage } from "@/server/auth";
import { engineScenario } from "@/server/sop/capacityTools";
import { SOP_CUTOVER } from "@/server/sop/sync";
import { q } from "@/server/db";
import { departments, FUNC_NAMES, listRates, mappingState, productivity, SUPPORT, WHS, type MpLine } from "@/server/manpower/model";
import { lastManpowerRuns, manpowerConfigured, manpowerUrl } from "@/server/manpower/feed";
import { ProductivityTable } from "@/components/sop/ProductivityTable";
import { ProcessProductivity } from "@/components/sop/ProcessProductivity";
import { processProductivity } from "@/server/wcm/productivity";
import { ManpowerFeed, ManpowerMapping, ManpowerStandards } from "@/components/sop/ManpowerSetup";
import { Collapsible } from "@/components/ui/Collapsible";
import { addMonths, fmtMonth, today } from "@/lib/dates";
import { cn } from "@/lib/cn";

export const metadata = { title: "S&OP · Productivity" };
const n = (v: number | null | undefined) => (v == null ? "—" : new Intl.NumberFormat("en-IN").format(Math.round(v)));
const pc = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const TABS = [{ key: "overview", label: "Overview" }, { key: "process", label: "By process" }, { key: "standards", label: "Standards" }, { key: "feed", label: "Feed & mapping" }] as const;

/** Manpower (from the manpower tool) → actual capacity per department → achieved % from S&OP actuals. */
export default async function Productivity({ searchParams }: { searchParams: Promise<{ tab?: string; month?: string }> }) {
  const u = await requireSopOverview();
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "overview";
  const cur = `${today().slice(0, 7)}-01`;
  const months: string[] = [];
  for (let m = SOP_CUTOVER; m <= cur; m = addMonths(m, 1)) months.push(m);
  const month = sp.month && months.includes(sp.month) ? sp.month : cur;
  const edit = canManage(u);
  const [depts, map] = await Promise.all([departments(), mappingState()]);
  const unmapped = map.funcs.filter((f) => !f.department && f.func.trim().toLowerCase() !== "admin").length; // Admin is uncounted by design (guessFunc)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="seg">{TABS.map((t) => <Link key={t.key} href={`/sop/productivity?tab=${t.key}${tab === "overview" ? `&month=${month}` : ""}`} data-on={tab === t.key} className="seg-item">{t.label}{t.key === "feed" && unmapped > 0 && <span className="ml-1 rounded bg-warn-soft px-1 text-[10.5px] text-warn">{unmapped}</span>}</Link>)}</div>
        {tab === "overview" && (
          <div className="ml-auto flex flex-wrap gap-1.5">
            {months.map((p) => (
              <Link key={p} href={`/sop/productivity?month=${p}`} className={cn("flex h-8 items-center rounded-lg border px-2.5 text-[12.5px] transition", p === month ? "border-ink bg-ink text-canvas" : "border-line bg-surface text-ink-2 hover:border-line-strong")}>{fmtMonth(p)}</Link>
            ))}
          </div>
        )}
      </div>
      {tab === "overview" && <Overview month={month} unmapped={unmapped} configured={manpowerConfigured()} />}
      {tab === "process" && <ProcessProductivity data={await processProductivity()} />}
      {tab === "standards" && <ManpowerStandards rates={await listRates()} departments={depts} canEdit={edit} refs={await standardRefs(cur)} />}
      {tab === "feed" && (
        <div className="space-y-4">
          <ManpowerFeed configured={manpowerConfigured()} host={hostOf(manpowerUrl())} runs={await lastManpowerRuns()} lastDay={map.lastDay} canEdit={edit} />
          <ManpowerMapping sites={map.sites} funcs={map.funcs} departments={FUNC_NAMES} canEdit={edit} />
        </div>
      )}
    </div>
  );
}

/** What each function × warehouse actually did per head this month, and what the capacity plan needs per head. */
async function standardRefs(month: string) {
  const { lines } = await productivity(month);
  const out: Record<string, { actual: number | null; plan: number | null }> = {};
  for (const l of lines) out[`${l.department}|${l.warehouse}`] = { actual: l.uph, plan: l.required && l.headsAvg ? l.required / l.headsAvg : null };
  return out;
}

const hostOf = (url: string | null) => { try { return url ? new URL(url).host : null; } catch { return url; } };

async function Overview({ month, unmapped, configured }: { month: string; unmapped: number; configured: boolean }) {
  const { lines, to, hasHeads } = await productivity(month);
  const callouts = insights(lines);
  return (
    <>
      {!hasHeads ? (
        <div className="card flex flex-wrap items-center gap-3 px-4 py-3">
          <Users size={16} className="text-ink-3" />
          <div className="min-w-0 flex-1 text-[13px] text-ink-2">
            {!configured ? "Manpower isn’t connected yet — set the attendance app’s API variables in Coolify." : unmapped ? `No mapped manpower for ${fmtMonth(month)} — ${unmapped} function${unmapped === 1 ? "" : "s"} from the manpower tool still need a department.` : `No manpower for ${fmtMonth(month)} yet.`}
            <span className="text-ink-4"> Capacity-planning numbers are shown meanwhile.</span>
          </div>
          <Link href="/sop/productivity?tab=feed" className="text-[12.5px] font-medium text-info hover:underline">Feed & mapping →</Link>
        </div>
      ) : (
        <div className="card px-5 py-4">
          <div className="flex items-start gap-3">
            {callouts.some((c) => c.bad) ? <AlertTriangle size={17} className="mt-0.5 shrink-0 text-warn" /> : <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-ok" />}
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold">{fmtMonth(month)} · through {new Date(`${to}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}</div>
              <ul className="mt-1.5 space-y-1 text-[13px] text-ink-2">{callouts.length ? callouts.map((c, i) => <li key={i} className={cn(c.bad && "text-ink")}>{c.text}</li>) : <li>Every department with a standard is within ±20% of its capacity.</li>}</ul>
            </div>
          </div>
        </div>
      )}
      {WHS.map((wh) => { const ls = lines.filter((l) => l.warehouse === wh); return ls.length ? <ProductivityTable key={wh} wh={`${wh} WH`} lines={ls} /> : null; })}
      <p className="px-1 text-[11.5px] text-ink-4">
        Heads = attendance app, present day-equivalents per day by function (Ops & Logistics = loading, unloading, housekeeping + logistics: overhead; Admin not counted). Plan required = the capacity-planning departments each function covers. Actual capacity = heads × standard (Standards tab). Output = S&amp;OP Snowflake daily actuals per function (units; dispatch by packed time; Inward = category putaway, Inventory = return putaway, both by putaway updated). B2B covers marketplace + retail. Achieved = output ÷ actual capacity on days with both; amber below 80% (idle heads), red above 120% (standard too low or heads under-reported). Cover = actual capacity ÷ Capacity planning’s required per day.
      </p>
      <Collapsible id="prod-throughput" title="Throughput vs facility capacity" sub="Inward / outward per day against the facility capacity engine">
        <Throughput month={month} />
      </Collapsible>
    </>
  );
}

/** A handful of sentences worth saying out loud in the review. */
function insights(lines: MpLine[]) {
  const out: { text: string; bad: boolean }[] = [];
  const short = lines.filter((l) => l.cover != null && l.cover < 0.95).sort((a, b) => a.cover! - b.cover!);
  for (const l of short.slice(0, 3)) out.push({ bad: true, text: `${l.warehouse} ${l.department}: heads give ${n(l.capDay)}/day vs ${n(l.required)} planned — ${pc(1 - l.cover!)} short of plan.` });
  const idle = lines.filter((l) => l.ach != null && l.ach < 0.8).sort((a, b) => a.ach! - b.ach!);
  for (const l of idle.slice(0, 3)) out.push({ bad: true, text: `${l.warehouse} ${l.department} achieved ${pc(l.ach)} of capacity — ~${n((l.headsAvg ?? 0) * (1 - l.ach!))} heads/day more than the output needed (${l.under} of ${l.judged} days under 80%).` });
  const hot = lines.filter((l) => l.ach != null && l.ach > 1.2).sort((a, b) => b.ach! - a.ach!);
  for (const l of hot.slice(0, 2)) out.push({ bad: true, text: `${l.warehouse} ${l.department} ran at ${pc(l.ach)} of standard — check the standard or heads not reported.` });
  const noStd = lines.filter((l) => l.headsAvg && l.rateNow == null && l.department !== SUPPORT);
  if (noStd.length) out.push({ bad: false, text: `${noStd.length} function × warehouse ${noStd.length === 1 ? "has" : "have"} heads but no standard yet: ${noStd.map((l) => `${l.warehouse} ${l.department}`).slice(0, 4).join(", ")}${noStd.length > 4 ? "…" : ""}.` });
  for (const wh of WHS) {
    const all = lines.filter((l) => l.warehouse === wh).reduce((a, l) => a + (l.headsAvg ?? 0), 0), sup = lines.find((l) => l.warehouse === wh && l.department === SUPPORT)?.headsAvg ?? 0;
    if (all && sup / all > 0.15) out.push({ bad: false, text: `${wh}: Ops & Logistics (loading, unloading, housekeeping, logistics) is ${pc(sup / all)} of heads — ${n(sup)} of ${n(all)} a day.` });
  }
  const noHeads = lines.filter((l) => !l.headsAvg && l.required);
  if (noHeads.length) out.push({ bad: false, text: `No manpower mapped for ${noHeads.map((l) => `${l.warehouse} ${l.department}`).slice(0, 4).join(", ")}${noHeads.length > 4 ? "…" : ""}.` });
  return out;
}

async function Throughput({ month }: { month: string }) {
  const [flow, periods, engine] = await Promise.all([
    q<{ warehouse: "South" | "North"; inward_category: number; inward_returns: number; outward: number }>(
      `select warehouse, coalesce(inward_category,0)::float8 as inward_category, coalesce(inward_returns,0)::float8 as inward_returns, coalesce(outward,0)::float8 as outward from sop_inventory_flow where period = $1 order by warehouse desc`, [month]),
    q<{ through_day: number }>(`select through_day from sop_review_periods where period = $1`, [month]),
    engineScenario(),
  ]);
  const d = periods[0]?.through_day ?? new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const tone = (v: number | null) => (v == null ? "" : v >= 1 ? "text-bad font-semibold" : v >= 0.85 ? "text-warn font-semibold" : v < 0.5 ? "text-ink-3" : "text-ok");
  if (!flow.length) return <p className="px-4 py-3 text-[12.5px] text-ink-4">No flow for {fmtMonth(month)} yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="table-base min-w-[720px]">
        <thead><tr><th>WH</th><th className="text-right">Inward / day</th><th className="text-right">Inward cap</th><th className="text-right">Util.</th><th className="text-right">Outward / day</th><th className="text-right">Outward cap</th><th className="text-right">Util.</th></tr></thead>
        <tbody>{flow.map((f) => {
          const c = engine.input.caps.find((x) => x.facility === `${f.warehouse} WH`);
          const inD = (f.inward_category + f.inward_returns) / d, outD = f.outward / d;
          const iu = c?.inward ? inD / c.inward : null, ou = c?.outward ? outD / c.outward : null;
          return (
            <tr key={f.warehouse}><td className="font-medium">{f.warehouse}</td>
              <td className="text-right tabular">{n(inD)}</td><td className="text-right tabular text-ink-3">{n(c?.inward)}</td><td className={cn("text-right tabular", tone(iu))}>{pc(iu)}</td>
              <td className="text-right tabular">{n(outD)}</td><td className="text-right tabular text-ink-3">{n(c?.outward)}</td><td className={cn("text-right tabular", tone(ou))}>{pc(ou)}</td></tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}
