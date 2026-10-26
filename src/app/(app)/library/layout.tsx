import { PageHeader } from "@/components/ui";
import { SectionTabs } from "@/components/shell/SectionTabs";
import { LibraryTabs } from "@/components/library/LibraryTabs";
import { libraryCounts } from "@/server/library/queries";
import handbook from "@/db/seed/handbook-fy27.json";

export default async function LibraryLayout({ children }: { children: React.ReactNode }) {
  const c = await libraryCounts();
  return (
    <div>
      <SectionTabs section="others" prefix />
      <PageHeader eyebrow="Others" title="Ops Handbook" subtitle="Every SOP by function, the dashboards and tools the team runs on, and reference docs — in one place" />
      <LibraryTabs counts={{ sop: c.sop, tools: (c.dashboard ?? 0) + (c.tool ?? 0), refs: handbook.glossary.length }} />
      {children}
    </div>
  );
}
