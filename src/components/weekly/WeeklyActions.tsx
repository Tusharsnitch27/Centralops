"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Pencil } from "lucide-react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { remindPending, reopenEntry } from "@/server/weekly/actions";
import type { ActionResult } from "@/server/core/result";

function useRun() {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<ActionResult<unknown>>) => start(async () => {
    const r = await fn();
    if (!r.ok) return toast(r.error, "error");
    toast(r.message ?? "Done", "success"); router.refresh();
  });
  return { pending, run };
}

export function RemindButton({ reportId, count }: { reportId: string; count: number }) {
  const { pending, run } = useRun();
  return <Button size="sm" disabled={pending || !count} onClick={() => run(() => remindPending(reportId))}><BellRing size={13} />{pending ? "Sending…" : `Remind pending (${count})`}</Button>;
}

export function ReopenButton({ entryId }: { entryId: string }) {
  const { pending, run } = useRun();
  return <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => reopenEntry(entryId))}><Pencil size={12} />Edit</Button>;
}
