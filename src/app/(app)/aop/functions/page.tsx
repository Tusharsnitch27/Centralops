import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { FN_KEYS, fnHref, parseMode, parseSite } from "@/lib/functions";
import type { FnKey } from "@/server/functions/types";

/** Functions moved out of AOP (now /functions). Old links land on the same function with site, view, cycle and Rulebook scenario kept;
 *  no fn → B2B Retail, as the old page defaulted; "returns" → B2C Returns, as before. */
export default async function OldFunctionsRedirect({ searchParams }: { searchParams: Promise<{ fn?: string; site?: string; mode?: string; scenario?: string; cycle?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const fn: FnKey = sp.fn === "returns" ? "b2c_returns" : FN_KEYS.includes(sp.fn as FnKey) ? (sp.fn as FnKey) : "b2b_retail";
  redirect(fnHref(fn, { site: parseSite(sp.site), mode: parseMode(sp.mode), cycle: sp.cycle, scenario: sp.scenario }));
}
