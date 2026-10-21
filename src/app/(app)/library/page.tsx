import { LibraryList } from "@/components/library/LibraryList";
import { SopLibrary } from "@/components/library/SopLibrary";
import { canManage, requireUser } from "@/server/auth";
import { listLibrary } from "@/server/library/queries";

export const metadata = { title: "SOP Library" };

export default async function SopLibraryPage() {
  const u = await requireUser();
  const items = await listLibrary("sop");
  return (
    <div className="space-y-6">
      <SopLibrary items={items} />
      {canManage(u) && (
        <details className="group">
          <summary className="cursor-pointer px-1 text-[12.5px] text-ink-3 hover:text-ink">Edit entries (add, import, remove)</summary>
          <div className="mt-3"><LibraryList kind="sop" label="SOPs" items={items} manage /></div>
        </details>
      )}
    </div>
  );
}
