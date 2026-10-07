# Central Ops — architecture & conventions

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · PostgreSQL (`pg`, raw SQL) · Tailwind v4 · lucide-react · recharts · cmdk.
Local dev: `npm run db:local` (PGlite on :5434) + `npm run dev` (:3100). Sign in with ADMIN_EMAIL / ADMIN_PASSWORD from .env.local.

## Product rules (from the user — do not violate)
- **Auth is email + password only** (admin creates users). No Google/OAuth sign-in. Google is only an optional Calendar integration.
- **Every meeting has a MoM owner** (`meetings.mom_owner_id`, defaulting from `reviews.mom_owner_id`) who writes the MoM.
  Flow: `pending` → owner writes (`draft`) → submits (`submitted`) → AI extracts suggestions → **PM reviews with feedback** (accept / edit / reassign / ignore) → accepted items become tasks assigned to a **person or a team** (`tasks.owner_team_id`) → `distributed`. `skipped` / `not_relevant` are terminal and never re-asked.
- **No back-filling.** Users see work from `users.joined_at` onward; due dates can't be in the past (`assertFutureDate`). Calendar import starts at joining date.
- First-run "what are you working on?" capture (users.onboarded_at).
- Lean navigation (user decision 2026-10-07): Summary · Tasks (Follow-ups tab) · Meetings (Decisions tab) · AOP · S&OP · Settings.
  Projects, programs, risks, reviews, people, reports, insights, inbox, today, calendar and integrations routes exist but are
  intentionally out of the nav ("Intelligence yet to explore"); bring them back only when asked.
- Exception-first: show "6 tasks need attention", not "43 tasks". Every metric should lead to an action (CTA).
- Colour only for meaning: green on track · amber at risk · red delayed/critical · blue info · grey neutral.

## Layout
```
src/app/(app)/<route>/page.tsx     server components (pages); export `metadata = { title }`
src/app/api/...                     route handlers (JSON)
src/components/ui/index.tsx         server-safe primitives: Button, ButtonLink, Badge, Dot, StatusBadge, HealthBadge, PriorityIcon,
                                    Avatar, AvatarStack, PageHeader, Card, CardHeader, SectionTitle, Tabs (link-based), Stat, Progress,
                                    Kbd, EmptyState, Skeleton, Field, Prop, buttonClass()
src/components/ui/client.tsx        "use client": Modal, Popover, MenuItem, Combobox (searchable select, hidden input via `name`), Toaster/useToast
src/components/shell/*              Sidebar, Topbar, CommandPalette (openPalette), QuickAdd (openQuickAdd(kind,text)), Assistant (openAssistant(q))
src/components/tasks/TaskRow.tsx    TaskRow / TaskList — use these everywhere tasks are listed; TaskCheck = optimistic complete toggle
src/components/<module>/*           module client components
src/server/db                       q(), one(), tx() — always parameterised SQL. Migrations in db/migrations (see index.ts for version ranges)
src/server/auth                     getUser(), requireUser(), requireRole(), canManage(u) (admin|pm), canEdit(u)
src/server/core/activity.ts         logActivity() audit trail, link() universal relation graph (entity_links)
src/server/core/notify.ts           notify() in-app notification, toInbox() idempotent inbox item (dedupeKey), resolveInbox()
src/server/core/people.ts           listPeople(), listTeams(), listProjectsLite(), listProgramsLite(), matchPerson(name), matchTeam(name)
src/server/core/result.ts           ActionResult, ok(), fail()
src/server/tasks/core.ts            createTask(), updateTask(), addTaskUpdate(), requestUpdate() — THE ONLY way to create/change tasks
                                    (writes task_history journey + activity_log + notifications). assertFutureDate().
src/server/tasks/queries.ts         listTasks(filter) → TaskListItem[] (canonical list query)
src/server/tasks/actions.ts         server actions: setTaskStatus, patchTask, postTaskUpdate, requestTaskUpdate
src/server/ai/provider.ts           aiConfigured(), aiStructured({system,prompt,tool,schema(zod)}) → T|null, aiText() → string|null.
                                    Always have a rule-based fallback when AI is not configured or returns null.
src/lib/dates.ts                    today() (IST 'YYYY-MM-DD'), addDays, diffDays, addMonths, monthStart, weekStart, fmtDate, fmtMonth, fmtTime, relDay, ago, fyLabel
src/lib/format.ts                   inr(v) → ₹1.32 Cr / ₹18.4 L, inrFull, num, pct, plural
src/lib/meta.ts                     TASK_STATUS, HEALTH, PRIORITY, MOM_STATUS, TASK_SOURCE, RISK_LEVEL, OPEN_STATUSES, Tone
src/lib/nav.ts                      sidebar navigation (all routes already declared)
```

## Patterns
- **Pages** are async server components that call server query functions directly (`src/server/<module>/queries.ts`, `import "server-only"`).
  Use `searchParams: Promise<...>` / `params: Promise<...>` (Next 16). Every page under (app) is dynamic.
- **Mutations** are server actions in `src/server/<module>/actions.ts` (`"use server"`), returning `ActionResult`; they call
  `requireUser()`, check `canEdit`/`canManage`, write `logActivity`, and `revalidatePath("/", "layout")` (or narrower).
  Client components call them inside `useTransition` and show `useToast()` feedback; then `router.refresh()` if needed.
- **Dates**: DATE columns come back as 'YYYY-MM-DD' strings; timestamps as JS Date/ISO. NUMERIC/BIGINT parsed to number.
  Never alias a column as bare `month`/`day` — use other names.
- **IDs** are uuid. Tasks also have `number` (display as `CO-123`).
- **Styling**: Tailwind with tokens from globals.css (`bg-canvas bg-surface bg-subtle bg-muted border-line text-ink text-ink-2/3/4
  text-ok/warn/bad/info bg-ok-soft/warn-soft/bad-soft/info-soft`, `card`, `field`, `label`, `table-base`, `eyebrow`, `font-serif` for page
  titles/big numbers, `tabular`). Body text 13–13.5px. Compact tables (`table-base`). Premium and restrained — no loud colour blocks,
  no gradients on cards, subtle hover states, `animate-rise` for popovers. Polished empty states (EmptyState) with a CTA.
- **Charts**: recharts, neutral greys + semantic colours only, thin strokes, no gridline clutter, tooltips formatted with inr()/num().
- **Every metric → action**: cards in exception lists should carry a CTA (Review / Follow up / Update / Resolve / View).
- Keep pages fast: one or two queries per section, `Promise.all` for independent ones.

## Module ownership (parallel build)
Each module owns its routes, `src/server/<module>/`, `src/components/<module>/`, and a migration version range:
tasks 10-19 · meetings/calendar 20-29 · aop 30-39 · sop 40-49 · projects/programs/decisions/risks/reviews 50-59 · people/reports/insights/assistant/settings 60-69.
Foundation (core/, shell/, ui/, tasks/core.ts, tasks/queries.ts, db/index.ts) — extend, don't break signatures.
