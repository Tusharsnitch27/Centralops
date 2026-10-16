import Link from "next/link";
import * as Icons from "lucide-react";
import { cn } from "@/lib/cn";
import type { AttentionItem } from "@/server/home/attention";

const AREA_ICON: Record<AttentionItem["area"], keyof typeof Icons> = {
  tasks: "CircleCheck", followups: "Send", meetings: "CalendarClock", aop: "Target", sop: "Boxes", projects: "FolderKanban", decisions: "Gavel", risks: "TriangleAlert",
};
const SEV = {
  critical: { dot: "bg-bad", icon: "text-bad", label: "Critical" },
  high: { dot: "bg-warn", icon: "text-warn", label: "High" },
  medium: { dot: "bg-transparent", icon: "text-ink-4", label: "" },
  info: { dot: "bg-transparent", icon: "text-ink-4", label: "" },
};

export function AttentionList({ items }: { items: AttentionItem[] }) {
  return (
    <div className="divide-y divide-line/70">
      {items.map((it) => {
        const Icon = (Icons[AREA_ICON[it.area]] ?? Icons.Circle) as React.ComponentType<{ size?: number }>;
        const s = SEV[it.severity];
        return (
          <div key={it.key} className="group relative flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3 transition-colors hover:bg-subtle/50 sm:flex-nowrap">
            <span className={cn("relative mt-0.5 shrink-0", s.icon)}><Icon size={15} />{s.dot !== "bg-transparent" && <span className={cn("absolute -right-0.5 -top-0.5 size-1.5 rounded-full ring-2 ring-surface", s.dot)} />}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium leading-snug text-ink">{it.title}</div>
              {it.detail && <div className="mt-0.5 line-clamp-2 text-[12.5px] text-ink-3">{it.detail}</div>}
            </div>
            <div className="ml-7 flex shrink-0 items-center gap-1.5 self-center sm:ml-0">
              {it.secondary && <Link href={it.secondary.href} className="hidden h-7 items-center rounded-lg px-2 text-[12px] text-ink-3 hover:bg-muted hover:text-ink sm:flex">{it.secondary.label}</Link>}
              <Link href={it.cta.href} className="flex h-7 items-center gap-1 rounded-lg border border-line-strong bg-surface px-2.5 text-[12px] font-medium text-ink transition-colors group-hover:border-ink-3">
                {it.cta.label}<Icons.ArrowRight size={12} />
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
