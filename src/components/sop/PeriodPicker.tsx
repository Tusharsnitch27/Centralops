import Link from "next/link";
import type { Grain, PeriodOption } from "@/server/sop/monthly";

const GRAINS: { key: Grain; label: string }[] = [{ key: "month", label: "Month" }, { key: "quarter", label: "Quarter" }, { key: "year", label: "Annual" }];

/** View by Month / Quarter / Annual, then the specific period. */
export function PeriodPicker({ base, grain, options, selected, partial }: { base: string; grain: Grain; options: PeriodOption[]; selected: string; partial: Record<string, number> }) {
  const href = (g: Grain, p?: string) => `${base}?grain=${g}${p ? `&p=${p}` : ""}`;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <div className="seg"><span className="seg-label">View by</span>
        {GRAINS.map((g) => <Link key={g.key} href={href(g.key)} data-on={g.key === grain} className="seg-item">{g.label}</Link>)}
      </div>
      <div className="seg">
        {options.map((o) => <Link key={o.key} href={href(grain, o.key)} data-on={o.key === selected} className="seg-item">{o.label}{grain === "month" && partial[o.key] ? ` · MTD 1–${partial[o.key]}` : ""}</Link>)}
      </div>
    </div>
  );
}
