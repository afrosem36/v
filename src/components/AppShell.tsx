"use client";

import { usePathname } from "next/navigation";
import { BottomNav } from "./BottomNav";
import { InstallPrompt } from "./InstallPrompt";

// Active workout logging and the partner chat are full-screen and focused — no bottom nav (or
// install nudge) fighting with the chat's own fixed input bar / mid-set distractions.
const FOCUSED_PREFIXES = ["/workout/active", "/partner"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const focused = FOCUSED_PREFIXES.some((p) => pathname.startsWith(p));

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
      <div className={focused ? "flex-1" : "flex-1 pb-24"}>{children}</div>
      {!focused && <InstallPrompt />}
      {!focused && <BottomNav />}
    </div>
  );
}
