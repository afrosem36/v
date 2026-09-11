import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return { hash: derived.toString("hex"), salt };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  const stored = Buffer.from(hash, "hex");
  // Lengths must match before timingSafeEqual — a length mismatch would otherwise throw.
  if (derived.length !== stored.length) return false;
  return timingSafeEqual(derived, stored);
}

export function passwordProblem(password: string): string | null {
  if (password.length < 6) return "Use at least 6 characters.";
  if (password.length > 200) return "That password is too long.";
  return null;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim().toLowerCase());
}
