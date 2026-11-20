import "server-only";
import { one, q } from "../db";
import { canManage, type User } from "../auth";
import { emptyTotals, rollup, sliceLine, type Basis, type Family, type Rule, type Site, type Slice, type SourceLine, type Totals } from "./math";

/** Snapshot the Cost Master reads (set by the seed; a newer workbook load moves it). */
export async function currentSnapshot() {
  const s = await one<{ id: string }>(`select value #>> '{}' as id from app_settings where key = 'wcm.snapshot'`);
  if (!s?.id) return null;
  return one<{ id: string; source: string; file_name: string; sha256: string; taken: string; loaded_at: string; workbook: { period: string; site: Site; what: string; amount: number; cell: string }[] }>(
    `select id, source, file_name, sha256, taken::text, loaded_at::text, workbook from wcm_snapshot where id = $1`, [s.id]);
}

export const wcmMonths = async (snapshotId: string) =>
  (await q<{ p: string }>(`select distinct period::text as p from wcm_source_line where snapshot_id = $1 and amount is not null order by 1`, [snapshotId])).map((r) => r.p);

const LINE_COLS = `id, period::text as period, basis, site, family, head, channel, amount::float8 as amount, cell`;
async function sourceLines(snapshotId: string, period: string, basis: Basis) {
  return q<SourceLine>(`select ${LINE_COLS} from wcm_source_line where snapshot_id = $1 and period = $2 and basis = $3 order by family, site, head`, [snapshotId, period, basis]);
}

export type RuleRow = Rule & { driver: string | null; reason: string; evidence: string | null; createdBy: string | null; createdAt: string; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; replaces: string | null };
export async function listRules(): Promise<RuleRow[]> {
  return q<RuleRow>(`select r.id, r.family, r.head, r.site, r.effective_from::text as "from", r.effective_to::text as "to", r.slices, r.status, r.driver, r.reason, r.evidence,
      cu.name as "createdBy", r.created_at::text as "createdAt", du.name as "decidedBy", r.decided_at::text as "decidedAt", r.decision_note as "decisionNote", r.replaces
    from wcm_rule r left join users cu on cu.id = r.created_by left join users du on du.id = r.decided_by
    order by (r.status = 'draft') desc, r.created_at desc`);
}

/** Who may draft / approve warehouse cost rules: admins; the Warehousing (or Packaging) section owner; AOP owners marked approver. */
export async function wcmRights(u: Pick<User, "id" | "role">) {
  const r = await one<{ owner: boolean; approver: boolean; member: boolean }>(
    `with s as (select s.id, s.owner_id from aop_sections s join aop_cycles c on c.id = s.cycle_id and c.status = 'active'
                where s.parent_id is null and (s.name ilike 'warehous%' or s.name ilike 'packag%'))
     select exists(select 1 from s where owner_id = $1) as owner,
            exists(select 1 from aop_owners o join s on s.id = o.section_id where o.user_id = $1 and o.role = 'approver') as approver,
            exists(select 1 from aop_owners o join s on s.id = o.section_id where o.user_id = $1) as member`, [u.id]);
  const approve = u.role === "admin" || !!r?.owner || !!r?.approver;
  return { draft: approve || canManage(u) || !!r?.member, approve };
}

const daysSince = (periodStart: string) => {
  const end = new Date(`${periodStart}T00:00:00Z`); end.setUTCMonth(end.getUTCMonth() + 1);
  return Math.max(0, Math.floor((Date.now() - end.getTime()) / 864e5));
};

export interface QueueItem { line: SourceLine; open: number; reasons: string[]; fnKnown: string | null; ageDays: number; owner: string }
export interface WcmMonth {
  period: string; site: Site; basis: Basis;
  byFamily: Record<Family, Totals>; total: Totals;
  byFunction: { fn: string; paise: number; kinds: Record<string, number> }[];
  byChannel: { channel: string; paise: number }[];            // assigned only; Shared + Unallocated are separate rows
  shared: number; unallocated: number;
  queue: QueueItem[]; missing: SourceLine[];
  lines: (SourceLine & { slices: Slice[] })[];
  workbook: { what: string; amount: number; cell: string }[];
}

/** One month × site filter × basis: every number traceable to source lines and approved rules. Both = South + North + site-unassigned. */
export async function wcmMonth(snapshotId: string, period: string, site: Site, basis: Basis): Promise<WcmMonth> {
  const [all, rules, owners] = await Promise.all([
    sourceLines(snapshotId, period, basis), listRules(),
    q<{ name: string; owner: string | null }>(`select s.name, u.name as owner from aop_sections s join aop_cycles c on c.id = s.cycle_id and c.status = 'active'
      left join users u on u.id = s.owner_id where s.parent_id is null and (s.name ilike 'warehous%' or s.name ilike 'packag%')`),
  ]);
  const lines = site === "Both" ? all : all.filter((l) => l.site === site);
  const withSlices = lines.map((l) => ({ ...l, slices: sliceLine(l, rules) }));
  const slices = withSlices.flatMap((l) => l.slices);
  const byFamily = Object.fromEntries((["warehousing", "manpower", "ot", "packaging"] as Family[]).map((f) => {
    const ls = withSlices.filter((l) => l.family === f);
    return [f, ls.length ? rollup(ls, ls.flatMap((l) => l.slices)) : emptyTotals()];
  })) as Record<Family, Totals>;
  const total = rollup(lines, slices); // throws if anything fails to reconcile
  const fnMap = new Map<string, { fn: string; paise: number; kinds: Record<string, number> }>();
  for (const s of slices) {
    const k = s.fn ?? "Function not yet mapped";
    const x = fnMap.get(k) ?? { fn: k, paise: 0, kinds: {} };
    x.paise += s.paise; x.kinds[s.kind] = (x.kinds[s.kind] ?? 0) + s.paise; fnMap.set(k, x);
  }
  const chMap = new Map<string, number>();
  for (const s of slices) if (s.kind === "assigned") chMap.set(s.channel!, (chMap.get(s.channel!) ?? 0) + s.paise);
  const ownerOf = (f: Family) => owners.find((o) => (f === "packaging" ? /packag/i : /warehous/i).test(o.name))?.owner ?? "AOP admin";
  const queue = withSlices.filter((l) => l.slices.some((s) => s.kind === "unallocated" && s.paise !== 0)).map((l) => { // booked zeros need no mapping
    const open = l.slices.filter((s) => s.kind === "unallocated");
    return { line: l, open: open.reduce((a, s) => a + s.paise, 0), reasons: [...new Set(open.map((s) => s.why))], fnKnown: open.find((s) => s.fn)?.fn ?? null, ageDays: daysSince(period), owner: ownerOf(l.family) };
  }).sort((a, b) => Math.abs(b.open) - Math.abs(a.open));
  const snap = await currentSnapshot();
  return {
    period, site, basis, byFamily, total,
    byFunction: [...fnMap.values()].sort((a, b) => b.paise - a.paise),
    byChannel: [...chMap.entries()].map(([channel, paise]) => ({ channel, paise })).sort((a, b) => b.paise - a.paise),
    shared: total.shared, unallocated: total.unallocated, queue,
    missing: lines.filter((l) => l.amount == null), lines: withSlices,
    workbook: basis === "actual" ? (snap?.workbook ?? []).filter((w) => w.period === period && w.site === site) : [],
  };
}

/** What a draft rule would do if approved: every snapshot line it would govern, current vs proposed slices. */
export async function previewRule(snapshotId: string, draft: Rule) {
  const [lines, rules] = await Promise.all([
    q<SourceLine>(`select ${LINE_COLS} from wcm_source_line where snapshot_id = $1 and family = $2 and head = $3 and ($4 = '*' or site = $4) and period >= $5 and amount is not null
                   order by period, site, basis`, [snapshotId, draft.family, draft.head, draft.site, draft.from]),
    listRules(),
  ]);
  const proposed = [...rules.filter((r) => r.status === "approved"), { ...draft, status: "approved" as const, id: "preview" }];
  return lines.map((l) => {
    const now = sliceLine(l, rules), next = sliceLine(l, proposed);
    const sum = (ss: Slice[], k: string) => ss.filter((s) => s.kind === k).reduce((a, s) => a + s.paise, 0);
    return { period: l.period, site: l.site, basis: l.basis, cell: l.cell, paise: Math.round((l.amount ?? 0) * 100),
      now: { assigned: sum(now, "assigned"), shared: sum(now, "shared"), unallocated: sum(now, "unallocated") },
      next: { assigned: sum(next, "assigned"), shared: sum(next, "shared"), unallocated: sum(next, "unallocated") } };
  });
}

/** Cost heads present in the snapshot (the only valid rule targets). */
export async function wcmHeads(snapshotId: string) {
  return q<{ family: Family; head: string }>(`select distinct family, head from wcm_source_line where snapshot_id = $1 order by 1, 2`, [snapshotId]);
}
