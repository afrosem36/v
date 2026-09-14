"use client";

import "./globals.css";

/**
 * Last-resort safety net: catches any render-time throw that escapes every other boundary (e.g. a
 * `useLiveQuery` querier rethrowing synchronously — see dexie-react-hooks). Without this, Next.js
 * falls back to its own generic "A server error occurred. Reload to try again." page. This must
 * define its own <html>/<body> since it replaces the root layout entirely while active.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg px-6 text-center text-text">
        <div className="text-lg font-semibold">Something went wrong</div>
        <p className="max-w-xs text-sm text-text-muted">
          The app hit a snag loading your data. This is usually a one-off — try again.
        </p>
        <button
          onClick={reset}
          className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground active:brightness-95"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
