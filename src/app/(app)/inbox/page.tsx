import { Inbox as InboxIcon } from "lucide-react";
import { Card, EmptyState, PageHeader, Tabs } from "@/components/ui";
import { InboxList } from "@/components/inbox/InboxList";
import { requireUser } from "@/server/auth";
import { runSweeps } from "@/server/inbox/sweep";
import { INBOX_GROUPS, inboxCounts, listInbox } from "@/server/inbox/queries";

export const metadata = { title: "Inbox" };

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ g?: string; done?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  await runSweeps(u);
  const group = sp.g && INBOX_GROUPS[sp.g] ? sp.g : "all";
  const showDone = sp.done === "1";
  const [items, counts] = await Promise.all([listInbox(u.id, group, showDone ? "done" : "open"), inboxCounts(u.id)]);
  return (
    <>
      <PageHeader title="Inbox" subtitle="Everything that needs a decision from you — processed, snoozed or dismissed, nothing gets lost."
        actions={<a href={showDone ? `/inbox?g=${group}` : `/inbox?g=${group}&done=1`} className="text-[12.5px] text-ink-3 hover:text-ink">{showDone ? "Show open" : "Recently processed"}</a>} />
      <Tabs className="mb-4" active={group}
        items={Object.entries(INBOX_GROUPS).map(([k, v]) => ({ key: k, label: v.label, href: `/inbox?g=${k}${showDone ? "&done=1" : ""}`, count: showDone ? undefined : counts[k] }))} />
      <Card className="overflow-hidden">
        {items.length ? <InboxList items={items} readOnly={showDone} /> : (
          <EmptyState icon={<InboxIcon size={18} />} title={showDone ? "Nothing processed recently" : "Inbox zero"}
            body={showDone ? "Items you complete or dismiss show up here for 14 days." : "New MoM prompts, assignments, overdue items and input requests will land here."} />
        )}
      </Card>
    </>
  );
}
