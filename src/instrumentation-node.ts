// Daily reminder scheduler (in-process). Runs once a day at REMINDER_TIME IST (default 10:00).
// On by default in production; set REMINDER_SCHEDULER=off to rely on an external cron (/api/cron/reminders) instead.
const enabled = (process.env.REMINDER_SCHEDULER ?? (process.env.NODE_ENV === "production" ? "on" : "off")) === "on";
const g = globalThis as unknown as { __reminderTimer?: ReturnType<typeof setInterval> };

if (enabled && process.env.DATABASE_URL && !g.__reminderTimer) {
  const [hh, mm] = (process.env.REMINDER_TIME ?? "10:00").split(":").map(Number);
  const tick = async () => {
    try {
      const now = new Date();
      const ist = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(now).split(":").map(Number);
      if (ist[0] * 60 + ist[1] < hh * 60 + mm) return;
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
      const { one, q } = await import("./server/db");
      const last = await one<{ value: string }>(`select value from app_settings where key = 'reminders.auto_day'`);
      if (last?.value === day) return;
      await q(`insert into app_settings (key, value) values ('reminders.auto_day', to_jsonb($1::text)) on conflict (key) do update set value = excluded.value, updated_at = now()`, [day]);
      const { runAopReminders } = await import("./server/aop/reminders");
      const run = await runAopReminders();
      console.log(`[reminders] ${day}: ${run.checked} late/due inputs, ${run.sent.length} messages (${run.provider})`);
      // Monday: nudge owners whose weekly update isn't in yet (due 12:00 IST)
      if (new Date(`${day}T00:00:00Z`).getUTCDay() === 1) {
        const { remindWeeklyOwners } = await import("./server/weekly/delivery");
        const n = await remindWeeklyOwners(day, null);
        console.log(`[reminders] weekly update: reminded ${n} owners`);
      }
    } catch (e) {
      console.error("[reminders] run failed", e instanceof Error ? e.message : e);
    }
  };
  g.__reminderTimer = setInterval(tick, 10 * 60_000);
  setTimeout(tick, 30_000);
  console.log(`[reminders] scheduler on — daily at ${process.env.REMINDER_TIME ?? "10:00"} IST`);
}
export {};

// Daily Snowflake → S&OP actuals refresh at SOP_SYNC_TIME IST (default 07:00). Same on/off switch as the reminders.
const gs = globalThis as unknown as { __sopSyncTimer?: ReturnType<typeof setInterval> };
if (enabled && process.env.DATABASE_URL && !gs.__sopSyncTimer) {
  const [sh, sm] = (process.env.SOP_SYNC_TIME ?? "07:00").split(":").map(Number);
  const syncTick = async () => {
    try {
      const now = new Date();
      const ist = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(now).split(":").map(Number);
      if (ist[0] * 60 + ist[1] < sh * 60 + sm) return;
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
      const { one, q } = await import("./server/db");
      if ((await one<{ value: string }>(`select value from app_settings where key = 'sop.sync_day'`))?.value === day) return;
      const { sfConfigured } = await import("./server/snowflake");
      if (!sfConfigured()) return;
      // a failed day is retried hourly (e.g. after the warehouse is fixed) — the day only counts as done once every feed is ok
      const last = await one<{ value: string }>(`select value from app_settings where key = 'sop.sync_attempt'`);
      if (last?.value && Date.now() - Date.parse(last.value) < 55 * 60_000) return;
      await q(`insert into app_settings (key, value) values ('sop.sync_attempt', to_jsonb($1::text)) on conflict (key) do update set value = excluded.value, updated_at = now()`, [now.toISOString()]);
      const { runSync } = await import("./server/sop/sync");
      const r = await runSync(undefined, "schedule");
      if (r.every((x) => x.status === "ok"))
        await q(`insert into app_settings (key, value) values ('sop.sync_day', to_jsonb($1::text)) on conflict (key) do update set value = excluded.value, updated_at = now()`, [day]);
      console.log(`[sop-sync] ${day}: ${r.map((x) => `${x.feed} ${x.status}`).join(", ")}`);
      // AOP logistics shipments per channel (cp_1 + eShipz) — own try so it never blocks the S&OP day
      try { const { pullLogisticsVolumes } = await import("./server/aop/logistics"); const l = await pullLogisticsVolumes(); console.log(`[aop-logistics] ${l.written} rows from ${l.from}`); }
      catch (e) { console.error("[aop-logistics] pull failed", e instanceof Error ? e.message : e); }
      // warehouse stage output (picked / packed / manifested / dispatched / putaway) for the daily planner — own try, never blocks the day
      try { const { pullStageOutput } = await import("./server/wcm/feed"); const w = await pullStageOutput(); console.log(`[wcm-stage] ${w.read} rows from ${w.from}`); }
      catch (e) { console.error("[wcm-stage] pull failed", e instanceof Error ? e.message : e); }
      try { const { pullSla } = await import("./server/wcm/feed"); const w = await pullSla(); console.log(`[wcm-sla] ${w.read} cohort rows from ${w.from}`); }
      catch (e) { console.error("[wcm-sla] pull failed", e instanceof Error ? e.message : e); }
    } catch (e) {
      console.error("[sop-sync] run failed", e instanceof Error ? e.message : e);
    }
  };
  gs.__sopSyncTimer = setInterval(syncTick, 10 * 60_000);
  setTimeout(syncTick, 60_000);
  console.log(`[sop-sync] daily Snowflake refresh at ${process.env.SOP_SYNC_TIME ?? "07:00"} IST`);
}

// Daily manpower pull from the manpower tool's read-only API at MANPOWER_SYNC_TIME IST (default 08:00); a failed day retries hourly.
const gm = globalThis as unknown as { __mpSyncTimer?: ReturnType<typeof setInterval> };
if (enabled && process.env.DATABASE_URL && (process.env.ATTENDANCE_API_BASE_URL || process.env.MANPOWER_API_URL) && !gm.__mpSyncTimer) {
  const [mh, mmin] = (process.env.MANPOWER_SYNC_TIME ?? "08:00").split(":").map(Number);
  const mpTick = async () => {
    try {
      const now = new Date();
      const ist = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(now).split(":").map(Number);
      if (ist[0] * 60 + ist[1] < mh * 60 + mmin) return;
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
      const { one, q } = await import("./server/db");
      const set = (k: string, v: string) => q(`insert into app_settings (key, value) values ($1, to_jsonb($2::text)) on conflict (key) do update set value = excluded.value, updated_at = now()`, [k, v]);
      if ((await one<{ value: string }>(`select value from app_settings where key = 'manpower.sync_day'`))?.value === day) return;
      const last = await one<{ value: string }>(`select value from app_settings where key = 'manpower.sync_attempt'`);
      if (last?.value && Date.now() - Date.parse(last.value) < 55 * 60_000) return;
      await set("manpower.sync_attempt", now.toISOString());
      const { pullManpower } = await import("./server/manpower/feed");
      const r = await pullManpower("schedule");
      if (r.ok) await set("manpower.sync_day", day);
      console.log(`[manpower] ${day}: ${r.ok ? r.note : `failed — ${r.error}`}`);
    } catch (e) {
      console.error("[manpower] run failed", e instanceof Error ? e.message : e);
    }
  };
  gm.__mpSyncTimer = setInterval(mpTick, 10 * 60_000);
  setTimeout(mpTick, 90_000);
  console.log(`[manpower] daily pull at ${process.env.MANPOWER_SYNC_TIME ?? "08:00"} IST`);
}
