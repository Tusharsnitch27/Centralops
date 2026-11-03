// S&OP monthly review: view definitions, utilisation maths and top-3 insights (pure; server + client).

export type ViewKey = "b2c" | "b2b_mp" | "retail_fwd" | "liquidation" | "category_inward" | "prepack" | "returns" | "category_view";
export interface ViewDef { key: ViewKey; title: string; sub: string; flow: "outbound" | "inbound"; rowLabel: string; weekly?: boolean; subtotalGroup?: string }
export const VIEWS: ViewDef[] = [
  { key: "b2c", title: "B2C channels", sub: "Item-level orders by channel", flow: "outbound", rowLabel: "Channel", subtotalGroup: "Marketplace" },
  { key: "b2b_mp", title: "B2B-MP channels", sub: "B2B marketplace dispatch by channel", flow: "outbound", rowLabel: "Channel" },
  { key: "retail_fwd", title: "Retail forward", sub: "Store dispatch (NSO + replenishment) by week", flow: "outbound", rowLabel: "Week", weekly: true },
  { key: "liquidation", title: "Liquidation", sub: "Aging / liquidation dispatch plan vs actual by week", flow: "outbound", rowLabel: "Week", weekly: true },
  { key: "category_inward", title: "Category inward", sub: "Inward plan vs received by week", flow: "inbound", rowLabel: "Week", weekly: true },
  { key: "prepack", title: "Pre-pack", sub: "Pre-pack plan vs actual by week", flow: "inbound", rowLabel: "Week", weekly: true },
  // plan from the projection sheet (monthly); actual = return putaway (B2B = final type B2B / store / retail / SOR)
  { key: "returns", title: "Returns", sub: "Units returned (putaway) vs plan · B2C, and B2B from stores + marketplaces", flow: "inbound", rowLabel: "Returns" },
  { key: "category_view", title: "Category-wise inward", sub: "Inward by category", flow: "inbound", rowLabel: "Category" },
];

export interface RawRow { label: string; group: string | null; sp: number; sa: number; np: number; na: number }
export interface Row extends RawRow { tp: number; ta: number; tu: number | null; su: number | null; nu: number | null; gap: number; kind?: "subtotal" | "total" }
/** inventory = total space used; good / bad / other split it (other = blocked + not found + putaway pending). */
export interface WhCap { period: string; warehouse: "South" | "North"; capacity: number; inventory: number | null; good?: number | null; bad?: number | null; other?: number | null;
  /** floor space (pre-pack area): pre-pack stock in pieces (PP4 = 4) + non-apparel stock, against its own capacity */
  special_capacity?: number | null; special?: number | null; prepack_pcs?: number | null }

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
export interface WhPoint { period: string; capacity: number; inventory: number | null; util: number | null; good: number | null; bad: number | null; other: number | null;
  spCap: number | null; special: number | null; prepack: number | null; spUsed: number | null; spUtil: number | null }
export function whSeries(caps: WhCap[]) {
  const months = [...new Set(caps.map((c) => c.period))].sort();
  const n = (v: number | null | undefined) => (v == null ? null : Number(v));
  const pick = (wh: "South" | "North"): WhPoint[] => months.map((p) => {
    const c = caps.find((x) => x.period === p && x.warehouse === wh);
    const inv = n(c?.inventory), spCap = n(c?.special_capacity), special = n(c?.special), prepack = n(c?.prepack_pcs);
    const spUsed = special == null && prepack == null ? null : (special ?? 0) + (prepack ?? 0);
    return { period: p, capacity: Number(c?.capacity ?? 0), inventory: inv, util: inv != null && c?.capacity ? inv / Number(c.capacity) : null, good: n(c?.good), bad: n(c?.bad), other: n(c?.other),
      spCap, special, prepack, spUsed, spUtil: spUsed != null && spCap ? spUsed / spCap : null };
  });
  const S = pick("South"), N = pick("North");
  const add = (a: number | null, b: number | null) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0));
  const T: WhPoint[] = months.map((p, i) => { const inv = add(S[i].inventory, N[i].inventory); const cap = S[i].capacity + N[i].capacity;
    const spCap = add(S[i].spCap, N[i].spCap), spUsed = add(S[i].spUsed, N[i].spUsed);
    return { period: p, capacity: cap, inventory: inv, util: inv != null && cap ? inv / cap : null, good: add(S[i].good, N[i].good), bad: add(S[i].bad, N[i].bad), other: add(S[i].other, N[i].other),
      spCap, special: add(S[i].special, N[i].special), prepack: add(S[i].prepack, N[i].prepack), spUsed, spUtil: spUsed != null && spCap ? spUsed / spCap : null }; });
  return { months, South: S, North: N, Total: T };
}
/** Latest month with inventory for a WH. */
export const latestUtil = (s: WhPoint[]) => [...s].reverse().find((x) => x.util != null) ?? null;

/* ---------- insights ---------- */
export type Seg = string | { b: string; tone?: "bad" | "good" | "warn" };
/** Plan vs actual is highlighted only beyond ±20% — for a flow, a channel / marketplace row, or a day. */
export const DEV_BAND = 0.2;
export interface Insight { key: string; tone: "bad" | "warn" | "good" | "info"; title: Seg[]; impact: Seg[]; score: number }

const n = (v: number) => new Intl.NumberFormat("en-IN").format(Math.round(v));
const k = (v: number) => (Math.abs(v) >= 100000 ? `${(v / 100000).toFixed(2)}L` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}K` : n(v));
const pc = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const sgn = (v: number) => `${v >= 0 ? "+" : "−"}${k(Math.abs(v))}`;

export function viewInsights(v: ViewDef, raw: RawRow[], wh: { South: WhPoint | null; North: WhPoint | null }): Insight[] {
  const rows = raw.map((r) => enrich(r));
  const total = sumRows(raw, "Total", "total");
  const min = Math.max(300, total.tp * 0.005); // small marketplaces still get called out
  const unit = v.flow === "inbound" ? "units" : v.key === "b2c" ? "items" : "units";
  const whAt = (w: "South" | "North") => wh[w];
  const utilBump = (w: "South" | "North", units: number) => { const c = whAt(w); return c && c.capacity ? units / c.capacity : null; };
  const domWh = (r: Row, sign: 1 | -1): "South" | "North" => (sign * (r.sa - r.sp) >= sign * (r.na - r.np) ? "South" : "North");
  const out: Insight[] = [];
  // Sep 2026 onwards comes from Snowflake: no feed yet is a data gap, not "nothing moved" on every row
  if (total.ta === 0 && total.tp > 0) return [{ key: "noactuals", tone: "info", score: 1, title: [{ b: "No actuals yet" }], impact: [`From Sep 2026 actuals come from the Snowflake pipelines — they appear after the next refresh${v.key === "liquidation" ? " (liquidation comes from Malhar's gatepass upload under Inputs)" : ""}.`] }];

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
      if (r.tu > 1 + DEV_BAND) {
        const w = domWh(r, 1), bump = utilBump(w, v.flow === "inbound" ? Math.max(0, w === "South" ? r.sa - r.sp : r.na - r.np) : 0);
        const wU = w === "South" ? r.su : r.nu;
        out.push({ key: `${r.label}:over`, tone: r.tu >= 1.5 ? "bad" : "warn", score: r.gap * (r.tu >= 1.5 ? 1.2 : 1),
          title: [{ b: what }, ` at `, { b: pc(r.tu), tone: "bad" }, ` of plan (`, { b: sgn(r.gap) }, ` ${unit}), led by ${w} (`, { b: pc(wU) }, `)`],
          impact: v.flow === "inbound"
            ? ([`Extra inward lifts ${w} WH utilisation by ~`, { b: pc(bump), tone: "warn" }, ...(whAt(w)?.util != null ? [` — already at `, { b: pc(whAt(w)!.util), tone: ((whAt(w)!.util ?? 0) > 0.9 ? "bad" : "warn") as "bad" | "warn" }, `.`] : ["."])] as Seg[])
            : [`Pick/pack load above plan at ${w} — check manpower/OT and dispatch SLA; raise next month’s projection.`] });
      } else if (r.tu < 1 - DEV_BAND) {
        const w = domWh(r, -1);
        out.push({ key: `${r.label}:under`, tone: r.tu <= 0.5 ? "bad" : "warn", score: -r.gap * (r.tu <= 0.5 ? 1.15 : 1),
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
    // space that isn't sellable: bad stock and stock stuck in blocked / not found / putaway pending
    const used = cur.inventory ?? 0;
    if (used > 0 && cur.bad != null && cur.bad / used >= 0.02) {
      const sh = cur.bad / used, pb = prev?.bad != null && prev.inventory ? prev.bad / prev.inventory : null;
      out.push({ key: `${w}:bad`, tone: sh >= 0.05 ? "bad" : "warn", score: sh * 4,
        title: [`${w}: `, { b: `${k(cur.bad)} bad units`, tone: "bad" }, ` take `, { b: pc(sh) }, ` of used space`, ...(pb != null ? [` (${sh >= pb ? "up" : "down"} from ${pc(pb)})`] : [])],
        impact: [`Liquidate / RTV the bad stock to free `, { b: pc(cur.bad / (cur.capacity || 1)) }, ` of ${w} capacity.`] });
    }
    if (used > 0 && cur.other != null && cur.other / used >= 0.03) {
      const sh = cur.other / used;
      out.push({ key: `${w}:other`, tone: sh >= 0.08 ? "bad" : "warn", score: sh * 3,
        title: [`${w}: `, { b: `${k(cur.other)} units`, tone: "warn" }, ` blocked, not found or waiting for putaway (`, { b: pc(sh) }, ` of used space)`],
        impact: [`Clear the putaway backlog, trace not-found stock and unblock it — it fills space without being sellable.`] });
    }
  }
  return out;
}

/* ---------- month-on-month ---------- */
/** Total utilisation (actual ÷ plan) per view per month. */
export const isShopify = (label: string) => /^shopify/i.test(label);
/** Rows of the month-on-month table: every view, with B2C split into Shopify and the marketplaces. */
type TrendRow = { key: string; title: string; view: string; match?: (label: string) => boolean };
const TREND_ROWS: TrendRow[] = VIEWS.flatMap((v): TrendRow[] => v.key === "b2c"
  ? [{ key: "b2c_sf", title: "B2C · Shopify", view: "b2c", match: isShopify }, { key: "b2c_mp", title: "B2C · Marketplaces", view: "b2c", match: (l: string) => !isShopify(l) }]
  : [{ key: v.key, title: v.title, view: v.key }]);
export function trendTable(rows: { view_key: string; row_label: string; period: string; sp: number; sa: number; np: number; na: number }[]) {
  const periods = [...new Set(rows.map((r) => r.period))].sort();
  return TREND_ROWS.map((v) => ({
    def: { key: v.key, title: v.title },
    cells: periods.map((p) => {
      const rs = rows.filter((r) => r.view_key === v.view && r.period === p && (!v.match || v.match(r.row_label)));
      if (!rs.length) return null;
      const plan = rs.reduce((a, r) => a + r.sp + r.np, 0), actual = rs.reduce((a, r) => a + r.sa + r.na, 0);
      return { period: p, plan, actual, util: plan > 0 ? actual / plan : null };
    }),
  })).filter((r) => r.cells.some(Boolean)).map((r) => ({ ...r, periods }));
}

/* ---------- inventory flow (opening → closing) ---------- */
export interface FlowRow { period: string; warehouse: "South" | "North"; capacity: number; opening: number; inward_category: number; inward_returns: number; outward: number; closing: number }
export interface FlowCalc extends FlowRow { inward: number; utilOpen: number; utilClose: number; build: number; buildPct: number | null; inOut: number | null }
export function flowCalc(r: FlowRow): FlowCalc {
  const inward = (r.inward_category ?? 0) + (r.inward_returns ?? 0);
  return { ...r, inward, utilOpen: r.capacity ? r.opening / r.capacity : 0, utilClose: r.capacity ? r.closing / r.capacity : 0,
    build: r.closing - r.opening, buildPct: r.opening ? (r.closing - r.opening) / r.opening : null, inOut: r.outward ? inward / r.outward : null };
}
export function flowInsights(rows: FlowCalc[]): Insight[] {
  const out: Insight[] = [];
  for (const r of rows) {
    const mon = new Date(`${r.period}T00:00:00Z`).toLocaleString("en-IN", { month: "short", timeZone: "UTC" });
    if (r.utilClose >= 1) out.push({ key: `${r.warehouse}:over`, tone: "bad", score: 10 + r.utilClose,
      title: [`${r.warehouse} WH closes ${mon} at `, { b: pc(r.utilClose), tone: "bad" }, ` of capacity (`, { b: `${k(r.closing - r.capacity)} over`, tone: "bad" }, `)`],
      impact: [`Inward `, { b: k(r.inward) }, ` vs outward `, { b: k(r.outward) }, ` — hold or re-route inward, push liquidation and outbound before the next inward wave.`] });
    else if (r.utilClose >= 0.9) out.push({ key: `${r.warehouse}:tight`, tone: "warn", score: 5 + r.utilClose,
      title: [`${r.warehouse} WH closes ${mon} at `, { b: pc(r.utilClose), tone: "warn" }],
      impact: [`Headroom `, { b: `${k(r.capacity - r.closing)} units` }, ` — plan the next month’s inward against it.`] });
    if (r.inOut != null && r.inOut >= 1.3 && r.build > 0) out.push({ key: `${r.warehouse}:build`, tone: r.inOut >= 1.6 ? "bad" : "warn", score: 3 + r.inOut,
      title: [`${r.warehouse}: inward is `, { b: `${r.inOut.toFixed(2)}×`, tone: "warn" }, ` outward — inventory up `, { b: sgn(r.build) }, r.buildPct != null ? ` (${pc(r.buildPct)})` : ""],
      impact: [`Returns are `, { b: k(r.inward_returns) }, ` of the inward. Outbound throughput is the lever — check pick/pack capacity and channel dispatch.`] });
  }
  const seen = new Set<string>();
  return out.sort((a, b) => b.score - a.score).filter((i) => { const w = i.key.split(":")[0]; const key = `${w}:${i.key.endsWith("build") ? "b" : "u"}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 3);
}

/* ---------- returns ---------- */
export interface ReturnsRow { period: string; warehouse: "South" | "North"; b2c: number | null; b2b: number | null; fwd_b2c: number | null; fwd_retail: number | null }
export const returnRate = (ret: number | null, fwd: number | null) => (ret != null && fwd ? ret / fwd : null);
export function returnsInsights(rows: ReturnsRow[]): Insight[] {
  const months = [...new Set(rows.map((r) => r.period))].sort();
  const withFwd = months.filter((p) => rows.some((r) => r.period === p && r.fwd_b2c));
  const out: Insight[] = [];
  const last = withFwd.at(-1), prev = withFwd.at(-2);
  for (const w of ["South", "North"] as const) {
    const cur = rows.find((r) => r.period === last && r.warehouse === w), before = rows.find((r) => r.period === prev && r.warehouse === w);
    if (!cur) continue;
    const rr = returnRate(cur.b2c, cur.fwd_b2c), pr = before ? returnRate(before.b2c, before.fwd_b2c) : null;
    const br = returnRate(cur.b2b, cur.fwd_retail);
    const mon = new Date(`${cur.period}T00:00:00Z`).toLocaleString("en-IN", { month: "short", timeZone: "UTC" });
    if (rr != null) out.push({ key: `${w}:b2c`, tone: rr >= 0.4 ? "bad" : rr >= 0.3 ? "warn" : "info", score: rr * 10,
      title: [`${w} B2C returns `, { b: pc(rr), tone: rr >= 0.35 ? "bad" : "warn" }, ` of forward in ${mon}`, ...(pr != null ? [` (`, { b: `${((rr - pr) * 100).toFixed(1)} pts`, tone: rr > pr ? "bad" as const : "good" as const }, ` MoM)`] : [])],
      impact: [{ b: k(cur.b2c ?? 0) }, ` units came back into ${w} — they need QC and re-inward capacity, and add to utilisation.`] });
    if (br != null && br >= 0.15) out.push({ key: `${w}:b2b`, tone: br >= 0.3 ? "warn" : "info", score: br * 6,
      title: [`${w} store returns `, { b: pc(br), tone: "warn" }, ` of retail forward in ${mon}`],
      impact: [{ b: k(cur.b2b ?? 0) }, ` units back from stores — review the replenishment rulebook for over-allocation.`] });
  }
  // latest month without forward split: volume trend
  const latest = months.at(-1);
  if (latest && latest !== last) {
    const tot = rows.filter((r) => r.period === latest).reduce((a, r) => a + (r.b2c ?? 0) + (r.b2b ?? 0), 0);
    const mon = new Date(`${latest}T00:00:00Z`).toLocaleString("en-IN", { month: "short", timeZone: "UTC" });
    out.push({ key: "latest", tone: "info", score: 1, title: [{ b: k(tot) }, ` units returned in ${mon} (both WHs)`], impact: [`Forward split not in yet — return rate will show once forward volumes are added.`] });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}

/* ---------- overall accuracy ---------- */
/** Forecast accuracy: 1 − |actual − plan| ÷ plan (0 when off by 100%+); null without a plan. */
export const accuracy = (plan: number, actual: number) => (plan > 0 ? Math.max(0, 1 - Math.abs(actual - plan) / plan) : null);
export interface OverallRow { key: string; label: string; flow: "Inwards" | "Outwards" | "Returns"; kind?: "subtotal" | "total"; sp: number; sa: number; np: number; na: number; tp: number; ta: number; dev: number; devPct: number | null; acc: number | null; sAcc: number | null; nAcc: number | null }
const OVERALL: { key: ViewKey | "b2c_sf" | "b2c_mp" | "returns_b2c" | "returns_b2b"; label: string; flow: OverallRow["flow"] }[] = [
  { key: "category_inward", label: "Category inward", flow: "Inwards" },
  { key: "prepack", label: "Pre-pack", flow: "Inwards" },
  { key: "b2c_sf", label: "B2C · Shopify", flow: "Outwards" },
  { key: "b2c_mp", label: "B2C · Marketplaces", flow: "Outwards" },
  { key: "b2b_mp", label: "B2B · Marketplace", flow: "Outwards" },
  { key: "retail_fwd", label: "B2B · Retail stores", flow: "Outwards" },
  { key: "liquidation", label: "Liquidation", flow: "Outwards" },
  { key: "returns_b2c", label: "B2C returns", flow: "Returns" },
  { key: "returns_b2b", label: "B2B returns", flow: "Returns" },
];
const mk = (key: string, label: string, flow: OverallRow["flow"], s: { sp: number; sa: number; np: number; na: number }, kind?: OverallRow["kind"]): OverallRow => {
  const tp = s.sp + s.np, ta = s.sa + s.na;
  return { key, label, flow, kind, ...s, tp, ta, dev: ta - tp, devPct: tp > 0 ? (ta - tp) / tp : null, acc: accuracy(tp, ta), sAcc: accuracy(s.sp, s.sa), nAcc: accuracy(s.np, s.na) };
};
/** One row per flow (inwards / outwards by channel) from each view's total, plus subtotals. */
export function overallTable(views: { def: ViewDef; rows: Row[] }[]): OverallRow[] {
  const out: OverallRow[] = [];
  for (const flow of ["Inwards", "Outwards", "Returns"] as const) {
    const part: OverallRow[] = [];
    for (const o of OVERALL.filter((x) => x.flow === flow)) {
      // B2C splits into Shopify and the marketplaces
      const t = o.key === "b2c_sf" || o.key === "b2c_mp"
        ? (views.find((v) => v.def.key === "b2c")?.rows ?? []).filter((r) => !r.kind && (o.key === "b2c_sf") === isShopify(r.label)).reduce((a, r) => ({ sp: a.sp + r.sp, sa: a.sa + r.sa, np: a.np + r.np, na: a.na + r.na, tp: a.tp + r.tp, ta: a.ta + r.ta }), { sp: 0, sa: 0, np: 0, na: 0, tp: 0, ta: 0 })
        : o.key === "returns_b2c" || o.key === "returns_b2b"
          ? views.find((v) => v.def.key === "returns")?.rows.find((r) => !r.kind && r.label === o.label)
          : views.find((v) => v.def.key === o.key)?.rows.find((r) => r.kind === "total");
      if (t && (t.tp > 0 || t.ta > 0)) part.push(mk(o.key, o.label, flow, { sp: t.sp, sa: t.sa, np: t.np, na: t.na }));
    }
    if (!part.length) continue;
    out.push(...part);
    const sum = part.reduce((a, r) => ({ sp: a.sp + r.sp, sa: a.sa + r.sa, np: a.np + r.np, na: a.na + r.na }), { sp: 0, sa: 0, np: 0, na: 0 });
    out.push(mk(`${flow}:total`, `Total ${flow.toLowerCase()}`, flow, sum, "subtotal")); // Returns → overall returns
  }
  return out;
}
