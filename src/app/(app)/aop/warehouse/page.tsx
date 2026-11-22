import Link from "next/link";
import { EmptyState } from "@/components/ui";
import { AopHeader } from "@/components/aop/AopNav";
import { monLabel, Section } from "@/components/aop/processing/bits";
import { requireUser } from "@/server/auth";
import { listCycles, resolveCycle } from "@/server/aop/model";
import { currentSnapshot, wcmMonth, wcmMonths, type WcmMonth } from "@/server/wcm/queries";
import { FAMILY_LABEL, SITES, type Family, type Site } from "@/server/wcm/math";
import { inr } from "@/lib/format";
import { storageView } from "@/server/wcm/storage";
import { cn } from "@/lib/cn";

export const metadata = { title: "AOP · Warehouse" };
type SP = { month?: string; site?: string; cycle?: string };

const nf = (v: number) => new Intl.NumberFormat("en-IN").format(Math.round(v));
const FAMILIES: Family[] = ["warehousing", "manpower", "ot", "packaging"];

/** Cost heads of one month: family × head → ₹ (null = every line missing). */
function byHead(m: WcmMonth) {
  const out = new Map<string, { family: Family; head: string; amount: number | null }>();
  for (const l of m.lines) {
    const k = `${l.family}|${l.head}`, cur = out.get(k) ?? { family: l.family as Family, head: l.head, amount: null };
    if (l.amount != null) cur.amount = (cur.amount ?? 0) + l.amount;
    out.set(k, cur);
  }
  return out;
}

/** AOP › Warehouse: booked spend vs budget by cost head, and what holding stock costs by category. */
export default async function WarehousePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  await requireUser();
  const [cycles, cycle, snap] = await Promise.all([listCycles(), resolveCycle(sp.cycle), currentSnapshot()]);
  const header = <AopHeader active="warehouse" cycleId={cycle?.id ?? null} cycles={cycles} title="Warehouse"
    actions={<Link href="/aop/warehouse/3pl" className="text-[12.5px] text-ink-3 hover:text-ink">3PL comparison →</Link>} />;
  if (!snap) return <div className="animate-fade-in">{header}<div className="card"><EmptyState title="No Cost Master loaded" /></div></div>;

  const months = await wcmMonths(snap.id);
  const month = sp.month && months.includes(sp.month) ? sp.month : months.filter((m) => m < new Date().toISOString().slice(0, 7) + "-01").at(-1) ?? months.at(-1)!;
  const site: Site = (SITES as readonly string[]).includes(sp.site ?? "") ? (sp.site as Site) : "Both";
  const href = (o: Partial<SP>) => `/aop/warehouse?${new URLSearchParams(Object.entries({ cycle: cycles.length > 1 ? cycle?.id : undefined, month, site, ...o }).filter(([, v]) => v) as [string, string][])}`;
  const [act, bud, stor] = await Promise.all([wcmMonth(snap.id, month, site, "actual"), wcmMonth(snap.id, month, site, "budget"), storageView([month])]);
  const a = byHead(act), b = byHead(bud);
  const heads = [...new Set([...a.keys(), ...b.keys()])].map((k) => ({ k, family: (a.get(k) ?? b.get(k))!.family, head: (a.get(k) ?? b.get(k))!.head, actual: a.get(k)?.amount ?? null, budget: b.get(k)?.amount ?? null }));
  const famTot = (f: Family, which: "actual" | "budget") => { const xs = heads.filter((h) => h.family === f && h[which] != null); return xs.length ? xs.reduce((s, h) => s + h[which]!, 0) : null; };
  const total = (which: "actual" | "budget") => { const xs = FAMILIES.map((f) => famTot(f, which)).filter((x): x is number => x != null); return xs.length ? xs.reduce((s, x) => s + x, 0) : null; };
  const tA = total("actual"), tB = total("budget");
  const sites = stor.months.filter((x) => site === "Both" || x.site === site);

  return (
    <div className="animate-fade-in">
      {header}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="seg"><span className="seg-label">Site</span>{SITES.map((s) => <Link key={s} href={href({ site: s })} data-on={site === s} className="seg-item">{s}</Link>)}</div>
        <div className="ml-auto flex flex-wrap gap-1">{months.map((p) => (
          <Link key={p} href={href({ month: p })} className={cn("rounded-md px-2 py-1 text-[12px]", p === month ? "bg-ink text-white" : "text-ink-3 ring-1 ring-inset ring-line hover:text-ink")}>{monLabel(p)}</Link>))}</div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label={`Spend · ${monLabel(month)}`} value={inr(tA)} sub={act.total.missing ? `${act.total.missing} lines not booked yet` : site} />
        <Tile label="Budget" value={inr(tB)} sub={tA != null && tB ? `${Math.round((tA / tB) * 100)}% used` : undefined} />
        <Tile label="Over / under budget" value={tA != null && tB != null ? inr(tA - tB, { sign: true }) : "—"} tone={tA != null && tB != null ? (tA > tB ? "text-bad" : "text-ok") : undefined} />
        <Tile label="Storage & handling per item" value={sites.map((x) => (x.perItem == null ? "—" : `₹${x.perItem.toFixed(2)}`)).join(" · ")} sub={sites.map((x) => x.site).join(" · ")} />
      </div>

      <div className="space-y-3">
        <Section open title="Cost by head" summary={<span className="tabular text-white/80">{inr(tA)} of {inr(tB)}</span>}>
          <div className="overflow-x-auto"><table className="table-base min-w-[640px]">
            <thead><tr><th>Cost head</th><th className="text-right">Actual</th><th className="text-right">Budget</th><th className="text-right">Over / under</th></tr></thead>
            <tbody>{FAMILIES.filter((f) => heads.some((h) => h.family === f)).map((f) => {
              const fa = famTot(f, "actual"), fb = famTot(f, "budget");
              return [
                <tr key={f} className="bg-subtle/70 font-semibold"><td>{FAMILY_LABEL[f]}</td><td className="text-right tabular">{inr(fa)}</td><td className="text-right tabular">{inr(fb)}</td><Var a={fa} b={fb} /></tr>,
                ...heads.filter((h) => h.family === f).sort((x, y) => (y.actual ?? 0) - (x.actual ?? 0)).map((h) => (
                  <tr key={h.k}><td className="pl-6 text-ink-2">{h.head}</td><td className={cn("text-right tabular", h.actual == null && "text-ink-4")}>{h.actual == null ? "not booked" : inr(h.actual)}</td>
                    <td className="text-right tabular text-ink-3">{inr(h.budget)}</td><Var a={h.actual} b={h.budget} /></tr>)),
              ];
            })}
              <tr className="font-semibold"><td>Total</td><td className="text-right tabular">{inr(tA)}</td><td className="text-right tabular">{inr(tB)}</td><Var a={tA} b={tB} /></tr></tbody>
          </table></div>
        </Section>

        <Section open title="Storage & handling by category" sub={monLabel(month)}>
          <div className="grid gap-4 p-3 lg:grid-cols-2">
            {sites.map((x) => {
              const top = x.categories.slice(0, 10), rest = x.categories.slice(10);
              const restRow = rest.length ? { category: `${rest.length} other categories`, avgUnits: rest.reduce((s, c) => s + c.avgUnits, 0), bins: rest.reduce((s, c) => s + c.bins, 0), holding: x.sh != null && x.bins ? (x.sh * rest.reduce((s, c) => s + c.bins, 0)) / x.bins : null } : null;
              return (
                <div key={x.site} className="rounded-lg border border-line">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-3 py-2.5">
                    <div className="text-[13.5px] font-semibold">{x.site}</div>
                    <div className="text-[12px] text-ink-3">{x.sh == null ? "not booked yet" : <>{inr(x.sh)} · <b className="font-semibold text-ink">{x.perItem == null ? "—" : `₹${x.perItem.toFixed(2)}`}</b> per item · ₹{x.perBin == null ? "—" : x.perBin.toFixed(0)} per bin</>}</div>
                  </div>
                  {x.categories.length ? <div style={{ overflowX: "auto" }}><table className="table-base min-w-[460px]">
                    <thead><tr><th>Category</th><th className="text-right">Avg units</th><th className="text-right">Bins</th><th className="text-right">₹</th><th className="text-right">₹ / unit</th></tr></thead>
                    <tbody>{[...top, ...(restRow ? [restRow] : [])].map((c) => (
                      <tr key={c.category}><td className="font-medium">{c.category}</td><td className="text-right tabular">{nf(c.avgUnits)}</td><td className="text-right tabular">{nf(c.bins)}</td>
                        <td className="text-right tabular">{c.holding == null ? "—" : inr(c.holding)}</td><td className="text-right tabular">{c.holding == null || !c.avgUnits ? "—" : `₹${(c.holding / c.avgUnits).toFixed(2)}`}</td></tr>))}</tbody>
                  </table></div> : <p className="px-3 py-2.5 text-[12.5px] text-ink-4">Inventory by category not loaded yet.</p>}
                </div>
              );
            })}
          </div>
        </Section>
      </div>
    </div>
  );
}

function Var({ a, b }: { a: number | null; b: number | null }) {
  if (a == null || b == null) return <td className="text-right text-ink-4">—</td>;
  const d = a - b;
  return <td className={cn("text-right tabular", Math.abs(d) < 1 ? "text-ink-3" : d > 0 ? "text-bad" : "text-ok")}>{inr(d, { sign: true })}</td>;
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="card px-3 py-2.5">
      <div className="text-[11px] text-ink-4">{label}</div>
      <div className={cn("text-[20px] font-semibold leading-tight tabular", tone)}>{value}</div>
      {sub && <div className="text-[11px] text-ink-4">{sub}</div>}
    </div>
  );
}
