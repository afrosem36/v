"use client";

import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { abandonSession, completeSession } from "@/lib/db/repo/workouts";
import { formatDayAndDate } from "@/lib/utils/date";
import type { WorkoutSession } from "@/types/domain";

interface ActiveSessionBannerProps {
  session: WorkoutSession;
  setCount: number;
}

export function ActiveSessionBanner({ session, setCount }: ActiveSessionBannerProps) {
  const router = useRouter();

  async function handleClose() {
    const message =
      setCount > 0
        ? `Save "${session.label}" with the ${setCount} set(s) already logged and close it?`
        : `Discard "${session.label}"? Nothing was logged, so nothing is lost.`;
    if (!confirm(message)) return;
    if (setCount > 0) await completeSession(session.id);
    else await abandonSession(session.id);
  }

  return (
    <Card className="border-accent/40 bg-accent/10">
      <div className="text-sm font-semibold text-accent">Workout in progress</div>
      <div className="mt-0.5 text-sm text-text-muted">
        {session.label} · started {formatDayAndDate(session.startedAt)} · {setCount} {setCount === 1 ? "set" : "sets"} logged
      </div>
      <div className="mt-3 flex gap-2">
        <Button fullWidth onClick={() => router.push(`/workout/active?session=${session.id}`)}>
          Resume
        </Button>
        <Button variant="secondary" onClick={handleClose}>
          {setCount > 0 ? "Save & close" : "Discard"}
        </Button>
      </div>
    </Card>
  );
}
