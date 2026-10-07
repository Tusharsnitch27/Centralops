import Link from "next/link";
import * as Icons from "lucide-react";
import { cn } from "@/lib/cn";
import type { AttentionItem } from "@/server/home/attention";

const AREA_ICON: Record<AttentionItem["area"], keyof typeof Icons> = {
  tasks: "CircleCheck", followups: "Send", meetings: "CalendarClock", aop: "Target", sop: "Boxes", projects: "FolderKanban", decisions: "Gavel", risks: "TriangleAlert",
};
const SEV = {
  critical: { bar: "bg-bad", icon: "text-bad bg-bad-soft", label: "Critical" },
  high: { bar: "bg-warn", icon: "text-warn bg-warn-soft", label: "High" },
  medium: { bar: "bg-ink-4/50", icon: "text-ink-2 bg-subtle", label: "" },
  info: { bar: "bg-info/60", icon: "text-info bg-info-soft", label: "" },
};

export function AttentionList({ items }: { items: AttentionItem[] }) {
  return (
    <div className="divide-y divide-line/70">
      {items.map((it, i) => {
        const Icon = (Icons[AREA_ICON[it.area]] ?? Icons.Circle) as React.ComponentType<{ size?: number }>;
        const s = SEV[it.severity];
        return (
          <div key={it.key} className="group relative flex items-start gap-3.5 px-4 py-3.5 transition-colors hover:bg-subtle/50 animate-rise" style={{ animationDelay: `${i * 30}ms`, animationFillMode: "backwards" }}>
            <span className={cn("absolute inset-y-3 left-0 w-[2px] rounded-full", s.bar)} />
            <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", s.icon)}><Icon size={15} /></span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-medium leading-snug text-ink">{it.title}</div>
              {it.detail && <div className="mt-0.5 line-clamp-2 text-[12.5px] text-ink-3">{it.detail}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-1.5 self-center">
              {it.secondary && <Link href={it.secondary.href} className="hidden h-7 items-center rounded-lg px-2 text-[12px] text-ink-3 hover:bg-muted hover:text-ink sm:flex">{it.secondary.label}</Link>}
              <Link href={it.cta.href} className="flex h-7 items-center gap-1 rounded-lg border border-line-strong bg-surface px-2.5 text-[12px] font-medium text-ink transition-colors group-hover:border-ink group-hover:bg-ink group-hover:text-white">
                {it.cta.label}<Icons.ArrowRight size={12} />
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
