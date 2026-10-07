import { requireUser } from "@/server/auth";
import { navCounts } from "@/server/shell/counts";
import { Topbar } from "@/components/shell/Topbar";
import { NavRail } from "@/components/shell/NavRail";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { QuickAdd } from "@/components/shell/QuickAdd";
import { Toaster } from "@/components/ui/client";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const counts = await navCounts(user);
  return (
    <Toaster>
      {/* Vertical nav on the left */}
      <div className="mx-auto flex min-h-dvh max-w-[1680px] gap-5 px-3 md:px-5">
        <NavRail counts={counts} user={{ name: user.name, title: user.title }} />
        <div className="min-w-0 flex-1">
          <Topbar unread={counts.notifications ?? 0} counts={counts} user={{ name: user.name, title: user.title }} />
          <main className="w-full px-1 pb-16 pt-7 md:px-3">{children}</main>
        </div>
      </div>
      <CommandPalette />
      <QuickAdd />
    </Toaster>
  );
}
