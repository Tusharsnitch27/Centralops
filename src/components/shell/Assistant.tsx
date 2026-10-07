"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/cn";

export const openAssistant = (question?: string) => window.dispatchEvent(new CustomEvent("co:assistant", { detail: { question } }));

interface Msg { role: "user" | "assistant"; text: string; links?: { label: string; href: string }[]; engine?: string }

const SUGGESTIONS = [
  "What requires my attention today?",
  "Which projects are slipping?",
  "Which owners haven't updated AOP?",
  "What should I follow up today?",
  "Summarise yesterday's meetings",
  "What are the top AOP deviations?",
];

/** Persistent Central Ops assistant drawer. Answers come from /api/assistant (grounded in Central Ops data). */
export function Assistant() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    try {
      const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q, history: msgs.slice(-6) }) });
      const d = await r.json();
      setMsgs((m) => [...m, { role: "assistant", text: d.answer ?? d.error ?? "Sorry, I couldn't answer that.", links: d.links, engine: d.engine }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", text: "The assistant is unavailable right now." }]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const on = (e: Event) => { setOpen(true); const q = (e as CustomEvent).detail?.question; if (q) void ask(q); };
    window.addEventListener("co:assistant", on);
    return () => window.removeEventListener("co:assistant", on);
  });
  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [msgs, busy]);

  if (!open) return null;
  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[440px] flex-col border-l border-line bg-surface animate-rise" style={{ boxShadow: "var(--shadow-pop)" }}>
      <div className="flex h-14 items-center gap-2 border-b border-line px-4">
        <Sparkles size={16} className="text-violet" />
        <div className="flex-1">
          <div className="text-[14px] font-semibold">Ask Central Ops</div>
          <div className="text-[11.5px] text-ink-3">Answers from your tasks, meetings, projects, AOP & S&OP</div>
        </div>
        <button onClick={() => setOpen(false)} className="rounded-md p-1.5 text-ink-3 hover:bg-subtle hover:text-ink"><X size={16} /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 scroll-thin">
        {!msgs.length && (
          <div className="space-y-1.5">
            <div className="eyebrow mb-2">Try asking</div>
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => ask(s)} className="block w-full rounded-lg border border-line px-3 py-2 text-left text-[13px] text-ink-2 hover:border-line-strong hover:bg-subtle">{s}</button>
            ))}
          </div>
        )}
        <div className="space-y-4">
          {msgs.map((m, i) => (
            <div key={i} className={cn("text-[13.5px] leading-relaxed", m.role === "user" ? "ml-10 rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-white" : "text-ink")}>
              {m.role === "assistant" ? <Rich text={m.text} /> : m.text}
              {m.links && m.links.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.links.map((l) => <Link key={l.href + l.label} href={l.href} onClick={() => setOpen(false)} className="rounded-md bg-subtle px-2 py-1 text-[12px] text-ink-2 ring-1 ring-inset ring-line hover:text-ink">{l.label} →</Link>)}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="flex gap-1 py-2">{[0, 1, 2].map((i) => <span key={i} className="size-1.5 animate-pulse rounded-full bg-ink-4" style={{ animationDelay: `${i * 150}ms` }} />)}</div>}
          <div ref={endRef} />
        </div>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void ask(input); }} className="border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-xl border border-line-strong bg-surface p-1.5 pl-3 focus-within:border-ink-3">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} placeholder="Ask anything about your programs…"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(input); } }}
            className="max-h-32 flex-1 resize-none bg-transparent py-1.5 text-[13.5px] outline-none placeholder:text-ink-4" />
          <button disabled={!input.trim() || busy} className="flex size-8 items-center justify-center rounded-lg bg-ink text-white disabled:opacity-30"><ArrowUp size={15} /></button>
        </div>
      </form>
    </div>
  );
}

/** Minimal markdown: **bold**, bullets, paragraphs. */
function Rich({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") ? <strong key={i} className="font-semibold">{p.slice(2, -2)}</strong> : p));
  return (
    <div className="space-y-2">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-•]\s/.test(l)))
          return <ul key={i} className="space-y-1 pl-4">{lines.map((l, j) => <li key={j} className="list-disc marker:text-ink-4">{inline(l.replace(/^\s*[-•]\s/, ""))}</li>)}</ul>;
        return <p key={i}>{lines.map((l, j) => <span key={j}>{inline(l)}{j < lines.length - 1 && <br />}</span>)}</p>;
      })}
    </div>
  );
}
