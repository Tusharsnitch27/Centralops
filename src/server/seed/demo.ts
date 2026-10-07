import "server-only";
import type { RunQ } from "../db";

/* Demo activity so the workspace feels lived-in on first run (SEED_DEMO=true). Everything is dated relative to today
   and starts from the admin's joining date (14 days ago in demo mode) — nothing earlier is created. */

const istToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const day = (n: number) => { const d = new Date(`${istToday()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const at = (n: number, hhmm: string) => `${day(n)}T${hhmm}:00+05:30`;

export async function seedDemo(S: RunQ, adminId: string) {
  await S(`update users set joined_at = $1`, [day(-14)]); // demo: everyone joined two weeks ago
  const users = await S<{ id: string; username: string }>(`select id, username from users`);
  const U = (n: string) => users.find((u) => u.username === n)?.id ?? adminId;
  const teams = await S<{ id: string; name: string }>(`select id, name from teams`);
  const T = (n: string) => teams.find((t) => t.name === n)!.id;
  const progs = (await S<{ value: { cost: string; sop: string; wh: string } }>(`select value from app_settings where key = 'seed.programs'`))[0].value;
  const items = await S<{ id: string; name: string; section: string }>(`select i.id, i.name, s.name as section from aop_items i join aop_sections s on s.id = i.section_id`);
  const aopItem = (name: string, section?: string) => items.find((i) => i.name.startsWith(name) && (!section || i.section === section))?.id ?? null;

  /* ---------- projects ---------- */
  const project = async (p: { code: string; name: string; program: string; owner: string; objective: string; start: number; target: number; health: string; status?: string; budget?: number; spent?: number; teams: string[] }) => {
    const id = (await S<{ id: string }>(
      `insert into projects (code, name, program_id, owner_id, sponsor_id, objective, start_date, target_date, health, status, budget, spent, created_by, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$5,$13) returning id`,
      [p.code, p.name, p.program, U(p.owner), adminId, p.objective, day(p.start), day(p.target), p.health, p.status ?? "active", p.budget ?? null, p.spent ?? null, at(-14, "10:00")]))[0].id;
    for (const t of p.teams) await S(`insert into project_teams (project_id, team_id) values ($1,$2)`, [id, T(t)]);
    return id;
  };
  const P = {
    rfid: await project({ code: "RFID", name: "RFID Expansion — COCO doors & NSO", program: progs.wh, owner: "nitin", objective: "Tag-level inventory visibility in every COCO door and new store by Dec, with tunnel reads at YLK and handhelds at the North warehouse.", start: -60, target: 55, health: "at_risk", budget: 14800000, spent: 6833000, teams: ["RFID", "Retail", "Warehousing & Fulfilment"] }),
    northwh: await project({ code: "NWH", name: "North Warehouse Infra Upgrade", program: progs.wh, owner: "manish", objective: "Full CCTV + Wi-Fi coverage, cooling and MHE at Tauru before OND peak.", start: -45, target: 21, health: "on_track", budget: 1588500, spent: 1026346, teams: ["Warehousing & Fulfilment"] }),
    logi: await project({ code: "LOGI", name: "Logistics Cost Optimisation", program: progs.cost, owner: "iqbal", objective: "Bring B2C logistics within budget: billing audit of Bluedart / Blitz deviations, box-size rationalisation and B2C rate renegotiation.", start: -30, target: 40, health: "at_risk", teams: ["Logistics"] }),
    cn: await project({ code: "CN", name: "Credit Note Recovery FY27", program: progs.cost, owner: "vaishnavi", objective: "Recover weight-dispute and lost/damage credit notes from every courier partner within 45 days of raise.", start: -40, target: 80, health: "on_track", teams: ["Logistics"] }),
    peak: await project({ code: "PEAK", name: "OND’26 Peak Capacity Readiness", program: progs.sop, owner: "manish", objective: "Lock Oct–Dec projections from every channel and convert them into North/South capacity, manpower and OT plans with zero SLA breach.", start: -20, target: 35, health: "at_risk", teams: ["Warehousing & Fulfilment", "D2C", "Marketplace", "Retail", "Category & Inbound"] }),
    qc: await project({ code: "QC", name: "Quick Commerce Infra — Phase 1", program: progs.wh, owner: "manish", objective: "Racks, blue bins and IT devices for quick-commerce dark-store fulfilment; vendor payments cleared.", start: -25, target: 30, health: "on_track", teams: ["Warehousing & Fulfilment", "SaaS & Tech"] }),
    saas: await project({ code: "SAAS", name: "SaaS Cost Indexation & Renewals", program: progs.cost, owner: "faisal", objective: "Monthly SaaS cost booked in the right month; Unicommerce and Clickpost renewals negotiated before expiry.", start: -14, target: 60, health: "on_track", teams: ["SaaS & Tech"] }),
    aop28: await project({ code: "AOP28", name: "AOP FY 27-28 — Central Ops", program: progs.cost, owner: "tushar", objective: "Build the FY27-28 Central Ops cost plan bottom-up with every function owner, with S&OP volumes as the driver.", start: 25, target: 150, health: "on_track", status: "planned", teams: ["Central Ops PMO"] }),
  };
  const ms = (project: string, title: string, due: number, baseline: number, status: string, sort: number) =>
    S(`insert into milestones (project_id, title, due_date, baseline_date, status, completed_at, sort) values ($1,$2,$3,$4,$5,$6,$7)`,
      [project, title, day(due), day(baseline), status, status === "done" ? at(Math.min(due, -1), "17:00") : null, sort]);
  await ms(P.rfid, "Store asset kits procured", -30, -30, "done", 0);
  await ms(P.rfid, "Pilot stores live (5 doors)", -12, -14, "done", 1);
  await ms(P.rfid, "RFID tunnel live at YLK", -3, -8, "in_progress", 2);
  await ms(P.rfid, "Handheld rollout — North WH", 12, 10, "pending", 3);
  await ms(P.rfid, "40 COCO doors live", 55, 50, "pending", 4);
  await ms(P.northwh, "CCTV coverage — 100%", -10, -12, "done", 0);
  await ms(P.northwh, "Air coolers installed", -20, -20, "done", 1);
  await ms(P.northwh, "Wi-Fi router coverage", 5, 5, "in_progress", 2);
  await ms(P.northwh, "MHE rental renewal", 18, 18, "pending", 3);
  await ms(P.logi, "Bluedart & Blitz billing audit", -2, -4, "in_progress", 0);
  await ms(P.logi, "Box-size rationalisation pilot", 12, 12, "pending", 1);
  await ms(P.logi, "B2C rate renegotiation closed", 35, 30, "pending", 2);
  await ms(P.peak, "October projections locked", -16, -16, "done", 0);
  await ms(P.peak, "Nov–Dec projections from all channels", 14, 14, "pending", 1);
  await ms(P.peak, "Capacity & manpower plan signed off", 16, 16, "pending", 2);
  await ms(P.peak, "Temp manpower onboarded", 25, 25, "pending", 3);
  await ms(P.qc, "Racks & tables deployed", -5, -5, "done", 0);
  await ms(P.qc, "IT devices procured", 8, 8, "in_progress", 1);
  await ms(P.qc, "Phase 1 go-live", 30, 30, "pending", 2);
  await ms(P.cn, "September weight disputes raised", -6, -6, "done", 0);
  await ms(P.cn, "October CNs received", 25, 25, "pending", 1);

  /* ---------- meetings ---------- */
  const reviews = await S<{ id: string; name: string; mom_owner_id: string; program_id: string }>(`select id, name, mom_owner_id, program_id from reviews`);
  const R = (n: string) => reviews.find((r) => r.name.startsWith(n))!;
  const meeting = async (m: { title: string; start: string; mins: number; review?: string; project?: string; program?: string; momOwner: string; status: string; agenda?: string; attendees: string[]; summary?: string; prep?: string }) => {
    const r = m.review ? R(m.review) : null;
    const end = new Date(new Date(m.start).getTime() + m.mins * 60000).toISOString();
    const id = (await S<{ id: string }>(
      `insert into meetings (title, starts_at, ends_at, review_id, program_id, project_id, organizer_id, mom_owner_id, agenda, prep_notes, source, mom_status, summary, is_recurring, series_key, mom_due_at, created_by, reviewed_by, reviewed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'calendar',$11,$12,$13,$14, $3::timestamptz + interval '24 hours', $7, $15, $16) returning id`,
      [m.title, m.start, end, r?.id ?? null, m.program ?? r?.program_id ?? null, m.project ?? null, adminId, U(m.momOwner), m.agenda ?? null, m.prep ?? null, m.status, m.summary ?? null,
        !!r, r ? r.name : null, m.status === "distributed" ? adminId : null, m.status === "distributed" ? end : null]))[0].id;
    for (const a of m.attendees) await S(`insert into meeting_attendees (meeting_id, user_id, name, response) values ($1,$2,$3,'accepted')`, [id, U(a), a[0].toUpperCase() + a.slice(1)]);
    return id;
  };
  const M = {
    logiPast: await meeting({ title: "Logistics Cost & Disputes Review", start: at(-6, "11:00"), mins: 45, review: "Logistics", momOwner: "vaishnavi", status: "distributed", attendees: ["tushar", "iqbal", "vaishnavi", "jyoti", "ifham"],
      agenda: "1. Aug actuals vs budget by vendor\n2. Weight disputes — Sep raise\n3. Lost/damage claims ageing\n4. NSO unloading charges",
      summary: "B2C August actuals landed 2.2% over budget, driven by Bluedart and Blitz billing. Weight disputes for September raised with all five partners; Blitz and Delhivery CNs received. NSO unloading (Mathadi) charges are recurring and need a budget line." }),
    sopPast: await meeting({ title: "Weekly S&OP Review", start: at(-7, "16:00"), mins: 60, review: "Weekly S&OP", momOwner: "shikha", status: "distributed", attendees: ["tushar", "manish", "aaryan", "liza", "yash", "shikha", "niketh", "praveen"],
      summary: "October projections are in from all channels except pre-pack. Myntra SOR volume for October is 43K vs 80K in September. Retail forward for Nov–Dec is locked; marketplace and D2C still pending for November." }),
    rfid: await meeting({ title: "RFID Program Review", start: at(-3, "15:00"), mins: 45, review: "RFID", project: P.rfid, momOwner: "nitin", status: "submitted", attendees: ["tushar", "nitin", "manish", "medha", "faisal"],
      agenda: "Tunnel install status at YLK, handheld demo results, COCO rollout wave plan" }),
    whOps: await meeting({ title: "Warehouse Ops Review", start: at(-1, "10:30"), mins: 45, review: "Warehouse Ops", momOwner: "mahadevan", status: "pending", attendees: ["tushar", "manish", "mahadevan"] }),
    qcSync: await meeting({ title: "Quick Commerce infra sync", start: at(-1, "17:00"), mins: 30, project: P.qc, momOwner: "tushar", status: "pending", attendees: ["tushar", "manish", "faisal"] }),
    pack: await meeting({ title: "Packaging cost deep-dive", start: at(-2, "14:00"), mins: 30, program: progs.cost, momOwner: "mahadevan", status: "skipped", attendees: ["tushar", "mahadevan"] }),
    costToday: await meeting({ title: "Monthly Central Ops Cost Review — September", start: at(0, "16:30"), mins: 60, review: "Monthly Central Ops Cost", momOwner: "tushar", status: "pending", attendees: ["tushar", "manish", "iqbal", "nitin", "faisal", "mahadevan"],
      agenda: "1. September actuals by function (cut-off today)\n2. Provision accuracy\n3. Q3 projections (due 20th)\n4. Credit notes & incident expenses",
      prep: "Sep actuals still missing for Logistics B2B vendors and Staffing. Logistics July overspend persisted into August." }),
    sopToday: await meeting({ title: "Weekly S&OP Review", start: at(0, "12:00"), mins: 60, review: "Weekly S&OP", momOwner: "shikha", status: "pending", attendees: ["tushar", "manish", "aaryan", "liza", "yash", "shikha", "niketh", "praveen"] }),
    liza: await meeting({ title: "B2B marketplace volumes — Myntra SOR / Flipkart SOR", start: at(0, "15:00"), mins: 30, project: P.peak, momOwner: "liza", status: "pending", attendees: ["tushar", "liza"] }),
    logiNext: await meeting({ title: "Logistics Cost & Disputes Review", start: at(1, "11:00"), mins: 45, review: "Logistics", momOwner: "vaishnavi", status: "pending", attendees: ["tushar", "iqbal", "vaishnavi", "jyoti", "ifham"] }),
    whNext: await meeting({ title: "Warehouse Ops Review", start: at(6, "10:30"), mins: 45, review: "Warehouse Ops", momOwner: "mahadevan", status: "pending", attendees: ["tushar", "manish", "mahadevan"] }),
    rfidNext: await meeting({ title: "RFID Program Review", start: at(11, "15:00"), mins: 45, review: "RFID", project: P.rfid, momOwner: "nitin", status: "pending", attendees: ["tushar", "nitin", "manish", "medha", "faisal"] }),
  };
  await S(`update meetings set mom_status = 'skipped', pm_feedback = 'Covered in the monthly cost review instead.' where id = $1`, [M.pack]);

  const note = (meeting: string, author: string, body: string, submittedDays: number | null) =>
    S<{ id: string }>(`insert into meeting_notes (meeting_id, author_id, kind, body, submitted_at, created_at) values ($1,$2,'mom',$3,$4,$4) returning id`,
      [meeting, U(author), body, submittedDays == null ? null : at(submittedDays, "18:30")]);
  await note(M.logiPast, "vaishnavi", `Attendees: Tushar, Iqbal, Vaishnavi, Jyoti, Ifham

- August B2C actuals ₹1.95 Cr vs budget ₹1.91 Cr. Bluedart +₹16L and Blitz +₹8L over provision; Urbanebolt within budget.
- Decision: Raise billing audit for Bluedart and Blitz for Jul–Aug before paying September invoices.
- Weight disputes for September raised with Bluedart, Blitz, Delhivery, Shadowfax, Prozo. Blitz ₹5.5L and Delhivery ₹0.9L CNs received.
- Lost/damage: Shadowfax ₹4.9L and Bluedart ₹5.7L claims ageing beyond 30 days.
- NSO unloading (Mathadi) charges at Kurla and Viviana are recurring — needs a budget line from November.

Actions
- Iqbal to share vendor-wise audit sheet for Bluedart & Blitz by Friday
- Jyoti to escalate Shadowfax lost/damage claims to their KAM
- Ifham to propose NSO unloading budget line for Nov–Mar
- Vaishnavi to update credit note tracker with CN numbers`, -6);
  await note(M.sopPast, "shikha", `- October projections received from B2C-SF, B2C-MP, B2B-MP, Retail, Inbound and Liquidation. Pre-pack pending (Niketh).
- Myntra SOR October volume 43K vs 80K in September — Liza to confirm whether this is a plan change or missing input.
- Retail: 1 NSO per week through December; replenishment +4% WoW into Diwali.
- Decision: November and December projections are due by 21 October; no capacity plan sign-off without them.
- Capacity: South inward capacity at 20K/day may breach in the Diwali week.

Actions
- Niketh to submit pre-pack category projections for Oct–Dec
- Liza to confirm Myntra SOR volumes for Oct and Nov
- Manish to share South warehouse ramp-up plan for Diwali week
- Aaryan to share Shopify event calendar with % BAU uplift`, -7);
  const rfidNote = (await note(M.rfid, "nitin", `RFID program review — attendees Tushar, Nitin, Manish, Medha, Faisal

Tunnel at YLK: hardware installed, reads at 92% vs 98% target. Vendor recalibration needed; go-live slips by ~1 week.
Handheld demo at North WH went well — 3 units enough for cycle counts. Need PO for 3 more.
COCO wave 1: 12 doors identified with Medha. Store asset kits for wave 1 already in stock.
Decided to go ahead with wave 1 of 12 doors in November even if tunnel slips, since store-level tagging doesn't depend on the tunnel.
Risk: tag supply — current vendor lead time is 4 weeks; Diwali rush could delay wave 2.

Next steps:
- Nitin to get vendor recalibration done and re-test tunnel reads by next Wednesday
- Faisal to integrate handheld counts with Unicommerce cycle-count API by 25th
- Medha to share wave 1 store list with store managers' availability this week
- Manish to raise PO for 3 more handhelds
- Need confirmation from finance on RFID budget for Nov`, -2))[0].id;
  // AI-extracted suggestions awaiting the PM's review (the distribution step)
  const sug = (kind: string, payload: object, sort: number) =>
    S(`insert into meeting_suggestions (meeting_id, note_id, kind, payload, sort) values ($1,$2,$3,$4,$5)`, [M.rfid, rfidNote, kind, JSON.stringify(payload), sort]);
  await S(`update meeting_notes set ai_engine = 'claude', processed_at = $2, ai_output = $3 where id = $1`, [rfidNote, at(-2, "18:31"), JSON.stringify({
    summary: "Tunnel reads at 92% vs 98% target push YLK tunnel go-live by about a week; handheld pilot at North WH succeeded; COCO wave 1 (12 doors) goes ahead in November independent of the tunnel. Tag supply lead time is the main risk for wave 2.",
    discussion: ["Tunnel read accuracy and recalibration", "Handheld pilot results", "COCO wave 1 store list", "Tag supply lead times"],
  })]);
  await sug("action", { title: "Recalibrate YLK tunnel and re-test reads (target 98%)", owner_id: U("nitin"), owner_name: "Nitin", due_date: day(4), priority: "high", project_id: P.rfid }, 0);
  await sug("action", { title: "Integrate handheld counts with Unicommerce cycle-count API", owner_id: U("faisal"), owner_name: "Faisal", due_date: day(18), priority: "medium", project_id: P.rfid }, 1);
  await sug("action", { title: "Share COCO wave 1 store list with store-manager availability", owner_id: U("medha"), owner_name: "Medha", due_date: day(2), priority: "medium", project_id: P.rfid }, 2);
  await sug("action", { title: "Raise PO for 3 additional RFID handhelds", owner_id: U("manish"), owner_name: "Manish", due_date: day(3), priority: "medium", project_id: P.rfid }, 3);
  await sug("followup", { title: "Confirm November RFID budget with Finance", owner_id: adminId, owner_name: "Tushar", due_date: day(2), priority: "high", project_id: P.rfid }, 4);
  await sug("decision", { title: "Proceed with COCO wave 1 (12 doors) in November independent of tunnel go-live", decision_maker: "Tushar", context: "Store-level tagging doesn't depend on the YLK tunnel." }, 5);
  await sug("risk", { title: "RFID tag supply lead time (4 weeks) may delay wave 2 during Diwali", owner_name: "Nitin", owner_id: U("nitin"), probability: 3, impact: 4, mitigation: "Place wave 2 tag order now; qualify a second vendor." }, 6);

  /* ---------- tasks ---------- */
  type TaskSeed = { title: string; owner: string; team?: string; status: string; priority: string; due: number | null; created: number; project?: string; meeting?: string; source?: string; lastUpdate?: number; note?: string; waitingOn?: string; health?: string; aop?: string | null; blocker?: string; desc?: string };
  const task = async (t: TaskSeed) => {
    const id = (await S<{ id: string }>(
      `insert into tasks (title, description, owner_id, owner_team_id, requester_id, status, health, priority, due_date, original_due_date, project_id, program_id, meeting_id, source, aop_item_id,
         waiting_on_id, blocker, last_update_at, last_update_note, created_by, created_at, updated_at, completed_at, acknowledged_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,(select program_id from projects where id = $10),$11,$12,$13,$14,$15,$16,$17,$5,$18,$16,$19,$20) returning id`,
      [t.title, t.desc ?? null, t.team ? null : U(t.owner), t.team ? T(t.team) : null, adminId, t.status, t.health ?? (t.due != null && t.due < 0 && t.status !== "completed" ? "delayed" : "on_track"), t.priority,
        t.due == null ? null : day(t.due), t.project ?? null, t.meeting ?? null, t.source ?? (t.meeting ? "meeting" : "manual"), t.aop ?? null, t.waitingOn ? U(t.waitingOn) : null, t.blocker ?? null,
        at(t.lastUpdate ?? t.created, "12:00"), t.note ?? null, at(t.created, "10:00"), t.status === "completed" ? at(t.lastUpdate ?? 0, "16:00") : null,
        t.status !== "not_started" ? at(t.created, "13:00") : null]))[0].id;
    await S(`insert into task_history (task_id, actor_id, event, to_value, created_at) values ($1,$2,'created',$3,$4)`, [id, adminId, t.source ?? (t.meeting ? "meeting" : "manual"), at(t.created, "10:00")]);
    if (t.owner !== "tushar" || t.team) await S(`insert into task_history (task_id, actor_id, event, to_value, created_at) values ($1,$2,'assigned',$3,$4)`, [id, adminId, t.team ?? t.owner, at(t.created, "10:01")]);
    if (t.status !== "not_started") await S(`insert into task_history (task_id, actor_id, event, created_at) values ($1,$2,'acknowledged',$3)`, [id, U(t.owner), at(t.created, "13:00")]);
    if (["in_progress", "blocked", "waiting", "completed"].includes(t.status))
      await S(`insert into task_history (task_id, actor_id, event, from_value, to_value, created_at) values ($1,$2,'status_changed','Not started','In progress',$3)`, [id, U(t.owner), at(t.created, "13:05")]);
    if (t.note) {
      await S(`insert into task_updates (task_id, author_id, body, created_at) values ($1,$2,$3,$4)`, [id, U(t.owner), t.note, at(t.lastUpdate ?? t.created, "12:00")]);
      await S(`insert into task_history (task_id, actor_id, event, note, created_at) values ($1,$2,'updated',$3,$4)`, [id, U(t.owner), t.note, at(t.lastUpdate ?? t.created, "12:00")]);
    }
    if (t.status === "blocked") await S(`insert into task_history (task_id, actor_id, event, from_value, to_value, note, created_at) values ($1,$2,'blocked','In progress','Blocked',$3,$4)`, [id, U(t.owner), t.blocker ?? null, at(t.lastUpdate ?? t.created, "12:30")]);
    if (t.status === "completed") await S(`insert into task_history (task_id, actor_id, event, from_value, to_value, created_at) values ($1,$2,'completed','In progress','Completed',$3)`, [id, U(t.owner), at(t.lastUpdate ?? 0, "16:00")]);
    if (t.meeting) await S(`insert into entity_links (from_type, from_id, to_type, to_id, relation) values ('meeting',$1,'task',$2,'action') on conflict do nothing`, [t.meeting, id]);
    return id;
  };
  const bd = aopItem("Bluedart", "B2C");
  const tk = {
    audit: await task({ title: "Share vendor-wise billing audit for Bluedart & Blitz (Jul–Aug)", owner: "iqbal", status: "in_progress", priority: "high", due: -1, created: -6, project: P.logi, meeting: M.logiPast, lastUpdate: -4, note: "Bluedart Jul sheet done; waiting on Blitz invoice line items.", aop: bd }),
    shadowfax: await task({ title: "Escalate Shadowfax lost/damage claims (₹4.9L) to KAM", owner: "jyoti", status: "waiting", priority: "high", due: 1, created: -6, project: P.cn, meeting: M.logiPast, lastUpdate: -5, note: "Mail sent to KAM, awaiting call slot." }),
    mathadi: await task({ title: "Propose NSO unloading (Mathadi) budget line for Nov–Mar", owner: "ifham", status: "not_started", priority: "medium", due: 3, created: -6, project: P.logi, meeting: M.logiPast }),
    cnTracker: await task({ title: "Update credit-note tracker with CN numbers for Sep disputes", owner: "vaishnavi", status: "completed", priority: "medium", due: -3, created: -6, project: P.cn, meeting: M.logiPast, lastUpdate: -3, note: "Blitz CN 1287 and Delhivery CN logged." }),
    prepack: await task({ title: "Submit pre-pack category projections for Oct–Dec", owner: "niketh", status: "not_started", priority: "urgent", due: -2, created: -7, project: P.peak, meeting: M.sopPast, source: "sop" }),
    myntra: await task({ title: "Confirm Myntra SOR volumes for Oct and Nov", owner: "liza", status: "in_progress", priority: "high", due: 0, created: -7, project: P.peak, meeting: M.sopPast, lastUpdate: -6, note: "Checking with Myntra category team." }),
    ramp: await task({ title: "Share South warehouse ramp-up plan for Diwali week", owner: "manish", status: "in_progress", priority: "high", due: 2, created: -7, project: P.peak, meeting: M.sopPast, lastUpdate: -2, note: "Draft ready — need inward capacity numbers from Shikha." }),
    events: await task({ title: "Share Shopify event calendar with % BAU uplift", owner: "aaryan", status: "completed", priority: "medium", due: -4, created: -7, project: P.peak, meeting: M.sopPast, lastUpdate: -4, note: "Shared: Big Bang sale 17–20 Oct (+180% BAU), Diwali week (+120%)." }),
    sepActualsLogi: await task({ title: "Upload September actuals — Logistics B2B vendors", owner: "iqbal", status: "not_started", priority: "high", due: 0, created: -3, source: "aop", aop: aopItem("Mudita Cargo") }),
    sepActualsStaff: await task({ title: "Upload September manpower & OT actuals", owner: "mahadevan", status: "not_started", priority: "high", due: 0, created: -3, source: "aop" }),
    q3proj: await task({ title: "Collect Q3 projections from all function owners", owner: "tushar", status: "in_progress", priority: "high", due: 13, created: -3, source: "aop", lastUpdate: -1, note: "Template shared in the cost master sheet." }),
    brief: await task({ title: "Prepare September cost review pre-read", owner: "tushar", status: "in_progress", priority: "urgent", due: 0, created: -2, lastUpdate: 0, note: "Variance commentary pending from Logistics." }),
    finance: await task({ title: "Reconcile Finance Tally vs vendor invoices for Jul–Aug", owner: "tushar", status: "waiting", priority: "medium", due: 5, created: -10, waitingOn: "faisal", lastUpdate: -6, note: "Waiting for AP ledger export." }),
    wifi: await task({ title: "Complete Wi-Fi router coverage — North WH", owner: "manish", status: "in_progress", priority: "medium", due: 5, created: -12, project: P.northwh, lastUpdate: -6, note: "Routers delivered, installation scheduled." }),
    mhe: await task({ title: "Renew MHE rental contract (North)", owner: "manish", status: "not_started", priority: "low", due: 16, created: -10, project: P.northwh }),
    qcDevices: await task({ title: "Close IT device procurement for quick-commerce Phase 1", owner: "faisal", status: "blocked", priority: "high", due: 4, created: -9, project: P.qc, lastUpdate: -3, note: "Vendor quote expired.", blocker: "Waiting on revised quote — previous one expired on 30 Sep." }),
    qcPay: await task({ title: "Clear Packlabs blue-bin invoice (dated 4 Sep)", owner: "faisal", status: "completed", priority: "medium", due: -5, created: -12, project: P.qc, lastUpdate: -5, note: "Paid." }),
    unicom: await task({ title: "Unicommerce renewal — benchmark pricing and negotiate", owner: "faisal", status: "in_progress", priority: "medium", due: 20, created: -8, project: P.saas, lastUpdate: -7, note: "Got benchmark from two brands." }),
    clickpost: await task({ title: "Fix month indexation for Clickpost quarterly billing", owner: "faisal", status: "not_started", priority: "low", due: 9, created: -8, project: P.saas }),
    boxPilot: await task({ title: "Run box-size rationalisation pilot on top 20 SKUs", owner: "Logistics", team: "Logistics", status: "not_started", priority: "medium", due: 12, created: -5, project: P.logi }),
    rateCard: await task({ title: "Draft B2C rate renegotiation brief (Bluedart, Shadowfax, Delhivery)", owner: "iqbal", status: "not_started", priority: "medium", due: 21, created: -4, project: P.logi }),
    tunnelVendor: await task({ title: "Chase tunnel vendor for recalibration slot", owner: "nitin", status: "in_progress", priority: "high", due: 1, created: -3, project: P.rfid, lastUpdate: -1, note: "Slot offered for Monday." }),
    capacityTable: await task({ title: "Fill WH capacity table (required vs actual) for Oct–Dec", owner: "manish", status: "not_started", priority: "high", due: 9, created: -5, project: P.peak, source: "sop" }),
    temp: await task({ title: "Line up temp manpower agency for OND peak (North + South)", owner: "mahadevan", status: "not_started", priority: "medium", due: 15, created: -4, project: P.peak }),
    liquidation: await task({ title: "Share October liquidation actuals by warehouse", owner: "praveen", status: "not_started", priority: "low", due: 6, created: -2, source: "sop" }),
    incident: await task({ title: "Review incident expenses > ₹15K for Sep and tag root cause", owner: "tushar", status: "not_started", priority: "low", due: 8, created: -2, source: "aop" }),
    aop28: await task({ title: "Draft AOP FY27-28 planning calendar and templates", owner: "tushar", status: "not_started", priority: "low", due: 24, created: -1, project: P.aop28 }),
    weekly: await task({ title: "Send weekly program review to leadership", owner: "tushar", status: "not_started", priority: "medium", due: 2, created: 0 }),
  };
  await S(`insert into task_dependencies (task_id, depends_on_id) values ($1,$2),($3,$4)`, [tk.capacityTable, tk.prepack, tk.ramp, tk.myntra]);
  for (const [t, tag] of [[tk.audit, "aop"], [tk.audit, "logistics"], [tk.sepActualsLogi, "aop"], [tk.sepActualsStaff, "aop"], [tk.prepack, "sop"], [tk.myntra, "sop"], [tk.capacityTable, "sop"], [tk.temp, "peak"], [tk.brief, "review"]] as const)
    await S(`insert into task_tags (task_id, tag) values ($1,$2) on conflict do nothing`, [t, tag]);
  // a due-date change shows up in the journey
  await S(`update tasks set due_date = $2 where id = $1`, [tk.wifi, day(5)]);
  await S(`update tasks set original_due_date = $2 where id = $1`, [tk.wifi, day(1)]);
  await S(`insert into task_history (task_id, actor_id, event, from_value, to_value, note, created_at) values ($1,$2,'due_changed',$3,$4,'Router delivery delayed by vendor',$5)`, [tk.wifi, U("manish"), day(1), day(5), at(-6, "15:00")]);

  /* ---------- follow-ups ---------- */
  const fu = (task: string, person: string, days: number, msg: string, status = "open") =>
    S(`insert into followups (entity_type, entity_id, person_id, requested_by, channel, message, status, created_at) values ('task',$1,$2,$3,'in_app',$4,$5,$6)`, [task, U(person), adminId, msg, status, at(days, "11:00")]);
  await fu(tk.audit, "iqbal", -2, "Can you share where the Blitz audit is? Need it for the cost review.");
  await fu(tk.myntra, "liza", -3, "Any update from Myntra on SOR volumes?");
  await fu(tk.finance, "faisal", -4, "Need the AP ledger export to close the Tally reconciliation.");
  await fu(tk.events, "aaryan", -5, "Please share the event calendar.", "responded");
  for (const [t, who, d] of [[tk.audit, "tushar", -2], [tk.myntra, "tushar", -3], [tk.finance, "tushar", -4]] as const)
    await S(`insert into task_history (task_id, actor_id, event, to_value, created_at) values ($1,$2,'followed_up','in_app',$3)`, [t, U(who), at(d, "11:00")]);

  /* ---------- decisions ---------- */
  const decision = (title: string, ctx: string, reason: string, impact: string, d: number, meeting: string | null, maker: string, project: string | null, status = "made") =>
    S(`insert into decisions (title, context, reason, impact, decided_on, meeting_id, decision_maker_id, project_id, status, created_by, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [title, ctx, reason, impact, d == null ? null : day(d), meeting, U(maker), project, status, adminId, at(d ?? 0, "12:00")]);
  await decision("Audit Bluedart & Blitz billing for Jul–Aug before paying September invoices", "Bluedart +₹16L and Blitz +₹8L over provision in August.", "Repeated deviation between provision and invoice.", "Holds ~₹1 Cr of September payables until the audit closes.", -6, M.logiPast, "tushar", P.logi);
  await decision("Nov–Dec projections due 21 Oct; no capacity sign-off without them", "OND peak; marketplace and D2C November inputs still pending.", "Capacity plan quality depends on complete inputs.", "Capacity plan sign-off moves to 23 Oct.", -7, M.sopPast, "tushar", P.peak);
  await decision("Continue Mudita Cargo for B2B line-haul through December", "Mudita performing on TAT; switching mid-peak is risky.", "Avoid vendor transition during OND.", "B2B line-haul cost stays at ~₹20L/month.", -9, null, "iqbal", P.logi);
  await decision("Book SaaS costs monthly even when billed quarterly", "Clickpost and eShipz bill quarterly; provisions were lumpy.", "Right-month indexation for the cost review.", "Cleaner monthly variance.", -12, null, "tushar", P.saas);
  await S(`insert into decisions (title, context, status, due_date, decision_maker_id, project_id, created_by) values ($1,$2,'pending',$3,$4,$5,$4)`,
    ["Approve temp manpower budget for OND peak (North + South)", "Capacity plan shows South inward breach in Diwali week; OT alone won't cover it.", day(9), adminId, P.peak]);
  await S(`insert into decisions (title, context, status, due_date, decision_maker_id, project_id, created_by) values ($1,$2,'pending',$3,$4,$5,$4)`,
    ["Add NSO unloading (Mathadi) charges as a Logistics budget line", "₹1.5L+ per month in recurring NSO unloading incidents.", day(4), adminId, P.logi]);

  /* ---------- risks ---------- */
  const risk = (title: string, owner: string, p: number, i: number, mitigation: string, trigger: string, target: number, project: string | null, status = "open") =>
    S(`insert into risks (title, owner_id, probability, impact, mitigation, trigger_signal, target_date, project_id, status, created_by, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [title, U(owner), p, i, mitigation, trigger, day(target), project, status, adminId, at(-5, "12:00")]);
  await risk("South warehouse inward capacity breach in Diwali week", "manish", 4, 4, "Temp manpower + second shift for inward; shift pre-pack to North.", "Required inward > 20K units/day for 3+ days", 14, P.peak, "mitigating");
  await risk("Logistics B2C overspend persists into Q3", "iqbal", 4, 3, "Billing audit + rate renegotiation; weekly vendor-level tracking.", "Monthly B2C actual > budget by >5% for 2 months", 30, P.logi);
  await risk("RFID tunnel go-live slips past wave 1", "nitin", 3, 3, "Decouple store wave 1 from tunnel; vendor recalibration this week.", "Read accuracy < 95% after recalibration", 10, P.rfid);
  await risk("Pre-pack projections missing for OND", "niketh", 4, 3, "Escalate in S&OP review; use last-year ratios as fallback.", "No submission by 21 Oct", 14, P.peak, "escalated");
  await risk("Quick-commerce device vendor quote expired", "faisal", 2, 2, "Fetch revised quote from two vendors.", "No PO by 15 Oct", 8, P.qc);
  await risk("Credit notes ageing beyond 45 days (Shadowfax, Bluedart)", "jyoti", 3, 3, "KAM escalation; hold payments against open claims.", "Claims > 45 days old", 20, P.cn);

  /* ---------- project updates (for "what changed" comparisons) ---------- */
  const upd = (project: string, author: string, d: number, what: string, blockers: string | null, next: string, pctDone: number, health: string, expected: number) =>
    S(`insert into project_updates (project_id, author_id, what_changed, progress, blockers, decisions_required, next_steps, expected_completion, percent_complete, health, created_at) values ($1,$2,$3,$3,$4,null,$5,$6,$7,$8,$9)`,
      [project, U(author), what, blockers, next, day(expected), pctDone, health, at(d, "17:00")]);
  await upd(P.rfid, "nitin", -10, "Pilot stores live; tunnel hardware delivered to YLK.", null, "Install tunnel, handheld demo at North.", 45, "on_track", 50);
  await upd(P.rfid, "nitin", -2, "Tunnel installed but reads at 92% vs 98% target; handheld demo successful.", "Vendor recalibration slot.", "Recalibrate tunnel, finalise wave 1 stores, PO for handhelds.", 52, "at_risk", 55);
  await upd(P.logi, "iqbal", -8, "Started vendor-wise audit for July.", null, "Complete Jul–Aug audit; start box pilot.", 20, "on_track", 40);
  await upd(P.logi, "iqbal", -1, "August B2C still 2.2% over budget; Bluedart audit done for July.", "Blitz invoice line items not received.", "Close Blitz audit, share findings in cost review.", 30, "at_risk", 45);
  await upd(P.peak, "manish", -3, "October locked; Nov–Dec pending from D2C, Marketplace, Pre-pack.", "Missing projections.", "Chase inputs; draft capacity plan with fallback ratios.", 35, "at_risk", 35);
  await upd(P.northwh, "manish", -6, "CCTV complete; Wi-Fi routers delayed by vendor 4 days.", null, "Install routers; MHE renewal.", 65, "on_track", 21);

  /* ---------- comments, notifications ---------- */
  await S(`insert into comments (entity_type, entity_id, author_id, body, created_at) values ('task',$1,$2,$3,$4)`, [tk.audit, U("iqbal"), "Blitz has promised line items by tomorrow EOD.", at(-1, "18:00")]);
  await S(`insert into comments (entity_type, entity_id, author_id, body, created_at) values ('task',$1,$2,$3,$4)`, [tk.ramp, U("shikha"), "Inward capacity for Diwali week: South 26K/day required vs 20K available.", at(-1, "12:00")]);
  const n = (kind: string, title: string, body: string | null, href: string, actor: string, d: number) =>
    S(`insert into notifications (user_id, kind, title, body, href, actor_id, created_at) values ($1,$2,$3,$4,$5,$6,$7)`, [adminId, kind, title, body, href, U(actor), at(d, "09:30")]);
  await n("mom_submitted", "Nitin submitted the MoM for RFID Program Review", "4 actions, 1 decision and 1 risk are waiting for your review.", `/meetings/${M.rfid}`, "nitin", -2);
  await n("task_update", "Update on Share South warehouse ramp-up plan", "Draft ready — need inward capacity numbers from Shikha.", `/tasks/${tk.ramp}`, "manish", -2);
  await n("comment", "Iqbal commented on Bluedart & Blitz audit", "Blitz has promised line items by tomorrow EOD.", `/tasks/${tk.audit}`, "iqbal", -1);
  await n("task_update", "Completed: Update credit-note tracker", null, `/tasks/${tk.cnTracker}`, "vaishnavi", -3);

  /* ---------- activity log (sample of the audit trail) ---------- */
  const act = (actor: string, type: string, id: string, action: string, field: string | null, from: string | null, to: string | null, summary: string, d: number) =>
    S(`insert into activity_log (actor_id, entity_type, entity_id, action, field, from_value, to_value, summary, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [U(actor), type, id, action, field, from, to, summary, at(d, "15:00")]);
  await act("manish", "task", tk.wifi, "due_changed", "due_date", day(1), day(5), "Complete Wi-Fi router coverage — North WH", -6);
  await act("faisal", "task", tk.qcDevices, "blocked", "status", "In progress", "Blocked", "Close IT device procurement for quick-commerce Phase 1", -3);
  await act("nitin", "project", P.rfid, "updated", "health", "on_track", "at_risk", "RFID Expansion — COCO doors & NSO", -2);

  /* ---------- extra S&OP capacity (OND) for the capacity view ---------- */
  const DEPTS: [string, number, number][] = [["Inventory/Audit/CC", 15000, 10000], ["Inward (Ratio+Put-Away)", 20000, 10000], ["B2C-Forward-Shopify", 4500, 4000], ["B2C-Forward-MP", 6500, 3500], ["B2B-Forward-Retail", 12500, 12500], ["B2B-Forward-MP", 4000, 4000], ["B2C Return-Shopify", 2000, 1000], ["B2C Return-MP", 2000, 1500]];
  const OND: [string, number][] = [[`${day(0).slice(0, 7)}-01`, 1.18], [addMonth(1), 1.32], [addMonth(2), 1.12]];
  for (const [period, mult] of OND)
    for (const [dept, s, nth] of DEPTS) {
      const reqS = Math.round((s * mult * (dept.startsWith("Inward") ? 1.12 : 1)) / 100) * 100, reqN = Math.round((nth * mult) / 100) * 100;
      await S(`insert into sop_capacity (period, department, warehouse, required, available, remarks) values ($1,$2,'South',$3,$4,'Demo — replace with WH input') on conflict do nothing`, [period, dept, reqS, Math.round(s * 1.15)]);
      await S(`insert into sop_capacity (period, department, warehouse, required, available, remarks) values ($1,$2,'North',$3,$4,'Demo — replace with WH input') on conflict do nothing`, [period, dept, reqN, Math.round(nth * 1.2)]);
    }
}

function addMonth(n: number) {
  const d = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()).slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
