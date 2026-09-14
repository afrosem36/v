import { NextResponse } from "next/server";
import { callOpenAIVision } from "@/lib/openai/server";

export const runtime = "nodejs";

const MAX_IMAGES = 3;
const MAX_PROMPT_CHARS = 60_000;
const MAX_IMAGE_CHARS = 3_000_000; // a data URL for a client-resized JPEG is well under this

interface GeneratePlanRequest {
  prompt: string;
  images: string[];
}

function isValid(body: unknown): body is GeneratePlanRequest {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  if (typeof b.prompt !== "string" || !b.prompt.trim() || b.prompt.length > MAX_PROMPT_CHARS) return false;
  if (!Array.isArray(b.images) || b.images.length > MAX_IMAGES) return false;
  return b.images.every((img) => typeof img === "string" && img.startsWith("data:image/") && img.length <= MAX_IMAGE_CHARS);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isValid(body)) {
    return NextResponse.json({ error: "Missing or malformed 'prompt'/'images'" }, { status: 400 });
  }

  try {
    const text = await callOpenAIVision(body.prompt, body.images);
    return NextResponse.json({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Plan generation unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
