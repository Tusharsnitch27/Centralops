import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/**
 * Where Claude runs.
 *  - snowflake: Snowflake Cortex's Anthropic-compatible Messages endpoint, authenticated with SNOWFLAKE_PAT.
 *    Cortex rejects `strict` tools and server-side `fallbacks`, so both are off for this provider.
 *  - anthropic: api.anthropic.com with ANTHROPIC_API_KEY.
 * When neither is configured, callers fall back to rule-based logic (see server/ai/rules.ts users).
 */
export type Provider = "snowflake" | "anthropic";

export function aiProvider(): Provider | null {
  const want = (process.env.AI_PROVIDER ?? "").toLowerCase();
  const sf = Boolean(process.env.SNOWFLAKE_PAT && process.env.SNOWFLAKE_ACCOUNT);
  const an = Boolean(process.env.ANTHROPIC_API_KEY);
  if (want === "none" || want === "off") return null;
  if (want === "anthropic") return an ? "anthropic" : null;
  if (want === "snowflake") return sf ? "snowflake" : null;
  return sf ? "snowflake" : an ? "anthropic" : null;
}
export const aiConfigured = () => aiProvider() !== null;
export const AI_MODEL = process.env.AI_MODEL || "claude-opus-5-5";

const g = globalThis as unknown as { __ai?: { p: Provider; c: Anthropic } };

export function aiClient(): { client: Anthropic; provider: Provider } {
  const p = aiProvider();
  if (!p) throw new Error("AI provider not configured");
  if (g.__ai?.p === p) return { client: g.__ai.c, provider: p };
  const client = p === "snowflake"
    ? new Anthropic({
        apiKey: null,
        authToken: process.env.SNOWFLAKE_PAT,
        baseURL: process.env.AI_SNOWFLAKE_BASE_URL || `https://${process.env.SNOWFLAKE_ACCOUNT}.snowflakecomputing.com/api/v2/cortex`,
        defaultHeaders: { "X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN" },
        maxRetries: 2,
        timeout: 120_000,
      })
    // explicit baseURL: never pick up an inherited ANTHROPIC_BASE_URL from the host environment
    : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.AI_BASE_URL || "https://api.anthropic.com", maxRetries: 2, timeout: 120_000 });
  g.__ai = { p, c: client };
  return { client, provider: p };
}

type Effort = "low" | "medium" | "high";

/**
 * One-shot structured extraction: Claude must call `tool` with arguments matching `schema`.
 * Claude Opus 5.5 rejects forced tool_choice, so the tool is offered with `auto` and the prompt asks for it;
 * the arguments are validated with zod. Returns null on any failure (callers fall back to rules).
 */
export async function aiStructured<T>(opts: {
  system: string;
  prompt: string;
  tool: { name: string; description: string };
  schema: z.ZodType<T>;
  effort?: Effort;
  maxTokens?: number;
}): Promise<T | null> {
  if (!aiConfigured()) return null;
  const { client, provider } = aiClient();
  const input_schema = z.toJSONSchema(opts.schema, { target: "draft-7" }) as Anthropic.Tool.InputSchema;
  const tool: Anthropic.Tool = { name: opts.tool.name, description: opts.tool.description, input_schema, ...(provider === "anthropic" ? { strict: true } : {}) };
  const params = {
    model: AI_MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    system: `${opts.system}\n\nDeliver your result by calling the \`${opts.tool.name}\` tool exactly once. Do not reply with plain text.`,
    messages: [{ role: "user" as const, content: opts.prompt }],
    tools: [tool],
    tool_choice: { type: "auto" as const },
    output_config: { effort: opts.effort ?? "low" },
  };
  try {
    const res = provider === "anthropic"
      ? await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } as never) as unknown as Anthropic.Message
      : await client.messages.create(params as never) as unknown as Anthropic.Message;
    if (res.stop_reason === "refusal") return null;
    const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === opts.tool.name);
    if (!call) return null;
    const parsed = opts.schema.safeParse(call.input);
    if (!parsed.success) {
      console.warn("[ai] invalid tool input", parsed.error.issues.slice(0, 3));
      return null;
    }
    return parsed.data;
  } catch (e) {
    console.error("[ai] request failed", e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e);
    return null;
  }
}

/** Plain-text completion (summaries, briefs, assistant answers). Null on failure. */
export async function aiText(opts: { system: string; prompt: string; effort?: Effort; maxTokens?: number }): Promise<string | null> {
  if (!aiConfigured()) return null;
  const { client, provider } = aiClient();
  const params = {
    model: AI_MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    system: opts.system,
    messages: [{ role: "user" as const, content: opts.prompt }],
    output_config: { effort: opts.effort ?? "low" },
  };
  try {
    const res = provider === "anthropic"
      ? await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } as never) as unknown as Anthropic.Message
      : await client.messages.create(params as never) as unknown as Anthropic.Message;
    if (res.stop_reason === "refusal") return null;
    return res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim() || null;
  } catch (e) {
    console.error("[ai] request failed", e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e);
    return null;
  }
}
