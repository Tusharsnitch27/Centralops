import { redirect } from "next/navigation";
import { getUser } from "@/server/auth";
import { safeNext } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  invalid: "That username and password don't match.",
  locked: "Too many attempts. Try again in a few minutes.",
};

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await getUser()) redirect(next);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-[380px] animate-rise">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-ink text-white shadow-lg">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="7.5" opacity=".45" /><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" /></svg>
          </div>
          <h1 className="font-serif text-[34px] leading-none tracking-[-0.01em]">Central Ops</h1>
          <p className="mt-2 text-[13.5px] text-ink-3">Information → Insight → Action → Follow-up → Closure</p>
        </div>
        <div className="card p-6">
          {sp.error && <div className="mb-4 rounded-lg bg-bad-soft px-3 py-2 text-[12.5px] text-bad">{ERRORS[sp.error] ?? "Sign-in failed."}</div>}
                    <form action="/api/auth/login" method="post" className="space-y-3.5">
            <input type="hidden" name="next" value={next} />
            <label className="block"><span className="label">Email</span><input name="username" autoComplete="email" required autoFocus className="field" /></label>
            <label className="block"><span className="label">Password</span><input name="password" type="password" autoComplete="current-password" required className="field" /></label>
            <button className="mt-1 h-10 w-full rounded-lg bg-ink text-[13.5px] font-medium text-white hover:bg-ink-2">Sign in</button>
          </form>
        </div>
        <p className="mt-6 text-center text-[12px] text-ink-4">Snitch · Central Operations</p>
      </div>
    </div>
  );
}
