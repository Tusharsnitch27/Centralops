import { PageHeader } from "@/components/ui";
import { LibraryTabs } from "@/components/library/LibraryTabs";
import { libraryCounts } from "@/server/library/queries";

export default async function LibraryLayout({ children }: { children: React.ReactNode }) {
  const c = await libraryCounts();
  return (
    <div>
      <PageHeader eyebrow="Programs" title="Ops Handbook" subtitle="Every SOP by function, the dashboards and tools the team runs on, and reference docs — in one place" />
      <LibraryTabs counts={{ sop: c.sop, tools: (c.dashboard ?? 0) + (c.tool ?? 0), refs: c.handbook }} />
      {children}
    </div>
  );
}
