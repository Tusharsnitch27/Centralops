import { requireUser } from "@/server/auth";
import { listPeople, listProjectsLite, listTeams } from "@/server/core/people";
import { Capture } from "@/components/onboarding/Capture";

export const metadata = { title: "What are you working on?" };

export default async function Welcome() {
  const u = await requireUser();
  const [people, teams, projects] = await Promise.all([listPeople(), listTeams(), listProjectsLite()]);
  return (
    <div className="py-6">
      <Capture name={u.name.split(" ")[0]}
        options={{
          people: people.map((p) => ({ id: p.id, name: p.name, title: p.title, color: p.avatar_color })),
          teams: teams.map((t) => ({ id: t.id, name: t.name })),
          projects: projects.map((p) => ({ id: p.id, name: p.name, code: p.code })),
        }} />
    </div>
  );
}
