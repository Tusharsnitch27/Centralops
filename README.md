# Central Ops — Program Management 2.0

An operating layer for program management: **Information → Insight → Action → Follow-up → Closure.**
Built for the Central Operations Program Manager at Snitch first (Phase 1), then team collaboration (Phase 2) and an
organisation-wide program layer (Phase 3).

Stack: Next.js 16 · TypeScript · PostgreSQL · Tailwind v4 · Recharts · Claude (via Snowflake Cortex or the Anthropic API) · Coolify.
Conventions and module map: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run locally (no Docker needed)

```bash
npm install
npm run db:local          # PGlite Postgres on 127.0.0.1:5434 (data in ./.pglite)
npm run dev               # http://localhost:3100
```

`.env.local` (not committed):

```
DATABASE_URL=postgres://postgres@127.0.0.1:5434/postgres
PG_POOL_MAX=6
NEXTAUTH_SECRET=<32+ random chars>
NEXTAUTH_URL=http://localhost:3100
ADMIN_EMAIL=tushar@snitch.com
ADMIN_PASSWORD=<local password>
SEED_DEMO=true
```

Migrations and the seed run automatically on the first request:
- **Reference data** (always): people, owners and teams from the two workbooks, programs, recurring reviews, the
  **FY 26-27 Central Ops cost AOP** (Budget / Provision / Actuals from *Central Operations Cost Master Sheet FY 26-27*),
  credit notes and incident expenses, and the **S&OP FY'27** streams, POCs, projections and capacity
  (*S&OP_Projection_FY'27*). Re-extract after workbook changes with `npm run aop:extract -- <cost.xlsx> <sop.xlsx>`.
- **Demo activity** (`SEED_DEMO=true`, empty DB only): projects, milestones, tasks with history, meetings and MoMs,
  decisions, risks — dated relative to today. Use it for previews; leave it off in production.

## Sign-in
Email + password only. The first admin comes from `ADMIN_EMAIL` / `ADMIN_PASSWORD`; everyone else is created by an
admin in **Settings → Users & access** (people seeded from the workbooks have no email until an admin adds one).

## Deploy on Coolify
1. Push to GitHub; in Coolify **New Resource → Application → GitHub (GitHub App source for a private repo)**, build pack
   **Dockerfile**, port **3000**.
2. Add a **PostgreSQL 16** resource in the same project; set `DATABASE_URL` to its internal URL.
3. Environment variables (see `.env.example`): `TZ=Asia/Kolkata`, `DATABASE_URL`, `PG_POOL_MAX=8`, `NEXTAUTH_SECRET`,
   `NEXTAUTH_URL=https://centralops.snitch-workflow.com`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SEED_DEMO=false`,
   AI: `AI_PROVIDER=snowflake`, `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_PAT` (Claude via Cortex) — optional;
   Google Calendar: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — optional.
4. Health check: `GET /api/health`. Domain: `centralops.snitch-workflow.com`.

## Optional integrations
- **Google Calendar** (Integrations page): OAuth client (Web) with redirect URI
  `<NEXTAUTH_URL>/api/integrations/google/callback`, Calendar API enabled. Imports meetings from your joining date onward.
- **AI**: without a provider, MoM extraction, onboarding capture and the assistant fall back to built-in rules.
- Planned: Gmail, Slack, WhatsApp, Drive, Sheets, Snowflake (S&OP actuals), ERP/BI.
