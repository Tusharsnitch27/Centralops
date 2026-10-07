import { requireUser } from "@/server/auth";
import { navCounts } from "@/server/shell/counts";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { QuickAdd } from "@/components/shell/QuickAdd";
import { Toaster } from "@/components/ui/client";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const counts = await navCounts(user);
  return (
    <Toaster>
      <div className="flex min-h-dvh">
        <Sidebar counts={counts} user={{ name: user.name, title: user.title, role: user.role }} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar unread={counts.notifications ?? 0} />
          <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-7 md:px-8">{children}</main>
        </div>
      </div>
      <CommandPalette />
      <QuickAdd />
    </Toaster>
  );
}
