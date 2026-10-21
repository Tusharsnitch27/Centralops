import { requireSopOverview } from "@/server/sop/access";
import { Badge } from "@/components/ui";
import { Collapsible } from "@/components/ui/Collapsible";
import { requireUser } from "@/server/auth";
import { q } from "@/server/db";
import { FEEDS, FROM, INVENTORY_FEED, lastRuns, schemaInfo } from "@/server/sop/sync";
import { ago } from "@/lib/dates";
import { cn } from "@/lib/cn";

export const metadata = { title: "S&OP · Data sources" };
const n = (v: number | null | undefined) => (v == null ? "—" : new Intl.NumberFormat("en-IN").format(Math.round(v)));
const MON = (p: string) => new Date(`${p}T00:00:00Z`).toLocaleString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });

/** What each S&OP number comes from, with which conditions — plus reconciliation and open questions. */
export default async function DataSources() {
  await requireSopOverview();
  const [runs, schema, recon, plans] = await Promise.all([
    lastRuns(), schemaInfo(),
    q<{ view_key: string; period: string; wb: number; sf: number }>(
      `select view_key, period::text as period, sum(coalesce(wb_south_actual,0) + coalesce(wb_north_actual,0))::float8 as wb, sum(coalesce(south_actual,0) + coalesce(north_actual,0))::float8 as sf
       from sop_review_rows where actual_source = 'snowflake' and (wb_south_actual is not null or wb_north_actual is not null) group by 1, 2 order by 2, 1`),
    q<{ view_key: string; months: string }>(`select view_key, string_agg(distinct to_char(day, 'Mon'), ', ') as months from sop_plan_daily group by 1`),
  ]);
  const run = (k: string) => runs.find((r) => r.feed === k);
  const feeds = [...Object.entries(FEEDS).map(([key, f]) => ({ key, ...f, sqlText: f.sql({ slaSku: schema.sla?.picked.sku ?? null }) })),
    { key: "inventory", ...INVENTORY_FEED, source: process.env.SNOWFLAKE_INVENTORY_TABLE ?? "snitch_db.maplemonk.snitch_final_inventory_wh2", sqlText: "DESCRIBE TABLE → detect date / warehouse / SKU / quantity columns → daily SUM by warehouse, pre-packs split out" }];
  const slaSku = schema.sla?.picked.sku;
  const inv = schema.inventory?.picked;
  const QUESTIONS: { q: string; status: "open" | "auto" }[] = [
    { q: slaSku ? `Dispatch table SKU column detected as “${slaSku}” — confirm it holds the PP4-… style code so outward pre-packs expand to units.` : "Dispatch table (warehouse_sla_performance): which column holds the SKU? Needed to count outward pre-packs as units (PP4-… = 4).", status: slaSku ? "auto" : "open" },
    { q: inv ? `Inventory columns detected: date = ${inv.date}, warehouse = ${inv.warehouse}, SKU = ${inv.sku}, quantity = ${inv.quantity}. Is that quantity on-hand (incl. blocked / QC) or sellable only?` : "Inventory table: which columns are the snapshot date, warehouse, SKU and quantity — and is quantity on-hand or sellable only? (detected on the first refresh)", status: inv ? "auto" : "open" },
    { q: "Category inward includes pre-pack putaway (expanded to units) — and Pre-pack is also shown on its own. Should Category inward exclude PP SKUs so ‘Total inwards’ doesn’t count them twice?", status: "open" },
    { q: "Capacity: South is 16L for SAPL-WH1 + WH2 combined. What is each warehouse’s own capacity, and what is the capacity of the separate pre-pack area?", status: "open" },
    { q: "Timestamps: are packed_time and putaway_completed_date in IST? (decides which day an order near midnight counts in)", status: "open" },
    { q: "Category-wise inward has no is_trading filter (Category inward does), so their totals can differ. Keep as is?", status: "open" },
    { q: "Returns: North = Warehouse Name containing NORTH, everything else counts as South (including any non-SAPL warehouse). Limit to the three SAPL warehouses?", status: "open" },
    { q: "B2B-MP has a planned row “Amazon Cocoblu”. With AMAZON/COCOBLU treated as B2C, should that B2B plan move to B2C or stay as a B2B channel?", status: "open" },
    { q: "Liquidation actuals: no query yet (still from the workbook).", status: "open" },
    { q: `Day-level plans exist for: ${plans.map((p) => `${p.view_key === "b2c" ? "B2C" : "Retail"} (${p.months})`).join("; ") || "none"}. B2B-MP has no FY27 daily plan; B2C has none from Nov; Pre-pack only Sep (weekly). Others are spread evenly from the week / month plan.`, status: "open" },
    { q: "Retail daily plan only has store-dispatch days (~22 a month); dispatch on other days shows as unplanned. Is that the intent (fixed dispatch days)?", status: "open" },
    { q: "Orders are captured for B2C only. Do you want order counts for B2B-MP and Retail too?", status: "open" },
  ];
  return (
    <div className="space-y-6">
      <section>
        <h2 className="label-caps mb-2 px-1">Open questions &amp; findings</h2>
        <div className="card divide-y divide-line/70 overflow-hidden">
          {QUESTIONS.map((x, i) => (
            <div key={i} className="flex gap-3 px-4 py-2.5 text-[12.5px]">
              <span className={cn("mt-0.5 shrink-0 rounded px-1.5 text-[10.5px] font-semibold uppercase", x.status === "open" ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok")}>{x.status === "open" ? "Confirm" : "Detected"}</span>
              <span className="text-ink-2">{x.q}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="label-caps mb-2 px-1">Where each number comes from · daily from {FROM()}, refreshed every morning</h2>
        <div className="space-y-2">
          {feeds.map((f) => {
            const r = run(f.key);
            return (
              <Collapsible key={f.key} id={`sop:data:${f.key}`} title={f.title} sub={`${f.source} · ${f.grain}`}
                summary={r ? <><Badge tone={r.status === "ok" ? "green" : "red"} dot>{r.status}</Badge><span className="text-ink-4">{ago(r.started_at)}</span></> : <span className="text-ink-4">not run yet</span>}>
                <div className="grid gap-4 p-4 md:grid-cols-3 md:p-5">
                  <div><div className="label">Conditions</div><ul className="list-disc space-y-1 pl-4 text-[12.5px] text-ink-2">{f.conditions.map((c) => <li key={c}>{c}</li>)}</ul></div>
                  <div><div className="label">Transformations</div><ul className="list-disc space-y-1 pl-4 text-[12.5px] text-ink-2">{f.transforms.map((c) => <li key={c}>{c}</li>)}</ul></div>
                  <div><div className="label">Feeds into</div><ul className="list-disc space-y-1 pl-4 text-[12.5px] text-ink-2">{f.fills.map((c) => <li key={c}>{c}</li>)}</ul></div>
                  <details className="md:col-span-3"><summary className="cursor-pointer text-[12px] text-ink-3 hover:text-ink">Exact query</summary><pre className="mt-2 overflow-x-auto rounded-lg bg-subtle p-3 text-[11.5px] leading-snug">{f.sqlText}</pre></details>
                  {r?.message && <p className={cn("md:col-span-3 text-[12px]", r.status === "failed" ? "text-bad" : "text-ink-4")}>Last run: {r.message}</p>}
                </div>
              </Collapsible>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="label-caps mb-2 px-1">Reconciliation · workbook vs Snowflake</h2>
        {recon.length ? (
          <div className="card overflow-x-auto">
            <table className="table-base min-w-[560px]">
              <thead><tr><th>Month</th><th>View</th><th className="text-right">Workbook actual</th><th className="text-right">Snowflake actual</th><th className="text-right">Difference</th></tr></thead>
              <tbody>{recon.map((r) => { const diff = r.wb ? (r.sf - r.wb) / r.wb : null; return (
                <tr key={`${r.period}${r.view_key}`}><td>{MON(r.period)}</td><td>{r.view_key}</td><td className="text-right tabular">{n(r.wb)}</td><td className="text-right tabular">{n(r.sf)}</td>
                  <td className={cn("text-right tabular", diff == null ? "" : Math.abs(diff) > 0.05 ? "font-semibold text-bad" : "text-ok")}>{diff == null ? "—" : `${diff > 0 ? "+" : ""}${(diff * 100).toFixed(1)}%`}</td></tr>
              ); })}</tbody>
            </table>
            <p className="border-t border-line px-3 py-2 text-[11.5px] text-ink-4">Rows where Snowflake replaced a number that came from the workbook. Over ±5% (red) means the query and the sheet count differently — worth a look.</p>
          </div>
        ) : <div className="card px-4 py-5 text-[12.5px] text-ink-3">Shows up after the first Snowflake refresh: every workbook figure it replaces is kept and compared here.</div>}
      </section>
    </div>
  );
}
