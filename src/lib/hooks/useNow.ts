"use client";

import { useEffect, useState } from "react";

/**
 * Wall-clock time as state, refreshed on an interval. Reading `Date.now()` straight out of
 * render makes a component impure — its output changes without any state changing, so React
 * can't reason about when to re-render it. Null until the first tick lands.
 */
export function useNow(intervalMs: number): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    // The zero-delay timeout gets the first value in right after mount, without setting state
    // synchronously inside the effect body (which would cascade a second render every mount).
    const immediate = setTimeout(() => setNow(Date.now()), 0);
    const interval = setInterval(() => setNow(Date.now()), intervalMs);
    return () => {
      clearTimeout(immediate);
      clearInterval(interval);
    };
  }, [intervalMs]);

  return now;
}
