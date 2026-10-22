"use client";
import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleCheck, FolderKanban, Megaphone, Target } from "lucide-react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { createGoal, createProject } from "@/server/goals/actions";
import { createProgram } from "@/server/taskPrograms/actions";
import { TaskCapture, type LinkOpts } from "./TaskCapture";
import { today } from "@/lib/dates";
import { cn } from "@/lib/cn";

interface PersonOpt { id: string; name: string; title: string | null }
type Tab = "task" | "goal" | "project" | "program";

/** Add a task (default), a goal or a project — they can link to each other, none is required. */
export function CreateTabs({ people, meId, links, canProgram }: { people: PersonOpt[]; meId: string; links: LinkOpts; canProgram?: boolean }) {
  const want = useSearchParams().get("create");
  const [tab, setTab] = useState<Tab>(want === "goal" || want === "project" || (want === "program" && canProgram) ? want : "task");
  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "task", label: "Task", icon: <CircleCheck size={13} /> }, { key: "goal", label: "Goal", icon: <Target size={13} /> }, { key: "project", label: "Project", icon: <FolderKanban size={13} /> },
    // programs (one ask to many people, with reminders) are for program managers
    ...(canProgram ? [{ key: "program" as Tab, label: "Program", icon: <Megaphone size={13} /> }] : []),
  ];
  return (
    <div id="capture" className="scroll-mt-20">
      <div className="seg mb-2">{TABS.map((t) => <button key={t.key} type="button" data-on={tab === t.key} onClick={() => setTab(t.key)} className="seg-item gap-1.5">{t.icon}{t.label}</button>)}</div>
      {tab === "task" && <TaskCapture people={people} meId={meId} links={links} />}
      {tab === "goal" && <GoalForm people={people} meId={meId} projects={links.projects} done={() => setTab("task")} />}
      {tab === "project" && <ProjectForm people={people} meId={meId} goals={links.goals} done={() => setTab("task")} />}
      {tab === "program" && canProgram && <ProgramForm people={people} meId={meId} links={links} done={() => setTab("task")} />}
    </div>
  );
}

function GoalForm({ people, meId, projects, done }: { people: PersonOpt[]; meId: string; projects: LinkOpts["projects"]; done: () => void }) {
  const [f, setF] = useState({ title: "", description: "", ownerId: meId, targetDate: "", projectIds: [] as string[] });
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <div className="card space-y-3 p-3 md:p-4">
      <label className="block"><span className="label">Goal</span><input className="field font-medium" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Bring North WH utilisation under 90% before Diwali" /></label>
      <label className="block"><span className="label">Why / how we’ll measure it <span className="font-normal text-ink-4">(optional)</span></span><textarea className="field min-h-[60px]" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="label">Owner</span><select className="field" value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}>{people.map((p) => <option key={p.id} value={p.id}>{p.id === meId ? `${p.name} (me)` : p.name}</option>)}</select></label>
        <label className="block"><span className="label">Target date <span className="font-normal text-ink-4">(optional)</span></span><input type="date" min={today()} className="field" value={f.targetDate} onChange={(e) => setF({ ...f, targetDate: e.target.value })} /></label>
      </div>
      {projects.length > 0 && (
        <div><span className="label">Projects under this goal <span className="font-normal text-ink-4">(optional)</span></span>
          <div className="flex flex-wrap gap-1.5">{projects.map((p) => { const on = f.projectIds.includes(p.id); return (
            <button key={p.id} type="button" onClick={() => setF({ ...f, projectIds: on ? f.projectIds.filter((x) => x !== p.id) : [...f.projectIds, p.id] })}
              className={cn("rounded-md px-2 py-1 text-[12px] ring-1 ring-inset", on ? "bg-ink text-white ring-ink" : "bg-surface text-ink-2 ring-line hover:ring-line-strong")}>{p.name}</button>
          ); })}</div>
        </div>
      )}
      <div className="flex justify-end"><Button variant="primary" disabled={pending || !f.title.trim()} onClick={() => start(async () => {
        const r = await createGoal(f); if (!r.ok) return toast(r.error, "error"); toast(r.message ?? "Goal added", "success"); router.refresh(); done();
      })}>{pending ? "Adding…" : "Add goal"}</Button></div>
    </div>
  );
}

function ProjectForm({ people, meId, goals, done }: { people: PersonOpt[]; meId: string; goals: LinkOpts["goals"]; done: () => void }) {
  const [f, setF] = useState({ name: "", objective: "", ownerId: meId, targetDate: "", goalId: "" });
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <div className="card space-y-3 p-3 md:p-4">
      <label className="block"><span className="label">Project</span><input className="field font-medium" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. M Express train cargo onboarding" /></label>
      <label className="block"><span className="label">Objective <span className="font-normal text-ink-4">(optional)</span></span><textarea className="field min-h-[60px]" value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} /></label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block"><span className="label">Owner</span><select className="field" value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}>{people.map((p) => <option key={p.id} value={p.id}>{p.id === meId ? `${p.name} (me)` : p.name}</option>)}</select></label>
        <label className="block"><span className="label">Target date <span className="font-normal text-ink-4">(optional)</span></span><input type="date" min={today()} className="field" value={f.targetDate} onChange={(e) => setF({ ...f, targetDate: e.target.value })} /></label>
        <label className="block"><span className="label">Goal <span className="font-normal text-ink-4">(optional)</span></span><select className="field" value={f.goalId} onChange={(e) => setF({ ...f, goalId: e.target.value })}><option value="">—</option>{goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</select></label>
      </div>
      <div className="flex justify-end"><Button variant="primary" disabled={pending || !f.name.trim()} onClick={() => start(async () => {
        const r = await createProject(f); if (!r.ok) return toast(r.error, "error"); toast(r.message ?? "Project created", "success"); router.refresh(); done();
      })}>{pending ? "Creating…" : "Create project"}</Button></div>
    </div>
  );
}

/** Program: the same task to many people at once — each gets their own, tracked and reminded together. */
function ProgramForm({ people, meId, links, done }: { people: PersonOpt[]; meId: string; links: LinkOpts; done: () => void }) {
  const [f, setF] = useState({ title: "", details: "", dueDate: "", userIds: [] as string[], goalId: "", projectId: "" });
  const [find, setFind] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const pick = (id: string) => setF((x) => ({ ...x, userIds: x.userIds.includes(id) ? x.userIds.filter((y) => y !== id) : [...x.userIds, id] }));
  const shown = people.filter((p) => p.id !== meId && (!find || `${p.name} ${p.title ?? ""}`.toLowerCase().includes(find.toLowerCase())));
  return (
    <div className="card space-y-3 p-3 md:p-4">
      <label className="block"><span className="label">What everyone needs to do</span><input className="field font-medium" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Submit November manpower plan for your function" /></label>
      <label className="block"><span className="label">Details <span className="font-normal text-ink-4">(optional)</span></span><textarea className="field min-h-[56px]" value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} placeholder="Format, template link, what “done” looks like" /></label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block"><span className="label">Due date</span><input type="date" min={today()} className="field" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></label>
        <label className="block"><span className="label">Goal <span className="font-normal text-ink-4">(optional)</span></span><select className="field" value={f.goalId} onChange={(e) => setF({ ...f, goalId: e.target.value })}><option value="">None</option>{links.goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</select></label>
        <label className="block"><span className="label">Project <span className="font-normal text-ink-4">(optional)</span></span><select className="field" value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}><option value="">None</option>{links.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      </div>
      <div>
        <div className="mb-1.5 flex items-center gap-2"><span className="label mb-0">People <span className="font-normal text-ink-4">· {f.userIds.length} selected</span></span>
          <input className="field ml-auto h-8 w-44" placeholder="Find…" value={find} onChange={(e) => setFind(e.target.value)} />
          <button type="button" className="text-[12px] text-ink-3 hover:text-ink" onClick={() => setF({ ...f, userIds: [...new Set([...f.userIds, ...shown.map((p) => p.id)])] })}>All shown</button>
          {f.userIds.length > 0 && <button type="button" className="text-[12px] text-ink-3 hover:text-ink" onClick={() => setF({ ...f, userIds: [] })}>Clear</button>}
        </div>
        <div className="flex max-h-[180px] flex-wrap gap-1.5 overflow-y-auto">{shown.map((p) => { const on = f.userIds.includes(p.id); return (
          <button key={p.id} type="button" onClick={() => pick(p.id)} title={p.title ?? undefined}
            className={cn("rounded-md px-2 py-1 text-[12px] ring-1 ring-inset", on ? "bg-ink text-white ring-ink" : "bg-surface text-ink-2 ring-line hover:ring-line-strong")}>{p.name}</button>
        ); })}</div>
      </div>
      <div className="flex items-center justify-end gap-3"><span className="text-[12px] text-ink-4">Each person gets their own task; track and remind them under Tasks › Programs.</span>
        <Button variant="primary" disabled={pending || !f.title.trim() || !f.dueDate || !f.userIds.length} onClick={() => start(async () => {
          const r = await createProgram(f); if (!r.ok) return toast(r.error, "error"); toast(r.message ?? "Program sent", "success"); router.push("/tasks/programs"); done();
        })}>{pending ? "Sending…" : `Send to ${f.userIds.length || ""} ${f.userIds.length === 1 ? "person" : "people"}`.replace("  ", " ")}</Button></div>
    </div>
  );
}
