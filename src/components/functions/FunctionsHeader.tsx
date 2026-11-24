import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui";
import { FN_KEYS, fnHref, type FnQuery } from "@/lib/functions";
import { FN } from "@/server/functions/types";
import type { FnKey } from "@/server/functions/types";

/** Functions module header: Overview + the seven functions, then Site and the view (Last 30 days / Month on month). Filters carry across. */
export function FunctionsHeader({ active, q, title, subtitle }: { active: FnKey | "overview"; q: FnQuery & { site: NonNullable<FnQuery["site"]>; mode: NonNullable<FnQuery["mode"]> }; title: ReactNode; subtitle?: ReactNode }) {
  const fn = active === "overview" ? null : active;
  return (
    <>
      <PageHeader eyebrow="Warehouse functions" title={title} subtitle={subtitle} className="mb-4" />
      <nav aria-label="Functions" className="mb-3 flex flex-wrap items-center gap-2">
        <div className="seg">
          <Link href={fnHref(null, q)} scroll={false} data-on={active === "overview"} aria-current={active === "overview" ? "page" : undefined} className="seg-item">Overview</Link>
        </div>
        <div className="seg">
          {FN_KEYS.map((k) => (
            <Link key={k} href={fnHref(k, q)} scroll={false} data-on={k === active} aria-current={k === active ? "page" : undefined} className="seg-item">{FN[k].label}</Link>
          ))}
        </div>
      </nav>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="seg" role="group" aria-label="Site">
          <span className="seg-label">Site</span>
          {(["Both", "South", "North"] as const).map((s) => <Link key={s} href={fnHref(fn, { ...q, site: s })} scroll={false} data-on={s === q.site} className="seg-item">{s}</Link>)}
        </div>
        <div className="seg" role="group" aria-label="View">
          <Link href={fnHref(fn, { ...q, mode: "day" })} scroll={false} data-on={q.mode === "day"} className="seg-item">Last 30 days</Link>
          <Link href={fnHref(fn, { ...q, mode: "month" })} scroll={false} data-on={q.mode === "month"} className="seg-item">Month on month</Link>
        </div>
      </div>
    </>
  );
}
