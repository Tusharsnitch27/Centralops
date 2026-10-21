"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui";

export function WeeklyTabs() {
  const path = usePathname();
  const week = useSearchParams().get("week");
  const qs = week ? `?week=${week}` : "";
  return <Tabs className="mb-4" active={path.startsWith("/weekly/glance") ? "glance" : "collect"} items={[
    { key: "collect", href: `/weekly${qs}`, label: "This week" },
    { key: "glance", href: `/weekly/glance${qs}`, label: "At a glance" },
  ]} />;
}
