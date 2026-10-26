import Link from "next/link";
import { ArrowUpRight, CalendarDays, MessageSquareText, TriangleAlert, User } from "lucide-react";
import { cn } from "@/lib/cn";
import type { DailyView, DaySeries } from "@/server/sop/daily";
import { DEV_BAND, type Insight, type Row, type Seg } from "./reviewMath";
import { Strip } from "./LeaderBits";

const fmt = (v: number) => new Intl.NumberFormat("en-IN").format(Math.round(v));
const pc = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const plain = (segs: Seg[]) => segs.map((s) => (typeof s === "string" ? s : s.b)).join("");
const clean = (l: string) => l.replace(/\s*\(items\)$/i, "");

// review view → the day-level views and the streams (owners) behind it
const DAILY: Record<string, string[]> = { b2c: ["b2c_sf", "b2c_mp"], b2b_mp: ["b2b_mp"], retail_fwd: ["retail_fwd"], category_inward: ["category_inward"], prepack: ["prepack"] };
const ORDERS: Record<string, string[]> = { b2c: ["b2c_sf_orders", "b2c_mp_orders"] };
export const STREAMS: Record<string, string[]> = {
  b2c: ["b2c-sf", "b2c-mp"], b2b_mp: ["b2b-mp"], retail_fwd: ["retail-forward"], liquidation: ["liquidation"],
  category_inward: ["inbound-category-wise"], category_view: ["inbound-category-wise"], prepack: ["pre-pack-category-wise", "inbound-category-wise"],
};
const KIND: Record<string, string> = { commentary: "Commentary", variance_reason: "Variance reason", corrective_action: "Action" };

function merge(list: DaySeries[]) {
  return list.reduce((a, s) => ({ judged: a.judged + s.judged, up: a.up + s.up, down: a.down + s.down, ok: a.ok + s.ok, unplanned: a.unplanned + s.unplanned }), { judged: 0, up: 0, down: 0, ok: 0, unplanned: 0 });
}

/**
 * One function at a glance, beside its plan-vs-actual table: accuracy, days beyond ±20%, rows off plan (with their own day counts),
 * orders vs order plan where there is one, the top call-outs and the owners' remarks.
 */
export function FunctionTile({ viewKey, total, rows, insights, daily, notes, owners, period }: {
  viewKey: string; total: Row; rows: Row[]; insights: Insight[]; daily: DailyView[]; period?: string | null;
  notes: { code: string; kind: string; body: string; author: string | null; at: string }[]; owners: Record<string, string | null>;
}) {
  const dv = daily.filter((v) => DAILY[viewKey]?.includes(v.key));
  // every day count opens the Detailed view of this function, filtered to the days it counts
  const INWARD = ["category_inward", "prepack", "category_view"];
  const det = (o: { f?: string; l?: string; dev?: "above" | "below" }) => {
    if (!period) return null;
    const p = new URLSearchParams({ flow: INWARD.includes(viewKey) ? "inward" : "outbound", f: o.f ?? viewKey, p: period });
    if (o.l) p.set("l", o.l);
    if (o.dev) p.set("dev", o.dev);
    return `/sop/detailed?${p}`;
  };
  const L = ({ to, className, children }: { to: string | null; className?: string; children: React.ReactNode }) => (to ? <Link href={to} className={cn("hover:underline", className)}>{children}</Link> : <span className={className}>{children}</span>);
  const ov = daily.filter((v) => ORDERS[viewKey]?.includes(v.key));
  const days = dv.length ? merge(dv.map((v) => v.total)) : null;
  const strip = dv.length === 1 ? dv[0]!.total : null;
  const rowDays = new Map<string, DaySeries>();
  for (const v of dv) for (const r of v.rows) rowDays.set(clean(r.label), r.series);
  const orderRows = new Map<string, DaySeries>();
  for (const v of ov) for (const r of v.rows) orderRows.set(clean(r.label), r.series);
  const orderTot = ov.flatMap((v) => v.total.days).reduce((a, d) => ({ plan: a.plan + d.plan, actual: a.actual + d.actual }), { plan: 0, actual: 0 });

  const acc = total.tp > 0 ? Math.max(0, 1 - Math.abs(total.ta - total.tp) / total.tp) : null;
  const off = total.tu != null && Math.abs(total.tu - 1) > DEV_BAND;
  const offRows = rows.filter((r) => !r.kind && r.tp > 0 && r.tu != null && Math.abs(r.tu - 1) > DEV_BAND).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  const unplanned = rows.filter((r) => !r.kind && r.tp === 0 && r.ta > 0);
  // rows on plan for the month but swinging day to day
  const swingy = rows.filter((r) => !r.kind && !offRows.includes(r)).map((r) => ({ r, s: rowDays.get(clean(r.label)) }))
    .filter((x) => x.s && x.s.judged >= 4 && (x.s.up + x.s.down) / x.s.judged >= 0.3);
  const codes = STREAMS[viewKey] ?? [];
  const who = [...new Set(codes.map((c) => owners[c]).filter(Boolean))].join(", ");
  const remarks = notes.filter((n) => codes.includes(n.code)).slice(0, 3);

  return (
    <aside className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 text-[12.5px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-4">Function insight</div>
          {who && <div className="mt-0.5 flex items-center gap-1 text-ink-3"><User size={11} />{who}</div>}
        </div>
        <span className={cn("rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold", off ? "bg-bad-soft text-bad" : "bg-accent-soft text-accent-ink")}>{off ? "Off plan" : "Within ±20%"}</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Accuracy" value={pc(acc)} tone={acc == null ? undefined : acc >= 0.8 ? "ok" : "bad"} />
        <Stat label="Of plan" value={pc(total.tu)} tone={off ? "bad" : "ok"} />
        <Stat label="Variance" value={`${total.gap > 0 ? "+" : total.gap < 0 ? "−" : ""}${fmt(Math.abs(total.gap))}`} />
      </div>

      <div className="rounded-xl bg-subtle/60 p-3">
        <L to={det({})} className="mb-1.5 flex items-center gap-1.5 font-medium text-ink-2"><CalendarDays size={12} />Days beyond ±20%{period && <ArrowUpRight size={11} className="text-ink-4" />}</L>
        {days && days.judged ? (
          <>
            <div className="flex items-baseline gap-3">
              <span className="text-[20px] font-semibold tabular leading-none">{days.up + days.down}<span className="text-[12px] font-normal text-ink-4"> / {days.judged} days</span></span>
              <L to={det({ dev: "above" })} className="text-[#2563eb] tabular">{days.up} above</L>
              <L to={det({ dev: "below" })} className="text-bad tabular">{days.down} below</L>
            </div>
            {strip && <div className="mt-2"><Strip s={strip} small /></div>}
            {days.unplanned > 0 && <div className="mt-1.5 text-warn">{days.unplanned} day{days.unplanned > 1 ? "s" : ""} with volume but no plan</div>}
            {dv.length > 1 && <div className="mt-1.5 space-y-0.5 text-ink-3">{dv.map((v) => <L key={v.key} to={det({})} className="flex justify-between gap-2"><span>{v.title.replace(/^B2C · /, "")}</span><span className="tabular">{v.total.up + v.total.down} / {v.total.judged}</span></L>)}</div>}
          </>
        ) : <div className="text-ink-4">Needs daily actuals (Snowflake refresh) to count days.</div>}
      </div>

      {ov.length > 0 && orderTot.plan > 0 && (
        <div className="rounded-xl bg-subtle/60 p-3">
          <L to={det({ f: "b2c_orders" })} className="mb-1 block font-medium text-ink-2">Orders vs order plan</L>
          <div className="flex items-baseline gap-3 tabular">
            <span>Plan <b className="font-semibold">{fmt(orderTot.plan)}</b></span>
            <span>Actual <b className="font-semibold">{fmt(orderTot.actual)}</b></span>
            <span className={cn("font-semibold", Math.abs(orderTot.actual / orderTot.plan - 1) > DEV_BAND ? "text-bad" : "text-ok")}>{pc(orderTot.actual / orderTot.plan)}</span>
          </div>
          <div className="mt-0.5 text-ink-4">{ov.reduce((a, v) => a + v.total.up + v.total.down, 0)} of {ov.reduce((a, v) => a + v.total.judged, 0)} days beyond ±20% on orders · channels with an order plan only</div>
        </div>
      )}

      {(offRows.length > 0 || unplanned.length > 0 || swingy.length > 0) && (
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 font-medium text-ink-2"><TriangleAlert size={12} />Needs attention</div>
          <ul className="divide-y divide-line/70">
            {offRows.slice(0, 5).map((r) => {
              const s = rowDays.get(clean(r.label)), o = orderRows.get(clean(r.label));
              return (
                <li key={r.label} className="py-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-ink">{r.label}</span>
                    <span className="tabular"><b className="font-semibold text-bad">{pc(r.tu)}</b> <span className="text-ink-4">({r.gap > 0 ? "+" : "−"}{fmt(Math.abs(r.gap))})</span></span>
                  </div>
                  <div className="text-[11.5px] text-ink-4">
                    {r.su != null && r.nu != null ? `South ${pc(r.su)} · North ${pc(r.nu)}` : ""}
                    {s && s.judged ? <> · <L to={det({ l: r.label })}>{s.up + s.down}/{s.judged} days off ({s.up}↑ {s.down}↓)</L></> : ""}
                    {o && o.judged ? ` · orders ${o.up + o.down}/${o.judged} days off` : ""}
                  </div>
                </li>
              );
            })}
            {swingy.slice(0, 3).map(({ r, s }) => (
              <li key={`sw-${r.label}`} className="py-1.5">
                <div className="flex items-baseline justify-between gap-2"><span className="font-medium text-ink">{r.label}</span><span className="tabular text-ink-2">{pc(r.tu)} of plan</span></div>
                <div className="text-[11.5px] text-warn">On plan for the period, but off on {s!.up + s!.down} of {s!.judged} days ({s!.up}↑ {s!.down}↓)</div>
              </li>
            ))}
            {unplanned.slice(0, 3).map((r) => (
              <li key={`un-${r.label}`} className="flex items-baseline justify-between gap-2 py-1.5"><span className="font-medium text-ink">{r.label}</span><span className="text-warn">{fmt(r.ta)} with no plan</span></li>
            ))}
          </ul>
        </div>
      )}

      {insights.length > 0 && (
        <div>
          <div className="mb-1 font-medium text-ink-2">Call-outs</div>
          <ul className="space-y-1.5">
            {insights.slice(0, 3).map((i) => (
              <li key={i.key} className="flex gap-2">
                <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", i.tone === "bad" ? "bg-bad" : i.tone === "warn" ? "bg-warn" : i.tone === "good" ? "bg-ok" : "bg-ink-4")} />
                <span className="text-ink-2"><span className="text-ink">{plain(i.title)}.</span> <span className="text-ink-3">{plain(i.impact)}</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="mb-1 flex items-center gap-1.5 font-medium text-ink-2"><MessageSquareText size={12} />Owner remarks</div>
        {remarks.length ? (
          <ul className="space-y-1.5">
            {remarks.map((n, i) => (
              <li key={i} className="rounded-lg border border-line px-2.5 py-1.5">
                <div className="text-ink-2">{n.body}</div>
                <div className="mt-0.5 text-[11px] text-ink-4">{KIND[n.kind] ?? n.kind}{n.author ? ` · ${n.author}` : ""} · {n.at.slice(0, 10)}</div>
              </li>
            ))}
          </ul>
        ) : <div className="text-ink-4">No remarks yet — owners add them with their inputs (S&OP › Inputs › Commentary).</div>}
      </div>
    </aside>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "bad" }) {
  return (
    <div className="rounded-xl bg-subtle/60 px-2.5 py-2">
      <div className="text-[10.5px] text-ink-4">{label}</div>
      <div className={cn("text-[15px] font-semibold tabular leading-tight", tone === "ok" ? "text-ok" : tone === "bad" ? "text-bad" : "text-ink")}>{value}</div>
    </div>
  );
}
