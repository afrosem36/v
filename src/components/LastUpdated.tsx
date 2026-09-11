"use client";

import { useEffect, useState } from "react";
import { formatTimeAgo } from "@/lib/utils/time-ago";

/** Reflects when the currently-deployed code was last committed/pushed — set at build time. */
export function LastUpdated() {
  const iso = process.env.NEXT_PUBLIC_LAST_COMMIT_ISO;
  const [, forceTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!iso) return null;
  return <>Updated {formatTimeAgo(iso)}</>;
}
