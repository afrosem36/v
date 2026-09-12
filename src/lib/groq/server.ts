import "server-only";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-120b";
const TIMEOUT_MS = 15_000;

export interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Thin server-only wrapper around Groq's OpenAI-compatible chat completions endpoint.
 * Never import this from a client component — the API key only exists in this process's env.
 */
export async function callGroq(messages: GroqMessage[], maxTokens = 220): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not configured");
  }

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
      throw new Error(`Groq request failed (${res.status}): ${body.slice(0, 300)}`);
    }

    const data = await res.json();
    const text: string | undefined = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error("Groq returned no content");
    return text.trim();
  } finally {
    clearTimeout(timeout);
  }
}
