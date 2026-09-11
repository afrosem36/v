"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { getCompletedSessions, getSessionSets } from "@/lib/db/repo/workouts";
import { totalLoadForSet } from "@/lib/engine/weight-math";
import { formatFriendlyDate } from "@/lib/utils/date";

export default function HistoryPage() {
  const sessions = useLiveQuery(async () => {
    const completed = await getCompletedSessions(100);
    return Promise.all(
      completed.map(async (session) => {
        const sets = await getSessionSets(session.id);
        return {
          session,
          setCount: sets.length,
          volume: sets.reduce((sum, s) => sum + totalLoadForSet(s) * s.reps, 0),
        };
      })
    );
  }, []);

  return (
    <div className="flex flex-col gap-4 p-5 pt-[calc(1.5rem+var(--safe-top))]">
      <div className="text-2xl font-bold tracking-tight">History</div>

      {sessions && sessions.length === 0 && (
        <p className="text-sm text-text-muted">No completed workouts yet. Once you finish one, it&apos;ll show up here.</p>
      )}

      <div className="flex flex-col gap-2">
        {sessions?.map(({ session, setCount, volume }) => (
          <Link key={session.id} href={`/history/${session.id}`}>
            <Card className="flex items-center justify-between active:brightness-95">
              <div>
                <div className="font-semibold">{session.label}</div>
                <div className="text-xs text-text-muted">{formatFriendlyDate(session.startedAt)}</div>
                <div className="mt-1 text-xs text-text-muted">
                  {setCount} sets · {Math.round(volume)}kg volume
                </div>
              </div>
              <ChevronRight size={18} className="text-text-faint" />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
