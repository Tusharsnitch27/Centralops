import Link from "next/link";
import { BookOpen, ExternalLink } from "lucide-react";
import { LibraryList } from "@/components/library/LibraryList";
import { canManage, requireUser } from "@/server/auth";
import { listLibrary } from "@/server/library/queries";
import { cn } from "@/lib/cn";

export const metadata = { title: "Ops Handbook" };

/** Google Docs / Sheets / Slides → their embeddable preview (renders for anyone signed in to Google with access). */
function embedUrl(url: string | null) {
  if (!url) return null;
  const m = /docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([\w-]+)/.exec(url);
  if (!m) return null;
  const tab = /[?&]tab=([\w.]+)/.exec(url)?.[1];
  const gid = /gid=(\d+)/.exec(url)?.[1];
  return `https://docs.google.com/${m[1]}/d/${m[2]}/preview${m[1] === "document" && tab ? `?tab=${tab}` : m[1] === "spreadsheets" && gid ? `?gid=${gid}` : ""}`;
}

export default async function Handbook({ searchParams }: { searchParams: Promise<{ doc?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const docs = await listLibrary("handbook");
  const cur = docs.find((d) => d.id === sp.doc) ?? docs[0];
  const src = embedUrl(cur?.url ?? null);
  return (
    <div className="space-y-4">
      {docs.length > 1 && (
        <div className="seg">{docs.map((d) => <Link key={d.id} href={`/library/handbook?doc=${d.id}`} data-on={d.id === cur?.id} className="seg-item">{d.title}</Link>)}</div>
      )}
      {cur && (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
            <BookOpen size={15} className="text-ink-4" />
            <span className="text-[13.5px] font-semibold">{cur.title}</span>
            {cur.description && <span className="hidden text-[12px] text-ink-4 md:inline">· {cur.description}</span>}
            {cur.url && <a href={cur.url} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1 text-[12px] text-info hover:underline">Open in Google Docs<ExternalLink size={11} /></a>}
          </div>
          {src ? <iframe src={src} title={cur.title} className={cn("block h-[calc(100dvh-280px)] min-h-[520px] w-full bg-white")} />
            : <p className="p-6 text-[13px] text-ink-3">This document can’t be shown inline — use Open.</p>}
          <p className="border-t border-line px-4 py-2 text-[11.5px] text-ink-4">Shown from Google Docs — you need to be signed in to Google with access to the doc. Edits happen in Google Docs and show up here.</p>
        </div>
      )}
      <details className="group">
        <summary className="cursor-pointer px-1 text-[12.5px] text-ink-3 hover:text-ink">Manage handbook documents</summary>
        <div className="mt-3"><LibraryList kind="handbook" label="Handbook docs" items={docs} manage={canManage(u)} /></div>
      </details>
    </div>
  );
}
