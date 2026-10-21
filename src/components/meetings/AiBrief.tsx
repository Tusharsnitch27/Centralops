"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { Button, Card, CardHeader } from "@/components/ui";
import { generateMeetingBrief } from "@/server/meetings/actions";
import { cn } from "@/lib/cn";

/** AI pre-meeting brief: written on first open before the meeting, refreshable any time. */
export function AiBrief({ meetingId, initial, engine, at, auto }: { meetingId: string; initial: string | null; engine: string | null; at: string | null; auto: boolean }) {
  const [text, setText] = useState(initial);
  const [eng, setEng] = useState(engine);
  const [when, setWhen] = useState(at);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const run = () => start(async () => {
    const r = await generateMeetingBrief(meetingId);
    if (!r.ok) { setErr(r.error); return; }
    setErr(null); setText(r.data!.text); setEng(r.data!.engine); setWhen(new Date().toISOString());
  });
  const once = useRef(false);
  useEffect(() => { if (auto && !initial && !once.current) { once.current = true; run(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card>
      <CardHeader icon={<Sparkles size={15} />} title="Pre-meeting brief"
        subtitle={text ? `${eng === "claude" ? "Written by AI" : "From open actions & blockers"}${when ? ` · ${new Date(when).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : ""}` : "Open actions, who to chase, what to decide"}
        action={<Button size="xs" variant="ghost" disabled={pending} onClick={run}><RefreshCw size={12} className={cn(pending && "animate-spin")} />{text ? "Refresh" : "Write brief"}</Button>} />
      <div className="px-4 py-3.5">
        {pending && !text ? <p className="text-[13px] text-ink-3">Reading the last meeting, open actions and blockers…</p>
          : text ? <Md text={text} /> : <p className="text-[13px] text-ink-3">No brief yet.</p>}
        {err && <p className="mt-2 text-[12px] text-bad">{err}</p>}
      </div>
    </Card>
  );
}

/** The small Markdown the brief uses: **section** lines, "- " bullets, "1. " steps, **bold** inline. */
function Md({ text }: { text: string }) {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <b key={i} className="font-semibold text-ink">{p.slice(2, -2)}</b> : <span key={i}>{p}</span>));
  const out: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => { if (list) { const L = list.ordered ? "ol" : "ul"; out.push(<L key={out.length} className={cn("mb-2 space-y-1 pl-5 text-[13px] text-ink-2", list.ordered ? "list-decimal" : "list-disc")}>{list.items.map((x, i) => <li key={i}>{inline(x)}</li>)}</L>); list = null; } };
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    const b = l.match(/^[-*]\s+(.*)/), n = l.match(/^\d+[.)]\s+(.*)/);
    if (b || n) { const ordered = !!n; if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; } list.items.push((b ?? n)![1]); continue; }
    flush();
    if (!l) continue;
    const h = l.match(/^(?:#+\s*)?\*\*(.+)\*\*:?$/) ?? l.match(/^#+\s*(.+)$/);
    out.push(h ? <div key={out.length} className="mb-1 mt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-4 first:mt-0">{h[1]}</div>
      : <p key={out.length} className="mb-2 text-[13px] leading-[1.6] text-ink-2">{inline(l)}</p>);
  }
  flush();
  return <div>{out}</div>;
}
