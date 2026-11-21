"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { saveMpRate } from "@/server/wcm/rateActions";

/** Salary master entry: site, from-date, monthly ₹ per head, days basis, OT ₹/hour, source. */
export function MpRateForm() {
  const [f, setF] = useState({ site: "South", from: "", salary: "", days: "26", ot: "", note: "" });
  const [pending, start] = useTransition();
  const toast = useToast(), router = useRouter();
  const field = (k: keyof typeof f, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="flex flex-col gap-0.5"><span className="label">{label}</span><input className="field h-8" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} /></label>);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-0.5"><span className="label">Site</span>
        <select className="field h-8" value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })}><option>South</option><option>North</option></select></label>
      {field("from", "From", { type: "date" })}{field("salary", "Monthly ₹ / head", { inputMode: "decimal" })}{field("days", "Days basis", { inputMode: "numeric" })}
      {field("ot", "OT ₹ / hour", { inputMode: "decimal", placeholder: "optional" })}{field("note", "Source", { placeholder: "e.g. Quess billing Oct'26" })}
      <Button size="sm" variant="primary" disabled={pending} onClick={() => start(async () => {
        const r = await saveMpRate(f.site, f.from, Number(f.salary), Number(f.days), f.ot ? Number(f.ot) : null, f.note);
        if (!r.ok) return toast(r.error, "error"); toast(r.message ?? "Saved", "success"); router.refresh();
      })}>Save rate</Button>
    </div>
  );
}
