import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div>
      <Skeleton className="mb-2 h-3 w-12" />
      <Skeleton className="mb-3 h-8 w-40" />
      <Skeleton className="mb-6 h-4 w-72" />
      <div className="card mb-5 space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
      <Skeleton className="mb-3 h-8 w-full" />
      <div className="card space-y-3 p-4">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
    </div>
  );
}
