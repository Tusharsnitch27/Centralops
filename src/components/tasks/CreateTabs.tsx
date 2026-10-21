"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, FolderKanban, Target } from "lucide-react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { createGoal, createProject } from "@/server/goals/actions";
import { TaskCapture, type LinkOpts } from "./TaskCapture";
import { today } from "@/lib/dates";
import { cn } from "@/lib/cn";

interface PersonOpt { id: string; name: string; title: string | null }
type Tab = "task" | "goal" | "project";

/** Add a task (default), a goal or a project — they can link to each other, none is required. */
export function CreateTabs({ people, meId, links }: { people: PersonOpt[]; meId: string; links: LinkOpts }) {
  const [tab, setTab] = useState<Tab>("task");
  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "task", label: "Task", icon: <CircleCheck size={13} /> }, { key: "goal", label: "Goal", icon: <Target size={13} /> }, { key: "project", label: "Project", icon: <FolderKanban size={13} /> },
  ];
  return (
    <div>
      <div className="seg mb-2">{TABS.map((t) => <button key={t.key} type="button" data-on={tab === t.key} onClick={() => setTab(t.key)} className="seg-item gap-1.5">{t.icon}{t.label}</button>)}</div>
      {tab === "task" && <TaskCapture people={people} meId={meId} links={links} />}
      {tab === "goal" && <GoalForm people={people} meId={meId} projects={links.projects} done={() => setTab("task")} />}
      {tab === "project" && <ProjectForm people={people} meId={meId} goals={links.goals} done={() => setTab("task")} />}
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
