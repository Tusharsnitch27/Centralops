import { redirect } from "next/navigation";

// Inputs are entered in the tabular editor now.
export default async function SubmitInputs({ searchParams }: { searchParams: Promise<{ cycle?: string; period?: string }> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams(Object.entries({ cycle: sp.cycle, period: sp.period }).filter(([, v]) => v) as [string, string][]).toString();
  redirect(`/aop/inputs${qs ? `?${qs}` : ""}`);
}
