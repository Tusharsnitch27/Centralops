import { PageHeader, Tabs } from "@/components/ui";
import { requireUser, canManage } from "@/server/auth";
import {
  DEFAULT_TEMPLATES, TEMPLATE_KEYS, getTemplates, getUserProfile, listInsightRules, listPermissions, listTeamsAdmin, listUsersAdmin, permissionEntities,
} from "@/server/settings/queries";
import { listPeople } from "@/server/core/people";
import { today } from "@/lib/dates";
import { ProfileForm } from "@/components/settings/ProfileForm";
import { UsersAdmin } from "@/components/settings/UsersAdmin";
import { PermissionsAdmin } from "@/components/settings/PermissionsAdmin";
import { TeamsAdmin } from "@/components/settings/TeamsAdmin";
import { TemplatesForm } from "@/components/settings/TemplatesForm";
import { RulesAdmin } from "@/components/settings/RulesAdmin";

export const metadata = { title: "Settings" };

const ALL_TABS = [
  { key: "profile", label: "Profile", admin: false },
  { key: "users", label: "Users & access", admin: true },
  { key: "org", label: "Org chart", admin: true },
  { key: "permissions", label: "Permissions", admin: true },
  { key: "teams", label: "Teams", admin: true },
  { key: "templates", label: "Templates", admin: true },
  { key: "rules", label: "Insight rules", admin: true },
  { key: "integrations", label: "Integrations", admin: true },
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; user?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const manager = canManage(user);
  const isAdmin = user.role === "admin";
  const tabs = ALL_TABS.filter((t) => isAdmin || !t.admin);
  const tab = tabs.find((t) => t.key === sp.tab)?.key ?? "profile";

  return (
    <div className="max-w-[1100px]">
      <PageHeader eyebrow="Administration" title="Settings" subtitle={manager ? "Your profile, preferences, and how Central Ops is set up for everyone." : "Your profile and preferences."} />
      <Tabs className="mb-6" active={tab} items={tabs.map((t) => ({ key: t.key, label: t.label, href: `/settings?tab=${t.key}` }))} />
      {await renderTab(tab, user.id, user.role === "admin", manager, sp.user)}
    </div>
  );
}

async function renderTab(tab: string, userId: string, isAdmin: boolean, manager: boolean, focusUser?: string) {
  switch (tab) {
    case "users": {
      const [users, teams] = await Promise.all([listUsersAdmin(), listTeamsAdmin()]);
      return <UsersAdmin users={users} teams={teams.map((t) => ({ id: t.id, name: t.name }))} today={today()} focus={focusUser} isAdmin={isAdmin} />;
    }
    case "org": {
      if (!isAdmin) return null;
      const { orgPeople } = await import("@/server/org/queries");
      const { OrgChart } = await import("@/components/org/OrgChart");
      return <OrgChart people={await orgPeople()} />;
    }
    case "permissions": {
      const [rows, people, teams, entities] = await Promise.all([listPermissions(), listPeople(), listTeamsAdmin(), permissionEntities()]);
      return <PermissionsAdmin rows={rows} people={people.map((p) => ({ value: p.id, label: p.name, ...(p.team_name ? { hint: p.team_name } : {}) }))} teams={teams.map((t) => ({ value: t.id, label: t.name }))} entities={entities} />;
    }
    case "teams": {
      const [teams, people] = await Promise.all([listTeamsAdmin(), listPeople()]);
      return <TeamsAdmin teams={teams} people={people.map((p) => ({ id: p.id, name: p.name, color: p.avatar_color, title: p.title }))} />;
    }
    case "templates": {
      const templates = await getTemplates();
      const meta = Object.fromEntries(Object.entries(TEMPLATE_KEYS).map(([k, v]) => [k, { label: v.label, hint: v.hint }])) as Record<keyof typeof TEMPLATE_KEYS, { label: string; hint: string }>;
      return <TemplatesForm templates={templates} defaults={DEFAULT_TEMPLATES} meta={meta} canEdit={manager} />;
    }
    case "integrations": {
      const { integrationsData } = await import("@/server/integrations/queries");
      const { IntegrationsAdmin } = await import("@/components/settings/IntegrationsAdmin");
      const { CalendarMaster } = await import("@/components/settings/CalendarConnect");
      const { calendarMaster } = await import("@/server/integrations/actions");
      const { q } = await import("@/server/db");
      const [d, master, people] = await Promise.all([integrationsData(userId), calendarMaster(),
        q<{ id: string; name: string; color: string | null; email: string | null; status: string | null; last_sync_at: string | null }>(
          `select u.id, u.name, u.avatar_color as color, i.account_email as email, i.status, i.last_sync_at::text from users u
           left join integrations i on i.user_id = u.id and i.provider = 'google_calendar' where u.active order by u.name`)]);
      return <div className="space-y-6"><CalendarMaster master={master} people={people} /><IntegrationsAdmin d={d} /></div>;
    }
    case "rules":
      return (
        <div>
          <p className="mb-4 max-w-2xl text-[13px] text-ink-3">These rules drive Exceptions, Insights and the morning brief. Thresholds are validated — ratios between 0 and 100%, day counts as whole days.</p>
          <RulesAdmin rules={await listInsightRules()} canEdit={manager} />
        </div>
      );
    default: {
      const [profile, { googleStatus }, { calendarMaster }, { MyCalendar }] = await Promise.all([getUserProfile(userId), import("@/server/integrations/registry"), import("@/server/integrations/actions"), import("@/components/settings/CalendarConnect")]);
      const [g, master] = await Promise.all([googleStatus(userId), calendarMaster()]);
      return profile ? <div className="space-y-6"><ProfileForm profile={profile} /><MyCalendar g={g} master={master} /></div> : null;
    }
  }
}
