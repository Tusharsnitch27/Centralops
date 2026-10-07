"use client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/client";

export function CopyText({ text, label = "Copy as text", variant = "ghost" }: { text: string; label?: string; variant?: "ghost" | "secondary" }) {
  const [done, setDone] = useState(false);
  const toast = useToast();
  return (
    <Button size="xs" variant={variant} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); toast("Copied", "success"); setTimeout(() => setDone(false), 1800); }
      catch { toast("Couldn't access the clipboard", "error"); }
    }}>
      {done ? <Check size={12} /> : <Copy size={12} />}{label}
    </Button>
  );
}
