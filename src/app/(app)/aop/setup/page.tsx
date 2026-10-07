import { ButtonLink, EmptyState } from "@/components/ui";
import { AopHeader } from "@/components/aop/AopNav";
import { CycleSettings, NewCycleButton, OwnersTable, type SetupSection } from "@/components/aop/SetupForms";
import { requireUser, canManage } from "@/server/auth";
import { InputFieldsForm } from "@/components/aop/InputFieldsForm";
import { inputConfig } from "@/server/aop/actions";
import { allItemsOf, listCycles, loadModel, resolveCycle } from "@/server/aop/model";

export const metadata = { title: "AOP · Setup" };

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ cycle?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const manage = canManage(user);
  const [cycles, cycle] = await Promise.all([listCycles(), resolveCycle(sp.cycle)]);
  if (!cycle) return (
    <div>
      <AopHeader active="setup" cycleId={null} cycles={cycles} title="Setup" />
      <EmptyState title="No plan cycle yet" body="Create one, then import the workbook or add functions and lines here."
        action={<div className="flex gap-2">{manage && <NewCycleButton currentId={null} currentName={null} />}<ButtonLink href="/aop/import" variant="primary">Import plan</ButtonLink></div>} />
    </div>
  );
  const m = (await loadModel(cycle.id))!;
  const cfg = await inputConfig(cycle.id);
  const sections: SetupSection[] = [];
  for (const f of m.functions) {
    for (const s of [f, ...f.children]) sections.push({
      id: s.id, name: s.name, kind: s.kind, parentId: s.parent_id, ownerId: s.owner_id, ownerName: s.owner_name, ownerLabel: s.owner_label,
      contributors: s.contributors.map((c) => ({ id: c.id, name: c.name })), items: allItemsOf(s).length,
    });
  }
  return (
    <div className="animate-fade-in">
      <AopHeader active="setup" cycleId={cycle.id} cycles={cycles} title="Setup" subtitle={`${cycle.name} · ${m.functions.length} functions · ${m.items.length} lines`}
        actions={manage ? <NewCycleButton currentId={cycle.id} currentName={cycle.name} /> : undefined} />
      <div className="space-y-5">
        <CycleSettings canEdit={manage} cycle={{
          id: cycle.id, name: cycle.name, kind: cycle.kind, status: cycle.status, labels: cycle.labels, actuals_cutoff_day: cycle.actuals_cutoff_day,
          projection_cutoff_day: cycle.projection_cutoff_day, guidelines: cycle.guidelines, fy_start: cycle.fy_start, months: cycle.months,
        }} />
        <InputFieldsForm cycleId={cycle.id} config={cfg} labels={cycle.labels} canEdit={manage} />
        <OwnersTable cycleId={cycle.id} sections={sections} canEdit={manage} />
      </div>
    </div>
  );
}
