"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

const DISMISSED_KEY = "vshape.installPromptDismissed";

/** Chrome/Edge/Android fire this before showing their own install UI, letting a site show a
 * custom prompt first and trigger the native one on demand via `.prompt()`. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * "Install this app" nudge — shown once, never again after the person installs, dismisses it,
 * or is already running the installed app. Android/Chrome gets the real native install dialog
 * via beforeinstallprompt; iOS Safari has no equivalent API at all, so it gets a short one-time
 * instruction instead (Share → Add to Home Screen).
 */
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      // Private-mode storage refusal — treat as not-yet-dismissed rather than crashing.
    }
    if (dismissed) return;

    function handleBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    function handleInstalled() {
      markDismissed();
      setDeferredPrompt(null);
      setShowIOSInstructions(false);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    // iOS Safari never fires beforeinstallprompt — there's no programmatic install API there at
    // all, so the only option is telling them the manual Share-sheet steps, once.
    const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    const isSafari = /safari/i.test(window.navigator.userAgent) && !/crios|fxios|edgios/i.test(window.navigator.userAgent);
    const timer = isIOS && isSafari ? setTimeout(() => setShowIOSInstructions(true), 2500) : undefined;

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
      if (timer) clearTimeout(timer);
    };
  }, []);

  function markDismissed() {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Nothing to persist to — the prompt may reappear next visit, which is harmless.
    }
  }

  function dismiss() {
    markDismissed();
    setDeferredPrompt(null);
    setShowIOSInstructions(false);
  }

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    // Whatever they chose, don't ask again — a repeat "no" is still a "no".
    markDismissed();
    setDeferredPrompt(null);
  }

  if (!deferredPrompt && !showIOSInstructions) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-30 mx-auto w-full max-w-lg px-4 pt-[calc(0.75rem+var(--safe-top))]">
      <div className="flex items-center gap-3 rounded-2xl border border-accent/30 bg-surface/95 p-3 shadow-lg backdrop-blur">
        {deferredPrompt ? (
          <>
            <Download size={18} className="shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">Install Vshape</div>
              <div className="text-xs text-text-muted">Add it to your home screen for quick, full-screen access.</div>
            </div>
            <button
              onClick={handleInstall}
              className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground active:brightness-90"
            >
              Install
            </button>
          </>
        ) : (
          <>
            <Share size={18} className="shrink-0 text-accent" />
            <div className="min-w-0 flex-1 text-xs text-text-muted">
              <span className="font-semibold text-text">Install Vshape:</span> tap Share, then{" "}
              <span className="font-medium">Add to Home Screen</span>.
            </div>
          </>
        )}
        <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 text-text-faint active:text-text-muted">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
