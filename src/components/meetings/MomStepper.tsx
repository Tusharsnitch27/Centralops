import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import type { MomStatus } from "@/lib/meta";
import { phaseOf } from "./bits";

type StepState = "done" | "current" | "todo" | "muted";

/** Meeting → MoM by <owner> → Your review → Distributed. */
export function MomStepper({ m, ownerName, isPM, reviewerName }: { m: { starts_at: string | Date; ends_at: string | Date | null; mom_status: MomStatus }; ownerName: string | null; isPM: boolean; reviewerName?: string | null }) {
  const ph = phaseOf(m);
  const s = m.mom_status;
  const closed = s === "skipped" || s === "not_relevant";
  const steps: { label: string; sub: string; state: StepState }[] = [
    { label: "Meeting", sub: ph === "upcoming" ? "Scheduled" : ph === "live" ? "In progress" : "Held", state: ph === "ended" ? "done" : "current" },
    {
      label: `MoM by ${ownerName ?? "owner"}`,
      sub: closed ? (s === "skipped" ? "Skipped" : "Not relevant") : s === "draft" ? "Draft in progress" : s === "submitted" || s === "distributed" ? "Submitted" : ph === "ended" ? "Waiting" : "After the meeting",
      state: closed ? "muted" : s === "submitted" || s === "distributed" ? "done" : ph === "ended" ? "current" : "todo",
    },
    {
      label: isPM ? "Your review" : "PM review",
      sub: closed ? "—" : s === "distributed" ? `Reviewed${reviewerName ? ` by ${reviewerName}` : ""}` : s === "submitted" ? (isPM ? "Accept, edit, assign" : "With the PM") : "Feedback & assignment",
      state: closed ? "muted" : s === "distributed" ? "done" : s === "submitted" ? "current" : "todo",
    },
    { label: "Distributed", sub: closed ? "—" : s === "distributed" ? "Owners notified" : "Tasks go out", state: closed ? "muted" : s === "distributed" ? "done" : "todo" },
  ];
  return (
    <ol className="card flex items-stretch overflow-x-auto scroll-thin">
      {steps.map((st, i) => (
        <li key={i} className={cn("relative flex min-w-[170px] flex-1 items-center gap-3 px-4 py-3", i > 0 && "border-l border-line", st.state === "current" && "bg-subtle/60")}>
          <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
            st.state === "done" ? "bg-ok text-white" : st.state === "current" ? "bg-ink text-white" : st.state === "muted" ? "bg-muted text-ink-4" : "border border-line-strong text-ink-4")}>
            {st.state === "done" ? <Check size={13} strokeWidth={3} /> : st.state === "muted" ? <Minus size={12} /> : i + 1}
          </span>
          <span className="min-w-0">
            <span className={cn("block truncate text-[13px] font-medium", st.state === "todo" || st.state === "muted" ? "text-ink-3" : "text-ink")}>{st.label}</span>
            <span className={cn("block truncate text-[11.5px]", st.state === "current" ? "text-ink-2" : "text-ink-4")}>{st.sub}</span>
          </span>
          {st.state === "current" && <span className="absolute inset-x-0 bottom-0 h-[2px] bg-ink" />}
        </li>
      ))}
    </ol>
  );
}
