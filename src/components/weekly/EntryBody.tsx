import type { WeeklyEntry } from "@/server/weekly/model";
import { cn } from "@/lib/cn";

/** Bullet-aware text block: "- x" lines become a list, others paragraphs. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks: ({ ul: string[] } | { p: string })[] = [];
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    const m = /^([-•*]|\d+[.)])\s+(.*)$/.exec(l);
    const last = blocks.at(-1);
    if (m) { if (last && "ul" in last) last.ul.push(m[2]); else blocks.push({ ul: [m[2]] }); }
    else blocks.push({ p: l });
  }
  return (
    <div className={cn("space-y-1.5 text-[13px] leading-relaxed text-ink-2", className)}>
      {blocks.map((b, i) => "ul" in b
        ? <ul key={i} className="list-disc space-y-1 pl-5 marker:text-ink-4">{b.ul.map((x, j) => <li key={j}>{x}</li>)}</ul>
        : <p key={i}>{b.p}</p>)}
    </div>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => <div className="mb-1.5 mt-4 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-4 first:mt-0">{children}</div>;

/** Read-only render of one section's weekly entry (also the print/PDF layout). */
export function EntryBody({ e }: { e: WeeklyEntry }) {
  const empty = !e.metrics.length && !e.metrics_note && !e.updates && !e.ahead && !e.blockers && !e.tables.length && !e.images.length;
  if (empty) return <p className="text-[12.5px] text-ink-4">Nothing submitted yet.</p>;
  return (
    <div>
      {e.metrics.length > 0 && (
        <div className="mb-1 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 print:grid-cols-6">
          {e.metrics.map((m, i) => (
            <div key={i} className="rounded-lg border border-line bg-surface px-3 py-2">
              <div className="truncate text-[11px] text-ink-4">{m.label}</div>
              <div className="text-[17px] font-semibold tabular text-ink">{m.value || "—"}</div>
              {m.target && <div className="text-[11px] text-ink-4">Target {m.target}</div>}
            </div>
          ))}
        </div>
      )}
      {e.metrics_note && <><Label>North star metrics</Label><RichText text={e.metrics_note} /></>}
      {e.images.map((img) => (
        <figure key={img.id} className="mt-3 break-inside-avoid">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/weekly/image/${img.id}`} alt={img.caption || "Screenshot"} className="max-w-full rounded-lg border border-line" />
          {img.caption && <figcaption className="mt-1 text-[11.5px] text-ink-4">{img.caption}</figcaption>}
        </figure>
      ))}
      {e.tables.map((t, ti) => (
        <div key={ti} className="mt-3 break-inside-avoid">
          {t.title && <Label>{t.title}</Label>}
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full border-collapse text-[12.5px]">
              <thead><tr>{t.columns.map((c, i) => <th key={i} className="whitespace-nowrap border-b border-line bg-head px-2.5 py-1.5 text-left font-semibold text-head-ink">{c}</th>)}</tr></thead>
              <tbody>{t.rows.map((r, ri) => <tr key={ri} className="border-b border-line/60 last:border-0">{r.map((c, ci) => <td key={ci} className={cn("px-2.5 py-1.5 tabular", ci === 0 ? "text-ink" : "text-ink-2")}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </div>
      ))}
      {e.updates && <><Label>Updates</Label><RichText text={e.updates} /></>}
      {e.ahead && <><Label>Line items ahead</Label><RichText text={e.ahead} /></>}
      {e.blockers && <><Label>Blockers / dependencies</Label><RichText text={e.blockers} className="text-bad/90" /></>}
    </div>
  );
}
