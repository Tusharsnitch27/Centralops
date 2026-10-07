import "server-only";
import type { RunQ } from "../db";
import aop from "../../db/seed/aop-cost-fy27.json";
import sop from "../../db/seed/sop-fy27.json";

/* Reference data drawn from the two FY26-27 workbooks (Central Operations Cost Master, S&OP Projection FY'27). */

const PEOPLE: { name: string; title: string; team: string }[] = [
  { name: "Manish", title: "Head · Warehousing & Fulfilment", team: "Warehousing & Fulfilment" },
  { name: "Mahadevan", title: "Staffing & Packaging", team: "Staffing & Packaging" },
  { name: "Iqbal", title: "Head · Logistics", team: "Logistics" },
  { name: "Vaishnavi", title: "Logistics · Credit notes", team: "Logistics" },
  { name: "Jyoti", title: "Logistics · Lost & damage disputes", team: "Logistics" },
  { name: "Ifham", title: "Logistics · Line-haul & NSO", team: "Logistics" },
  { name: "Nitin", title: "RFID Program Lead", team: "RFID" },
  { name: "Faisal", title: "SaaS & Tech", team: "SaaS & Tech" },
  { name: "Aaryan", title: "D2C Planning (Shopify)", team: "D2C" },
  { name: "Aniket", title: "D2C", team: "D2C" },
  { name: "Liza", title: "Marketplace Planning", team: "Marketplace" },
  { name: "Yash", title: "Retail Planning", team: "Retail" },
  { name: "Medha", title: "Retail Expansion (NSO)", team: "Retail" },
  { name: "Devender", title: "Retail Replenishment", team: "Retail" },
  { name: "Shikha", title: "Inbound & Category Planning", team: "Category & Inbound" },
  { name: "Niketh", title: "Category Planning · Pre-pack", team: "Category & Inbound" },
  { name: "Praveen", title: "Liquidation", team: "Liquidation" },
];
const TEAMS: { name: string; fn: string; lead?: string; color: string }[] = [
  { name: "Central Ops PMO", fn: "Central Operations", color: "#18181b" },
  { name: "Warehousing & Fulfilment", fn: "Central Operations", lead: "Manish", color: "#0f766e" },
  { name: "Logistics", fn: "Central Operations", lead: "Iqbal", color: "#1d4ed8" },
  { name: "RFID", fn: "Central Operations", lead: "Nitin", color: "#7e22ce" },
  { name: "SaaS & Tech", fn: "Central Operations", lead: "Faisal", color: "#0e7490" },
  { name: "Staffing & Packaging", fn: "Central Operations", lead: "Mahadevan", color: "#a16207" },
  { name: "D2C", fn: "Online", lead: "Aaryan", color: "#9f1239" },
  { name: "Marketplace", fn: "Online", lead: "Liza", color: "#9a3412" },
  { name: "Retail", fn: "Offline", lead: "Yash", color: "#4d7c0f" },
  { name: "Category & Inbound", fn: "Planning", lead: "Shikha", color: "#3730a3" },
  { name: "Liquidation", fn: "Planning", lead: "Praveen", color: "#78716c" },
];

const addMonths = (p: string, n: number) => { const d = new Date(`${p}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const withDay = (p: string, day: number) => `${p.slice(0, 8)}${String(day).padStart(2, "0")}`;
const istToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

/** Deterministic pseudo-random in [0,1) from a string (stable demo values). */
export const hashRand = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 10000) / 10000; };

export async function seedReference(S: RunQ, adminId: string) {
  /* ---- teams & people ---- */
  const teamId = new Map<string, string>();
  for (const t of TEAMS) {
    const r = await S<{ id: string }>(`insert into teams (name, function, color) values ($1,$2,$3) on conflict (name) do update set function = excluded.function returning id`, [t.name, t.fn, t.color]);
    teamId.set(t.name, r[0].id);
  }
  await S(`update users set team_id = $2 where id = $1`, [adminId, teamId.get("Central Ops PMO")]);
  await S(`update teams set lead_id = $1 where name = 'Central Ops PMO'`, [adminId]);
  await S(`insert into team_members (team_id, user_id) values ($1,$2) on conflict do nothing`, [teamId.get("Central Ops PMO"), adminId]);
  const person = new Map<string, string>([["tushar", adminId]]);
  for (const p of PEOPLE) {
    const r = await S<{ id: string }>(
      `insert into users (username, name, title, role, team_id, joined_at) values ($1,$2,$3,'owner',$4, current_date) on conflict (username) do update set title = excluded.title returning id`,
      [p.name.toLowerCase(), p.name, p.title, teamId.get(p.team)]);
    person.set(p.name.toLowerCase(), r[0].id);
    await S(`insert into team_members (team_id, user_id) values ($1,$2) on conflict do nothing`, [teamId.get(p.team), r[0].id]);
  }
  for (const t of TEAMS) if (t.lead) await S(`update teams set lead_id = $2 where name = $1`, [t.name, person.get(t.lead.toLowerCase())]);
  const who = (label: string | null | undefined) => {
    const names = String(label ?? "").split(/\s*(?:&|,|\band\b)\s*/i).map((s) => s.trim().toLowerCase()).filter(Boolean);
    const ids = names.map((n) => person.get(n.split(/\s+/)[0])).filter(Boolean) as string[];
    const nonAdmin = ids.filter((i) => i !== adminId);
    return { owner: nonAdmin[0] ?? ids[0] ?? adminId, others: ids.filter((i) => i !== (nonAdmin[0] ?? ids[0])) };
  };

  /* ---- programs ---- */
  const program = async (code: string, name: string, description: string, owner: string, color: string) =>
    (await S<{ id: string }>(`insert into programs (code, name, description, owner_id, sponsor_id, status, start_date, target_date, color) values ($1,$2,$3,$4,$5,'active','2026-04-01','2027-03-31',$6) returning id`,
      [code, name, description, owner, adminId, color]))[0].id;
  const progCost = await program("COST", "Central Ops Cost Excellence", "Run Central Operations within the FY26-27 cost plan: budgets, provisions, actuals, credit-note recovery and incident cost control across Warehousing, Logistics, SaaS, Packaging, Staffing, RFID and one-time assets.", adminId, "#0f766e");
  const progSop = await program("SOP", "S&OP & Capacity Planning", "Monthly projections from every channel (D2C, Marketplace, Retail, Category, Liquidation) converted into warehouse capacity plans for North (GGN) and South (BLR), with weekly reviews and OND peak readiness.", adminId, "#1d4ed8");
  const progWh = await program("WFT", "Warehouse & Fulfilment Transformation", "North warehouse infrastructure, automation, RFID and quick-commerce readiness.", person.get("manish")!, "#7e22ce");
  await S(`insert into app_settings (key, value) values ('seed.programs', $1) on conflict (key) do update set value = excluded.value`, [JSON.stringify({ cost: progCost, sop: progSop, wh: progWh })]);

  /* ---- recurring reviews ---- */
  const review = (name: string, cadence: string, module: string, owner: string, momOwner: string, programId: string | null, match: string, description: string) =>
    S(`insert into reviews (name, cadence, module, owner_id, mom_owner_id, program_id, calendar_match, description) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [name, cadence, module, owner, momOwner, programId, match, description]);
  await review("Monthly Central Ops Cost Review", "monthly", "aop", adminId, adminId, progCost, "cost review", "Budget vs provision vs actuals by function. Actuals for the previous month due by the 7th; projections for the next quarter by the 20th.");
  await review("Weekly S&OP Review", "weekly", "sop", adminId, person.get("shikha")!, progSop, "s&op", "Projection inputs status, projection vs actual, warehouse capacity required vs available, open actions.");
  await review("Logistics Cost & Disputes Review", "weekly", "aop", person.get("iqbal")!, person.get("vaishnavi")!, progCost, "logistics", "Vendor-wise B2C/B2B cost vs budget, weight disputes, lost/damage claims and credit notes.");
  await review("Warehouse Ops Review", "weekly", "program", person.get("manish")!, person.get("mahadevan")!, progWh, "warehouse", "Manpower & OT, capacity, infra projects (CCTV, Wi-Fi, MHE), incidents.");
  await review("RFID Program Review", "fortnightly", "project", person.get("nitin")!, person.get("nitin")!, progWh, "rfid", "RFID expansion to COCO doors and NSOs, tunnel and handheld rollout.");

  /* ---- AOP: Central Ops cost FY 26-27 ---- */
  const cycle = (await S<{ id: string }>(
    `insert into aop_cycles (name, kind, fy_start, status, labels, actuals_cutoff_day, projection_cutoff_day, guidelines, source_file, owner_id)
     values ($1,'cost',$2,'active',$3,7,20,$4,$5,$6) returning id`,
    [aop.name, aop.fy_start, JSON.stringify({ plan: "Budget", forecast: "Provision", actual: "Actuals" }), JSON.stringify(aop.guidelines), "Central Operations Cost Master Sheet FY 26-27.xlsx", adminId]))[0].id;
  const today = istToday();
  const lastClosed = addMonths(`${today.slice(0, 7)}-01`, -1);
  let fSort = 0;
  for (const f of aop.functions) {
    const { owner, others } = who(f.owners);
    const team = TEAMS.find((t) => f.name.toLowerCase().includes(t.name.split(" ")[0].toLowerCase()))?.name;
    const fid = (await S<{ id: string }>(`insert into aop_sections (cycle_id, name, kind, owner_id, owner_label, team_id, sort) values ($1,$2,'function',$3,$4,$5,$6) returning id`,
      [cycle, f.name, owner, f.owners, team ? teamId.get(team) : null, fSort++]))[0].id;
    for (const o of others) await S(`insert into aop_owners (section_id, user_id, role) values ($1,$2,'contributor')`, [fid, o]);
    const monthsWithPlan = new Map<string, { plan: number; hasActual: boolean[]; hasForecast: boolean[] }>();
    let sSort = 0;
    for (const s of f.sections) {
      const sid = (await S<{ id: string }>(`insert into aop_sections (cycle_id, parent_id, name, kind, owner_id, sort) values ($1,$2,$3,'group',$4,$5) returning id`, [cycle, fid, s.name, owner, sSort++]))[0].id;
      let iSort = 0;
      for (const it of s.items) {
        const attrs = it.attrs as { note?: string; reference?: string };
        const iid = (await S<{ id: string }>(
          `insert into aop_items (cycle_id, section_id, name, metric, unit, direction, owner_id, reference, attributes, sort) values ($1,$2,$3,'Cost','inr','lower_better',$4,$5,$6,$7) returning id`,
          [cycle, sid, it.name, owner, attrs.reference ?? null, JSON.stringify(attrs.note ? { note: attrs.note } : {}), iSort++]))[0].id;
        for (const v of it.values) {
          await S(`insert into aop_period_values (item_id, period, plan, forecast, actual, updated_by) values ($1,$2,$3,$4,$5,$6)`, [iid, v.period, v.plan, v.forecast, v.actual, owner]);
          if (v.plan) {
            const m = monthsWithPlan.get(v.period) ?? { plan: 0, hasActual: [], hasForecast: [] };
            m.plan += v.plan; m.hasActual.push(v.actual != null); m.hasForecast.push(v.forecast != null);
            monthsWithPlan.set(v.period, m);
          }
        }
      }
    }
    // input-collection status per function × month, derived from what the workbook already holds
    for (const [period, m] of [...monthsWithPlan].sort()) {
      if (period <= lastClosed) {
        const due = withDay(addMonths(period, 1), 7);
        const done = m.hasActual.every(Boolean);
        await S(`insert into aop_submissions (cycle_id, section_id, period, kind, owner_id, due_date, status, submitted_at, submitted_by) values ($1,$2,$3,'actuals',$4,$5,$6,$7,$8)`,
          [cycle, fid, period, owner, due, done ? "submitted" : "pending", done ? `${withDay(addMonths(period, 1), 6)}T12:00:00+05:30` : null, done ? owner : null]);
      }
    }
    // projections: each month M due on the 20th of M-1, for the current month and the next two
    for (let k = 0; k < 3; k++) {
      const period = addMonths(`${today.slice(0, 7)}-01`, k);
      const m = monthsWithPlan.get(period);
      const done = !!m && m.hasForecast.length > 0 && m.hasForecast.every(Boolean);
      await S(`insert into aop_submissions (cycle_id, section_id, period, kind, owner_id, due_date, status, submitted_at, submitted_by) values ($1,$2,$3,'projections',$4,$5,$6,$7,$8)`,
        [cycle, fid, period, owner, withDay(addMonths(period, -1), 20), done ? "submitted" : "pending", done ? `${withDay(addMonths(period, -1), 19)}T12:00:00+05:30` : null, done ? owner : null]);
    }
    // the open actuals month (last closed) always has a row so missing inputs are visible
    const lc = await S(`select 1 from aop_submissions where section_id = $1 and period = $2 and kind = 'actuals'`, [fid, lastClosed]);
    if (!lc.length) await S(`insert into aop_submissions (cycle_id, section_id, period, kind, owner_id, due_date, status) values ($1,$2,$3,'actuals',$4,$5,'pending')`, [cycle, fid, lastClosed, owner, withDay(today, 7)]);
  }
  for (const c of aop.credit_notes) {
    const status = c.received && c.amount && c.received >= c.amount ? "received" : c.received ? "partial" : "open";
    await S(`insert into credit_notes (cycle_id, function_name, partner, cn_type, month_label, amount, received, owner_id, status, remarks) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [cycle, c.fn, c.partner, c.type, c.month || null, c.amount, c.received, c.owner ? person.get(c.owner.toLowerCase()) ?? null : null, status, c.remarks || null]);
  }
  for (const x of aop.incidents)
    await S(`insert into incident_expenses (cycle_id, function_name, month_label, channel, expense_type, reason, amount, owner_id, remarks) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [cycle, x.fn, x.month, x.channel, x.type, x.reason, x.amount, x.owner ? person.get(x.owner.toLowerCase()) ?? null : null, x.remarks || null]);

  /* ---- insight rules (configurable; evaluated by the AOP / S&OP insight engines) ---- */
  const rules: [string, string, string, string, object, string][] = [
    ["aop", "aop.overspend", "Overspend vs budget", "Actual exceeds budget by more than the threshold in a closed month (cost lines). For revenue lines: actual below plan by the threshold.", { metric: "actual_vs_plan", threshold: 0.05 }, "warning"],
    ["aop", "aop.persistent", "Persistent deviation", "Line misses plan by more than the threshold for N consecutive closed months.", { metric: "actual_vs_plan", threshold: 0.1, periods: 2 }, "critical"],
    ["aop", "aop.missing_actuals", "Missing actuals after cut-off", "Budgeted line has no actual after the actuals cut-off day.", { metric: "missing_actual" }, "warning"],
    ["aop", "aop.provision_accuracy", "Provision accuracy", "Actual differs from the month's provision by more than the threshold.", { metric: "actual_vs_forecast", threshold: 0.15 }, "info"],
    ["aop", "aop.run_rate", "Full-year run-rate risk", "Projected full-year (YTD actual + remaining provision/budget) exceeds annual budget (cost) or falls short (revenue); computes recovery required.", { metric: "fy_projection", threshold: 0.02 }, "critical"],
    ["sop", "sop.forecast_accuracy", "Projection accuracy", "Actual volume differs from the projection by more than the threshold.", { metric: "actual_vs_projection", threshold: 0.2 }, "warning"],
    ["sop", "sop.capacity_breach", "Capacity breach", "Required warehouse capacity exceeds available capacity for a department.", { metric: "required_vs_available", threshold: 0 }, "critical"],
    ["sop", "sop.late_input", "Late projection input", "Projection for a month not submitted by the due date (week 3 of the previous month).", { metric: "late_submission" }, "warning"],
    ["tasks", "tasks.no_update", "No update on delegated task", "Delegated open task has no update for N days.", { metric: "days_since_update", threshold: 5 }, "warning"],
    ["projects", "projects.milestone_slip", "Milestone slipped", "Milestone due date moved beyond its baseline by N days or is overdue.", { metric: "slip_days", threshold: 3 }, "warning"],
  ];
  for (const [module, key, name, description, rule, severity] of rules)
    await S(`insert into insight_rules (module, key, name, description, rule, severity, builtin) values ($1,$2,$3,$4,$5,$6,true)`, [module, key, name, description, JSON.stringify(rule), severity]);

  /* ---- S&OP FY'27 ---- */
  const AREA: Record<string, string> = { "B2C-SF": "demand", "B2C-MP": "demand", "B2B-MP": "demand", "Retail-Forward": "demand", "Retail -Return": "returns", "Inbound-Category Wise": "supply", "Pre-pack-Category Wise": "supply", "Liquidation": "liquidation" };
  const DESC: Record<string, string> = {
    "B2C-SF": "Shopify orders & items, monthly, plus event days with % BAU uplift — drives D2C pick/pack capacity.",
    "B2C-MP": "Marketplace B2C orders & items by channel (Myntra, Flipkart, Amazon, AJIO, Nykaa, Noon) and returns.",
    "B2B-MP": "B2B marketplace volumes by channel (SOR, Slikk, Zilo, Knot, Instamart…), split by warehouse.",
    "Retail-Forward": "Weekly NSO launches, NSO go-live inventory and replenishment & fresh for existing stores (GGN 35% / BLR 65%).",
    "Retail -Return": "Store returns to warehouse.",
    "Inbound-Category Wise": "Category-wise inbound by warehouse (North / South) for ramp-up and ramp-down.",
    "Pre-pack-Category Wise": "Category-wise pre-pack units by warehouse.",
    "Liquidation": "Weekly liquidation projections vs actuals by warehouse.",
  };
  const streamId = new Map<string, string>();
  let st = 0;
  for (const p of sop.pocs) {
    const poc = who(p.poc).owner;
    const name = p.stream.replace(/\s+-/, "-").replace(/\s+/g, " ");
    const dims = ["Inbound-Category Wise", "Pre-pack-Category Wise", "Liquidation"].includes(p.stream) ? ["North", "South"] : [];
    const gran = p.stream === "Retail-Forward" || p.stream === "Liquidation" ? "week" : "month";
    const id = (await S<{ id: string }>(
      `insert into sop_streams (code, name, area, poc_id, poc_label, description, granularity, unit, dimensions, due_day, actual_source, sort) values ($1,$2,$3,$4,$5,$6,$7,'units',$8,21,$9,$10) returning id`,
      [name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, AREA[p.stream] ?? "demand", poc, p.poc, DESC[p.stream] ?? null, gran, JSON.stringify(dims),
        ["B2C-SF", "B2C-MP", "B2B-MP"].includes(p.stream) ? "demo" : "manual", st++]))[0].id;
    streamId.set(p.stream, id);
    for (const [period, status] of Object.entries(p.status as Record<string, string>)) {
      const due = withDay(addMonths(period, -1), 21);
      const done = /done/i.test(status);
      await S(`insert into sop_submissions (stream_id, period, status, due_date, submitted_at, submitted_by) values ($1,$2,$3,$4,$5,$6)`,
        [id, period, done ? "submitted" : due < today ? "late" : "pending", due, done ? `${due}T18:00:00+05:30` : null, done ? poc : null]);
    }
    const next = addMonths(Object.keys(p.status).sort().at(-1)!, 1);
    await S(`insert into sop_submissions (stream_id, period, status, due_date) values ($1,$2,'pending',$3) on conflict do nothing`, [id, next, withDay(addMonths(next, -1), 21)]);
  }
  const lineIn = async (stream: string, name: string, metric: string, sort: number) =>
    (await S<{ id: string }>(`insert into sop_lines (stream_id, name, metric, unit, sort) values ($1,$2,$3,'units',$4) returning id`, [streamId.get(stream), name, metric, sort]))[0].id;
  const value = (line: string, period: string, label: string, dim: string, projection: number | null, actual: number | null, src: string | null) =>
    S(`insert into sop_values (line_id, period, period_label, dimension, projection, actual, actual_source) values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing`, [line, period, label, dim, projection, actual, src]);
  const currentMonth = `${today.slice(0, 7)}-01`;
  let ls = 0;
  for (const l of sop.lines) {
    const isShopify = /^shopify/i.test(l.line);
    const stream = l.stream === "B2B Marketplace" ? "B2B-MP" : isShopify ? "B2C-SF" : "B2C-MP";
    const metric = l.stream === "B2C Returns" ? "returns" : /orders/i.test(l.line) ? "orders" : "items";
    const nice = l.line.replace(/\s*\((Orders|Items Quantity)\)/i, (_, m) => (m.toLowerCase() === "orders" ? " · orders" : " · items")).replace(/^NOON/, "Noon").replace(/^AJIO/, "AJIO");
    const id = await lineIn(stream, l.stream === "B2C Returns" ? `${nice.replace(" · items", "").replace(" · orders", "")} · returns${/orders/i.test(l.line) ? " (orders)" : ""}` : nice, metric, ls++);
    for (const v of l.values) {
      // Actuals come from Snowflake later; past months carry clearly-flagged demo actuals so the review views work today.
      const demo = v.period < currentMonth && v.projection > 0 ? Math.round(v.projection * (0.82 + hashRand(`${l.line}${v.period}`) * 0.32)) : null;
      await value(id, v.period, "", "", v.projection, demo, demo != null ? "demo" : null);
    }
  }
  const MON: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Sept: "09", Oct: "10", Nov: "11", Dec: "12" };
  const weekPeriod = (w: string) => { const m = MON[w.split("_")[0]] ?? "01"; return `${Number(m) >= 4 ? 2026 : 2027}-${m}-01`; };
  const nso = await lineIn("Retail-Forward", "NSO launches", "nso", 0);
  const nsoInv = await lineIn("Retail-Forward", "NSO go-live inventory", "inventory", 1);
  const repl = await lineIn("Retail-Forward", "Replenishment & fresh", "units", 2);
  for (const r of sop.retail) {
    const p = weekPeriod(r.week);
    if (r.nso != null) await value(nso, p, r.week, "", r.nso, null, null);
    if (r.nso_inventory != null) await value(nsoInv, p, r.week, "", r.nso_inventory, null, null);
    if (r.replenishment != null) await value(repl, p, r.week, "", r.replenishment, null, null);
  }
  await lineIn("Retail -Return", "Store returns to warehouse", "returns", 0);
  const catLines = new Map<string, string>();
  for (const c of sop.categories) {
    if (!catLines.has(c.category)) catLines.set(c.category, await lineIn("Inbound-Category Wise", c.category, "units", catLines.size));
    await value(catLines.get(c.category)!, c.period, "", "North", c.north, null, null);
    await value(catLines.get(c.category)!, c.period, "", "South", c.south, null, null);
  }
  await lineIn("Pre-pack-Category Wise", "Pre-pack units", "units", 0);
  const liq = await lineIn("Liquidation", "Liquidation units", "units", 0);
  for (const w of sop.liquidation) {
    if (w.proj_north != null || w.act_north != null) await value(liq, w.period, w.week, "North", w.proj_north, w.act_north, w.act_north != null ? "manual" : null);
    if (w.proj_south != null || w.act_south != null) await value(liq, w.period, w.week, "South", w.proj_south, w.act_south, w.act_south != null ? "manual" : null);
  }
  for (const c of sop.capacity) {
    await S(`insert into sop_capacity (period, department, warehouse, required, available) values ($1,$2,'South',$3,$4) on conflict do nothing`, [c.period, c.department, c.req_south, c.act_south]);
    await S(`insert into sop_capacity (period, department, warehouse, required, available) values ($1,$2,'North',$3,$4) on conflict do nothing`, [c.period, c.department, c.req_north, c.act_north]);
  }
  await S(`insert into app_settings (key, value) values ('sop.guidelines', $1) on conflict (key) do update set value = excluded.value`, [JSON.stringify(sop.methodology)]);
}
