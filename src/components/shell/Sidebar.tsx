"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Icons from "lucide-react";
import { NAV } from "@/lib/nav";
import { cn } from "@/lib/cn";

type IconName = keyof typeof Icons;
type IconCmp = React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <div className="relative flex items-center justify-center rounded-[9px] border" style={{ width: size, height: size, borderColor: "color-mix(in srgb, var(--color-accent) 45%, transparent)", background: "color-mix(in srgb, var(--color-accent) 14%, transparent)" }}>
      <svg viewBox="0 0 24 24" style={{ width: size * 0.55, height: size * 0.55, color: "var(--color-accent)" }} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="7.5" opacity=".5" /><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
        <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
      </svg>
    </div>
  );
}

const S = { ink: "var(--color-side-ink)", ink2: "var(--color-side-ink-2)", ink3: "var(--color-side-ink-3)", accent: "var(--color-accent)" };

export function Sidebar({ counts, user }: { counts: Record<string, number>; user: { name: string; title: string | null; role: string } }) {
  const path = usePathname();
  const isActive = (href: string, match: string[] = []) =>
    href === "/" ? path === "/" : [href, ...match].some((h) => path === h || path.startsWith(`${h}/`));
  const Item = ({ href, label, icon, count, alert, match }: { href: string; label: string; icon: string; count?: number; alert?: boolean; match?: string[] }) => {
    const Icon = (Icons[icon as IconName] ?? Icons.Circle) as IconCmp;
    const active = isActive(href, match);
    return (
      <Link href={href} prefetch={false}
        className={cn("group relative flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] transition-all duration-200", active ? "bg-white/[0.07] shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]" : "hover:bg-white/[0.04]")}
        style={{ color: active ? S.ink : S.ink2 }}>
        {active && <span className="absolute inset-y-2 left-0 w-[2px] rounded-r-full" style={{ background: S.accent }} />}
        <Icon size={16} strokeWidth={1.7} className="shrink-0 transition-colors" />
        <span className={cn("flex-1 truncate", active && "font-medium")}>{label}</span>
        {!!count && (
          <span className="min-w-[20px] rounded-md px-1.5 py-px text-center text-[11px] font-semibold tabular"
            style={alert ? { background: "#c2414b", color: "#fff" } : { background: "color-mix(in srgb, var(--color-accent) 22%, transparent)", color: S.ink }}>{count}</span>
        )}
      </Link>
    );
  };
  return (
    <aside className="sticky top-0 hidden h-dvh w-[252px] shrink-0 flex-col lg:flex"
      style={{ background: "linear-gradient(180deg, var(--color-side) 0%, var(--color-side-2) 100%)", boxShadow: "inset -1px 0 0 rgb(255 255 255 / 0.04)" }}>
      <div className="px-6 pb-5 pt-6">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.32em]" style={{ color: S.ink3 }}>Snitch</div>
        <div className="mt-1 font-serif text-[24px] leading-none tracking-[-0.01em]" style={{ color: S.ink }}>Central Ops</div>
        <div className="mt-2 flex items-center gap-2">
          <span className="h-px w-5" style={{ background: S.accent }} />
          <span className="text-[10.5px] font-medium uppercase tracking-[0.2em]" style={{ color: S.accent }}>Program Manager 2.0</span>
        </div>
      </div>
      <div className="mx-5 h-px bg-white/[0.07]" />
      <nav className="flex-1 overflow-y-auto px-3 py-5 [scrollbar-width:none]">
        {NAV.map((g) => (
          <div key={g.label} className="mb-6">
            <div className="mb-2 flex items-center gap-2 px-3">
              <span className="size-1 rounded-full" style={{ background: S.accent }} />
              <span className="font-serif text-[13px]" style={{ color: S.ink2 }}>{g.label}</span>
              <span className="h-px flex-1 bg-white/[0.06]" />
            </div>
            <div className="space-y-0.5">
              {g.items.map((it) => (
                <Item key={it.href} href={it.href} label={it.label} icon={it.icon} match={it.match}
                  count={it.countKey ? counts[it.countKey] ?? 0 : 0} alert={it.countKey === "overdue"} />
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="space-y-1.5 p-3">
        <Item href="/settings" label="Settings" icon="Settings" />
        <form action="/api/auth/logout" method="post" className="flex items-center gap-2.5 rounded-xl bg-white/[0.05] px-3 py-2.5 ring-1 ring-inset ring-white/[0.06]">
          <div className="flex size-8 items-center justify-center rounded-full font-serif text-[13px]" style={{ background: "color-mix(in srgb, var(--color-accent) 30%, transparent)", color: S.ink }}>
            {user.name.slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-medium" style={{ color: S.ink }}>{user.name}</div>
            <div className="truncate text-[11px]" style={{ color: S.ink3 }}>{user.title ?? user.role}</div>
          </div>
          <button className="rounded-md p-1.5 transition-colors hover:bg-white/10" style={{ color: S.ink3 }} title="Sign out"><Icons.LogOut size={14} /></button>
        </form>
      </div>
    </aside>
  );
}
