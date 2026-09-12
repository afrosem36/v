"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";

const COUNTDOWN_SECONDS = 10;

interface DeleteEverywhereSheetProps {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * A separate, explicitly destructive confirmation from the ordinary device-local "Reset" — this
 * one reaches every device signed into the account (see deleteEverywhere.ts), so the confirm
 * button stays disabled behind a real 10-second countdown instead of a single tap, on top of the
 * usual close/backdrop-click escape hatches.
 */
export function DeleteEverywhereSheet({ open, busy, onClose, onConfirm }: DeleteEverywhereSheetProps) {
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);

  useEffect(() => {
    if (!open) return;
    setSecondsLeft(COUNTDOWN_SECONDS);
    const interval = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [open]);

  return (
    <BottomSheet open={open} onClose={onClose} title="Delete everywhere">
      <div className="flex flex-col gap-4 pb-4">
        <div className="flex items-start gap-3 rounded-xl border border-danger/40 bg-danger/10 p-3">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-sm text-text">
            This permanently deletes all workouts, history, body data, and settings on <strong>every device</strong> signed into
            this account — not just this one. This cannot be undone.
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" fullWidth onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" fullWidth onClick={onConfirm} disabled={busy || secondsLeft > 0}>
            {busy ? "Deleting…" : secondsLeft > 0 ? `Wait ${secondsLeft}s…` : "Delete everywhere"}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
