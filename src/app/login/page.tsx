import { redirect } from "next/navigation";
import { ArrowRight, Bell, CalendarCheck2, Lock, Mail, Target } from "lucide-react";
import { getUser } from "@/server/auth";
import { safeNext } from "@/lib/session";
import { LogoGlyph, LogoMark } from "@/components/shell/Logo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  invalid: "That email and password don't match.",
  locked: "Too many attempts. Try again in a few minutes.",
  session: "Your session ended — please sign in again.",
};

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await getUser()) redirect(next);

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(440px,0.9fr)]">
      {/* ---------- Brand panel (desktop) ---------- */}
      <section className="relative hidden flex-col justify-between bg-hero p-12 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-white text-ink"><LogoGlyph style={{ width: 20, height: 20 }} /></span>
          <span className="leading-tight">
            <span className="block text-[14px] font-semibold">Central Ops</span>
            <span className="block text-[11.5px] text-white/50">Program Manager 2.0</span>
          </span>
        </div>
        <div className="max-w-[440px]">
          <h1 className="text-[32px] font-semibold leading-[1.15] tracking-[-0.02em]">Run every program from one place.</h1>
          <p className="mt-3 text-[14px] leading-relaxed text-white/60">Meetings become actions, actions get followed up, and AOP &amp; S&amp;OP stay on plan.</p>
          <ul className="mt-8 space-y-3 border-t border-white/10 pt-6 text-[13px] text-white/75">
            <li className="flex items-center gap-3"><CalendarCheck2 size={15} className="text-white/45" /> MoM owners write, you review and distribute</li>
            <li className="flex items-center gap-3"><Bell size={15} className="text-white/45" /> Follow-ups and WhatsApp reminders on delays</li>
            <li className="flex items-center gap-3"><Target size={15} className="text-white/45" /> Budget, provision and actuals by function</li>
          </ul>
        </div>
        <div className="text-[11.5px] text-white/35">Information → Insight → Action → Follow-up → Closure</div>
      </section>

      {/* ---------- Sign-in ---------- */}
      <section className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-[360px]">
          <div className="mb-10 flex items-center gap-2.5 lg:hidden">
            <LogoMark size={32} />
            <div className="leading-tight"><div className="text-[14px] font-semibold">Central Ops</div><div className="text-[11.5px] text-ink-4">Program Manager 2.0</div></div>
          </div>
          <h2 className="text-[22px] font-semibold tracking-[-0.02em]">Sign in</h2>
          <p className="mt-1 text-[13px] text-ink-3">Use your Snitch work email.</p>

          {sp.error && <div className="mt-5 rounded-lg border border-bad/20 bg-bad-soft px-3.5 py-2.5 text-[12.5px] font-medium text-bad">{ERRORS[sp.error] ?? "Sign-in failed."}</div>}

          <form action="/api/auth/login" method="post" className="mt-6 space-y-4">
            <input type="hidden" name="next" value={next} />
            <label className="block">
              <span className="label">Email</span>
              <span className="relative block">
                <Mail size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
                <input name="username" type="text" inputMode="email" autoComplete="email" autoCapitalize="none" required autoFocus placeholder="name@snitch.com" className="field h-11 pl-9" />
              </span>
            </label>
            <label className="block">
              <span className="label">Password</span>
              <span className="relative block">
                <Lock size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
                <input name="password" type="password" autoComplete="current-password" required placeholder="••••••••" className="field h-11 pl-9" />
              </span>
            </label>
            <button className="group flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-ink text-[13.5px] font-medium text-white transition-colors hover:bg-ink-2">
              Sign in <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
            </button>
          </form>
          <p className="mt-6 text-[12px] text-ink-4">No access yet? Ask your Central Ops admin to add you.</p>
        </div>
      </section>
    </div>
  );
}
