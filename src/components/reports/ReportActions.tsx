"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Copy, MessageCircle, Printer, Sparkles } from "lucide-react";
import { Button } from "@/components/ui";
import { Combobox } from "@/components/ui/client";
import { useToast } from "@/components/ui/client";

/** Copy as text / WhatsApp / Print. Print CSS shows only the .print-doc article. */
export function ReportActions({ text, whatsapp, canPolish, polished }: { text: string; whatsapp: string; canPolish: boolean; polished: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const copy = async (s: string, label: string) => {
    try { await navigator.clipboard.writeText(s); toast(`${label} copied`, "success"); } catch { toast("Couldn't access the clipboard", "error"); }
  };
  const polish = () => { const n = new URLSearchParams(sp.toString()); n.set("polish", "1"); router.push(`${path}?${n}`); };
  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      {canPolish && !polished && <Button size="sm" variant="ghost" onClick={polish}><Sparkles size={14} className="text-violet" />AI summary</Button>}
      <Button size="sm" onClick={() => copy(text, "Report")}><Copy size={14} />Copy as text</Button>
      <Button size="sm" onClick={() => copy(whatsapp, "WhatsApp message")}><MessageCircle size={14} />Copy for WhatsApp</Button>
      <Button size="sm" variant="primary" onClick={() => window.print()}><Printer size={14} />Print / PDF</Button>
    </div>
  );
}

export function ReportPicker({ options, value, param, placeholder }: { options: { value: string; label: string; hint?: string }[]; value: string | null; param: string; placeholder: string }) {
  const router = useRouter();
  const path = usePathname();
  return (
    <div className="no-print w-full max-w-[360px]">
      <Combobox options={options} value={value} allowClear={false} placeholder={placeholder} onChange={(v) => v && router.push(`${path}?${param}=${v}`)} />
    </div>
  );
}
