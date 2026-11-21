import Link from "next/link";
import { Badge, EmptyState } from "@/components/ui";
import { AopHeader } from "@/components/aop/AopNav";
import { requireUser } from "@/server/auth";
import { q } from "@/server/db";
import { listCycles, resolveCycle } from "@/server/aop/model";
import { currentSnapshot, wcmMonth } from "@/server/wcm/queries";
import { priceMonth, RATE_CARD, TERMS, type TplSite, type TplStage } from "@/server/wcm/tpl";
import { inrFull } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "AOP · 3PL comparison" };
const STAGE_LABEL: Record<TplStage, string> = {
  inward: "Inward (category putaway, units)", b2c_out: "B2C outward (items)", b2c_orders: "B2C orders (stationery)", b2b_out: "B2B outward (retail + marketplace items)",
  b2c_returns: "B2C returns (units)", b2b_returns: "B2B / store returns (units)", storage_unit_days: "Storage (unit-days, avg stock × days)",
};
const n0 = (v: number | null) => (v == null ? "—" : new Intl.NumberFormat("en-IN").format(Math.round(v)));
const daysIn = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();

/** Last 3 complete months before the running one. */
function lastMonths(n = 3) {
  const now = new Date(), out: string[] = [];
  for (let i = n; i >= 1; i--) out.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 10));
  return out;
}

/**
 * Snitch volumes per stage (S&OP daily feeds: Unicommerce outward, trading putaway, inventory snapshot) for one site-month.
 * Activity feeds count a month only when the daily feed spans all of it (a day with no putaway or no B2B dispatch is a real
 * zero); months before the daily feed (Apr–Aug: workbook monthly figures) come back null. Inventory needs a snapshot every day.
 */
async function volumes(month: string, site: TplSite) {
  const region = site.toLowerCase(), dim = daysIn(month);
  const [rows, inv, span] = await Promise.all([
    q<{ feed: string; label: string; days: number; units: number; orders: number | null }>(
      `select feed, label, count(distinct day)::int as days, sum(units)::float8 as units, sum(orders)::float8 as orders from sop_actuals_daily
        where date_trunc('month', day)::date = $1::date and region = $2 and feed in ('category_inward','b2c','b2b_mp','retail','returns') group by 1, 2`, [month, region]),
    q<{ days: number; unit_days: number }>(`select count(distinct day)::int as days, sum(units + prepack_units)::float8 as unit_days from sop_inventory_daily where date_trunc('month', day)::date = $1::date and region = $2`, [month, region]),
    q<{ first: string | null; last: string | null }>(`select min(day)::text as first, max(day)::text as last from sop_actuals_daily where feed = 'b2c'`),
  ]);
  const end = `${month.slice(0, 8)}${String(dim).padStart(2, "0")}`;
  const spans = !!span[0]?.first && span[0].first <= month && span[0].last! >= end;
  const cover = new Map<string, number>();
  const sum = (feeds: string[], labels?: string[], key: "units" | "orders" = "units") => {
    const rs = rows.filter((r) => feeds.includes(r.feed) && (!labels || labels.includes(r.label)));
    return { v: spans ? rs.reduce((a, r) => a + (r[key] ?? 0), 0) : null, days: spans ? dim : 0 };
  };
  const put = (k: TplStage, x: { v: number | null; days: number }) => { cover.set(k, x.days); return x.v; };
  const vol: Record<TplStage, number | null> = {
    inward: put("inward", sum(["category_inward"])), b2c_out: put("b2c_out", sum(["b2c"])), b2c_orders: put("b2c_orders", sum(["b2c"], undefined, "orders")),
    b2b_out: put("b2b_out", sum(["b2b_mp", "retail"])), b2c_returns: put("b2c_returns", sum(["returns"], ["B2C Return Inward"])),
    b2b_returns: put("b2b_returns", sum(["returns"], ["Store Return Inward", "B2B MP Returns"])),
    storage_unit_days: put("storage_unit_days", { v: (inv[0]?.days ?? 0) >= dim ? inv[0]!.unit_days : null, days: inv[0]?.days ?? 0 }),
  };
  return { vol, cover, dim };
}

export default async function TplPage({ searchParams }: { searchParams: Promise<{ cycle?: string; site?: string }> }) {
  const sp = await searchParams;
  await requireUser();
  const [cycles, cycle, snap] = await Promise.all([listCycles(), resolveCycle(sp.cycle), currentSnapshot()]);
  const header = <AopHeader active="warehouse" cycleId={cycle?.id ?? null} cycles={cycles} title="3PL comparison"
    subtitle="The last 3 complete months of Snitch volumes per stage, priced through each 3PL tariff in its native unit, beside the Cost Master booked cost."
    actions={<Link href="/aop/warehouse" className="text-[12.5px] text-ink-3 hover:text-ink">← Warehouse cost master</Link>} />;
  if (!snap) return <div>{header}<div className="card"><EmptyState title="No Cost Master snapshot" body="Load the Cost Master first." /></div></div>;
  const site: TplSite = sp.site === "North" ? "North" : "South";
  const months = lastMonths();
  const data = await Promise.all(months.map(async (m) => {
    const [v, w] = await Promise.all([volumes(m, site), wcmMonth(snap.id, m, site, "actual")]);
    const fams = (["warehousing", "manpower", "ot"] as const).map((f) => w.byFamily[f]);
    const booked = fams.reduce((a, t) => a + t.source, 0) / 100, missing = fams.reduce((a, t) => a + t.missing, 0);
    return { m, ...v, booked, missing, emiza: priceMonth("Emiza", site, v.vol, v.dim), sr: priceMonth("Shiprocket", site, v.vol, v.dim) };
  }));
  const stages = Object.keys(STAGE_LABEL) as TplStage[];
  const href = (s: TplSite) => `/aop/warehouse/3pl?${new URLSearchParams({ ...(sp.cycle ? { cycle: sp.cycle } : {}), site: s })}`;

  return (
    <div className="animate-fade-in">
      {header}
      <div className="mb-4 seg"><span className="seg-label">Site</span>{(["South", "North"] as const).map((s) => <Link key={s} href={href(s)} data-on={site === s} className="seg-item">{s}</Link>)}</div>

      <div className="card overflow-x-auto">
        <table className="table-base min-w-[1100px]">
          <thead><tr><th>Stage · {site}</th>{data.map((d) => <th key={d.m} colSpan={3} className="text-center">{d.m.slice(0, 7)}</th>)}</tr>
            <tr><th /> {data.map((d) => [<th key={d.m + "q"} className="text-right">Snitch volume</th>, <th key={d.m + "e"} className="text-right">Emiza ₹</th>, <th key={d.m + "s"} className="text-right">Shiprocket ₹</th>])}</tr></thead>
          <tbody>
            {stages.map((st) => (
              <tr key={st}><td className="font-medium">{STAGE_LABEL[st]}</td>{data.map((d) => {
                const e = d.emiza.lines.find((l) => l.stage === st)!, s = d.sr.lines.find((l) => l.stage === st)!;
                const cell = (l: typeof e) => l.flag === "not charged" ? <span className="text-[11.5px] text-ink-4">not charged</span> : l.amount == null ? <span className="text-[11.5px] text-ink-4">{l.flag}</span> : <>{inrFull(l.amount)}{l.flag && <Badge tone="amber" className="ml-1">unit?</Badge>}</>;
                return [<td key={d.m + "q"} className="text-right tabular">{d.vol[st] == null ? <span className="text-[11.5px] text-warn">{st === "storage_unit_days" ? `incomplete · ${d.cover.get(st)} of ${d.dim} days` : "no daily feed for this month"}</span> : n0(d.vol[st])}</td>,
                  <td key={d.m + "e"} className="text-right tabular">{cell(e)}</td>, <td key={d.m + "s"} className="text-right tabular">{cell(s)}</td>];
              })}</tr>))}
            <tr className="font-semibold"><td>Priced (known stages only)</td>{data.map((d) => [<td key={d.m + "q"} />,
              <td key={d.m + "e"} className={cn("text-right tabular", !d.emiza.complete && "text-warn")}>{inrFull(d.emiza.priced)}{!d.emiza.complete && " *"}</td>,
              <td key={d.m + "s"} className={cn("text-right tabular", !d.sr.complete && "text-warn")}>{inrFull(d.sr.priced)}{!d.sr.complete && " *"}</td>])}</tr>
            <tr className="font-semibold"><td>Snitch booked (Cost Master actuals: warehousing + manpower + OT, before packaging)</td>{data.map((d) => (
              <td key={d.m} colSpan={3} className="text-right tabular">{d.missing ? <span className="text-warn">{inrFull(d.booked)} known · {d.missing} line(s) missing</span> : inrFull(d.booked)}</td>))}</tr>
          </tbody>
        </table>
        <p className="border-t border-line px-3 py-2 text-[11.5px] text-ink-4">* Not comparable as a total: at least one stage has no rate or no complete volume. Volumes: S&amp;OP daily feeds (Unicommerce outward, trading-stock putaway, daily inventory snapshot from snitch_final_inventory_wh2); months before the daily feed (Apr–Aug are workbook monthly figures) and inventory months with missing snapshot days aren&apos;t priced. Snitch booked comes from the Cost Master only (no Finance inputs); a month with missing lines is a coverage gap, never ₹0.</p>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="card overflow-x-auto">
          <div className="px-3 pt-3 text-[13px] font-semibold">Rate card</div>
          <table className="table-base"><thead><tr><th>Vendor</th><th>Service</th><th>Unit</th><th className="text-right">Rate</th><th>Region</th><th>Effective</th><th>Status</th></tr></thead>
            <tbody>{RATE_CARD.map((r, i) => <tr key={i}><td>{r.vendor}</td><td className="text-[12px]">{r.service}</td><td className="text-[12px]">{r.unit}</td><td className="text-right tabular">₹{r.rate}</td><td className="text-[12px]">{r.region}</td><td className="tabular text-[12px]">{r.effective}</td>
              <td>{r.status === "current" ? <Badge tone="green">current</Badge> : <Badge tone="amber">{r.status}</Badge>}</td></tr>)}</tbody></table>
          <p className="px-3 py-2 text-[11.5px] text-ink-4">Sources: {[...new Set(RATE_CARD.map((r) => r.source))].join(" · ")}</p>
        </div>
        <div className="card">
          <div className="px-3 pt-3 text-[13px] font-semibold">Terms not in the priced figure</div>
          <ul className="space-y-1 px-4 py-3 text-[12.5px] text-ink-2">{TERMS.map((t, i) => <li key={i}><span className="font-medium">{t.vendor}:</span> {t.term}</li>)}</ul>
          <div className="border-t border-line px-3 py-2 text-[11.5px] text-ink-4">Reference only — the old sheet table (₹/unit per process: Snitch, Shiprocket, Emiza old rate) uses the previous Emiza rate and groups its returns lines differently; it is not used here.</div>
        </div>
      </div>
    </div>
  );
}
