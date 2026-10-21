// Primary navigation — deliberately lean. Icons are lucide names resolved in the Sidebar (client).
// `match` lists extra routes that light up the item (sections shown as tabs inside it).
export interface NavItem { href: string; label: string; short?: string; icon: string; countKey?: string; match?: string[]; hue?: string }
export interface NavGroup { label: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { label: "Home", items: [
    { href: "/", label: "Summary", icon: "LayoutGrid", countKey: "inbox", hue: "#16a34a" },
  ] },
  { label: "Work", items: [
    { href: "/tasks", label: "Tasks", icon: "ListChecks", countKey: "overdue", match: ["/followups"], hue: "#2563eb" },
    { href: "/meetings", label: "Meetings", icon: "Presentation", countKey: "mom", match: ["/decisions"], hue: "#7c3aed" },
    { href: "/weekly", label: "Weekly updates", short: "Weekly", icon: "Newspaper", countKey: "weekly", hue: "#0f766e" },
  ] },
  { label: "Programs", items: [
    { href: "/aop", label: "AOP", icon: "Wallet", countKey: "aop", hue: "#ea580c" },
    { href: "/sop", label: "S&OP", icon: "PackageSearch", countKey: "sop", hue: "#0891b2" },
  ] },
];

/** Sub-sections rendered as tabs at the top of a work area. */
export const SECTION_TABS: Record<string, { href: string; label: string }[]> = {
  tasks: [{ href: "/tasks", label: "My list" }, { href: "/tasks/all", label: "All views" }, { href: "/followups", label: "Follow-ups" }],
  meetings: [{ href: "/meetings", label: "Meetings" }, { href: "/decisions", label: "Decisions" }],
};
