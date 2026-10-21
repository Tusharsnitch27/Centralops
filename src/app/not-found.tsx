import Link from "next/link";
import { LogoMark } from "@/components/shell/Logo";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
      <LogoMark size={36} />
      <div>
        <h1 className="text-[20px] font-semibold tracking-[-0.02em]">This page doesn’t exist</h1>
        <p className="mt-1 text-[13px] text-ink-3">The link may be mistyped or the item was removed.</p>
      </div>
      <div className="flex gap-2">
        <Link href="/" className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-white hover:bg-ink-2">Go to Summary</Link>
        <Link href="/tasks" className="rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-[13px] text-ink-2 hover:bg-subtle">My tasks</Link>
      </div>
    </div>
  );
}
