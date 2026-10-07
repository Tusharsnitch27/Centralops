"use client";
import { Plus } from "lucide-react";
import { Button, Kbd } from "@/components/ui";
import { openQuickAdd, type QuickKind } from "@/components/shell/QuickAdd";

/** Opens the global Quick Add (task / follow-up). */
export function NewTaskButton({ kind = "task", label = "New task", variant = "primary", shortcut }: { kind?: QuickKind; label?: string; variant?: "primary" | "secondary" | "ghost"; shortcut?: string }) {
  return (
    <Button variant={variant} size="sm" onClick={() => openQuickAdd(kind)}>
      <Plus size={14} /> {label}
      {shortcut && <Kbd className="ml-1 border-canvas/20 bg-canvas/10 text-canvas/70">{shortcut}</Kbd>}
    </Button>
  );
}
