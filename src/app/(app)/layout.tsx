import { requireUser } from "@/server/auth";
import { navCounts } from "@/server/shell/counts";
import { Topbar } from "@/components/shell/Topbar";
import { BottomNav, NavRail } from "@/components/shell/NavRail";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { Toaster } from "@/components/ui/client";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const counts = await navCounts(user);
  return (
    <Toaster>
      <div className="flex min-h-dvh">
        <NavRail counts={counts} user={{ name: user.name, title: user.title }} />
        <div className="min-w-0 flex-1">
          <Topbar unread={counts.notifications ?? 0} user={{ name: user.name, title: user.title }} />
          <main className="mx-auto w-full max-w-[1440px] px-4 pb-28 pt-5 md:px-6 md:pt-6 lg:pb-14 print:p-0">{children}</main>
        </div>
      </div>
      <BottomNav counts={counts} />
      <CommandPalette />
    </Toaster>
  );
}
