"use client";
import { useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { cn } from "@/lib/cn";

export interface Term { n: number; term: string; abbr: string; definition: string; formula: string; section: string }
const SECTIONS = ["Warehouse", "Logistics", "Inventory & planning", "Retail & omnichannel", "Cost & performance"];

/** Supply Chain Terminologies, readable in-app: search, filter by area, each term with its definition and formula. */
export function Glossary({ terms, source }: { terms: Term[]; source?: string | null }) {
  const [qy, setQy] = useState("");
  const [sec, setSec] = useState("");
  const shown = terms.filter((t) => (!sec || t.section === sec) && (!qy || `${t.term} ${t.abbr} ${t.definition} ${t.formula}`.toLowerCase().includes(qy.toLowerCase())));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 sm:max-w-[300px]">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
          <input className="field h-9 pl-8" placeholder="Search a term, abbreviation or formula…" value={qy} onChange={(e) => setQy(e.target.value)} />
        </label>
        {source && <a href={source} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-info ring-1 ring-inset ring-line hover:bg-info-soft">Source document<ExternalLink size={11} /></a>}
      </div>
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="seg min-w-max">
          <button onClick={() => setSec("")} data-on={!sec} className="seg-item">All <span className="ml-1 text-ink-4">{terms.length}</span></button>
          {SECTIONS.map((s) => <button key={s} onClick={() => setSec(s)} data-on={sec === s} className="seg-item">{s} <span className="ml-1 text-ink-4">{terms.filter((t) => t.section === s).length}</span></button>)}
        </div>
      </div>
      <div className="grid gap-2.5 md:grid-cols-2">
        {shown.map((t) => (
          <article key={t.n} className="card p-3.5">
            <div className="flex items-baseline gap-2">
              <span className="w-6 shrink-0 text-[11px] tabular-nums text-ink-4">{t.n}</span>
              <h3 className="min-w-0 flex-1 text-[13.5px] font-semibold leading-snug">{t.abbr ? t.term.replace(new RegExp(`\\s*\\(${t.abbr}\\)\\s*$`), "") : t.term}</h3>
              {t.abbr && <span className="shrink-0 rounded bg-info-soft px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide text-info">{t.abbr}</span>}
            </div>
            <p className="mt-1 pl-8 text-[12.5px] leading-relaxed text-ink-2">{t.definition}</p>
            <div className={cn("ml-8 mt-2 rounded-md bg-muted/70 px-2.5 py-1.5 font-mono text-[11.5px] leading-relaxed text-ink-2")}>{t.formula}</div>
            <div className="mt-2 pl-8 text-[10.5px] uppercase tracking-[0.06em] text-ink-4">{t.section}</div>
          </article>
        ))}
      </div>
      {!shown.length && <div className="card p-8 text-center text-[13px] text-ink-3">No term matches.</div>}
    </div>
  );
}
