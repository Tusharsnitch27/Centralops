import "server-only";
import { q } from "../db";
import { computeRow, rollupStream } from "./processingMath";
import { OVERHEAD_DEPTS, STREAMS, type AttributionRow, type MpAssignment, type ProcessingMonth, type ProcRow, type StreamKey, type Wh } from "./processingTypes";

/**
 * Warehouse processing cost: S&OP projection → planned MP → actual MP & adherence → cost per item, per stream × process.
 * Source per number (first that has it):
 *  - projection / planned MP / final output: the Cost Master processing tabs for the months they cover (Oct'25–Oct'26 forward,
 *    Oct–Dec'25 returns / inward / inventory) — the sheet stays the source of truth where it has a figure; then S&OP plan / actuals;
 *    Inventory has no S&OP volume, so its last sheet month carries forward.
 *  - actual MP: sheet planned MP (= heads deployed) for sheet months; from 29 Oct 2026 the attendance API, which has only
 *    departments, so heads are split to stream × process — proposed by planned-MP mix until the warehouse lead assigns them.
 */

type NormRow = { stream: string; process: string; department: string | null; target_per_day: number | null; working_days: number; avg_salary: number | null; sort: number };
type SheetRow = { period: string; stream: string; process: string; sop_proj: number | null; planned_mp: number | null; final_output: number | null; avg_salary: number | null };

const daysIn = (p: string) => new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0)).getUTCDate();
const col = (wh: Wh) => (wh === "South" ? "south" : "north");
const key = (s: string, p: string) => `${s}|${p}`;

async function norms(period: string, wh: Wh) {
  return q<NormRow>(`select distinct on (stream, process) stream, process, department, target_per_day::float8 as target_per_day, working_days::float8 as working_days,
       avg_salary::float8 as avg_salary, sort from aop_proc_norms where warehouse = $1
       and effective_from <= greatest($2::date, (select min(effective_from) from aop_proc_norms where warehouse = $1)) -- earliest norm also covers sheet history before it
     order by stream, process, effective_from desc`, [wh, period]);
}

/** Sheet rows for the month, plus the latest earlier sheet row per line (salary + Inventory carry-forward). */
async function sheet(period: string, wh: Wh) {
  const rows = await q<SheetRow>(`select distinct on (stream, process) period::text as period, stream, process, sop_proj::float8 as sop_proj, planned_mp::float8 as planned_mp,
       final_output::float8 as final_output, avg_salary::float8 as avg_salary
     from aop_proc_monthly where warehouse = $1 and period <= $2 order by stream, process, period desc`, [wh, period]);
  const now = new Map<string, SheetRow>(), last = new Map<string, SheetRow>();
  for (const r of rows) { last.set(key(r.stream, r.process), r); if (r.period === period) now.set(key(r.stream, r.process), r); }
  return { now, last };
}

/** S&OP plan + actual volume per stream for the month (South / North columns). Returns split by the forward channel mix. */
async function sopVolumes(period: string, wh: Wh) {
  const c = col(wh);
  const rows = await q<{ view_key: string; row_label: string; plan: number | null; actual: number | null }>(
    `select view_key, row_label, ${c}_plan::float8 as plan, ${c}_actual::float8 as actual from sop_review_rows
     where period = $1 and view_key in ('b2c','b2b_mp','retail_fwd','category_inward','returns')`, [period]);
  const ret = (await q<{ b2c: number | null; b2b: number | null }>(`select b2c::float8 as b2c, b2b::float8 as b2b from sop_returns where period = $1 and warehouse = $2`, [period, wh]))[0];
  const sum = (f: (r: (typeof rows)[number]) => boolean, m: "plan" | "actual") => {
    const xs = rows.filter(f).map((r) => r[m]).filter((x): x is number => x != null);
    return xs.length ? xs.reduce((a, x) => a + x, 0) : null;
  };
  const isShopify = (r: (typeof rows)[number]) => r.view_key === "b2c" && /^shopify/i.test(r.row_label);
  const v = (m: "plan" | "actual") => {
    const shop = sum(isShopify, m), mp = sum((r) => r.view_key === "b2c" && !isShopify(r), m);
    const retail = sum((r) => r.view_key === "retail_fwd", m), b2bmp = sum((r) => r.view_key === "b2b_mp", m);
    const b2cRet = m === "plan" ? sum((r) => r.view_key === "returns" && /^b2c/i.test(r.row_label), m) : ret?.b2c ?? null;
    const b2bRet = m === "plan" ? sum((r) => r.view_key === "returns" && /^b2b/i.test(r.row_label), m) : ret?.b2b ?? null;
    const split = (total: number | null, a: number | null, b: number | null): [number | null, number | null] =>
      total == null ? [null, null] : (a ?? 0) + (b ?? 0) ? [total * (a ?? 0) / ((a ?? 0) + (b ?? 0)), total * (b ?? 0) / ((a ?? 0) + (b ?? 0))] : [total / 2, total / 2];
    const [rs, rm] = split(b2cRet, shop, mp), [rr, rb] = split(b2bRet, retail, b2bmp);
    return {
      "B2C Shopify": shop, "B2C Marketplace": mp, "B2B Retail": retail, "B2B Marketplace": b2bmp,
      "B2C Returns Shopify": rs, "B2C Returns Marketplace": rm, "B2B Returns Retail": rr, "B2B Returns Marketplace": rb,
      Inward: sum((r) => r.view_key === "category_inward", m), Inventory: null,
    } as Record<StreamKey, number | null>;
  };
  return { plan: v("plan"), actual: v("actual") };
}

/** Attendance man-days per department for the month (sites mapped to the warehouse). */
async function attendance(period: string, wh: Wh) {
  const rows = await q<{ dept: string; man_days: number; days: number }>(
    `select coalesce(fm.department, d.func) as dept, sum(d.heads)::float8 as man_days, count(distinct d.day)::int as days
     from mp_daily d join mp_site_map sm on sm.site = d.site and sm.warehouse = $2
     left join mp_func_map fm on fm.func = d.func
     where date_trunc('month', d.day)::date = $1::date group by 1`, [period, wh]);
  const dataDays = (await q<{ n: number }>(
    `select count(distinct d.day)::int as n from mp_daily d join mp_site_map sm on sm.site = d.site and sm.warehouse = $2 where date_trunc('month', d.day)::date = $1::date`, [period, wh]))[0]?.n ?? 0;
  return { byDept: new Map(rows.map((r) => [r.dept, r.man_days])), dataDays };
}

/** Roster-equivalent heads from man-days: present per day × calendar days ÷ working days. */
const headsOf = (manDays: number, dataDays: number, period: string, wd: number) => (dataDays ? (manDays / dataDays) * (daysIn(period) / wd) : 0);

async function storedAssign(period: string, wh: Wh) {
  return q<{ department: string; stream: StreamKey; process: string; heads: number; status: "proposed" | "assigned" }>(
    `select department, stream, process, heads::float8 as heads, status from aop_mp_assign where period = $1 and warehouse = $2`, [period, wh]);
}

/** Split each department's heads across its lines by planned MP (stored rows win). */
function propose(lines: { stream: StreamKey; process: string; department: string; plannedMp: number | null }[], heads: Map<string, number>) {
  const out = new Map<string, number>();
  for (const [dept, h] of heads) {
    const ls = lines.filter((l) => l.department === dept);
    const tot = ls.reduce((a, l) => a + (l.plannedMp ?? 0), 0);
    if (tot) for (const l of ls) out.set(key(l.stream, l.process), (h * (l.plannedMp ?? 0)) / tot);
  }
  return out;
}

/** A closed month with only a few captured days (Oct 2026: attendance starts 29 Oct) would read as a big saving — attendance is
 *  used only for the running month (MTD) or when it covers ≥ 90% of the month. */
const usesAttendance = (period: string, dataDays: number) =>
  dataDays > 0 && (period >= `${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()).slice(0, 7)}-01` || dataDays / daysIn(period) >= 0.9);

export async function processingMonth(period: string, warehouse: Wh): Promise<ProcessingMonth> {
  const [ns, sh, vol, att, stored] = await Promise.all([norms(period, warehouse), sheet(period, warehouse), sopVolumes(period, warehouse), attendance(period, warehouse), storedAssign(period, warehouse)]);
  const wd = ns[0]?.working_days ?? 23;
  const share = att.dataDays / daysIn(period);
  const useAttendance = usesAttendance(period, att.dataDays);
  const deptHeads = new Map([...att.byDept].map(([d, md]) => [d, headsOf(md, att.dataDays, period, wd)]));

  // pass 1: plan per line
  const base = ns.map((n) => {
    const k = key(n.stream, n.process), s = sh.now.get(k), last = sh.last.get(k);
    const carry = n.stream === "Inventory" && !s ? last : undefined;
    const stream = n.stream as StreamKey;
    const sopProj = s?.sop_proj ?? carry?.sop_proj ?? vol.plan[stream] ?? null;
    const salary = s?.avg_salary ?? last?.avg_salary ?? n.avg_salary;
    const plannedMp = s?.planned_mp ?? carry?.planned_mp ?? null;
    const plan = computeRow({ targetPerDay: n.target_per_day, workingDays: n.working_days, avgSalary: n.avg_salary }, { sopProj, plannedMp, finalOutput: null, salary, actualMp: null });
    return { n, stream, s, carry, sopProj, salary, plannedMp: plan.plannedMp };
  });
  const proposed = propose(base.map((b) => ({ stream: b.stream, process: b.n.process, department: b.n.department ?? "", plannedMp: b.plannedMp })), deptHeads);

  // pass 2: actuals
  const rows: ProcRow[] = base.map((b) => {
    const k = key(b.stream, b.n.process);
    const finalOutput = b.s?.final_output ?? (b.carry ? null : vol.actual[b.stream] ?? null);
    let actualMp: number | null = null, src: ProcRow["actualMpSource"] = null, actualShare = 1;
    if (b.s?.planned_mp != null) { actualMp = b.s.planned_mp; src = "sheet"; }
    else if (useAttendance && b.n.department && deptHeads.has(b.n.department)) {
      const st = stored.find((x) => x.stream === b.stream && x.process === b.n.process && x.department === b.n.department);
      actualMp = st?.heads ?? proposed.get(k) ?? null;
      src = st?.status === "assigned" ? "attendance" : actualMp == null ? null : "proposed";
      actualShare = share;
    }
    const c = computeRow({ targetPerDay: b.n.target_per_day, workingDays: b.n.working_days, avgSalary: b.n.avg_salary },
      { sopProj: b.sopProj, plannedMp: b.plannedMp, finalOutput, salary: b.salary, actualMp, actualShare });
    return {
      stream: b.stream, process: b.n.process, department: b.n.department, targetPerDay: b.n.target_per_day, workingDays: b.n.working_days, avgSalary: b.salary,
      outputPerHead: c.outputPerHead, idealCpi: c.idealCpi, sopProj: b.sopProj, mpRequired: c.mpRequired, plannedMp: c.plannedMp, plannedExp: c.plannedExp, plannedCpi: c.plannedCpi,
      actualMp, actualMpSource: src, actualExp: c.actualExp, finalOutput, actualCpi: c.actualCpi, volumeAdherence: c.volumeAdherence, mpAdherence: c.mpAdherence, costImpact: c.costImpact,
    };
  });

  const order = new Map(ns.map((n) => [key(n.stream, n.process), n.sort]));
  const streams = STREAMS.map((s) => {
    const rs = rows.filter((r) => r.stream === s.key).sort((a, b) => (order.get(key(a.stream, a.process)) ?? 0) - (order.get(key(b.stream, b.process)) ?? 0));
    return { stream: s.key, channel: s.channel, dept: s.dept, rows: rs, ...rollupStream(rs) };
  }).filter((s) => s.rows.length);
  const has = rows.some((r) => r.actualExp != null);
  return {
    period, warehouse, streams,
    totals: {
      plannedExp: rows.reduce((a, r) => a + (r.plannedExp ?? 0), 0), actualExp: has ? rows.reduce((a, r) => a + (r.actualExp ?? 0), 0) : null,
      plannedMp: rows.reduce((a, r) => a + (r.plannedMp ?? 0), 0), actualMp: rows.some((r) => r.actualMp != null) ? rows.reduce((a, r) => a + (r.actualMp ?? 0), 0) : null,
    },
  };
}

/** Department heads (attendance) and their split to stream × process. unassigned = heads not yet confirmed by the warehouse lead. */
export async function mpAssignments(period: string, warehouse: Wh): Promise<MpAssignment[]> {
  const [att, pm, stored, ns] = await Promise.all([attendance(period, warehouse), processingMonth(period, warehouse), storedAssign(period, warehouse), norms(period, warehouse)]);
  const wd = ns[0]?.working_days ?? 23;
  if (!usesAttendance(period, att.dataDays)) return []; // e.g. Oct 2026: 3 captured days — the month stays on the sheet
  const depts = [...new Set(STREAMS.map((s) => s.dept))].filter((d) => att.byDept.has(d));
  return depts.map((department) => {
    const manDays = att.byDept.get(department) ?? 0, avgHeads = headsOf(manDays, att.dataDays, period, wd);
    const lines = pm.streams.flatMap((s) => s.rows).filter((r) => r.department === department).map((r) => {
      const st = stored.find((x) => x.department === department && x.stream === r.stream && x.process === r.process);
      return { stream: r.stream, process: r.process, heads: st?.heads ?? r.actualMp ?? 0, status: st?.status ?? ("proposed" as const) };
    });
    const assigned = lines.filter((l) => l.status === "assigned").reduce((a, l) => a + l.heads, 0);
    return { period, warehouse, department, presentManDays: manDays, workingDays: wd, avgHeads, lines, unassigned: Math.max(0, avgHeads - assigned) };
  });
}

/** Persist the planned-MP-mix split as 'proposed' (lines already assigned are left alone). */
export async function proposeAssignments(period: string, warehouse: Wh) {
  const list = await mpAssignments(period, warehouse);
  let n = 0;
  for (const a of list) for (const l of a.lines) {
    await q(`insert into aop_mp_assign (period, warehouse, department, stream, process, heads, status) values ($1,$2,$3,$4,$5,$6,'proposed')
             on conflict (period, warehouse, department, stream, process) do update set heads = excluded.heads, updated_at = now() where aop_mp_assign.status = 'proposed'`,
      [period, warehouse, a.department, l.stream, l.process, Math.round(l.heads * 100) / 100]);
    n++;
  }
  return n;
}

/**
 * Warehouse cost by channel: every AOP Warehousing & Fulfilment line (rent, utilities, security, repairs, ironing, …) and the
 * overhead departments' heads (Ops, Logistics, Admin) → "Shared · Storage & handling"; channel manpower → its channel by process
 * (Inward / Inventory streams → Shared with their own process).
 */
/** AOP lines the Cost Master sync adds for booked manpower (costMasterSync.ts). */
const MP_LINES = ["Monthly Manpower Cost", "Monthly OT"];
export async function warehouseAttribution(months: string[]): Promise<AttributionRow[]> {
  const lines = await q<{ item: string; section: string; period: string; plan: number | null; forecast: number | null; actual: number | null }>(
    `select i.name as item, s.name as section, v.period::text as period, v.plan::float8 as plan, v.forecast::float8 as forecast, v.actual::float8 as actual
     from aop_items i join aop_sections s on s.id = i.section_id join aop_sections p on p.id = s.parent_id
     join aop_cycles c on c.id = p.cycle_id and c.status = 'active'
     join aop_period_values v on v.item_id = i.id and v.period = any($1::date[])
     where p.name ilike 'warehous%' and i.active`, [months]);
  const whOf = (section: string): Wh => (/north/i.test(section) ? "North" : "South");
  const out: AttributionRow[] = [];
  for (const period of months) for (const wh of ["South", "North"] as const) {
    const mine = lines.filter((x) => x.period === period && whOf(x.section) === wh);
    // fixed warehouse lines: booked (actual) only — a plan or provision is not a cost (audit #2); no actual = missing, not ₹0
    for (const l of mine.filter((x) => !MP_LINES.includes(x.item))) {
      if (!l.actual) continue;
      out.push({ period, warehouse: wh, family: "warehouse", channel: "Shared", process: "Storage & handling", amount: l.actual, basis: "direct",
        key: `${l.item} · booked`, units: null, cpi: null });
    }
    // booked manpower + OT (Cost Master → AOP lines); when present, heads × salary below only splits it
    const bookedRows = mine.filter((x) => MP_LINES.includes(x.item) && x.actual != null);
    const booked = bookedRows.length ? bookedRows.reduce((a, x) => a + x.actual!, 0) : null;
    const mp: AttributionRow[] = [];
    const pm = await processingMonth(period, wh);
    // overhead departments from attendance
    const att = await attendance(period, wh);
    const salary = pm.streams.flatMap((s) => s.rows).find((r) => r.avgSalary != null && r.process !== "Capacity")?.avgSalary ?? null;
    const wd = pm.streams[0]?.rows[0]?.workingDays ?? 23;
    for (const [dept, manDays] of att.byDept) {
      if (!(OVERHEAD_DEPTS as readonly string[]).includes(dept) || salary == null) continue;
      mp.push({ period, warehouse: wh, family: "warehouse", channel: "Shared", process: "Storage & handling", amount: (manDays * salary) / wd, basis: "direct",
        key: `${dept} heads · ${Math.round(manDays)} man-days × ₹${Math.round(salary)} ÷ ${wd}`, units: null, cpi: null });
    }
    // channel manpower
    for (const s of pm.streams) for (const r of s.rows) {
      const actual = r.actualExp != null;
      const amount = r.actualExp ?? r.plannedExp;
      if (!amount) continue;
      const basis = actual && r.actualMpSource !== "proposed" ? "direct" : "allocated";
      const why = !actual ? "planned MP (no actual yet)" : r.actualMpSource === "sheet" ? "sheet deployed MP" : r.actualMpSource === "attendance" ? "attendance, assigned" : "attendance, proposed split by planned MP — awaiting assignment";
      const units = actual ? r.finalOutput : r.sopProj;
      mp.push({ period, warehouse: wh, family: "warehouse", channel: s.channel, process: r.process, amount, basis, key: `${s.stream} · ${why}`, units, cpi: units ? amount / units : null });
    }
    const est = mp.reduce((a, r) => a + r.amount, 0);
    if (booked != null && est > 0) {
      // one rupee, one place: booked manpower + OT split by each row's heads × salary share
      for (const r of mp) {
        const amount = (booked * r.amount) / est;
        out.push({ ...r, amount, basis: "allocated", key: `${r.key} · share of booked manpower + OT ₹${Math.round(booked).toLocaleString("en-IN")}`, cpi: r.units ? amount / r.units : null });
      }
    } else out.push(...mp.map((r) => ({ ...r, key: `${r.key} · estimate (no booked manpower for the month)` })));
  }
  return out;
}
