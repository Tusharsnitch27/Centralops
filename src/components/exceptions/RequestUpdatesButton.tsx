"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { useToast } from "@/components/ui/client";
import { requestUpdatesForTasks } from "@/server/insights/actions";

export function RequestUpdatesButton({ taskIds, label }: { taskIds: string[]; label?: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const toast = useToast();
  const router = useRouter();
  return (
    <button disabled={pending || done || !taskIds.length}
      onClick={() => start(async () => { const r = await requestUpdatesForTasks(taskIds); if (!r.ok) toast(r.error, "error"); else { toast(r.message ?? "Requested", "success"); setDone(true); router.refresh(); } })}
      className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-ink px-2.5 text-[12px] font-medium text-canvas hover:bg-ink-2 disabled:opacity-50">
      <Send size={12} />{done ? "Requested" : pending ? "Sending…" : label ?? `Request ${taskIds.length} update${taskIds.length === 1 ? "" : "s"}`}
    </button>
  );
}
