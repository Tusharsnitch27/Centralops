// Primary navigation — deliberately lean. Icons are lucide names resolved in the Sidebar (client).
// `match` lists extra routes that light up the item (sections shown as tabs inside it).
export interface NavItem { href: string; label: string; icon: string; countKey?: string; match?: string[] }
export interface NavGroup { label: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { label: "Home", items: [
    { href: "/", label: "Summary", icon: "LayoutDashboard", countKey: "inbox" },
  ] },
  { label: "Work", items: [
    { href: "/tasks", label: "Tasks", icon: "CircleCheck", countKey: "overdue", match: ["/followups"] },
    { href: "/meetings", label: "Meetings", icon: "CalendarClock", countKey: "mom", match: ["/decisions"] },
  ] },
  { label: "Programs", items: [
    { href: "/aop", label: "AOP", icon: "Target", countKey: "aop" },
    { href: "/sop", label: "S&OP", icon: "Boxes", countKey: "sop" },
  ] },
];

/** Sub-sections rendered as tabs at the top of a work area. */
export const SECTION_TABS: Record<string, { href: string; label: string }[]> = {
  tasks: [{ href: "/tasks", label: "Tasks" }, { href: "/followups", label: "Follow-ups" }],
  meetings: [{ href: "/meetings", label: "Meetings" }, { href: "/decisions", label: "Decisions" }],
};
