import { LibraryList } from "@/components/library/LibraryList";
import { canManage, requireUser } from "@/server/auth";
import { listLibrary } from "@/server/library/queries";

export const metadata = { title: "SOP Library" };

export default async function SopLibrary() {
  const u = await requireUser();
  return <LibraryList kind="sop" label="SOPs" items={await listLibrary("sop")} manage={canManage(u)} />;
}
