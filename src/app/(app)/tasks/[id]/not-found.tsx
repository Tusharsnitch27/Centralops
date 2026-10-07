import { SearchX } from "lucide-react";
import { ButtonLink, EmptyState } from "@/components/ui";

export default function TaskNotFound() {
  return (
    <div className="card">
      <EmptyState icon={<SearchX size={18} />} title="This task doesn't exist" body="It may have been deleted, or the link is incomplete."
        action={<ButtonLink href="/tasks" size="sm">Back to tasks</ButtonLink>} />
    </div>
  );
}
