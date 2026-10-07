import Link from "next/link";
import { ShieldAlert, X } from "lucide-react";
import { ButtonLink, Card, CardHeader, EmptyState, PageHeader, Tabs } from "@/components/ui";
import { FilterBar } from "@/components/projects/FilterBar";
import { RiskMatrix } from "@/components/risks/RiskMatrix";
import { RiskTable } from "@/components/risks/RiskTable";
import { RiskFormButton } from "@/components/risks/RiskForm";
import { toRiskView } from "@/components/risks/view";
import { requireUser, canEdit } from "@/server/auth";
import { listRisks } from "@/server/risks/queries";
import { LEVEL_RANGE, RISK_STATUS, riskLevelKey, type RiskLevelKey, type RiskStatus } from "@/server/risks/meta";
import { pickerOptions } from "@/server/projects/options";
import { today } from "@/lib/dates";
import { plural } from "@/lib/format";

export const metadata = { title: "Risks" };

type SP = Promise<{ level?: string; p?: string; i?: string; project?: string; owner?: string; status?: string; q?: string; focus?: string }>;
const LEVELS: { key: RiskLevelKey; label: string }[] = [{ key: "critical", label: "Critical" }, { key: "high", label: "High" }, { key: "medium", label: "Medium" }, { key: "low", label: "Low" }];

export default async function RisksPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await requireUser();
  const status = sp.status && sp.status in RISK_STATUS ? (sp.status as RiskStatus) : undefined;
  const [scoped, opts] = await Promise.all([
    listRisks({ projectId: sp.project, ownerId: sp.owner, status: status ?? "active", search: sp.q?.trim() || undefined }),
    pickerOptions(),
  ]);
  const level = LEVELS.some((l) => l.key === sp.level) ? (sp.level as RiskLevelKey) : null;
  const cell = sp.p && sp.i ? { p: Number(sp.p), i: Number(sp.i) } : null;
  let rows = scoped.filter((r) => (!level || riskLevelKey(r.score) === level) && (!cell || (r.probability === cell.p && r.impact === cell.i)));
  if (sp.focus && /^[0-9a-f-]{36}$/i.test(sp.focus) && !rows.some((r) => r.id === sp.focus)) rows = [...(await listRisks({ ids: [sp.focus], status: undefined }).then(async (a) => a.length ? a : listRisks({ ids: [sp.focus!], status: "closed" }))), ...rows];

  const td = today();
  const active = scoped.filter((r) => r.status !== "closed");
  const nCritical = active.filter((r) => r.score >= LEVEL_RANGE.critical[0]).length;
  const nEscalated = active.filter((r) => r.status === "escalated").length;
  const nLate = active.filter((r) => r.target_date && r.target_date < td).length;
  const nNoMitigation = active.filter((r) => !r.mitigation).length;
  const counts = [...active.reduce((m, r) => m.set(`${r.probability}-${r.impact}`, (m.get(`${r.probability}-${r.impact}`) ?? 0) + 1), new Map<string, number>())].map(([k, n]) => ({ probability: Number(k.split("-")[0]), impact: Number(k.split("-")[1]), n }));

  const keep = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(Object.entries({ project: sp.project, owner: sp.owner, status: sp.status, q: sp.q, level: sp.level, p: sp.p, i: sp.i }).filter(([, v]) => v) as [string, string][]);
    for (const [k, v] of Object.entries(patch)) (v ? q.set(k, v) : q.delete(k));
    const s = q.toString();
    return `/risks${s ? `?${s}` : ""}`;
  };
  const owners = [...new Map(scoped.filter((r) => r.owner_id).map((r) => [r.owner_id!, r.owner_name!])).entries()].map(([value, label]) => ({ value, label }));
  const editable = canEdit(user);
  const parts = [
    nCritical ? <Link key="c" href={keep({ level: "critical", p: null, i: null })} className="font-medium text-bad hover:underline">{nCritical} critical</Link> : null,
    nEscalated ? <span key="e" className="font-medium text-bad">{nEscalated} escalated</span> : null,
    nLate ? <span key="l" className="font-medium text-warn">{plural(nLate, "risk")} past target date</span> : null,
    nNoMitigation ? <span key="m" className="text-warn">{nNoMitigation} without mitigation</span> : null,
  ].filter(Boolean);

  return (
    <div>
      <PageHeader eyebrow="Work" title="Risk register"
        subtitle={parts.length ? <span className="flex flex-wrap gap-x-1.5">{parts.flatMap((x, idx) => (idx ? [<span key={`s${idx}`} className="text-ink-4">·</span>, x] : [x]))}<span className="text-ink-4">· {plural(active.length, "open risk")}</span></span> : `${plural(active.length, "open risk")}, none critical.`}
        actions={editable ? <RiskFormButton options={opts} /> : null} />

      <div className="mb-6 grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {LEVELS.map((l) => {
            const n = active.filter((r) => riskLevelKey(r.score) === l.key).length;
            const on = level === l.key;
            const tone = l.key === "critical" ? "text-bad" : l.key === "high" ? "text-warn" : l.key === "medium" ? "text-info" : "text-ink-3";
            return (
              <Link key={l.key} href={keep({ level: on ? null : l.key, p: null, i: null })} scroll={false}
                className={`card flex flex-col justify-between p-4 transition-colors hover:border-line-strong ${on ? "ring-2 ring-ink/80" : ""}`}>
                <span className="eyebrow">{l.label}</span>
                <span className={`mt-2 font-serif text-[30px] leading-none tabular ${n ? tone : "text-ink-4"}`}>{n}</span>
                <span className="mt-2 text-[11.5px] text-ink-4">score {LEVEL_RANGE[l.key][0]}–{LEVEL_RANGE[l.key][1]}</span>
              </Link>
            );
          })}
        </div>
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="eyebrow">Heat map</span>
            {cell && <Link href={keep({ p: null, i: null })} scroll={false} className="flex items-center gap-1 text-[11.5px] text-ink-3 hover:text-ink"><X size={11} />P{cell.p} × I{cell.i}</Link>}
          </div>
          <RiskMatrix counts={counts} selected={cell} hrefFor={(p, i) => (cell?.p === p && cell?.i === i ? keep({ p: null, i: null }) : keep({ p: String(p), i: String(i), level: null }))} />
        </Card>
      </div>

      <Tabs className="mb-4" active={level ?? "all"} items={[
        { key: "all", label: "All open", href: keep({ level: null }), count: active.length },
        ...LEVELS.map((l) => ({ key: l.key, label: l.label, href: keep({ level: l.key, p: null, i: null }), count: active.filter((r) => riskLevelKey(r.score) === l.key).length })),
      ]} />
      <FilterBar className="mb-4" search={{ placeholder: "Search risks, mitigations…" }} filters={[
        { key: "project", label: "Project", options: opts.projects, width: 200 },
        { key: "owner", label: "Owner", options: owners },
        { key: "status", label: "Status", options: (Object.keys(RISK_STATUS) as RiskStatus[]).map((s) => ({ value: s, label: RISK_STATUS[s].label })), width: 150 },
      ]} />

      <Card>
        {rows.length ? (
          <>
            <CardHeader title={`${plural(rows.length, "risk")}${level ? ` · ${level}` : ""}${cell ? ` · P${cell.p} × I${cell.i}` : ""}`} subtitle="Sorted by escalation, then score" />
            <RiskTable risks={rows.map(toRiskView)} options={opts} focusId={sp.focus} editable={editable} />
          </>
        ) : (
          <EmptyState icon={<ShieldAlert size={18} />} title={scoped.length ? "No risks in this view" : "No open risks"}
            body={scoped.length ? "Pick another level or cell on the heat map." : "Log risks with probability, impact, a mitigation and a trigger signal."}
            action={scoped.length ? <ButtonLink href="/risks">Show all</ButtonLink> : editable ? <RiskFormButton options={opts} /> : null} />
        )}
      </Card>
    </div>
  );
}
