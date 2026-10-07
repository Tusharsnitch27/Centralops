"use client";
import { useState } from "react";
import { Database, Plus } from "lucide-react";
import { Button } from "@/components/ui";
import { Combobox } from "@/components/ui/client";
import { addSopLine, updateStreamSource } from "@/server/sop/actions";
import { metricLabel, type ActualSource } from "@/server/sop/model";
import { cn } from "@/lib/cn";
import { useSopAction } from "./actions";

const OPTIONS: { key: ActualSource; label: string; hint: string }[] = [
  { key: "manual", label: "Manual", hint: "POC / PM types actuals" },
  { key: "demo", label: "Demo", hint: "Illustrative values, flagged" },
  { key: "snowflake", label: "Snowflake", hint: "Pulled by query (pending access)" },
];

export function DataSourcePanel({ stream, metrics, people, descriptions, snowflakeConnected, template, canManage }: {
  stream: { id: string; name: string; actual_source: ActualSource; actual_query: string | null; headline_metric: string | null; poc_id: string | null };
  metrics: string[]; people: { id: string; name: string }[]; descriptions: Record<ActualSource, string>;
  snowflakeConnected: boolean; template: string; canManage: boolean;
}) {
  const [source, setSource] = useState<ActualSource>(stream.actual_source);
  const [query, setQuery] = useState(stream.actual_query ?? "");
  const [metric, setMetric] = useState(stream.headline_metric ?? "");
  const [poc, setPoc] = useState<string | null>(stream.poc_id);
  const [lineName, setLineName] = useState("");
  const [lineMetric, setLineMetric] = useState(metrics[0] ?? "units");
  const { pending, run } = useSopAction();

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-subtle/50 px-3 py-2.5 text-[12.5px] text-ink-2">
        <div className="mb-0.5 flex items-center gap-1.5 font-medium text-ink"><Database size={13} />Snowflake {snowflakeConnected ? "credentials present" : "not connected yet"}</div>
        Actuals will come from Snowflake once access is shared. Until then they are entered manually{stream.actual_source === "demo" ? " — this stream currently shows demo actuals, clearly flagged everywhere" : ""}.
        Map a query per stream now; the sync job will use it as soon as the connection is live.
      </div>
      <div>
        <span className="label">Actuals source</span>
        <div className="grid grid-cols-3 gap-2">
          {OPTIONS.map((o) => (
            <button key={o.key} type="button" disabled={!canManage} onClick={() => setSource(o.key)}
              className={cn("rounded-lg border px-3 py-2 text-left transition", source === o.key ? "border-ink-3 bg-surface ring-4 ring-ink/5" : "border-line hover:bg-subtle", !canManage && "cursor-default")}>
              <div className="text-[13px] font-medium text-ink">{o.label}</div>
              <div className="text-[11.5px] text-ink-3">{o.hint}</div>
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[12px] text-ink-3">{descriptions[source]}</p>
      </div>
      <label className="block"><span className="label">Snowflake query {source !== "snowflake" && <span className="font-normal text-ink-4">(used when source = Snowflake)</span>}</span>
        <textarea className="field min-h-32 font-mono text-[12px]" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={template} disabled={!canManage} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="label">Headline metric</span>
          <select className="field" value={metric} onChange={(e) => setMetric(e.target.value)} disabled={!canManage}>
            <option value="">Automatic</option>
            {metrics.map((m) => <option key={m} value={m}>{metricLabel(m)}</option>)}
          </select>
        </label>
        <div><span className="label">POC</span><Combobox options={people.map((p) => ({ value: p.id, label: p.name }))} value={poc} onChange={setPoc} allowClear={false} /></div>
      </div>
      {canManage && (
        <div className="flex justify-end">
          <Button variant="primary" disabled={pending} onClick={() => run(() => updateStreamSource({ streamId: stream.id, actualSource: source, actualQuery: query, headlineMetric: metric || null, pocId: poc }))}>Save data source</Button>
        </div>
      )}
      {canManage && (
        <div className="border-t border-line pt-4">
          <span className="label">Add a line to {stream.name}</span>
          <div className="flex gap-2">
            <input className="field" value={lineName} onChange={(e) => setLineName(e.target.value)} placeholder="e.g. Instamart · items" />
            <select className="field w-36" value={lineMetric} onChange={(e) => setLineMetric(e.target.value)}>
              {[...new Set([...metrics, "orders", "items", "units", "returns"])].map((m) => <option key={m} value={m}>{metricLabel(m)}</option>)}
            </select>
            <Button disabled={pending || !lineName.trim()} onClick={() => run(() => addSopLine({ streamId: stream.id, name: lineName, metric: lineMetric }), (r) => r.ok && setLineName(""))}><Plus size={13} />Add</Button>
          </div>
        </div>
      )}
    </div>
  );
}
