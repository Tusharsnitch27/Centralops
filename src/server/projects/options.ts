import "server-only";
import { listPeople, listProgramsLite, listProjectsLite, listTeams } from "../core/people";

/** Picker options for forms in the projects / programs / decisions / risks / reviews modules. */
export async function pickerOptions() {
  const [people, teams, programs, projects] = await Promise.all([listPeople(), listTeams(), listProgramsLite(), listProjectsLite()]);
  return {
    people: people.map((p) => ({ value: p.id, label: p.name, hint: p.team_name ?? p.title ?? undefined })),
    teams: teams.map((t) => ({ value: t.id, label: t.name })),
    programs: programs.map((p) => ({ value: p.id, label: p.name, hint: p.code ?? undefined })),
    projects: projects.map((p) => ({ value: p.id, label: p.name, hint: p.code ?? undefined })),
  };
}
