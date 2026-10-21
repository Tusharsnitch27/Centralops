"use client";
import { usePathname } from "next/navigation";
import { Tabs } from "@/components/ui";

export function LibraryTabs({ counts }: { counts: { sop?: number; refs?: number; tools?: number } }) {
  const path = usePathname();
  const active = path.startsWith("/library/references") ? "refs" : path.startsWith("/library/tools") ? "tools" : "sop";
  return (
    <div className="-mx-4 mb-5 overflow-x-auto px-4 md:mx-0 md:px-0">
      <Tabs className="min-w-max" active={active} items={[
        { key: "sop", href: "/library", label: "SOP Library", count: counts.sop },
        { key: "tools", href: "/library/tools", label: "Dashboards & Tools", count: counts.tools },
        { key: "refs", href: "/library/references", label: "References", count: counts.refs },
      ]} />
    </div>
  );
}
