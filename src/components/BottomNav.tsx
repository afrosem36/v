"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import { Home, CalendarRange, History, LineChart, Settings } from "lucide-react";
import clsx from "clsx";

const TABS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/plan", label: "Plan", icon: CalendarRange },
  { href: "/history", label: "History", icon: History },
  { href: "/progress", label: "Progress", icon: LineChart },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const activeIndex = TABS.findIndex(({ href }) => (href === "/" ? pathname === "/" : pathname.startsWith(href)));

  const tabRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const limelightRef = useRef<HTMLDivElement | null>(null);
  // Starts un-animated so the glow doesn't slide in from off-screen on first paint; the very
  // first position (however it lands) happens instantly, only later moves animate.
  const [ready, setReady] = useState(false);

  // Measures the actual active tab's position rather than assuming equal-width slots, so this
  // stays correct regardless of tab count or label length.
  useLayoutEffect(() => {
    const limelight = limelightRef.current;
    const activeTab = tabRefs.current[activeIndex];
    if (!limelight || !activeTab) return;
    limelight.style.left = `${activeTab.offsetLeft + activeTab.offsetWidth / 2 - limelight.offsetWidth / 2}px`;
    if (!ready) requestAnimationFrame(() => setReady(true));
  }, [activeIndex, ready]);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur pb-[var(--safe-bottom)]">
      <div className="relative mx-auto flex max-w-lg items-stretch justify-around">
        <div
          ref={limelightRef}
          className={clsx(
            "pointer-events-none absolute top-0 z-10 h-1 w-10 rounded-full bg-accent",
            ready && "transition-[left] duration-300 ease-out"
          )}
          style={{ left: "-999px", boxShadow: "0 6px 14px -1px var(--color-accent)" }}
        />
        {TABS.map(({ href, label, icon: Icon }, index) => {
          const active = index === activeIndex;
          return (
            <Link
              key={href}
              href={href}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              className={clsx(
                "flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium",
                active ? "text-accent" : "text-text-faint"
              )}
            >
              <Icon size={22} strokeWidth={active ? 2.4 : 2} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
