import { NextResponse } from "next/server";
import { getUser } from "@/server/auth";
import { listPeople, listProjectsLite, listTeams } from "@/server/core/people";

// Picker options for client forms (quick add, command palette).
export async function GET() {
  if (!(await getUser())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const [people, teams, projects] = await Promise.all([listPeople(), listTeams(), listProjectsLite()]);
  return NextResponse.json({
    people: people.map((p) => ({ id: p.id, name: p.name, title: p.title, color: p.avatar_color })),
    teams: teams.map((t) => ({ id: t.id, name: t.name })),
    projects: projects.map((p) => ({ id: p.id, name: p.name, code: p.code })),
  });
}
