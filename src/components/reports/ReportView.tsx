import Link from "next/link";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/meta";
import type { Block, ReportDoc } from "@/server/reports/doc";

const toneText: Partial<Record<Tone, string>> = { red: "text-bad", amber: "text-warn", green: "text-ok", info: "text-info" };
const toneDot: Partial<Record<Tone, string>> = { red: "bg-bad", amber: "bg-warn", green: "bg-ok", info: "bg-info" };

/** Printable document rendering of a ReportDoc. */
export function ReportView({ doc, aiSummary }: { doc: ReportDoc; aiSummary?: string | null }) {
  return (
    <article className="print-doc card mx-auto max-w-[860px] px-6 py-7 md:px-10 md:py-9">
      <header className="mb-6 border-b border-line pb-5">
        <div className="eyebrow mb-1.5">Central Ops · Report</div>
        <h1 className="font-serif text-[22px] leading-tight tracking-[-0.01em] text-ink">{doc.title}</h1>
        <p className="mt-1 text-[13px] text-ink-3">{doc.subtitle}</p>
      </header>
      {aiSummary && (
        <section className="mb-6 rounded-xl border border-violet/15 bg-violet-soft/50 px-4 py-3">
          <div className="eyebrow mb-1 text-violet">Executive summary · AI</div>
          <p className="text-[13px] leading-relaxed text-ink-2">{aiSummary}</p>
        </section>
      )}
      <div className="space-y-6">
        {doc.sections.map((s, i) => {
          const empty = !s.blocks.some((b) => (b.type === "list" ? b.items.length : b.type === "table" ? b.rows.length : b.type === "stats" ? b.items.length : b.text));
          return (
            <section key={i} className="break-inside-avoid">
              {s.heading !== "—" && <h2 className="mb-2.5 text-[12px] font-semibold uppercase tracking-[0.07em] text-ink-3">{s.heading}</h2>}
              {empty ? <p className="text-[13px] text-ink-4">{s.empty ?? "Nothing to report."}</p> : <div className="space-y-3">{s.blocks.map((b, j) => <BlockView key={j} b={b} />)}</div>}
            </section>
          );
        })}
      </div>
      {doc.footer && <footer className="mt-8 border-t border-line pt-3 text-[11.5px] text-ink-4">{doc.footer}</footer>}
    </article>
  );
}

function BlockView({ b }: { b: Block }) {
  if (b.type === "p") return <p className="text-[13px] leading-relaxed text-ink-2">{b.text}</p>;
  if (b.type === "pre") return <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-2">{b.text}</pre>;
  if (b.type === "stats")
    return (
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
        {b.items.map((x, i) => (
          <div key={i} className="bg-surface px-3 py-2.5">
            <div className="truncate text-[11px] uppercase tracking-[0.06em] text-ink-3">{x.label}</div>
            <div className={cn("mt-0.5 font-serif text-[19px] leading-tight tabular", x.tone ? toneText[x.tone] : "text-ink")}>{x.value}</div>
            {x.hint && <div className="truncate text-[11px] text-ink-4">{x.hint}</div>}
          </div>
        ))}
      </div>
    );
  if (b.type === "table")
    return (
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="table-base">
          <thead><tr>{b.columns.map((c, i) => <th key={i} className={cn(b.align?.[i] === "r" && "text-right")}>{c}</th>)}</tr></thead>
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={i}>{r.map((c, j) => <td key={j} className={cn("h-9", b.align?.[j] === "r" && "text-right tabular", j === 0 ? "text-ink" : "text-ink-2", b.tones?.[i]?.[j] && toneText[b.tones[i][j]!])}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  const Tag = b.ordered ? "ol" : "ul";
  return (
    <Tag className="space-y-1.5">
      {b.items.map((it, i) => (
        <li key={i} className="flex gap-2.5 text-[13px] leading-snug">
          {b.ordered ? <span className="w-5 shrink-0 text-right font-mono text-[12px] leading-[1.45] text-ink-4">{i + 1}.</span>
            : <span className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", it.tone ? toneDot[it.tone] : "bg-ink-4")} />}
          <span className="min-w-0">
            {it.href ? <Link href={it.href} className="text-ink hover:underline decoration-ink-4 underline-offset-2">{it.text}</Link> : <span className="text-ink">{it.text}</span>}
            {it.meta && <span className="text-ink-3"> — {it.meta}</span>}
          </span>
        </li>
      ))}
    </Tag>
  );
}

export const PRINT_CSS = `@media print {
  @page { margin: 14mm; }
  body { background: #fff !important; }
  body * { visibility: hidden; }
  .print-doc, .print-doc * { visibility: visible; }
  .print-doc { position: absolute; left: 0; top: 0; width: 100%; max-width: none; border: 0 !important; box-shadow: none !important; padding: 0 !important; }
  .print-doc a { text-decoration: none; color: inherit; }
  .no-print { display: none !important; }
}`;
