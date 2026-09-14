import "server-only";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-120b";
const TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 2500;

export interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Groq's 429 body includes "Please try again in 2s" — worth honoring exactly when present. */
function retryDelayFromBody(body: string): number {
  const match = body.match(/try again in ([\d.]+)s/i);
  if (!match) return DEFAULT_RETRY_DELAY_MS;
  return Math.ceil(parseFloat(match[1]) * 1000) + 250;
}

async function attemptGroqCall(messages: GroqMessage[], maxTokens: number, apiKey: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || DEFAULT_MODEL,
        messages,
        max_tokens: maxTokens,
        temperature: 0.4,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`Groq request failed (${res.status}): ${body.slice(0, 300)}`);
      (err as Error & { status?: number; body?: string }).status = res.status;
      (err as Error & { status?: number; body?: string }).body = body;
      throw err;
    }

    const data = await res.json();
    const text: string | undefined = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error("Groq returned no content");
    return text.trim();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Thin server-only wrapper around Groq's OpenAI-compatible chat completions endpoint.
 * Never import this from a client component — the API key only exists in this process's env.
 *
 * A real workout session fires many of these calls in a short window (a mid-exercise tip per set,
 * plus feedback/nutrition at the end) — enough to hit Groq's free-tier per-minute rate limit
 * (429), which otherwise surfaced as the AI content silently never appearing (askCoach treats
 * every failure as "skip it," by design, so nothing looked broken to the user — it was just
 * quietly failing). A 429 here is self-resolving within a couple of seconds, so it's worth
 * retrying automatically rather than giving up on the first hit.
 */
export async function callGroq(messages: GroqMessage[], maxTokens = 220): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await attemptGroqCall(messages, maxTokens, apiKey);
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      if (status !== 429 || attempt === MAX_ATTEMPTS) throw err;
      await sleep(retryDelayFromBody((err as { body?: string }).body ?? ""));
    }
  }
  throw lastErr;
}
