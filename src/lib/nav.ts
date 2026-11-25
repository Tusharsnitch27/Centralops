// Primary navigation — deliberately lean. Icons are lucide names resolved in the Sidebar (client).
// `match` lists extra routes that light up the item (sections shown as tabs inside it).
export interface NavItem { href: string; label: string; short?: string; icon: string; countKey?: string; match?: string[]; hue?: string }
export interface NavGroup { label: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { label: "Home", items: [
    { href: "/", label: "Summary", icon: "LayoutGrid", countKey: "inbox", hue: "#16a34a" },
  ] },
  { label: "Work", items: [
    { href: "/tasks", label: "Tasks", icon: "ListChecks", countKey: "overdue", hue: "#2563eb" },
    { href: "/weekly", label: "Weekly updates", short: "Weekly", icon: "Newspaper", countKey: "weekly", hue: "#0f766e" },
  ] },
  { label: "Programs", items: [
    { href: "/aop", label: "AOP", icon: "Wallet", countKey: "aop", hue: "#ea580c" },
    { href: "/functions", label: "Cost Control", icon: "Warehouse", hue: "#4f46e5" },
    { href: "/sop", label: "S&OP", icon: "PackageSearch", countKey: "sop", hue: "#0891b2" },
  ] },
  // meetings & MoM and the handbook sit together; MoMs can also be started from Summary
  { label: "Others", items: [
    { href: "/meetings", label: "Others", short: "Others", icon: "LayoutList", countKey: "mom", match: ["/library"], hue: "#7c3aed" },
  ] },
];

/** Sub-sections rendered as tabs at the top of a work area. */
export const SECTION_TABS: Record<string, { href: string; label: string }[]> = {
  others: [{ href: "/meetings", label: "Meetings & MoM" }, { href: "/library", label: "Ops Handbook" }],
  tasks: [{ href: "/tasks", label: "My list" }, { href: "/tasks/goals", label: "Goals & projects" }, { href: "/tasks/programs", label: "Programs" }, { href: "/tasks/all", label: "All views" }],
};
