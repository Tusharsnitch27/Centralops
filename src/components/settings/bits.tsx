"use client";
import { useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/server/core/result";

/** iOS-style switch. */
export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full transition-colors disabled:opacity-50", checked ? "bg-ink" : "bg-line-strong")}>
      <span className={cn("inline-block size-[14px] rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-[14px]" : "translate-x-[2px]")} />
    </button>
  );
}

/** Run a server action with toast feedback + refresh. */
export function useAction() {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = <T,>(fn: () => Promise<ActionResult<T>>, opts: { success?: string; onOk?: (r: ActionResult<T> & { ok: true }) => void; refresh?: boolean } = {}) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) { toast(r.error, "error"); return; }
      toast(r.message ?? opts.success ?? "Saved", "success");
      opts.onOk?.(r);
      if (opts.refresh !== false) router.refresh();
    });
  return { pending, run };
}

export function Section({ title, description, children, action }: { title: ReactNode; description?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-line py-6 first:pt-0 last:border-0 md:grid-cols-[240px_minmax(0,1fr)]">
      <div>
        <h2 className="text-[13.5px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{description}</p>}
        {action && <div className="mt-3">{action}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export const ROLE_OPTIONS = [
  { value: "admin", label: "Admin", hint: "Everything, incl. users & settings" },
  { value: "pm", label: "Program manager", hint: "Create, assign, distribute, settings" },
  { value: "owner", label: "Owner", hint: "Edits what they own" },
  { value: "leadership", label: "Leadership", hint: "Read-only, all programs" },
  { value: "viewer", label: "Viewer", hint: "Read-only" },
];
