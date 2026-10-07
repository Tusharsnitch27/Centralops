import { NextResponse } from "next/server";
import { getUser } from "@/server/auth";
import { answer, type HistoryMsg } from "@/server/assistant";

export const dynamic = "force-dynamic";

/** POST { question, history? } → { answer, links, engine }. Grounded in Central Ops data; requires a signed-in user. */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  let body: { question?: unknown; history?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 2000) : "";
  if (!question) return NextResponse.json({ error: "Ask a question" }, { status: 400 });
  const history: HistoryMsg[] = Array.isArray(body.history)
    ? body.history.filter((h): h is HistoryMsg => !!h && typeof h === "object" && typeof (h as HistoryMsg).text === "string").map((h) => ({ role: String(h.role), text: h.text.slice(0, 2000) })).slice(-8)
    : [];
  try {
    return NextResponse.json(await answer(user.id, question, history));
  } catch (e) {
    console.error("[assistant]", e);
    return NextResponse.json({ answer: "I couldn't read the Central Ops data just now — please try again in a moment.", links: [], engine: "rules", error: "failed" }, { status: 500 });
  }
}
