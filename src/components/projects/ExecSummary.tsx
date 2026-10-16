// Server components: auto-generated executive summary (+ optional AI polish streamed in).
import { Suspense } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { polishExecSummary, type ProjectExecSummary } from "@/server/projects/exec";
import { CopyText } from "./CopyText";

export function ExecSummaryCard({ name, s, aiEnabled }: { name: string; s: ProjectExecSummary; aiEnabled: boolean }) {
  const body = s.parts.filter((p) => p.label !== "Recommended intervention");
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-semibold text-ink">Executive summary</h2>
          <span className="text-[11.5px] text-ink-4">auto-generated from milestones, tasks, risks, decisions & updates</span>
        </div>
        <CopyText text={`${name} — ${s.text}`} label="Copy" />
      </div>
      <div className="px-4 py-4">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-2.5 text-[13px] sm:grid-cols-[130px_1fr]">
          {body.map((p) => (
            <div key={p.label} className="contents">
              <dt className="text-[12px] text-ink-3 sm:pt-px">{p.label}</dt>
              <dd className={cn("text-ink-2", p.tone === "red" && "font-medium text-bad", p.tone === "amber" && "text-warn", p.tone === "green" && "font-medium text-ok", p.label === "Project status" && "tracking-wide")}>{p.value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 rounded-lg border border-line bg-subtle/60 px-3.5 py-3">
          <div className="eyebrow mb-1">Recommended intervention</div>
          <p className="text-[13px] font-medium leading-relaxed text-ink">{s.recommendation}.</p>
          {s.recommendations.length > 2 && (
            <ul className="mt-2 space-y-0.5 text-[12.5px] text-ink-3">
              {s.recommendations.slice(2, 5).map((r) => <li key={r}>· {r}</li>)}
            </ul>
          )}
        </div>
        {aiEnabled && <Suspense fallback={<div className="mt-3 h-4 w-2/3 skeleton" />}><Polished name={name} text={s.text} /></Suspense>}
      </div>
    </section>
  );
}

async function Polished({ name, text }: { name: string; text: string }) {
  const out = await polishExecSummary(name, text);
  if (!out) return null;
  return (
    <p className="mt-3 flex gap-2 text-[13px] leading-relaxed text-ink-2">
      <Sparkles size={13} className="mt-1 shrink-0 text-violet" />{out}
    </p>
  );
}
