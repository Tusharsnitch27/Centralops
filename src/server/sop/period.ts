import "server-only";
import { partialPeriods, periodOptions, reviewPeriods, type Grain } from "./monthly";

/** Resolve ?grain=&p= into the selected months (shared by Summary, Monthly review, Processing cost). */
export async function resolvePeriod(sp: { grain?: string; p?: string; period?: string }) {
  const [months, partial] = await Promise.all([reviewPeriods(), partialPeriods()]);
  const grain: Grain = sp.grain === "quarter" || sp.grain === "year" ? sp.grain : "month";
  const options = periodOptions(months, grain);
  const sel = options.find((o) => o.key === (sp.p ?? sp.period)) ?? options[0];
  return { grain, options, sel, partial, label: sel ? (grain === "month" ? sel.label : sel.label.split(" · ")[0]) : "" };
}
