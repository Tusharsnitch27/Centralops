import { LibraryList } from "@/components/library/LibraryList";
import { Glossary, type Term } from "@/components/library/Glossary";
import { canManage, requireUser } from "@/server/auth";
import { listLibrary } from "@/server/library/queries";
import handbook from "@/db/seed/handbook-fy27.json";

export const metadata = { title: "References" };

export default async function References() {
  const u = await requireUser();
  const docs = await listLibrary("handbook");
  const source = docs.find((d) => /1f3oKFnEL_jMLqLiBRLtgC5gzGN1kKDVBpbFXOpZqGy0/.test(d.url ?? ""))?.url ?? null;
  return (
    <div className="space-y-6">
      <div className="px-1">
        <h2 className="text-[15px] font-semibold">Supply Chain Terminologies</h2>
        <p className="text-[12.5px] text-ink-3">{handbook.glossary.length} terms used across warehouse, logistics, inventory and retail — each with how it is measured.</p>
      </div>
      <Glossary terms={handbook.glossary as Term[]} source={source} />
      <details className="group">
        <summary className="cursor-pointer px-1 text-[12.5px] text-ink-3 hover:text-ink">All reference documents ({docs.length})</summary>
        <div className="mt-3"><LibraryList kind="handbook" label="Reference docs" items={docs} manage={canManage(u)} /></div>
      </details>
    </div>
  );
}
