"use client";
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";
import { saveTemplate } from "@/server/settings/actions";
import { Section, useAction } from "./bits";

type Kind = "mom" | "project_update" | "weekly_report";

export function TemplatesForm({ templates, defaults, meta, canEdit }: { templates: Record<Kind, string>; defaults: Record<Kind, string>; meta: Record<Kind, { label: string; hint: string }>; canEdit: boolean }) {
  return (
    <div>
      {(Object.keys(meta) as Kind[]).map((k) => <TemplateEditor key={k} kind={k} value={templates[k]} fallback={defaults[k]} label={meta[k].label} hint={meta[k].hint} canEdit={canEdit} />)}
    </div>
  );
}

function TemplateEditor({ kind, value, fallback, label, hint, canEdit }: { kind: Kind; value: string; fallback: string; label: string; hint: string; canEdit: boolean }) {
  const [text, setText] = useState(value);
  const { pending, run } = useAction();
  return (
    <Section title={label} description={<>{hint}{kind === "weekly_report" && <><br /><span className="text-ink-4">Placeholders: <code className="font-mono">{"{{report}}"}</code> <code className="font-mono">{"{{name}}"}</code></span></>}</>}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} disabled={!canEdit} rows={Math.min(16, Math.max(7, text.split("\n").length + 1))}
        className="field resize-y font-mono text-[12.5px] leading-relaxed" />
      {canEdit && (
        <div className="mt-2.5 flex items-center gap-2">
          <Button variant="primary" disabled={pending || text === value} onClick={() => run(() => saveTemplate(kind, text))}>{pending ? "Saving…" : "Save template"}</Button>
          <Button variant="ghost" disabled={text === fallback} onClick={() => setText(fallback)}><RotateCcw size={13} />Reset to default</Button>
        </div>
      )}
    </Section>
  );
}
