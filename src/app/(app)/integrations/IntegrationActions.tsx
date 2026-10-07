"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui";
import { Popover, useToast } from "@/components/ui/client";
import { disconnectGoogle, syncGoogleCalendar } from "@/server/integrations/actions";

export function GoogleActions() {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="primary" disabled={pending} onClick={() => start(async () => { const r = await syncGoogleCalendar(); if (!r.ok) toast(r.error, "error"); else { toast(r.message ?? "Synced", "success"); router.refresh(); } })}>
        <RefreshCw size={13} className={pending ? "animate-spin" : undefined} />{pending ? "Syncing…" : "Sync now"}
      </Button>
      <Popover align="end" className="w-[280px] p-3" trigger={({ toggle }) => <Button size="sm" variant="ghost" onClick={toggle} disabled={pending}><Unplug size={13} />Disconnect</Button>}>
        {(close) => (
          <div>
            <div className="text-[13px] font-medium text-ink">Disconnect Google Calendar?</div>
            <p className="mt-0.5 text-[12px] text-ink-3">New meetings stop syncing. Meetings already imported — and their MoMs and actions — stay.</p>
            <div className="mt-3 flex justify-end gap-2">
              <Button size="xs" variant="ghost" onClick={close}>Cancel</Button>
              <Button size="xs" variant="danger" onClick={() => { close(); start(async () => { const r = await disconnectGoogle(); if (!r.ok) toast(r.error, "error"); else { toast(r.message ?? "Disconnected"); router.refresh(); } }); }}>Disconnect</Button>
            </div>
          </div>
        )}
      </Popover>
    </div>
  );
}
