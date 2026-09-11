/**
 * Password hashing, on-device. PBKDF2-SHA256 via WebCrypto — available on https and on
 * localhost, which covers both the deployed PWA and `npm run dev`. Opening the dev server
 * over a plain-http LAN IP has no SubtleCrypto, and we refuse rather than silently
 * downgrading to something that only looks like hashing.
 */
const ITERATIONS = 210_000;
const KEY_LENGTH_BITS = 256;

export function isCryptoAvailable(): boolean {
  return typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.subtle !== "undefined";
}

export const INSECURE_CONTEXT_MESSAGE =
  "Secure storage isn't available on this connection. Open the app over https, or on localhost, so passwords can be hashed properly.";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toBase64(bytes);
}

export function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return toBase64(bytes).replace(/[+/=]/g, "");
}

export async function hashPassword(password: string, salt: string, iterations: number = ITERATIONS): Promise<string> {
  if (!isCryptoAvailable()) throw new Error(INSECURE_CONTEXT_MESSAGE);
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromBase64(salt) as BufferSource, iterations, hash: "SHA-256" },
    keyMaterial,
    KEY_LENGTH_BITS
  );
  return toBase64(new Uint8Array(bits));
}

/** Length-constant comparison — the timing win is small in JS, but there's no reason to leak it. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const DEFAULT_ITERATIONS = ITERATIONS;
