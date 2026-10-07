import { redirect } from "next/navigation";
import { ArrowRight, Bell, CalendarCheck2, Lock, Mail, Target } from "lucide-react";
import { getUser } from "@/server/auth";
import { safeNext } from "@/lib/session";
import { LogoMark } from "@/components/shell/Logo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  invalid: "That email and password don't match.",
  locked: "Too many attempts. Try again in a few minutes.",
  session: "Your session ended — please sign in again.",
};

const BARS = [38, 52, 44, 68, 57, 74, 63, 82, 70, 88, 76, 92];

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await getUser()) redirect(next);

  return (
    <div className="flex min-h-dvh items-stretch p-3 md:p-4">
      <div className="grid w-full overflow-hidden rounded-[28px] bg-white shadow-[0_30px_80px_-30px_rgb(17_18_20/0.35)] lg:grid-cols-[1.1fr_1fr]">
        {/* ---------- Brand panel ---------- */}
        <section className="relative hidden overflow-hidden p-10 text-white lg:flex lg:flex-col"
          style={{ background: "radial-gradient(800px 420px at 85% -10%, color-mix(in srgb, var(--color-accent) 55%, transparent), transparent 60%), radial-gradient(600px 380px at -10% 110%, color-mix(in srgb, var(--color-accent-2) 30%, transparent), transparent 60%), linear-gradient(150deg, #17181b, #0d0e10)" }}>
          <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "linear-gradient(rgb(255 255 255) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255) 1px, transparent 1px)", backgroundSize: "44px 44px" }} />
          <div className="relative flex items-center gap-3">
            <LogoMark size={46} />
            <div className="leading-tight">
              <div className="text-[20px] font-extrabold tracking-[-0.03em]">Central Ops</div>
              <div className="text-[12.5px] font-medium text-white/60">Program Manager 2.0</div>
            </div>
          </div>

          <div className="relative mt-auto">
            <h1 className="max-w-[460px] text-[40px] font-extrabold leading-[1.05] tracking-[-0.045em]">
              Run every program <span style={{ color: "var(--color-accent-2)" }}>from one place.</span>
            </h1>
            <p className="mt-4 max-w-[420px] text-[15px] leading-relaxed text-white/65">
              Meetings become actions, actions get followed up, and AOP & S&OP stay on plan — without the spreadsheet chase.
            </p>

            {/* preview tiles */}
            <div className="mt-8 grid max-w-[480px] grid-cols-2 gap-3">
              <div className="col-span-2 rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur">
                <div className="flex items-center justify-between text-[12px] font-semibold text-white/60">
                  <span className="flex items-center gap-1.5"><Target size={13} /> Opex vs budget · FY 26-27</span>
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: "color-mix(in srgb, var(--color-accent) 55%, transparent)" }}>Live</span>
                </div>
                <div className="mt-3 flex h-16 items-end gap-1.5">
                  {BARS.map((h, i) => (
                    <span key={i} className="flex-1 rounded-t-md" style={{ height: `${h}%`, background: i >= 8 ? "linear-gradient(180deg, var(--color-accent-2), var(--color-accent))" : "rgb(255 255 255 / 0.16)" }} />
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur">
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-white/60"><CalendarCheck2 size={13} /> Meetings</div>
                <div className="mt-2 text-[20px] font-extrabold leading-tight tracking-[-0.03em]">MoM → actions</div>
                <div className="mt-1 text-[11.5px] text-white/50">owners write, you distribute</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur">
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-white/60"><Bell size={13} /> Follow-ups</div>
                <div className="mt-2 text-[20px] font-extrabold leading-tight tracking-[-0.03em]">Auto-reminders</div>
                <div className="mt-1 text-[11.5px] text-white/50">in-app &amp; WhatsApp</div>
              </div>
            </div>
          </div>
          <div className="relative mt-10 text-[12px] text-white/40">Information → Insight → Action → Follow-up → Closure</div>
        </section>

        {/* ---------- Sign-in ---------- */}
        <section className="flex flex-col justify-center px-6 py-12 sm:px-14">
          <div className="mx-auto w-full max-w-[380px]">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <LogoMark size={42} />
              <div className="leading-tight"><div className="text-[18px] font-extrabold tracking-[-0.03em]">Central Ops</div><div className="text-[12px] font-medium text-ink-3">Program Manager 2.0</div></div>
            </div>
            <h2 className="text-[30px] font-extrabold leading-tight tracking-[-0.04em]">Welcome back</h2>
            <p className="mt-1.5 text-[14.5px] text-ink-3">Sign in with your Snitch work email.</p>

            {sp.error && <div className="mt-6 rounded-2xl border border-bad/20 bg-bad-soft px-4 py-3 text-[13px] font-medium text-bad">{ERRORS[sp.error] ?? "Sign-in failed."}</div>}

            <form action="/api/auth/login" method="post" className="mt-7 space-y-4">
              <input type="hidden" name="next" value={next} />
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-semibold text-ink-2">Email</span>
                <span className="relative block">
                  <Mail size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-4" />
                  <input name="username" type="text" autoComplete="email" required autoFocus placeholder="name@snitch.com"
                    className="h-12 w-full rounded-2xl border border-line-strong bg-subtle/50 pl-11 pr-4 text-[14.5px] outline-none transition-[border-color,box-shadow,background] placeholder:text-ink-4 focus:border-[var(--color-accent)] focus:bg-white focus:ring-4 focus:ring-[color-mix(in_srgb,var(--color-accent)_15%,transparent)]" />
                </span>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-semibold text-ink-2">Password</span>
                <span className="relative block">
                  <Lock size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-4" />
                  <input name="password" type="password" autoComplete="current-password" required placeholder="••••••••"
                    className="h-12 w-full rounded-2xl border border-line-strong bg-subtle/50 pl-11 pr-4 text-[14.5px] outline-none transition-[border-color,box-shadow,background] placeholder:text-ink-4 focus:border-[var(--color-accent)] focus:bg-white focus:ring-4 focus:ring-[color-mix(in_srgb,var(--color-accent)_15%,transparent)]" />
                </span>
              </label>
              <button className="group flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-bold text-white shadow-[0_14px_28px_-14px_var(--color-accent)] transition-transform active:translate-y-px"
                style={{ background: "linear-gradient(135deg, var(--color-accent), color-mix(in srgb, var(--color-accent) 65%, var(--color-accent-2)))" }}>
                Sign in <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" />
              </button>
            </form>
            <p className="mt-6 text-center text-[12.5px] text-ink-4">Don’t have access? Ask your Central Ops admin to add you.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
