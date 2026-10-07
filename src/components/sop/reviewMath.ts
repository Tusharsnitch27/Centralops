// S&OP monthly review: view definitions, utilisation maths and top-3 insights (pure; server + client).

export type ViewKey = "b2c" | "b2b_mp" | "retail_fwd" | "category_inward" | "prepack" | "category_view";
export interface ViewDef { key: ViewKey; title: string; sub: string; flow: "outbound" | "inbound"; rowLabel: string; weekly?: boolean; subtotalGroup?: string }
export const VIEWS: ViewDef[] = [
  { key: "b2c", title: "B2C channels", sub: "Item-level orders by channel", flow: "outbound", rowLabel: "Channel", subtotalGroup: "Marketplace" },
  { key: "b2b_mp", title: "B2B-MP channels", sub: "B2B marketplace dispatch by channel", flow: "outbound", rowLabel: "Channel" },
  { key: "retail_fwd", title: "Retail forward", sub: "Store dispatch (NSO + replenishment) by week", flow: "outbound", rowLabel: "Week", weekly: true },
  { key: "category_inward", title: "Category inward", sub: "Inward plan vs received by week", flow: "inbound", rowLabel: "Week", weekly: true },
  { key: "prepack", title: "Pre-pack", sub: "Pre-pack plan vs actual by week", flow: "inbound", rowLabel: "Week", weekly: true },
  { key: "category_view", title: "Category-wise inward", sub: "Inward by category", flow: "inbound", rowLabel: "Category" },
];

export interface RawRow { label: string; group: string | null; sp: number; sa: number; np: number; na: number }
export interface Row extends RawRow { tp: number; ta: number; tu: number | null; su: number | null; nu: number | null; gap: number; kind?: "subtotal" | "total" }
export interface WhCap { period: string; warehouse: "South" | "North"; capacity: number; inventory: number | null }

const u = (a: number, p: number) => (p > 0 ? a / p : null);
export function enrich(r: RawRow, kind?: Row["kind"]): Row {
  const tp = r.sp + r.np, ta = r.sa + r.na;
  return { ...r, tp, ta, tu: u(ta, tp), su: u(r.sa, r.sp), nu: u(r.na, r.np), gap: ta - tp, kind };
}
export function sumRows(rows: RawRow[], label: string, kind: Row["kind"]): Row {
  const s = rows.reduce((a, r) => ({ sp: a.sp + r.sp, sa: a.sa + r.sa, np: a.np + r.np, na: a.na + r.na }), { sp: 0, sa: 0, np: 0, na: 0 });
  return enrich({ label, group: null, ...s }, kind);
}

/** Display rows: data rows, optional subtotal of a group (e.g. Marketplace), grand total. */
export function tableRows(v: ViewDef, raw: RawRow[]): Row[] {
  const rows = raw.map((r) => enrich(r));
  const out: Row[] = [];
  if (v.subtotalGroup) {
    const g = raw.filter((r) => r.group === v.subtotalGroup);
    out.push(...rows.filter((r) => r.group === v.subtotalGroup), sumRows(g, `${v.subtotalGroup} total`, "subtotal"), ...rows.filter((r) => r.group !== v.subtotalGroup));
  } else out.push(...rows);
  out.push(sumRows(raw, "Total", "total"));
  return out;
}

/* ---------- warehouse utilisation ---------- */
export interface WhPoint { period: string; capacity: number; inventory: number | null; util: number | null }
export function whSeries(caps: WhCap[]) {
  const months = [...new Set(caps.map((c) => c.period))].sort();
  const pick = (wh: "South" | "North") => months.map((p) => { const c = caps.find((x) => x.period === p && x.warehouse === wh); return { period: p, capacity: c?.capacity ?? 0, inventory: c?.inventory ?? null, util: c?.inventory != null && c.capacity ? c.inventory / c.capacity : null }; });
  const S = pick("South"), N = pick("North");
  const T = months.map((p, i) => { const inv = S[i].inventory != null || N[i].inventory != null ? (S[i].inventory ?? 0) + (N[i].inventory ?? 0) : null; const cap = S[i].capacity + N[i].capacity; return { period: p, capacity: cap, inventory: inv, util: inv != null && cap ? inv / cap : null }; });
  return { months, South: S, North: N, Total: T };
}
/** Latest month with inventory for a WH. */
export const latestUtil = (s: WhPoint[]) => [...s].reverse().find((x) => x.util != null) ?? null;

/* ---------- insights ---------- */
export type Seg = string | { b: string; tone?: "bad" | "good" | "warn" };
export interface Insight { key: string; tone: "bad" | "warn" | "good" | "info"; title: Seg[]; impact: Seg[]; score: number }

const n = (v: number) => new Intl.NumberFormat("en-IN").format(Math.round(v));
const k = (v: number) => (Math.abs(v) >= 100000 ? `${(v / 100000).toFixed(2)}L` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}K` : n(v));
const pc = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const sgn = (v: number) => `${v >= 0 ? "+" : "−"}${k(Math.abs(v))}`;

export function viewInsights(v: ViewDef, raw: RawRow[], wh: { South: WhPoint | null; North: WhPoint | null }): Insight[] {
  const rows = raw.map((r) => enrich(r));
  const total = sumRows(raw, "Total", "total");
  const min = Math.max(1000, total.tp * 0.01);
  const unit = v.flow === "inbound" ? "units" : v.key === "b2c" ? "items" : "units";
  const whAt = (w: "South" | "North") => wh[w];
  const utilBump = (w: "South" | "North", units: number) => { const c = whAt(w); return c && c.capacity ? units / c.capacity : null; };
  const domWh = (r: Row, sign: 1 | -1): "South" | "North" => (sign * (r.sa - r.sp) >= sign * (r.na - r.np) ? "South" : "North");
  const out: Insight[] = [];

  for (const r of rows) {
    const what = v.weekly ? r.label.replace("Wk_0", "Week ").replace("Wk_", "Week ") : r.label;
    if (r.tp === 0 && r.ta >= min) {
      const w = r.sa >= r.na ? "South" : "North", bump = utilBump(w, v.flow === "inbound" ? r.ta : 0);
      out.push({ key: `${r.label}:unplanned`, tone: "warn", score: r.ta * 1.1,
        title: [{ b: what }, `: `, { b: `${k(r.ta)} ${unit}`, tone: "warn" }, ` with `, { b: "no plan" }],
        impact: v.flow === "inbound"
          ? [`Unplanned stock — adds ~`, { b: pc(bump), tone: "warn" }, ` to ${w} WH utilisation${whAt(w)?.util != null ? ` (at ${pc(whAt(w)!.util)})` : ""}. Add it to next month’s projection.`]
          : [`Volume outside the capacity plan — capture it in next month’s projection.`] });
      continue;
    }
    if (r.tp >= min && r.ta === 0) {
      out.push({ key: `${r.label}:none`, tone: "warn", score: r.tp * 0.9,
        title: [{ b: what }, `: `, { b: `${k(r.tp)} planned` }, `, `, { b: "nothing moved", tone: "bad" }],
        impact: [v.flow === "inbound" ? `Inward didn’t happen — confirm if the PO slipped or was cancelled; frees planned space.` : `Channel planned but inactive — confirm with the channel owner; release the reserved capacity.`] });
      continue;
    }
    if (r.tp > 0 && r.tu != null && Math.abs(r.gap) >= min) {
      if (r.tu >= 1.15) {
        const w = domWh(r, 1), bump = utilBump(w, v.flow === "inbound" ? Math.max(0, w === "South" ? r.sa - r.sp : r.na - r.np) : 0);
        const wU = w === "South" ? r.su : r.nu;
        out.push({ key: `${r.label}:over`, tone: r.tu >= 1.4 ? "bad" : "warn", score: r.gap * (r.tu >= 1.4 ? 1.2 : 1),
          title: [{ b: what }, ` at `, { b: pc(r.tu), tone: "bad" }, ` of plan (`, { b: sgn(r.gap) }, ` ${unit}), led by ${w} (`, { b: pc(wU) }, `)`],
          impact: v.flow === "inbound"
            ? ([`Extra inward lifts ${w} WH utilisation by ~`, { b: pc(bump), tone: "warn" }, ...(whAt(w)?.util != null ? [` — already at `, { b: pc(whAt(w)!.util), tone: ((whAt(w)!.util ?? 0) > 0.9 ? "bad" : "warn") as "bad" | "warn" }, `.`] : ["."])] as Seg[])
            : [`Pick/pack load above plan at ${w} — check manpower/OT and dispatch SLA; raise next month’s projection.`] });
      } else if (r.tu <= 0.85) {
        const w = domWh(r, -1);
        out.push({ key: `${r.label}:under`, tone: r.tu <= 0.6 ? "bad" : "warn", score: -r.gap * (r.tu <= 0.6 ? 1.15 : 1),
          title: [{ b: what }, ` at `, { b: pc(r.tu), tone: "bad" }, ` of plan (`, { b: sgn(r.gap) }, ` ${unit}), weakest in ${w} (`, { b: pc(w === "South" ? r.su : r.nu) }, `)`],
          impact: v.flow === "inbound"
            ? [`Inward behind plan — stock for these SKUs may run short; chase vendor/PO timelines.`]
            : [`Projection overstated by `, { b: k(-r.gap) }, ` — capacity and manpower were planned for volume that didn’t come. Re-forecast next month.`] });
      }
    }
    if (r.sp > 0 && r.np > 0 && r.su != null && r.nu != null && Math.abs(r.su - r.nu) >= 0.4) {
      const hi = r.su > r.nu ? "South" : "North", lo = hi === "South" ? "North" : "South";
      const g = Math.max(Math.abs(r.sa - r.sp), Math.abs(r.na - r.np));
      const extreme = Math.max(r.su, r.nu) >= 1.4 || Math.min(r.su, r.nu) <= 0.5;
      if (g >= min) out.push({ key: `${r.label}:skew`, tone: extreme ? "warn" : "info", score: g * (extreme ? 1.25 : 0.8),
        title: [{ b: what }, ` skewed to ${hi}: `, { b: pc(hi === "South" ? r.su : r.nu) }, ` vs ${lo} `, { b: pc(lo === "South" ? r.su : r.nu) }],
        impact: [`Volume moved between warehouses — rebalance the ${v.flow === "inbound" ? "inward" : "dispatch"} split${whAt(hi)?.util != null ? ` (${hi} WH at ${pc(whAt(hi)!.util)})` : ""}.`] });
    }
  }
  // weekly back-loading
  if (v.weekly && raw.length >= 4 && total.tp > 0) {
    const last = enrich(raw[raw.length - 1]);
    const share = last.tp / total.tp;
    if (share >= 0.35) out.push({ key: "backload", tone: "info", score: total.tp * share * 0.5,
      title: [`Plan is back-loaded: `, { b: `${pc(share)} of the month in ${last.label.replace("Wk_0", "Week ")}` }],
      impact: [`Late-month peaks strain capacity — ${last.tu != null && last.tu < 0.7 ? "and it under-delivered, so the shortfall rolls into next month." : "smooth the plan across weeks."}`] });
  }
  const seen = new Set<string>();
  return out.sort((a, b) => b.score - a.score).filter((i) => { const r = i.key.split(":")[0]; if (seen.has(r)) return false; seen.add(r); return true; }).slice(0, 3);
}

export function whInsights(s: ReturnType<typeof whSeries>): Insight[] {
  const out: Insight[] = [];
  for (const w of ["South", "North"] as const) {
    const pts = s[w].filter((p) => p.util != null);
    if (!pts.length) continue;
    const cur = pts[pts.length - 1], prev = pts[pts.length - 2];
    const head = cur.capacity - (cur.inventory ?? 0);
    const mon = new Date(`${cur.period}T00:00:00Z`).toLocaleString("en-IN", { month: "short", timeZone: "UTC" });
    out.push({ key: w, tone: (cur.util ?? 0) >= 0.9 ? "bad" : (cur.util ?? 0) >= 0.8 ? "warn" : "good", score: cur.util ?? 0,
      title: [`${w} WH at `, { b: pc(cur.util), tone: (cur.util ?? 0) >= 0.9 ? "bad" : "warn" }, ` in ${mon}`, ...(prev ? [` (`, { b: `${(((cur.util ?? 0) - (prev.util ?? 0)) * 100).toFixed(1)} pts`, tone: (cur.util ?? 0) < (prev.util ?? 0) ? "good" as const : "bad" as const }, ` vs last month)`] : [])],
      impact: [`Headroom `, { b: `${k(head)} units` }, (cur.util ?? 0) >= 0.9 ? ` — little room for OND peak inward; prioritise liquidation / North allocation.` : ` before hitting capacity.`] });
  }
  return out;
}
