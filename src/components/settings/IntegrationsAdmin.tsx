"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlarmClock, CalendarClock, CheckCircle2, Copy, Download, KeyRound, MessageCircle, Play, Send, Workflow } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import { ago, fmtDate } from "@/lib/dates";
import { describeRule, type DeadlineConfig, type DeadlineRule, type Measure } from "@/server/aop/deadlines";
import { generateWebhookSecret, runRemindersNow, saveDeadlines, saveMyWhatsApp, saveWhatsAppConfig, sendTestWhatsApp } from "@/server/integrations/waActions";
import type { IntegrationsData } from "@/server/integrations/queries";
import type { WaProvider } from "@/server/integrations/whatsapp";

const Section = ({ icon, title, sub, right, children }: { icon: React.ReactNode; title: string; sub?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) => (
  <div className="card overflow-hidden">
    <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
      <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[16px] font-bold tracking-[-0.01em]">{title}</div>
        {sub && <div className="text-[12.5px] text-ink-3">{sub}</div>}
      </div>
      {right}
    </div>
    <div className="p-5">{children}</div>
  </div>
);

export function IntegrationsAdmin({ d }: { d: IntegrationsData }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState({ provider: (d.wa.provider === "dry_run" ? "webhook" : d.wa.provider) as WaProvider, webhookUrl: d.wa.webhookUrl, secret: "", template: d.wa.template, lang: d.wa.lang, phoneNumberId: d.wa.phoneNumberId, metaToken: "" });
  const [phone, setPhone] = useState(d.myPhone ?? "");
  const [run, setRun] = useState<null | { checked: number; sent: { to: string; fn: string; what: string; status: string; reason?: string }[]; provider: string }>(null);
  const act = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, msg?: string) => start(async () => {
    const r = await fn();
    if (!r.ok) return toast(r.error ?? "Failed", "error");
    toast(msg ?? r.message ?? "Done", "success"); router.refresh();
  });
  const payload = JSON.stringify({ event: "reminder", to: "919876543210", name: "Iqbal Akram Choudhary", template: f.template, language: f.lang,
    params: ["Iqbal", "Logistics Sep ’26 actuals", "Oct 12", "2 days overdue", "14 of 23", `${d.appUrl}/aop/inputs?period=2026-09-01`],
    text: "Hi Iqbal, Logistics Sep ’26 actuals were due on Oct 12 — 2 days overdue. 14 of 23 lines pending… Update here: …" }, null, 2);

  return (
    <div className="space-y-6">
      {/* ---------- WhatsApp via n8n ---------- */}
      <Section icon={<MessageCircle size={17} />} title="WhatsApp reminders" sub="Central Ops calls your n8n webhook; n8n sends the WhatsApp message."
        right={<Badge tone={d.wa.configured ? "green" : "amber"} dot>{d.wa.configured ? `Live · ${d.wa.provider === "webhook" ? "n8n webhook" : "Meta Cloud API"}` : "Dry run — nothing is sent yet"}</Badge>}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-3.5">
            <div className="inline-flex rounded-full bg-subtle p-1 text-[12.5px] font-semibold">
              {([["webhook", "n8n webhook"], ["meta", "Meta Cloud API (direct)"], ["dry_run", "Dry run"]] as [WaProvider, string][]).map(([k, l]) => (
                <button key={k} onClick={() => setF({ ...f, provider: k })} className={cn("rounded-full px-3 py-1.5", f.provider === k ? "bg-white text-ink shadow-[var(--shadow-card)]" : "text-ink-3")}>{l}</button>
              ))}
            </div>
            {f.provider === "webhook" && (
              <>
                <label className="block"><span className="label">n8n webhook URL (Production URL of the Webhook node)</span>
                  <input className="field" value={f.webhookUrl} onChange={(e) => setF({ ...f, webhookUrl: e.target.value })} placeholder="https://n8n.snitch-workflow.com/webhook/central-ops-whatsapp" /></label>
                <label className="block"><span className="label">Shared secret {d.wa.hasSecret && <span className="font-normal text-ink-4">(set — leave blank to keep)</span>}</span>
                  <div className="flex gap-1.5">
                    <input className="field font-mono text-[12.5px]" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} placeholder={d.wa.hasSecret ? "••••••••••" : "Generate one"} />
                    <Button size="md" onClick={() => start(async () => { const r = await generateWebhookSecret(); if (r.ok) setF((x) => ({ ...x, secret: r.data!.secret })); })}><KeyRound size={14} /> Generate</Button>
                  </div>
                  <span className="mt-1 block text-[11.5px] text-ink-3">Sent as the <code className="rounded bg-subtle px-1">x-central-ops-secret</code> header; n8n rejects calls without it.</span></label>
              </>
            )}
            {f.provider === "meta" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block"><span className="label">Phone number ID</span><input className="field" value={f.phoneNumberId} onChange={(e) => setF({ ...f, phoneNumberId: e.target.value })} /></label>
                <label className="block"><span className="label">Permanent access token {d.wa.hasMetaToken && <span className="font-normal text-ink-4">(set)</span>}</span><input className="field font-mono text-[12.5px]" value={f.metaToken} onChange={(e) => setF({ ...f, metaToken: e.target.value })} placeholder={d.wa.hasMetaToken ? "••••••••" : ""} /></label>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="label">Approved template name</span><input className="field" value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })} /></label>
              <label className="block"><span className="label">Template language</span><input className="field" value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value })} /></label>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button variant="primary" disabled={pending} onClick={() => act(() => saveWhatsAppConfig(f))}>Save</Button>
              <span className="mx-1 h-5 w-px bg-line" />
              <input className="field h-8 w-[170px] py-1 text-[12.5px]" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Your WhatsApp no." />
              <Button disabled={pending} onClick={() => act(() => saveMyWhatsApp(phone), "Number saved")}>Save no.</Button>
              <Button disabled={pending || !d.myPhone} onClick={() => start(async () => { const r = await sendTestWhatsApp(); toast(r.ok ? (r.data?.status === "dry_run" ? "Dry run logged — configure n8n to actually send" : `Test ${r.data?.status}`) : r.error, r.ok ? "success" : "error"); router.refresh(); })}>
                <Send size={13} /> Send test to me
              </Button>
            </div>
            <div className="rounded-xl bg-subtle px-3.5 py-2.5 text-[12.5px] text-ink-2">
              <b className="font-bold text-ink">{d.phones.with_phone}/{d.phones.total}</b> people have a WhatsApp number. Add numbers in <a href="/settings?tab=users" className="font-semibold text-accent-ink underline">Users &amp; access</a> — reminders skip anyone without one.
            </div>
          </div>

          {/* setup guide */}
          <div className="rounded-2xl border border-line bg-subtle/50 p-4">
            <div className="mb-3 flex items-center gap-2 text-[14px] font-bold"><Workflow size={16} className="text-accent" /> Set up in n8n (≈10 minutes)</div>
            <ol className="space-y-2.5 text-[13px] text-ink-2">
              {[
                <><b>Download</b> the ready-made workflow and in n8n choose <b>Workflows → Import from file</b>.</>,
                <>Open <b>Secret matches?</b> and paste the secret from the left (generate + save it here first — the download pre-fills it).</>,
                <>Open <b>Send WhatsApp</b>: replace <code className="rounded bg-white px-1">YOUR_PHONE_NUMBER_ID</code> and add a <b>Header Auth</b> credential — <code className="rounded bg-white px-1">Authorization: Bearer &lt;token&gt;</code>. Using Interakt/Gupshup/AiSensy instead? Point this node at their send-template API.</>,
                <>In Meta Business Manager create a <b>Utility</b> template named <code className="rounded bg-white px-1">{f.template}</code> with 6 variables: <i>Hi {"{{1}}"}, {"{{2}}"} were due on {"{{3}}"} ({"{{4}}"}). {"{{5}}"} lines pending. Update: {"{{6}}"}</i></>,
                <><b>Activate</b> the workflow, copy the Webhook node’s <b>Production URL</b> into the field on the left, save, then <b>Send test to me</b>.</>,
              ].map((s, i) => (
                <li key={i} className="flex gap-2.5"><span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-white">{i + 1}</span><span>{s}</span></li>
              ))}
            </ol>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href="/api/integrations/n8n-workflow" className="inline-flex h-8 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[12.5px] font-semibold text-white hover:bg-ink-2"><Download size={13} /> Download n8n workflow</a>
              <Button size="sm" onClick={() => { navigator.clipboard?.writeText(payload); toast("Sample payload copied", "success"); }}><Copy size={13} /> Copy sample payload</Button>
            </div>
            <pre className="mt-3 max-h-[160px] overflow-auto rounded-xl bg-[#111214] p-3 text-[11px] leading-relaxed text-white/80">{payload}</pre>
          </div>
        </div>
      </Section>

      {/* ---------- Deadlines & cadence ---------- */}
      {d.cycle && <DeadlinesCard cycleId={d.cycle.id} cycleName={d.cycle.name} initial={d.cycle.deadlines} functions={d.cycle.functions} />}

      {/* ---------- What's late right now ---------- */}
      <Section icon={<AlarmClock size={17} />} title="Due & late inputs right now" sub={d.lastRun ? <>Last reminder run {ago(d.lastRun.at)} · {d.lastRun.sent} messages · Daily at {d.reminderTime} IST {d.scheduler ? "(scheduler on)" : "(scheduler off — use the cron URL)"}</> : <>Daily at {d.reminderTime} IST {d.scheduler ? "(scheduler on)" : "(scheduler off in this environment)"}</>}
        right={<div className="flex gap-2">
          <Button disabled={pending} onClick={() => start(async () => { const r = await runRemindersNow({}); if (r.ok) { setRun(r.data!); toast(`${r.data!.sent.length} reminders (${r.data!.provider})`, "success"); router.refresh(); } else toast(r.error, "error"); })}><Play size={13} /> Run today’s reminders</Button>
          <Button variant="primary" disabled={pending || !d.late.length} onClick={() => start(async () => { const r = await runRemindersNow({ force: true }); if (r.ok) { setRun(r.data!); toast(`Reminded ${r.data!.sent.length} (${r.data!.provider})`, "success"); router.refresh(); } else toast(r.error, "error"); })}><Send size={13} /> Remind everyone late now</Button>
        </div>}>
        {d.late.length ? (
          <table className="table-base">
            <thead><tr><th>Function</th><th>Owner</th><th>Input</th><th>Due</th><th>Status</th><th className="text-right">Pending lines</th></tr></thead>
            <tbody>{d.late.map((x) => (
              <tr key={`${x.sectionId}${x.kind}${x.period}`}>
                <td className="font-semibold">{x.fn}</td><td>{x.ownerName ?? "—"}</td>
                <td>{new Date(`${x.period}T00:00:00Z`).toLocaleString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" })} {x.kind === "budget" ? "budget" : x.kind === "projections" ? "provision" : "actuals"}</td>
                <td className="tabular">{fmtDate(x.due)}</td>
                <td>{x.daysLate === 0 ? <Badge tone="amber">Due today</Badge> : <Badge tone="red">{x.daysLate}d late</Badge>}</td>
                <td className="text-right tabular"><b>{x.missing}</b> / {x.total}</td>
              </tr>))}</tbody>
          </table>
        ) : <div className="flex items-center gap-2 text-[13.5px] text-ink-3"><CheckCircle2 size={16} className="text-accent" /> Nothing due or late today.</div>}
        {run && (
          <div className="mt-4 rounded-xl bg-subtle p-3 text-[12.5px]">
            <b className="font-bold">Run result</b> · {run.checked} items checked · provider <b>{run.provider}</b>
            <ul className="mt-1.5 space-y-0.5">{run.sent.map((s, i) => <li key={i}>{s.to} — {s.fn} {s.what}: <b className={s.status === "failed" ? "text-bad" : s.status === "skipped" ? "text-warn" : "text-accent-ink"}>{s.status}</b>{s.reason ? ` (${s.reason})` : ""}</li>)}</ul>
          </div>
        )}
        <div className="mt-4 text-[12px] text-ink-3">
          External cron (optional, e.g. Coolify → Scheduled Tasks): <code className="rounded bg-subtle px-1.5 py-0.5">curl -fsS -H &quot;Authorization: Bearer $CRON_SECRET&quot; {d.appUrl || "https://<host>"}/api/cron/reminders</code>
          {!d.cronSecretSet && <span className="text-warn"> · set CRON_SECRET to enable it</span>}
        </div>
      </Section>

      {/* ---------- Message log ---------- */}
      <Section icon={<Send size={17} />} title="Message log" sub="Every WhatsApp attempt — sent, dry run, skipped (no number / opted out) or failed">
        {d.log.length ? (
          <table className="table-base">
            <thead><tr><th>When</th><th>To</th><th>Status</th><th>Message</th></tr></thead>
            <tbody>{d.log.map((l) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap text-ink-3">{ago(l.created_at)}</td>
                <td><div className="font-semibold">{l.to_name ?? "—"}</div><div className="text-[11.5px] text-ink-4">{l.to_phone ? `+${l.to_phone}` : "no number"}</div></td>
                <td><Badge tone={l.status === "sent" ? "green" : l.status === "failed" ? "red" : l.status === "dry_run" ? "info" : "amber"}>{l.status.replace("_", " ")}</Badge>{l.error && <div className="mt-0.5 text-[11px] text-ink-4">{l.error}</div>}</td>
                <td className="max-w-[520px] text-[12.5px] text-ink-2">{l.body}</td>
              </tr>))}</tbody>
          </table>
        ) : <div className="text-[13px] text-ink-3">No messages yet.</div>}
      </Section>
    </div>
  );
}

const MEASURES: [Measure, string][] = [["plan", "Budget"], ["forecast", "Provision"], ["actual", "Actuals"]];

function RuleEdit({ r, onChange }: { r: DeadlineRule; onChange: (r: DeadlineRule) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <input type="number" min={1} max={31} value={r.day} onChange={(e) => onChange({ ...r, day: Number(e.target.value) })} className="field h-8 w-16 py-1 text-center text-[13px] font-bold tabular" />
      <select value={r.monthOffset} onChange={(e) => onChange({ ...r, monthOffset: Number(e.target.value) })} className="field h-8 w-auto py-1 text-[12.5px]">
        <option value={-1}>of the previous month</option><option value={0}>of the same month</option><option value={1}>of the next month</option>
      </select>
    </div>
  );
}

function DeadlinesCard({ cycleId, cycleName, initial, functions }: { cycleId: string; cycleName: string; initial: DeadlineConfig; functions: string[] }) {
  const [c, setC] = useState<DeadlineConfig>(initial);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const overrides = Object.entries(c.overrides).flatMap(([fn, o]) => (Object.entries(o) as [Measure, DeadlineRule][]).map(([m, r]) => ({ fn, m, r })));
  const setOverride = (fn: string, m: Measure, r: DeadlineRule | null) => setC((x) => {
    const o = { ...x.overrides, [fn]: { ...(x.overrides[fn] ?? {}) } };
    if (r) o[fn][m] = r; else delete o[fn][m];
    if (!Object.keys(o[fn]).length) delete o[fn];
    return { ...x, overrides: o };
  });
  const [newFn, setNewFn] = useState(functions.find((f) => !c.overrides[f]) ?? functions[0] ?? "");
  const [newM, setNewM] = useState<Measure>("actual");
  return (
    <Section icon={<CalendarClock size={17} />} title="AOP deadlines & reminder cadence" sub={`${cycleName} — when each month’s inputs are due, and how reminders escalate`}
      right={<Button variant="primary" disabled={pending} onClick={() => start(async () => { const r = await saveDeadlines({ cycleId, config: c }); toast(r.ok ? "Deadlines saved" : r.error, r.ok ? "success" : "error"); if (r.ok) router.refresh(); })}>Save deadlines</Button>}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-4">For month M, due by</div>
          <div className="space-y-2.5">
            {MEASURES.map(([m, l]) => (
              <div key={m} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-subtle/70 px-3.5 py-2.5">
                <span className="w-24 text-[14px] font-bold">{l}</span>
                <RuleEdit r={c[m]} onChange={(r) => setC({ ...c, [m]: r })} />
              </div>
            ))}
          </div>
          <div className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-4">Function exceptions</div>
          <div className="space-y-2">
            {overrides.map(({ fn, m, r }) => (
              <div key={fn + m} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line px-3.5 py-2.5">
                <span className="text-[13.5px]"><b className="font-bold">{fn}</b> · {MEASURES.find(([k]) => k === m)?.[1]}</span>
                <div className="flex items-center gap-2"><RuleEdit r={r} onChange={(nr) => setOverride(fn, m, nr)} /><button className="text-[12px] font-semibold text-ink-4 hover:text-bad" onClick={() => setOverride(fn, m, null)}>Remove</button></div>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <select value={newFn} onChange={(e) => setNewFn(e.target.value)} className="field h-8 w-auto py-1 text-[12.5px]">{functions.map((f) => <option key={f}>{f}</option>)}</select>
              <select value={newM} onChange={(e) => setNewM(e.target.value as Measure)} className="field h-8 w-auto py-1 text-[12.5px]">{MEASURES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <Button size="sm" onClick={() => newFn && setOverride(newFn, newM, { ...c[newM] })}>Add exception</Button>
            </div>
          </div>
        </div>
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-4">Reminder cadence</div>
          <div className="space-y-2.5 rounded-2xl bg-subtle/70 p-4 text-[13.5px]">
            <label className="flex items-center justify-between gap-3"><span>Send reminders</span><input type="checkbox" checked={c.reminders.enabled} onChange={(e) => setC({ ...c, reminders: { ...c.reminders, enabled: e.target.checked } })} className="size-4 accent-[var(--color-accent)]" /></label>
            <label className="flex items-center justify-between gap-3"><span>Nudge on the due date</span><input type="checkbox" checked={c.reminders.dueDayNudge} onChange={(e) => setC({ ...c, reminders: { ...c.reminders, dueDayNudge: e.target.checked } })} className="size-4 accent-[var(--color-accent)]" /></label>
            {([["everyDays", "Repeat while late, every", "days"], ["maxPerItem", "Stop after", "reminders"], ["escalateAfterDays", "Escalate to the PM after", "days late"]] as const).map(([k, l, u]) => (
              <label key={k} className="flex items-center justify-between gap-3"><span>{l}</span>
                <span className="flex items-center gap-1.5"><input type="number" min={1} max={30} value={c.reminders[k]} onChange={(e) => setC({ ...c, reminders: { ...c.reminders, [k]: Number(e.target.value) } })} className="field h-8 w-16 py-1 text-center font-bold tabular" /><span className="text-[12.5px] text-ink-3">{u}</span></span>
              </label>
            ))}
          </div>
          <div className="mt-4 rounded-2xl border border-line p-4 text-[13px] leading-relaxed text-ink-2">
            <b className="font-bold text-ink">In plain words:</b> Budget is due on the {describeRule(c.plan)}, provision on the {describeRule(c.forecast)}, actuals on the {describeRule(c.actual)}
            {overrides.map(({ fn, m, r }) => <span key={fn + m}> — <b>{fn}</b> {MEASURES.find(([k]) => k === m)?.[1].toLowerCase()} on the {describeRule(r)}</span>)}.
            {c.reminders.enabled ? <> Owners get a WhatsApp {c.reminders.dueDayNudge ? "on the due date and " : ""}every {c.reminders.everyDays} days while late (max {c.reminders.maxPerItem}); you’re copied once it’s {c.reminders.escalateAfterDays}+ days late.</> : " Reminders are off."}
          </div>
        </div>
      </div>
    </Section>
  );
}
