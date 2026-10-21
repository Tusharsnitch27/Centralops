import { Suspense } from "react";
import Link from "next/link";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { Collapsible } from "@/components/ui/Collapsible";
import { RichText } from "@/components/weekly/EntryBody";
import { WeeklyTabs } from "@/components/weekly/WeeklyTabs";
import { canOverview, requireUser } from "@/server/auth";
import { redirect } from "next/navigation";
import { q } from "@/server/db";
import { currentWeekOf, ensureReport, loadReport } from "@/server/weekly/model";
import { fmtDate } from "@/lib/dates";

export const metadata = { title: "Weekly updates · At a glance" };

const bullets = (s: string) => s.split("\n").map((l) => l.replace(/^\s*([-•*]|\d+[.)])\s*/, "").trim()).filter((l) => l.length > 3 && !/^(done|pending|waiting):?$/i.test(l));
const FOCUS = /^(key focus ahead|focus ahead|next steps?|next week|line items ahead)\s*[:\-–]\s*/i;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, "")}…` : s);
const ENTRY = { pending: { label: "Pending", tone: "red" as const }, draft: { label: "Draft", tone: "amber" as const }, submitted: { label: "Submitted", tone: "green" as const } };

/** Last week's highlights next to what each section committed for this week. */
export default async function Glance({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const u = await requireUser();
  if (!canOverview(u)) redirect("/weekly");
  const sp = await searchParams;
  const cur = currentWeekOf();
  const weekOf = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : cur;
  if (weekOf >= cur) await ensureReport(weekOf);
  const prevWeek = (await q<{ week_of: string }>(`select week_of from weekly_reports where week_of < $1 order by week_of desc limit 1`, [weekOf]))[0]?.week_of;
  const [now, prev] = await Promise.all([loadReport(weekOf, u), prevWeek ? loadReport(prevWeek, u) : null]);
  if (!now) return <EmptyState title="No update for that week" />;
  const rows = now.rows.map((r) => ({ r, p: prev?.rows.find((x) => x.section.id === r.section.id) ?? null }));
  const groups = [...new Set(rows.map((x) => x.r.section.group_name))];

  return (
    <div>
      <PageHeader title="Weekly updates" subtitle={<>Last week ({prevWeek ? fmtDate(prevWeek) : "—"}) and what’s coming up for {fmtDate(weekOf)}</>} />
      <Suspense><WeeklyTabs /></Suspense>

      {prev?.report.exec_summary && (
        <div className="mb-5">
          <Collapsible id="weekly:glance:exec" title={`Executive summary · ${fmtDate(prev.report.week_of)}`} sub="What went to leadership last week">
            <div className="p-4 md:p-5"><RichText text={prev.report.exec_summary} className="space-y-2.5" /></div>
          </Collapsible>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="table-wrap">
          <table className="table-base min-w-[860px]">
            <thead><tr>
              <th className="w-[190px]">Section</th>
              <th>Last week · {prevWeek ? fmtDate(prevWeek) : "—"}</th>
              <th>Coming up · committed for {fmtDate(weekOf)}</th>
              <th className="w-[110px]">This week</th>
            </tr></thead>
            {groups.map((g) => (
              <tbody key={g}>
                <tr><td colSpan={4} className="!h-8 bg-subtle/60 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-4">{g}</td></tr>
                {rows.filter((x) => x.r.section.group_name === g).map(({ r, p }) => {
                  const e = p?.entry;
                  const hi = e ? [...(e.metrics.length ? [e.metrics.slice(0, 3).map((m) => `${m.label} ${m.value}${m.target ? ` (target ${m.target})` : ""}`).join(" · ")] : []), ...(e.metrics_note ? [e.metrics_note] : []), ...bullets(e.updates).filter((b) => !FOCUS.test(b)),
                    // tables: latest column of the first rows
                    ...e.tables.map((t) => `${t.title ? `${t.title}: ` : ""}${t.rows.slice(0, 3).map((r) => `${r[0]} ${r.at(-1)}`).join(" · ")}${t.columns.length > 1 ? ` (${t.columns.at(-1)})` : ""}`)].slice(0, 3) : [];
                  // "Key focus ahead: …" written inside updates counts as coming up
                  const ahead = e ? (bullets(e.ahead).length ? bullets(e.ahead) : bullets(e.updates).filter((b) => FOCUS.test(b)).map((b) => b.replace(FOCUS, "").trim())) : [];
                  const blocker = e ? bullets(e.blockers)[0] : undefined;
                  const st = ENTRY[r.entry.status];
                  return (
                    <tr key={r.section.id} className="align-top">
                      <td className="!py-3">
                        <div className="font-semibold text-ink">{r.section.name}</div>
                        <div className="text-[11.5px] text-ink-4">{r.section.owners.join(", ")}</div>
                      </td>
                      <td className="!py-3">
                        {hi.length ? <ul className="list-disc space-y-1 pl-4 text-[12.5px] text-ink-2 marker:text-ink-4">{hi.map((h, i) => <li key={i}>{clip(h, 170)}</li>)}</ul> : <span className="text-[12px] text-ink-4">No update</span>}
                        {blocker && <div className="mt-1.5 text-[12px] text-bad"><b className="font-semibold">Blocker:</b> {clip(blocker, 140)}</div>}
                      </td>
                      <td className="!py-3">
                        {ahead.length ? (
                          <ul className="list-disc space-y-1 pl-4 text-[12.5px] text-ink-2 marker:text-accent">{ahead.slice(0, 4).map((h, i) => <li key={i}>{clip(h, 120)}</li>)}
                            {ahead.length > 4 && <li className="list-none text-ink-4">+{ahead.length - 4} more</li>}</ul>
                        ) : <span className="text-[12px] text-ink-4">Nothing listed</span>}
                      </td>
                      <td className="!py-3">
                        <Badge tone={st.tone} dot>{st.label}</Badge>
                        <Link href={`/weekly?week=${weekOf}#${r.entry.id}`} className="mt-1.5 block text-[11.5px] text-ink-3 hover:text-ink">Open →</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      </div>
    </div>
  );
}
