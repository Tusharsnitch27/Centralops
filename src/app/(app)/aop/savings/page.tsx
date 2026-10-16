import { ButtonLink, Card, CardHeader, EmptyState } from "@/components/ui";
import { AopHeader } from "@/components/aop/AopNav";
import { Meter } from "@/components/aop/bits";
import { CreditNotesTable, IncidentsTable } from "@/components/aop/SavingsTables";
import { requireUser, canEdit, canManage } from "@/server/auth";
import { listCycles, loadModel, resolveCycle } from "@/server/aop/model";
import { listCreditNotes, listIncidents } from "@/server/aop/queries";
import { inr, pct } from "@/lib/format";

export const metadata = { title: "AOP · Cost savings" };

const sumBy = <T,>(rows: T[], key: (r: T) => string, val: (r: T) => number) => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + val(r));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

export default async function SavingsPage({ searchParams }: { searchParams: Promise<{ cycle?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const [cycles, cycle] = await Promise.all([listCycles(), resolveCycle(sp.cycle)]);
  if (!cycle) return <EmptyState title="No operating plan yet" action={<ButtonLink href="/aop/import" variant="primary">Import plan</ButtonLink>} />;
  const [m, notes, incidents] = await Promise.all([loadModel(cycle.id), listCreditNotes(cycle.id), listIncidents(cycle.id)]);
  const fnNames = m!.functions.map((f) => f.name);
  const claimed = notes.reduce((a, n) => a + (n.amount ?? 0), 0);
  const received = notes.reduce((a, n) => a + (n.received ?? 0), 0);
  const openCount = notes.filter((n) => n.status === "open" || n.status === "partial").length;
  const incTotal = incidents.reduce((a, x) => a + (x.amount ?? 0), 0);
  const byPartner = sumBy(notes, (n) => n.partner, (n) => (n.amount ?? 0) - (n.received ?? 0)).filter(([, v]) => v > 0).slice(0, 5);
  const byType = sumBy(incidents, (x) => x.expense_type ?? "Other", (x) => x.amount ?? 0).slice(0, 6);
  const byFn = sumBy(incidents, (x) => x.function_name ?? "—", (x) => x.amount ?? 0).slice(0, 6);
  const byMonth = sumBy(incidents, (x) => x.month_label ?? "—", (x) => x.amount ?? 0).slice(0, 6);
  const edit = canEdit(user), del = canManage(user);

  return (
    <div className="animate-fade-in">
      <AopHeader active="savings" cycleId={cycle.id} cycles={cycles} title="Cost savings"
        subtitle="Credit-note recovery and incident cost control — the levers that close the gap to plan." />

      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <Card className="p-5">
          <div className="eyebrow mb-1.5">Credit notes outstanding</div>
          <div className="font-serif text-[24px] leading-none tabular text-ink">{inr(claimed - received)}</div>
          <div className="mt-3"><Meter value={claimed ? received / claimed : 0} tone={claimed && received / claimed < 0.5 ? "amber" : "green"} /></div>
          <div className="mt-2 flex justify-between text-[12px] text-ink-3"><span>{pct(claimed ? received / claimed : null)} recovered · {inr(received)} of {inr(claimed)}</span><span>{openCount} open</span></div>
        </Card>
        <Card className="min-w-0">
          <CardHeader title="Chase first" subtitle="Largest outstanding by partner" />
          {byPartner.length ? byPartner.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between border-b border-line/70 px-4 py-2 text-[13px] last:border-0"><span className="truncate text-ink">{k}</span><span className="tabular text-ink-2">{inr(v)}</span></div>
          )) : <EmptyState compact title="Nothing outstanding" />}
        </Card>
        <Card className="min-w-0 p-5">
          <div className="eyebrow mb-1.5">Incident expenses</div>
          <div className="font-serif text-[24px] leading-none tabular text-ink">{inr(incTotal)}</div>
          <div className="mt-1.5 text-[12px] text-ink-3">{incidents.length} incidents logged</div>
          <div className="mt-3 space-y-1.5">
            {byType.slice(0, 4).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 text-[12px]">
                <span className="w-28 truncate text-ink-2">{k}</span>
                <div className="flex-1"><Meter value={incTotal ? v / incTotal : 0} /></div>
                <span className="w-16 text-right tabular text-ink-3">{inr(v)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="space-y-5">
        <CreditNotesTable cycleId={cycle.id} rows={notes} functions={fnNames} canEdit={edit} canDelete={del} />
        {incidents.length > 0 && (
          <div className="grid gap-5 md:grid-cols-2">
            <Totals title="Incidents by function" rows={byFn} total={incTotal} />
            <Totals title="Incidents by month" rows={byMonth} total={incTotal} />
          </div>
        )}
        <IncidentsTable cycleId={cycle.id} rows={incidents} functions={fnNames} canEdit={edit} canDelete={del} />
      </div>
    </div>
  );
}

function Totals({ title, rows, total }: { title: string; rows: [string, number][]; total: number }) {
  return (
    <Card>
      <CardHeader title={title} />
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center gap-3 border-b border-line/70 px-4 py-2 text-[13px] last:border-0">
          <span className="w-40 truncate text-ink">{k}</span>
          <div className="flex-1"><Meter value={total ? v / total : 0} /></div>
          <span className="w-20 text-right tabular text-ink-2">{inr(v)}</span>
        </div>
      ))}
    </Card>
  );
}
