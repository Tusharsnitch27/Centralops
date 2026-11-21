// D-1 cost of doing business — pure maths (no server imports; used by dayCost.ts and scripts/check-wcm.mjs).

export type Basis = "measured" | "run-rate" | "booked" | "missing";
export interface CostLine { key: string; label: string; amount: number | null; basis: Basis; note: string; side: "B2C" | "B2B" | "shared" }

/**
 * Split a day's cost into B2C and B2B: direct lines go to their side; shared lines are split by dispatched items
 * (B2C items ÷ all items). Missing lines are listed, never priced as 0. Returns totals that always tie:
 * total = b2c + b2b (shared included in both by share), and the shared amount separately for display.
 * Unit of measure, the same in the day and month views: B2C = cost per shipment (order / package — S&OP orders and
 * Unicommerce packages agree within ~2%); B2B = cost per unit (an LR, a box and a unit differ, and only units exist both daily
 * and monthly).
 */
export function splitDay(lines: CostLine[], items: { b2c: number; b2b: number }, shipments: { b2c: number }) {
  const known = lines.filter((l) => l.amount != null);
  const sum = (side: CostLine["side"]) => known.filter((l) => l.side === side).reduce((a, l) => a + l.amount!, 0);
  const shared = sum("shared"), allItems = items.b2c + items.b2b;
  const share = allItems ? items.b2c / allItems : null; // no dispatch that day ⇒ shared can't be split
  const b2c = share == null ? null : sum("B2C") + shared * share;
  const b2b = share == null ? null : sum("B2B") + shared * (1 - share);
  const total = known.reduce((a, l) => a + l.amount!, 0);
  return {
    total, shared, shareB2c: share, b2c, b2b,
    cpsB2c: b2c != null && shipments.b2c ? b2c / shipments.b2c : null,
    cpuB2b: b2b != null && items.b2b ? b2b / items.b2b : null,
    missing: lines.filter((l) => l.amount == null).map((l) => l.label),
  };
}

/** ₹ per present day-equivalent from the salary master. */
export const perDe = (monthly: number, daysBasis: number) => monthly / daysBasis;
