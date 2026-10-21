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
