"use client";
// Small form helpers shared by the projects / programs / decisions / risks / reviews modules.
import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { Check } from "lucide-react";
import { useToast, type Option } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/server/core/result";

/** Run a server action with toast feedback + refresh. Returns [pending, run]. */
export function useAction() {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = <T,>(fn: () => Promise<ActionResult<T>>, opts: { success?: string; onOk?: (data: T | undefined) => void } = {}) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) { toast(r.error, "error"); return; }
      toast(r.message ?? opts.success ?? "Saved", "success");
      opts.onOk?.(r.data);
      router.refresh();
    });
  return [pending, run] as const;
}

/** IST today for <input type="date" min>. */
export const todayIST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

export function DateInput({ name, value, onChange, min, allowPast, className, required }: {
  name?: string; value: string; onChange: (v: string) => void; min?: string; allowPast?: boolean; className?: string; required?: boolean;
}) {
  return <input type="date" name={name} value={value} required={required} min={allowPast ? min : min ?? todayIST()} onChange={(e) => onChange(e.target.value)} className={cn("field", className)} />;
}

/** Toggle-chip multi select (teams, tasks). */
export function ChipSelect({ options, value, onChange, max = 30, className }: { options: Option[]; value: string[]; onChange: (v: string[]) => void; max?: number; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {options.slice(0, max).map((o) => {
        const on = value.includes(o.value);
        return (
          <button key={o.value} type="button" onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={cn("inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[12px] transition-colors",
              on ? "border-ink bg-ink text-canvas" : "border-line-strong bg-surface text-ink-2 hover:border-ink-4 hover:text-ink")}>
            {on && <Check size={11} strokeWidth={3} />}{o.label}
          </button>
        );
      })}
    </div>
  );
}

export function FieldRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3", className)}>{children}</div>;
}

export function TextArea({ value, onChange, placeholder, rows = 3, className, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; className?: string; autoFocus?: boolean }) {
  return <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} autoFocus={autoFocus} className={cn("field resize-y leading-relaxed", className)} />;
}

export type { Option };
