import { LibraryList } from "@/components/library/LibraryList";
import { canManage, requireUser } from "@/server/auth";
import { listLibrary } from "@/server/library/queries";

export const metadata = { title: "Dashboards & Tools" };

export default async function DashboardsTools() {
  const u = await requireUser();
  const [dash, tools] = await Promise.all([listLibrary("dashboard"), listLibrary("tool")]);
  return (
    <div className="space-y-8">
      <section><h2 className="label-caps mb-2 px-1">Dashboards</h2><LibraryList kind="dashboard" label="Dashboards" items={dash} manage={canManage(u)} layout="cards" /></section>
      <section><h2 className="label-caps mb-2 px-1">Tools</h2><LibraryList kind="tool" label="Tools" items={tools} manage={canManage(u)} layout="cards" /></section>
    </div>
  );
}
