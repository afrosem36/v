"use client";

import { useEffect, useState } from "react";
import { Dumbbell, Eye, EyeOff, MessageCircle, Phone, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { listAccounts } from "@/lib/auth/accounts";
import { isCryptoAvailable, INSECURE_CONTEXT_MESSAGE } from "@/lib/auth/crypto";
import { SUPPORT_PHONE_DISPLAY, SUPPORT_TEL_URL, supportWhatsAppUrl } from "@/lib/auth/support";
import { GOALS } from "@/lib/coach/goals";
import type { AuthResult, Gender, SignUpInput, UserAccount } from "@/lib/auth/types";
import type { TrainingGoal } from "@/types/domain";

type Mode = "signin" | "signup" | "forgot";

interface AuthScreenProps {
  signIn: (email: string, password: string) => Promise<AuthResult<UserAccount>>;
  signUp: (input: SignUpInput) => Promise<AuthResult<UserAccount>>;
}

export function AuthScreen({ signIn, signUp }: AuthScreenProps) {
  const [mode, setMode] = useState<Mode>("signin");
  const [knownEmails, setKnownEmails] = useState<string[]>([]);

  useEffect(() => {
    listAccounts().then((accounts) => {
      setKnownEmails(accounts.map((a) => a.email));
      if (accounts.length === 0) setMode("signup");
    });
  }, []);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 pb-10 pt-[calc(3rem+var(--safe-top))]">
      <div className="mb-8 flex flex-col items-center text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
          <Dumbbell size={26} />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Vshape</h1>
        <p className="mt-1 text-sm text-text-muted">
          {mode === "signup" ? "Set up your training account" : mode === "forgot" ? "Get back into your account" : "Sign in to your training log"}
        </p>
      </div>

      {!isCryptoAvailable() && (
        <div className="mb-4 rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger">{INSECURE_CONTEXT_MESSAGE}</div>
      )}

      {/* Keyed on the account list so the email field picks up its default once accounts load. */}
      {mode === "signin" && (
        <SignInForm key={knownEmails.join("|")} signIn={signIn} knownEmails={knownEmails} onForgot={() => setMode("forgot")} />
      )}
      {mode === "signup" && <SignUpForm signUp={signUp} />}
      {mode === "forgot" && <ForgotPanel onBack={() => setMode("signin")} />}

      {mode !== "forgot" && (
        <button
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="mt-6 text-center text-sm font-medium text-text-muted active:text-text"
        >
          {mode === "signin" ? "New here? Create an account" : "I already have an account"}
        </button>
      )}

      <p className="mt-8 text-center text-xs leading-relaxed text-text-faint">
        Your account and every workout you log stay on this device. Nothing is uploaded to a server.
      </p>
    </div>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-text-faint">{hint}</span>}
    </label>
  );
}

const inputClass =
  "h-12 w-full rounded-xl border border-border bg-surface-2 px-4 text-base outline-none placeholder:text-text-faint focus:border-accent";

function PasswordInput({
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

function SignInForm({
  signIn,
  knownEmails,
  onForgot,
}: {
  signIn: AuthScreenProps["signIn"];
  knownEmails: string[];
  onForgot: () => void;
}) {
  const [email, setEmail] = useState(knownEmails[0] ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await signIn(email, password);
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
    }
    // On success the page reloads into the signed-in app.
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {knownEmails.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {knownEmails.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEmail(e)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                email === e ? "border-accent bg-accent/10 text-text" : "border-border bg-surface-2 text-text-muted"
              }`}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      <Field label="Email">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="username"
          inputMode="email"
          className={inputClass}
        />
      </Field>

      <Field label="Password">
        <PasswordInput value={password} onChange={setPassword} placeholder="Your password" autoComplete="current-password" />
      </Field>

      {error && <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger">{error}</div>}

      <Button type="submit" size="lg" fullWidth disabled={busy || !email || !password}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>

      <button type="button" onClick={onForgot} className="text-center text-sm font-medium text-text-muted active:text-text">
        Forgot your password?
      </button>
    </form>
  );
}

function SignUpForm({ signUp }: { signUp: AuthScreenProps["signUp"] }) {
  const [stage, setStage] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState<Gender>("unspecified");
  const [phone, setPhone] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [goal, setGoal] = useState<TrainingGoal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function goToDetails(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    setStage(2);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    const result = await signUp({
      email,
      password,
      name,
      dateOfBirth: dateOfBirth || null,
      gender,
      phone: phone || null,
      goal,
      heightCm: heightCm ? Number(heightCm) : null,
      weightKg: weightKg ? Number(weightKg) : null,
    });

    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      setStage(1);
    }
  }

  if (stage === 1) {
    return (
      <form onSubmit={goToDetails} className="flex flex-col gap-4">
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="username"
            inputMode="email"
            className={inputClass}
          />
        </Field>
        <Field label="Password" hint="At least 6 characters. Write it down — there's no server that can email you a reset.">
          <PasswordInput value={password} onChange={setPassword} placeholder="Create a password" autoComplete="new-password" />
        </Field>
        <Field label="Confirm password">
          <PasswordInput value={confirm} onChange={setConfirm} placeholder="Type it again" autoComplete="new-password" />
        </Field>

        {error && <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger">{error}</div>}

        <Button type="submit" size="lg" fullWidth disabled={!email || password.length < 6 || !confirm}>
          Continue
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <button type="button" onClick={() => setStage(1)} className="flex items-center gap-1 self-start text-sm font-medium text-text-muted">
        <ChevronLeft size={16} />
        Back
      </button>

      <Field label="Your name">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoComplete="name" className={inputClass} />
      </Field>

      <Field label="Date of birth">
        <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className={inputClass} />
      </Field>

      <Field label="Gender" hint="Only used to make calorie and body-composition estimates a bit less wrong.">
        <div className="grid grid-cols-3 gap-2">
          {(["male", "female", "other"] as Gender[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGender(g)}
              className={`h-11 rounded-xl border text-sm font-medium capitalize ${
                gender === g ? "border-accent bg-accent/10 text-text" : "border-border bg-surface-2 text-text-muted"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Height (cm)">
          <input
            type="number"
            inputMode="numeric"
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
            placeholder="175"
            className={inputClass}
          />
        </Field>
        <Field label="Weight (kg)">
          <input
            type="number"
            inputMode="decimal"
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
            placeholder="72"
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Phone" hint="Optional. Handy if you ever need your password reset.">
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+91…"
          autoComplete="tel"
          className={inputClass}
        />
      </Field>

      <Field label="What are you training for?">
        <div className="flex flex-col gap-2">
          {GOALS.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setGoal(g.key)}
              className={`rounded-xl border px-3 py-2.5 text-left ${
                goal === g.key ? "border-accent bg-accent/10" : "border-border bg-surface-2"
              }`}
            >
              <span className="block text-sm font-medium">{g.label}</span>
              <span className="block text-xs text-text-muted">{g.blurb}</span>
            </button>
          ))}
        </div>
      </Field>

      {error && <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger">{error}</div>}

      <Button type="submit" size="lg" fullWidth disabled={busy || !name.trim()}>
        {busy ? "Creating account…" : "Create my account"}
      </Button>
    </form>
  );
}

function ForgotPanel({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-border bg-surface p-4">
        <p className="text-sm text-text-muted">
          Vshape keeps everything on your phone, so there&apos;s no server that can send you a reset link. Message the number below with
          the email you signed up with and you&apos;ll be given a new password to sign in with.
        </p>
      </div>

      <Field label="Your email (so you can include it in the message)">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          inputMode="email"
          className={inputClass}
        />
      </Field>

      <a href={supportWhatsAppUrl(email)} target="_blank" rel="noopener noreferrer">
        <Button size="lg" fullWidth>
          <MessageCircle size={18} />
          Message {SUPPORT_PHONE_DISPLAY}
        </Button>
      </a>

      <a href={SUPPORT_TEL_URL}>
        <Button variant="secondary" size="lg" fullWidth>
          <Phone size={18} />
          Call instead
        </Button>
      </a>

      <button onClick={onBack} className="text-center text-sm font-medium text-text-muted active:text-text">
        Back to sign in
      </button>
    </div>
  );
}
