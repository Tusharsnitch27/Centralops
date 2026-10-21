import Link from "next/link";
import { LibraryList } from "@/components/library/LibraryList";
import { canManage, requireUser } from "@/server/auth";
import { listLibrary, type LibraryItem } from "@/server/library/queries";

export const metadata = { title: "Dashboards & Tools" };

// dashboards come from three registers; register sheets (category "Source") ride along with the first view
const VIEWS = [
  { key: "tools", label: "Tools", hint: "Internal apps built for ops — open with the link, owner listed for access." },
  { key: "maplemonk", label: "Maplemonk analytics", hint: "analytics.maplemonk.com dashboards, by function and owner." },
  { key: "metabase", label: "Metabase", hint: "Omni, Q-Com, SnitchX loyalty, reverse escalation and NPR dashboards, by project." },
  { key: "trackers", label: "Trackers & sheets", hint: "Working trackers and planning sheets, by area." },
] as const;
const GROUP: Record<string, string> = { maplemonk: "Maplemonk", metabase: "Metabase", trackers: "Trackers" };

export default async function DashboardsTools({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const v = VIEWS.find((x) => x.key === sp.v) ?? VIEWS[0];
  const [dash, tools] = await Promise.all([listLibrary("dashboard"), listLibrary("tool")]);
  const pick = (key: string): LibraryItem[] => key === "tools" ? tools
    : dash.filter((d) => d.extra?.group === GROUP[key] || (d.category === "Source" && key === "maplemonk") || (!d.extra?.group && d.category !== "Source" && key === "trackers"));
  const count = (key: string) => pick(key).filter((i) => i.category !== "Source").length;
  return (
    <div className="space-y-4">
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="seg min-w-max">
          {VIEWS.map((x) => <Link key={x.key} href={`/library/tools?v=${x.key}`} data-on={x.key === v.key} className="seg-item">{x.label} <span className="text-ink-4">{count(x.key)}</span></Link>)}
        </div>
      </div>
      <p className="px-1 text-[12.5px] text-ink-3">{v.hint}</p>
      <LibraryList key={v.key} kind={v.key === "tools" ? "tool" : "dashboard"} anchor={v.key} label={v.label} items={pick(v.key)} manage={canManage(u)} layout="cards"
        groupBy={v.key === "tools" ? "function" : "category"} />
    </div>
  );
}
