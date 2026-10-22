"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Plus } from "lucide-react";
import { Avatar, Badge, Button } from "@/components/ui";
import { Collapsible } from "@/components/ui/Collapsible";
import { useToast } from "@/components/ui/client";
import { addToProgram, remindProgram, setProgramStatus } from "@/server/taskPrograms/actions";
import type { ProgramRow } from "@/server/taskPrograms/queries";
import { fmtDate, relDay, today } from "@/lib/dates";
import { cn } from "@/lib/cn";

export function ProgramList({ programs, people }: { programs: ProgramRow[]; people: { id: string; name: string }[] }) {
  return <div className="space-y-2">{programs.map((p) => <Program key={p.id} p={p} people={people} />)}</div>;
}

function Program({ p, people }: { p: ProgramRow; people: { id: string; name: string }[] }) {
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState("");
  const toast = useToast();
  const router = useRouter();
  const t = today();
  const done = p.people.filter((x) => x.status === "completed").length;
  const late = p.people.filter((x) => x.status !== "completed" && x.due_date && x.due_date < t).length;
  const act = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => start(async () => { const r = await fn(); if (!r.ok) toast(r.error ?? "Failed", "error"); else { toast(r.message ?? "Done", "success"); router.refresh(); } });
  const pct = p.people.length ? done / p.people.length : 0;
  return (
    <Collapsible id={`program:${p.id}`} title={p.title}
      sub={[`due ${fmtDate(p.due_date)}`, p.created_by_name, p.goal_title ? `goal: ${p.goal_title}` : null, p.project_name].filter(Boolean).join(" · ")}
      summary={<>
        <span className="flex items-center gap-2"><span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-ok" style={{ width: `${pct * 100}%` }} /></span><span className="text-[11.5px] tabular text-ink-3">{done}/{p.people.length}</span></span>
        {late > 0 && <Badge tone="red">{late} late</Badge>}
        {p.status === "closed" && <Badge tone="muted">Closed</Badge>}
      </>}>
      {p.details && <p className="border-b border-line px-4 py-2.5 text-[12.5px] text-ink-2">{p.details}</p>}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <Button size="sm" variant="primary" disabled={pending || done === p.people.length} onClick={() => act(() => remindProgram(p.id))}><BellRing size={13} />Remind {p.people.length - done} pending</Button>
        {p.last_reminded_at && <span className="text-[11.5px] text-ink-4">last reminded {fmtDate(p.last_reminded_at.slice(0, 10))}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          <select className="field h-8 w-44 py-0 text-[12.5px]" value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">Add a person…</option>
            {people.filter((x) => !p.people.some((y) => y.user_id === x.id)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <Button size="sm" disabled={!adding || pending} onClick={() => act(async () => { const r = await addToProgram(p.id, [adding]); setAdding(""); return r; })}><Plus size={13} />Add</Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => setProgramStatus(p.id, p.status === "open" ? "closed" : "open"))}>{p.status === "open" ? "Close" : "Reopen"}</Button>
        </span>
      </div>
      <div className="divide-y divide-line/70">
        {p.people.map((x) => {
          const isLate = x.status !== "completed" && x.due_date && x.due_date < t;
          return (
            <div key={x.task_id} className="flex items-center gap-3 px-4 py-2">
              <Avatar name={x.name} color={x.color} size={22} />
              <Link href={`/tasks/${x.task_id}`} className="min-w-0 flex-1 truncate text-[13px] hover:underline">{x.name ?? "—"} <span className="text-ink-4">· CO-{x.number}</span></Link>
              <span className={cn("text-[12px]", x.status === "completed" ? "text-ok" : isLate ? "font-medium text-bad" : "text-ink-3")}>
                {x.status === "completed" ? `Done${x.completed_at ? ` · ${fmtDate(String(x.completed_at).slice(0, 10))}` : ""}` : isLate ? `Late · ${relDay(x.due_date!)}` : x.status.replace(/_/g, " ")}
              </span>
              <span className="hidden w-[110px] text-right text-[11.5px] text-ink-4 sm:inline">{x.last_update_at ? `updated ${fmtDate(String(x.last_update_at).slice(0, 10))}` : "no update yet"}</span>
              {x.status !== "completed" && <Button size="xs" variant="ghost" disabled={pending} onClick={() => act(() => remindProgram(p.id, x.task_id))}><BellRing size={12} />Remind</Button>}
            </div>
          );
        })}
      </div>
    </Collapsible>
  );
}
