import "server-only";
import { fmtDate, dateOf } from "@/lib/dates";
import { pickerOptions } from "../projects/options";
import { meetingOptions, taskOptions } from "./queries";

export async function decisionFormOptions() {
  const [base, meetings, tasks] = await Promise.all([pickerOptions(), meetingOptions(), taskOptions()]);
  return {
    people: base.people,
    projects: base.projects,
    meetings: meetings.map((m) => ({ value: m.id, label: m.title, hint: fmtDate(dateOf(m.starts_at)) })),
    tasks: tasks.map((t) => ({ value: t.id, label: t.title, hint: `CO-${t.number}`, projectId: t.project_id })),
  };
}
