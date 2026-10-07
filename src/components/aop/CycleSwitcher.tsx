"use client";
import { usePathname, useRouter } from "next/navigation";
import { ChevronsUpDown } from "lucide-react";
import { MenuItem, Popover } from "@/components/ui/client";
import { buttonClass } from "@/components/ui";

export function CycleSwitcher({ cycles, current }: { cycles: { id: string; name: string; status: string; kind: string }[]; current: string | null }) {
  const router = useRouter();
  const path = usePathname();
  const cur = cycles.find((c) => c.id === current) ?? cycles[0];
  return (
    <Popover align="end" className="w-[280px]" trigger={({ toggle }) => (
      <button type="button" onClick={toggle} className={buttonClass("secondary", "sm")}>
        <span className="max-w-[200px] truncate">{cur?.name ?? "Select cycle"}</span>
        <ChevronsUpDown size={13} className="text-ink-4" />
      </button>
    )}>
      {(close) => (
        <div>
          <div className="eyebrow px-2 py-1.5">Plan cycles</div>
          {cycles.map((c) => (
            <MenuItem key={c.id} active={c.id === cur?.id} onClick={() => { close(); router.push(`${path}?cycle=${c.id}`); }}>
              <span className="flex items-center justify-between gap-2">
                <span className="truncate">{c.name}</span>
                <span className="text-[11px] capitalize text-ink-4">{c.status === "active" ? c.kind : c.status}</span>
              </span>
            </MenuItem>
          ))}
        </div>
      )}
    </Popover>
  );
}
