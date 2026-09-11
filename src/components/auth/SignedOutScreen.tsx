"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { KnownAccount } from "@/lib/auth/types";

const inputClass =
  "h-12 w-full rounded-xl border border-border bg-surface-2 px-4 text-base outline-none placeholder:text-text-faint focus:border-accent";

function PasswordField({
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={`${inputClass} pr-12`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute right-1 top-1 flex h-10 w-10 items-center justify-center rounded-lg text-text-muted active:bg-surface"
      >
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

interface SignedOutScreenProps {
  knownAccounts: KnownAccount[];
  /** Pre-fills the email field — set after a silent session-resume attempt fails, so the person
   * doesn't have to retype an email they've already used on this device. */
  prefillEmail: string;
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (email: string, password: string) => Promise<void>;
}

export function SignedOutScreen({ knownAccounts, prefillEmail, onSignIn, onSignUp }: SignedOutScreenProps) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState(prefillEmail);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    if (mode === "signup" && password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "signin") await onSignIn(email, password);
      else await onSignUp(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-5 px-6 pb-10">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">Vshape</h1>
        <p className="mt-1 text-sm text-text-muted">
          {mode === "signin" ? "Sign in to your training log" : "Create your account"}
        </p>
      </div>

      {knownAccounts.length > 0 && mode === "signin" && (
        <div className="flex flex-wrap justify-center gap-2">
          {knownAccounts.map((account) => (
            <button
              key={account.id}
              type="button"
              onClick={() => setEmail(account.email)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                email === account.email ? "border-accent bg-accent/10 text-text" : "border-border bg-surface-2 text-text-muted"
              }`}
            >
              {account.email}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="username"
          className={inputClass}
        />
        <PasswordField
          value={password}
          onChange={setPassword}
          placeholder={mode === "signup" ? "Create a password" : "Password"}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
        />
        {mode === "signup" && (
          <PasswordField value={confirm} onChange={setConfirm} placeholder="Confirm password" autoComplete="new-password" />
        )}

        {error && <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger">{error}</div>}

        <button
          type="submit"
          disabled={busy || !email || !password || (mode === "signup" && !confirm)}
          className="h-14 w-full rounded-2xl bg-accent text-base font-semibold text-accent-foreground disabled:opacity-40"
        >
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>

      <button
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError(null);
        }}
        className="text-center text-sm font-medium text-text-muted active:text-text"
      >
        {mode === "signin" ? "New here? Create an account" : "I already have an account"}
      </button>

      <p className="text-center text-xs text-text-faint">Everything you log stays yours — Vshape has no ads, no tracking, no data resale.</p>
    </div>
  );
}
