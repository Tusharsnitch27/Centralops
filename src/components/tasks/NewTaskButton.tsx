import { Plus } from "lucide-react";
import { ButtonLink } from "@/components/ui";

/** Goes to the capture box on My tasks (Task / Goal / Project). */
export function NewTaskButton({ label = "New task", variant = "primary", create }: { label?: string; variant?: "primary" | "secondary" | "ghost"; create?: "goal" | "project" }) {
  return <ButtonLink href={`/tasks${create ? `?create=${create}` : ""}#capture`} variant={variant} size="sm"><Plus size={14} /> {label}</ButtonLink>;
}
