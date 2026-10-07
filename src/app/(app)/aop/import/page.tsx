import { Card, CardHeader } from "@/components/ui";
import { AopHeader } from "@/components/aop/AopNav";
import { ImportWizard } from "@/components/aop/ImportWizard";
import { requireUser, canManage } from "@/server/auth";
import { listCycles, loadModel, resolveCycle } from "@/server/aop/model";
import { listImports, listTemplates } from "@/server/aop/queries";
import { q } from "@/server/db";
import { ago } from "@/lib/dates";

export const metadata = { title: "AOP · Import" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ cycle?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const [cycles, cycle, templates, imports, cycleOpts] = await Promise.all([
    listCycles(), resolveCycle(sp.cycle), listTemplates(), listImports(),
    q<{ id: string; name: string; fy_start: string; kind: string }>(`select id, name, fy_start, kind from aop_cycles order by (status = 'active') desc, fy_start desc`),
  ]);
  const m = cycle ? await loadModel(cycle.id) : null;
  return (
    <div className="animate-fade-in">
      <AopHeader active="import" cycleId={cycle?.id ?? null} cycles={cycles} title="Import plan"
        subtitle="Bring in any plan workbook — one header row or two (month over Budget / Provision / Actual), wide or long format. Map once, save as a template." />
      {canManage(user) ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <ImportWizard cycles={cycleOpts} templates={templates.map((t) => ({ id: t.id, name: t.name, header_rows: t.header_rows, mapping: t.mapping }))}
              defaultCycle={cycle?.id ?? null} functions={m?.functions.map((f) => f.name) ?? []} />
          </div>
          <div className="space-y-5">
            <Card>
              <CardHeader title="Recent imports" />
              {imports.length ? imports.map((i) => (
                <div key={i.id} className="border-b border-line/70 px-4 py-2.5 last:border-0">
                  <div className="truncate text-[13px] text-ink">{i.file_name ?? "File"}</div>
                  <div className="text-[11.5px] text-ink-3">{i.rows_imported ?? 0} lines → {i.cycle_name ?? "—"} · {i.who ?? ""} · {ago(i.created_at)}</div>
                </div>
              )) : <p className="px-4 py-4 text-[12.5px] text-ink-4">No imports yet.</p>}
            </Card>
            <Card className="p-4 text-[12.5px] leading-relaxed text-ink-3">
              <div className="mb-1.5 font-medium text-ink-2">How matching works</div>
              Functions, groups and lines are matched by name (case-insensitive) and created when new. Values upsert month by month — existing numbers are overwritten and the change is kept in each line&apos;s history. Rows with only a function/group name start a new block; total rows are skipped.
            </Card>
          </div>
        </div>
      ) : <Card className="p-6 text-[13px] text-ink-3">Only admins and PMs can import plans.</Card>}
    </div>
  );
}
