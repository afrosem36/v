import "server-only";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-5.6-luna";
const TIMEOUT_MS = 60_000;

/**
 * Thin server-only wrapper around OpenAI's vision-capable chat completions endpoint.
 * Never import this from a client component — the API key only exists in this process's env.
 */
export async function callOpenAIVision(promptText: string, images: string[], maxTokens = 24_000): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const content: unknown[] = [{ type: "text", text: promptText }];
  for (const url of images) {
    content.push({ type: "image_url", image_url: { url } });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
        messages: [{ role: "user", content }],
        max_completion_tokens: maxTokens,
        reasoning_effort: "low",
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI request failed (${res.status}): ${body.slice(0, 300)}`);
    }

    const data = await res.json();
    const choice = data?.choices?.[0];
    const text: string | undefined = choice?.message?.content;
    if (!text) {
      if (choice?.finish_reason === "length") {
        throw new Error("OpenAI cut the response off before writing any output — try again, or with fewer/smaller photos.");
      }
      throw new Error("OpenAI returned no content");
    }
    return text.trim();
  } finally {
    clearTimeout(timeout);
  }
}
