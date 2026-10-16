import Link from "next/link";
import * as Icons from "lucide-react";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { REPORTS } from "@/server/reports/builders";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  await requireUser();
  return (
    <div>
      <PageHeader eyebrow="Intelligence" title="Reports" subtitle="Ready-to-send documents composed from live Central Ops data. Copy as text, paste into WhatsApp, or print to PDF." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((r) => {
          const Icon = (Icons[r.icon as keyof typeof Icons] ?? Icons.FileText) as React.ComponentType<{ size?: number; className?: string }>;
          return (
            <Link key={r.kind} href={`/reports/${r.kind}`} className="card group flex gap-3.5 p-4 transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-[var(--shadow-pop)]">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-subtle text-ink-2"><Icon size={16} /></span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">{r.title}<Icons.ArrowRight size={13} className="text-ink-4 opacity-0 transition-opacity group-hover:opacity-100" /></span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-3">{r.desc}</span>
                {"pick" in r && <span className="mt-2 inline-block text-[11.5px] text-ink-4">Pick a {r.pick}</span>}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
