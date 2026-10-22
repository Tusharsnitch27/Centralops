import Link from "next/link";
import { redirect } from "next/navigation";
import { Megaphone } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { ProgramList } from "@/components/tasks/ProgramList";
import { canManage, requireUser } from "@/server/auth";
import { listPrograms } from "@/server/taskPrograms/queries";
import { listPeople } from "@/server/core/people";

export const metadata = { title: "Programs" };

/** Program managers' broadcasts: one ask to many people, who is done, who is late, remind the rest. */
export default async function ProgramsPage() {
  const u = await requireUser();
  if (!canManage(u)) redirect("/tasks");
  const [programs, people] = await Promise.all([listPrograms(), listPeople()]);
  const open = programs.filter((p) => p.status === "open");
  return (
    <div>
      <PageHeader title="Programs" subtitle={<>{open.length} running · send one task to many people from <Link href="/tasks?create=program#capture" className="underline">My list › Program</Link></>} />
      {programs.length ? <ProgramList programs={programs} people={people.map((p) => ({ id: p.id, name: p.name }))} />
        : <div className="card"><EmptyState icon={<Megaphone size={18} />} title="No programs yet" body="Create one from My list › Program: pick the people, a due date, and everyone gets their own task you can track and remind together." /></div>}
    </div>
  );
}
