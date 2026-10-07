"use client";
import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/client";
import { deleteTaskView } from "@/server/tasks/collab-actions";

/** Saved views as pills. Built-ins can't be deleted. */
export function SavedViewPills({ views, activeHref }: { views: { id: string; name: string; href: string; builtin?: boolean }[]; activeHref: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 flex items-center gap-1 text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink-4"><Bookmark size={12} /> Views</span>
      {views.map((v) => {
        const on = v.href === activeHref;
        return (
          <span key={v.id} className={cn("group/pill inline-flex h-7 items-center rounded-full border text-[12.5px] transition-colors",
            on ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink", pending && "opacity-70")}>
            <Link href={v.href} scroll={false} className={cn("flex h-full items-center", v.builtin ? "px-3" : "pl-3 pr-1")}>{v.name}</Link>
            {!v.builtin && (
              <button type="button" aria-label={`Delete view ${v.name}`}
                onClick={() => start(async () => { const r = await deleteTaskView(v.id); if (!r.ok) toast(r.error, "error"); else { toast("View removed"); router.refresh(); } })}
                className={cn("mr-1 flex size-5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover/pill:opacity-100 focus:opacity-100",
                  on ? "text-white/70 hover:bg-white/15 hover:text-white" : "text-ink-4 hover:bg-subtle hover:text-ink")}>
                <X size={11} />
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
