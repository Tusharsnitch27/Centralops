// Central Ops functions, in display order, with keywords used to place an SOP/dashboard when the sheet doesn't say.
export const OPS_FUNCTIONS: { name: string; keys: RegExp }[] = [
  { name: "Warehouse", keys: /\b(warehouse|wh\b|inward|grn|putaway|picking|packing|dispatch|cycle count|audit stock|not found|nf\b|returns? processing|qc\b|fulfil+ment centre)/i },
  { name: "Logistics", keys: /\b(logistics|courier|shipping|shipment|rto|ndr|last mile|clickpost|delhivery|bluedart|shadowfax|xpressbees|freight|transport|hld|pickup|reverse pickup|rvp)/i },
  { name: "Distribution", keys: /\b(distribution|replenish|allocation|b2b|store transfer|stock transfer|rulebook|milk.?run|outward)/i },
  { name: "Customer Experience", keys: /\b(cx\b|customer|nps|refund|cancellation|complaint|ticket|wismo|escalation|contact rate|wpr|dispute)/i },
  { name: "RFID", keys: /\b(rfid|tagging|global count)/i },
  { name: "Retail & Store Tech", keys: /\b(store|retail|pos\b|boris|dsr|nso|omni|in.?store)/i },
  { name: "PLM & WAM", keys: /\b(plm|wam|asn|pre.?pack|item master|purchase order|po\b|vendor onboarding|sampling)/i },
  { name: "ERP", keys: /\b(erp|logic|unicommerce|uniware|uc\b|gst|invoice|journal|tally)/i },
  { name: "Finance Ops", keys: /\b(fin ?ops|finance|payment|reconciliation|recon|cost|budget|aop|provision|billing)/i },
  { name: "Packaging", keys: /\b(packaging|carton|polybag|box(es)?|label(ling)?)/i },
  { name: "SaaS & Tools", keys: /\b(saas|licen[cs]e|software|tool|subscription|automation|n8n|bot)/i },
  { name: "Snitch Quick", keys: /\b(quick|q-?com|instamart|blinkit|zepto|dark store|mfc)/i },
  { name: "Long Tail & Plus", keys: /\b(long ?tail|plus|liquidation|accessor|perfume|shoe|footwear|trolley)/i },
  { name: "Marketplace", keys: /\b(marketplace|myntra|flipkart|ajio|amazon|nykaa|sor\b|ppmp)/i },
  { name: "S&OP & Planning", keys: /\b(s&op|sop review|projection|forecast|demand|planning|capacity)/i },
];
export const GENERAL = "General";
// business lines are matched before generic process words ("Long Tail allocation" is Long Tail, not Distribution)
const MATCH_ORDER = ["Snitch Quick", "Long Tail & Plus", "Marketplace", "RFID", "PLM & WAM", "ERP", "Customer Experience", "S&OP & Planning"];
const ranked = [...OPS_FUNCTIONS].sort((a, b) => (MATCH_ORDER.indexOf(a.name) + 1 || 99) - (MATCH_ORDER.indexOf(b.name) + 1 || 99));

/** The function an item belongs to: the sheet's own column when it names one, else keyword match on the text. */
export function functionOf(i: { function_name?: string; category?: string; title: string; description?: string }) {
  const given = (i.function_name || "").trim();
  if (given) return OPS_FUNCTIONS.find((f) => f.name.toLowerCase() === given.toLowerCase())?.name ?? ranked.find((f) => f.keys.test(given))?.name ?? given;
  // the title decides first; description only when the title says nothing
  return ranked.find((f) => f.keys.test(`${i.title} ${i.category ?? ""}`))?.name ?? ranked.find((f) => f.keys.test(i.description ?? ""))?.name ?? GENERAL;
}
export const functionOrder = (name: string) => { const i = OPS_FUNCTIONS.findIndex((f) => f.name === name); return i < 0 ? (name === GENERAL ? 999 : 500) : i; };
