// Central Ops UI kit — small, composable primitives. Server-safe unless noted.
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { HEALTH, PRIORITY, TASK_STATUS, type Health, type Priority, type TaskStatus, type Tone } from "@/lib/meta";

/* ---------- Button ---------- */
type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type BtnSize = "xs" | "sm" | "md";
const btnBase = "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap select-none transition-[background,border-color,color,box-shadow,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50";
const btnVariant: Record<BtnVariant, string> = {
  primary: "bg-ink text-white hover:bg-ink-2 shadow-[0_1px_0_rgb(255_255_255/0.08)_inset,0_1px_2px_rgb(0_0_0/0.15)]",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-subtle hover:border-ink-4/60",
  ghost: "text-ink-2 hover:bg-subtle hover:text-ink",
  subtle: "bg-subtle text-ink-2 hover:bg-muted hover:text-ink",
  danger: "bg-surface text-bad border border-bad/25 hover:bg-bad-soft",
};
const btnSize: Record<BtnSize, string> = { xs: "h-7 px-2 text-[12px]", sm: "h-8 px-2.5 text-[12.5px]", md: "h-9 px-3.5 text-[13px]" };
export const buttonClass = (variant: BtnVariant = "secondary", size: BtnSize = "sm", className?: string) => cn(btnBase, btnVariant[variant], btnSize[size], className);

export function Button({ variant = "secondary", size = "sm", className, ...p }: ComponentProps<"button"> & { variant?: BtnVariant; size?: BtnSize }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...p} />;
}
export function ButtonLink({ variant = "secondary", size = "sm", className, ...p }: ComponentProps<typeof Link> & { variant?: BtnVariant; size?: BtnSize }) {
  return <Link className={buttonClass(variant, size, className)} {...p} />;
}

/* ---------- Badges & status ---------- */
const toneClass: Record<Tone, string> = {
  neutral: "bg-subtle text-ink-2 ring-line",
  muted: "bg-transparent text-ink-3 ring-line",
  info: "bg-info-soft text-info ring-info/15",
  green: "bg-ok-soft text-ok ring-ok/15",
  amber: "bg-warn-soft text-warn ring-warn/20",
  red: "bg-bad-soft text-bad ring-bad/15",
  violet: "bg-violet-soft text-violet ring-violet/15",
};
const dotClass: Record<Tone, string> = { neutral: "bg-ink-4", muted: "bg-ink-4/60", info: "bg-info", green: "bg-ok", amber: "bg-warn", red: "bg-bad", violet: "bg-violet" };

export function Badge({ tone = "neutral", dot, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex h-[22px] items-center gap-1.5 rounded-md px-1.5 text-[11.5px] font-medium ring-1 ring-inset whitespace-nowrap", toneClass[tone], className)}>
      {dot && <span className={cn("size-1.5 rounded-full", dotClass[tone])} />}
      {children}
    </span>
  );
}
export const Dot = ({ tone = "neutral", className }: { tone?: Tone; className?: string }) => <span className={cn("inline-block size-2 shrink-0 rounded-full", dotClass[tone], className)} />;

export function StatusBadge({ status }: { status: TaskStatus }) {
  const m = TASK_STATUS[status];
  return <Badge tone={m.tone as Tone} dot>{m.label}</Badge>;
}
export function HealthBadge({ health, className }: { health: Health; className?: string }) {
  const m = HEALTH[health];
  return <Badge tone={m.tone as Tone} dot className={className}>{m.label}</Badge>;
}
export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  const rank = PRIORITY[priority].rank;
  if (priority === "urgent")
    return <span title="Urgent" className={cn("inline-flex size-4 items-center justify-center rounded-[4px] bg-bad text-[10px] font-bold text-white", className)}>!</span>;
  return (
    <span title={PRIORITY[priority].label} className={cn("inline-flex h-4 items-end gap-[2px]", className)}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={cn("w-[3px] rounded-[1px]", i === 0 ? "h-1.5" : i === 1 ? "h-2.5" : "h-3.5", 3 - i > rank ? "bg-ink-2" : "bg-line-strong")} />
      ))}
    </span>
  );
}

/* ---------- Avatar ---------- */
const PALETTE = ["#64748b", "#78716c", "#0f766e", "#4d7c0f", "#a16207", "#9a3412", "#9f1239", "#7e22ce", "#3730a3", "#0e7490"];
export const avatarColor = (seed: string) => PALETTE[[...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
export const initials = (name: string) => name.split(/[\s&]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");

export function Avatar({ name, color, size = 22, className, title }: { name?: string | null; color?: string | null; size?: number; className?: string; title?: string }) {
  if (!name) return <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong text-ink-4", className)} style={{ width: size, height: size }} title="Unassigned" />;
  return (
    <span title={title ?? name} className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white ring-2 ring-surface", className)}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.4)), background: color || avatarColor(name) }}>
      {initials(name)}
    </span>
  );
}
export function AvatarStack({ people, max = 4, size = 22 }: { people: { name: string; color?: string | null }[]; max?: number; size?: number }) {
  const shown = people.slice(0, max);
  return (
    <span className="inline-flex items-center -space-x-1.5">
      {shown.map((p, i) => <Avatar key={i} name={p.name} color={p.color} size={size} />)}
      {people.length > max && <span className="ml-1 text-[11px] text-ink-3">+{people.length - max}</span>}
    </span>
  );
}

/* ---------- Layout ---------- */
export function PageHeader({ title, subtitle, eyebrow, actions, className }: { title: ReactNode; subtitle?: ReactNode; eyebrow?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cn("mb-6 flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h1 className="font-serif text-[30px] leading-[1.1] tracking-[-0.01em] text-ink">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[13.5px] text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
export function Card({ className, children, ...p }: ComponentProps<"div">) {
  return <div className={cn("card", className)} {...p}>{children}</div>;
}
export function CardHeader({ title, subtitle, action, className, icon }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 border-b border-line px-4 py-3", className)}>
      <div className="flex min-w-0 items-center gap-2">
        {icon && <span className="text-ink-3">{icon}</span>}
        <div className="min-w-0">
          <h2 className="truncate text-[13.5px] font-semibold text-ink">{title}</h2>
          {subtitle && <p className="truncate text-[12px] text-ink-3">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
export function SectionTitle({ children, count, action, className }: { children: ReactNode; count?: number; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-2.5 flex items-center justify-between", className)}>
      <h3 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">
        {children}
        {count != null && <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tracking-normal text-ink-2">{count}</span>}
      </h3>
      {action}
    </div>
  );
}

/* ---------- Tabs (link-based) ---------- */
export function Tabs({ items, active, className }: { items: { href: string; label: ReactNode; key: string; count?: number }[]; active: string; className?: string }) {
  return (
    <nav className={cn("flex items-center gap-1 border-b border-line", className)}>
      {items.map((t) => (
        <Link key={t.key} href={t.href} scroll={false}
          className={cn("relative -mb-px flex h-9 items-center gap-1.5 px-2.5 text-[13px] transition-colors",
            t.key === active ? "font-medium text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:rounded-full after:bg-ink" : "text-ink-3 hover:text-ink")}>
          {t.label}
          {t.count != null && t.count > 0 && <span className="rounded-full bg-muted px-1.5 text-[11px] tabular text-ink-2">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/* ---------- Data display ---------- */
export function Stat({ label, value, delta, tone, hint, className }: { label: ReactNode; value: ReactNode; delta?: ReactNode; tone?: Tone; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="eyebrow mb-1 truncate">{label}</div>
      <div className="font-serif text-[28px] leading-none tracking-[-0.01em] tabular text-ink">{value}</div>
      {(delta || hint) && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[12px]">
          {delta && <span className={cn("font-medium tabular", tone === "red" ? "text-bad" : tone === "green" ? "text-ok" : tone === "amber" ? "text-warn" : "text-ink-2")}>{delta}</span>}
          {hint && <span className="text-ink-3">{hint}</span>}
        </div>
      )}
    </div>
  );
}
export function Progress({ value, tone = "neutral", className }: { value: number; tone?: Tone; className?: string }) {
  const v = Math.max(0, Math.min(1, value || 0));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", tone === "neutral" ? "bg-ink-2" : dotClass[tone])} style={{ width: `${v * 100}%` }} />
    </div>
  );
}
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn("inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line-strong bg-surface px-1 font-mono text-[10.5px] text-ink-3", className)}>{children}</kbd>;
}
export function EmptyState({ icon, title, body, action, className, compact }: { icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "px-4 py-8" : "px-6 py-14", className)}>
      {icon && <div className="mb-3 flex size-10 items-center justify-center rounded-xl border border-line bg-subtle text-ink-3">{icon}</div>}
      <div className="text-[14px] font-medium text-ink">{title}</div>
      {body && <p className="mt-1 max-w-sm text-[13px] text-ink-3">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} />;
}
export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-ink-3">{hint}</span>}
    </label>
  );
}
/** Inline key/value row used in detail sidebars. */
export function Prop({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-3 text-[13px]">
      <div className="w-28 shrink-0 text-ink-3">{label}</div>
      <div className="min-w-0 flex-1 text-ink">{children}</div>
    </div>
  );
}
