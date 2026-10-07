"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Star } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { savePersonalisation } from "@/server/settings/actions";
import { DASHBOARD_SECTIONS, NOTIFICATION_KINDS, TASK_VIEWS, type Preferences } from "@/server/settings/constants";
import { Section, Toggle, useAction } from "./bits";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function PersonalisationForm({ prefs, programs }: { prefs: Preferences; programs: { id: string; name: string; code: string | null }[] }) {
  const [p, setP] = useState<Preferences>(prefs);
  // ordered list of all sections: visible ones first in their saved order, then hidden ones
  const [order, setOrder] = useState<string[]>(() => [...prefs.dashboard.sections, ...DASHBOARD_SECTIONS.map((s) => s.key).filter((k) => !prefs.dashboard.sections.includes(k))]);
  const [visible, setVisible] = useState<Set<string>>(new Set(prefs.dashboard.sections));
  const { pending, run } = useAction();
  const move = (i: number, d: -1 | 1) => setOrder((o) => { const n = [...o]; const j = i + d; if (j < 0 || j >= n.length) return o; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const toggleSection = (k: string, on: boolean) => setVisible((s) => { const n = new Set(s); if (on) n.add(k); else n.delete(k); return n; });
  const fav = new Set(p.favouritePrograms);
  const next: Preferences = { ...p, dashboard: { sections: order.filter((k) => visible.has(k)) } };
  const dirty = JSON.stringify(next) !== JSON.stringify(prefs);

  return (
    <div>
      <Section title="Command Centre" description="Choose which sections appear on your home screen and in what order.">
        <ul className="card divide-y divide-line/70 overflow-hidden">
          {order.map((k, i) => {
            const meta = DASHBOARD_SECTIONS.find((s) => s.key === k)!;
            const on = visible.has(k);
            return (
              <li key={k} className={cn("flex items-center gap-3 px-3 py-2.5", !on && "bg-subtle/40")}>
                <GripVertical size={14} className="text-ink-4" />
                <div className="min-w-0 flex-1">
                  <div className={cn("text-[13px] font-medium", on ? "text-ink" : "text-ink-3")}>{meta.label}</div>
                  <div className="text-[12px] text-ink-3">{meta.hint}</div>
                </div>
                <div className="flex items-center gap-0.5">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded-md p-1 text-ink-3 hover:bg-subtle hover:text-ink disabled:opacity-30" aria-label="Move up"><ArrowUp size={14} /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === order.length - 1} className="rounded-md p-1 text-ink-3 hover:bg-subtle hover:text-ink disabled:opacity-30" aria-label="Move down"><ArrowDown size={14} /></button>
                </div>
                <Toggle checked={on} onChange={(v) => toggleSection(k, v)} label={`Show ${meta.label}`} />
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Favourite programs" description="Pinned to the top of program views and your weekly review.">
        {programs.length === 0 ? <p className="text-[13px] text-ink-3">No programs yet.</p> : (
          <div className="flex flex-wrap gap-2">
            {programs.map((g) => {
              const on = fav.has(g.id);
              return (
                <button key={g.id} type="button" onClick={() => setP({ ...p, favouritePrograms: on ? p.favouritePrograms.filter((x) => x !== g.id) : [...p.favouritePrograms, g.id] })}
                  className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] transition-colors", on ? "border-ink/20 bg-subtle text-ink" : "border-line bg-surface text-ink-3 hover:text-ink")}>
                  <Star size={13} className={on ? "fill-warn text-warn" : ""} />{g.name}
                </button>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Defaults" description="Where things open and when you review.">
        <div className="grid max-w-xl gap-4 sm:grid-cols-3">
          <label className="block"><span className="label">Default task view</span>
            <select className="field" value={p.defaultTaskView} onChange={(e) => setP({ ...p, defaultTaskView: e.target.value })}>
              {TASK_VIEWS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
            </select>
          </label>
          <label className="block"><span className="label">Program review cadence</span>
            <select className="field" value={p.reviewCadence.frequency} onChange={(e) => setP({ ...p, reviewCadence: { ...p.reviewCadence, frequency: e.target.value as Preferences["reviewCadence"]["frequency"] } })}>
              <option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly">Monthly</option>
            </select>
          </label>
          <label className="block"><span className="label">Review day</span>
            <select className="field" value={p.reviewCadence.weeklyReviewDay} onChange={(e) => setP({ ...p, reviewCadence: { ...p.reviewCadence, weeklyReviewDay: e.target.value } })}>
              {DAYS.map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
        </div>
      </Section>

      <Section title="Notifications" description="In-app for now; the same preferences will apply to email, Slack and WhatsApp when connected.">
        <div className="card divide-y divide-line/70">
          {NOTIFICATION_KINDS.map((k) => (
            <label key={k.key} className="flex cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5 text-[13px]">
              <span className="text-ink-2">{k.label}</span>
              <Toggle checked={p.notifications[k.key] !== false} onChange={(v) => setP({ ...p, notifications: { ...p.notifications, [k.key]: v } })} label={k.label} />
            </label>
          ))}
        </div>
      </Section>

      <div className="sticky bottom-4 mt-2 flex justify-end">
        <div className={cn("flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2 transition-opacity", dirty ? "opacity-100" : "pointer-events-none opacity-0")} style={{ boxShadow: "var(--shadow-pop)" }}>
          <span className="text-[12.5px] text-ink-3">Unsaved changes</span>
          <Button variant="ghost" size="sm" onClick={() => { setP(prefs); setOrder([...prefs.dashboard.sections, ...DASHBOARD_SECTIONS.map((s) => s.key).filter((k) => !prefs.dashboard.sections.includes(k))]); setVisible(new Set(prefs.dashboard.sections)); }}>Discard</Button>
          <Button variant="primary" size="sm" disabled={pending} onClick={() => run(() => savePersonalisation(next))}>{pending ? "Saving…" : "Save preferences"}</Button>
        </div>
      </div>
    </div>
  );
}
