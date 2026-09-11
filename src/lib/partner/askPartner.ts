const CLIENT_TIMEOUT_MS = 20_000;

export interface PartnerChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Unlike askCoach() elsewhere (always optional, resolves null on failure), a chat reply that
 * silently vanishes reads as broken, not "no AI content today" — so this throws instead, and the
 * chat UI shows the failure as a message the person can retry.
 */
export async function askPartner(params: { contextText: string; history: PartnerChatMessage[]; message: string | null }): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

  try {
    const res = await fetch("/api/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "partner", ...params }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? "Your training partner is unavailable right now.");
    }
    const data = await res.json();
    if (typeof data.text !== "string") throw new Error("Got an empty reply — try again.");
    return data.text;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("That took too long to answer. Try again.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
