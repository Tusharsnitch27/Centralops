"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/client";

/** Admin / PM upload of the two logistics working files; each replaces its dataset. Shows rows and ₹ loaded to check against the file. */
type Kind = "b2c" | "b2b" | "rvp" | "b2ccat";
export function LogisticsUpload({ loaded }: { loaded: Record<Kind, string | null> }) {
  const [pending, start] = useTransition();
  const [files, setFiles] = useState<Partial<Record<Kind, File>>>({});
  const toast = useToast(), router = useRouter();
  const send = (kind: Kind) => start(async () => {
    const f = files[kind];
    if (!f) return toast("Choose the file first", "error");
    const body = new FormData(); body.set("kind", kind); body.set("file", f);
    const res = await fetch("/api/aop/logistics", { method: "POST", body });
    const j = await res.json().catch(() => ({ error: "Upload failed" }));
    if (!res.ok) return toast(j.error ?? "Upload failed", "error");
    toast(`${kind === "b2c" ? "B2C" : kind === "b2b" ? "B2B" : kind === "rvp" ? "B2B RVP & MP" : "Courier cost by package"}: ${new Intl.NumberFormat("en-IN").format(j.rows)} rows, ₹${new Intl.NumberFormat("en-IN").format(Math.round(j.amount))} loaded`, "success");
    router.refresh();
  });
  const row = (kind: Kind, label: string) => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-48 text-[12.5px] font-medium">{label}</span>
      <input type="file" accept={kind === "b2ccat" ? ".csv" : ".xlsx"} aria-label={label} className="text-[12px]" onChange={(e) => setFiles({ ...files, [kind]: e.target.files?.[0] })} />
      <Button size="sm" variant="primary" disabled={pending || !files[kind]} onClick={() => send(kind)}>Load</Button>
      <span className="text-[11.5px] text-ink-4">{loaded[kind] ? `current: ${loaded[kind]}` : "not loaded"}</span>
    </div>);
  return (
    <div className="card mb-4 space-y-2 px-4 py-3">
      {row("b2c", "B2C partner file (RAW sheet)")}
      {row("b2b", "B2B LR file (DATA + BLR Own vehicle)")}
      {row("rvp", "B2B RVP & MP file (Summary)")}
      {row("b2ccat", "Courier cost by package (CSV from scripts/courier-category.mjs)")}
      <p className="text-[11.5px] text-ink-4">Each upload replaces that dataset. Billed figures, before credit notes. The files stay in the database only (not in the code repository).</p>
    </div>
  );
}
