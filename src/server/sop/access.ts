import "server-only";
import { redirect } from "next/navigation";
import { canOverview, requireUser } from "../auth";

/** S&OP overview pages: full-overview people only; everyone else goes to their own inputs. */
export async function requireSopOverview() {
  const u = await requireUser();
  if (!canOverview(u)) redirect("/sop/inputs");
  return u;
}
