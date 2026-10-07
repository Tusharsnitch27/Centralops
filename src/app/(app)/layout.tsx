import { requireUser } from "@/server/auth";
import { navCounts } from "@/server/shell/counts";
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
      <div className="min-h-dvh">
        <Topbar unread={counts.notifications ?? 0} counts={counts} user={{ name: user.name, title: user.title }} />
        <main className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-7 md:px-9">{children}</main>
      </div>
      <CommandPalette />
      <QuickAdd />
    </Toaster>
  );
}
