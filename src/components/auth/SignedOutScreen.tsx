"use client";

interface SignedOutScreenProps {
  onSignIn: () => void;
  busy: boolean;
  error: string | null;
}

/** Google is the only identity provider now — this is just the door, not a form. */
export function SignedOutScreen({ onSignIn, busy, error }: SignedOutScreenProps) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center justify-center gap-6 px-6 pb-10 text-center">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Vshape</h1>
        <p className="mt-1 text-sm text-text-muted">Sign in to your training log</p>
      </div>

      {error && <div className="w-full rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger">{error}</div>}

      <button
        type="button"
        onClick={onSignIn}
        disabled={busy}
        className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl border border-border bg-surface-2 text-base font-semibold disabled:opacity-40"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M19.6 10.23c0-.68-.06-1.32-.17-1.94H10v3.68h5.4a4.6 4.6 0 0 1-2 3.02v2.5h3.23c1.9-1.75 2.97-4.32 2.97-7.26Z"
          />
          <path
            fill="#34A853"
            d="M10 20c2.7 0 4.96-.9 6.62-2.44l-3.23-2.5c-.9.6-2.04.96-3.4.96-2.6 0-4.8-1.76-5.6-4.12H1.06v2.58A10 10 0 0 0 10 20Z"
          />
          <path fill="#FBBC05" d="M4.4 11.9a6 6 0 0 1 0-3.8V5.52H1.06a10 10 0 0 0 0 8.96l3.34-2.58Z" />
          <path
            fill="#EA4335"
            d="M10 3.98c1.47 0 2.8.5 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 10 0 10 10 0 0 0 1.06 5.52L4.4 8.1C5.2 5.74 7.4 3.98 10 3.98Z"
          />
        </svg>
        {busy ? "Signing you in…" : "Continue with Google"}
      </button>

      <p className="text-center text-xs text-text-faint">Everything you log stays yours — Vshape has no ads, no tracking, no data resale.</p>
    </div>
  );
}
