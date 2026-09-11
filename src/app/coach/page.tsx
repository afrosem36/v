"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronLeft, Sparkles, History, Undo2, Trash2, RefreshCw } from "lucide-react";
import { Card, CardLabel } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { CoachPlanFlow, type CoachFlowMode } from "@/components/coach/CoachPlanFlow";
import { deleteCoachPlan, getCoachPlans, getPlanSnapshots, restorePlanSnapshot } from "@/lib/db/repo/coach";
import { goalByKey } from "@/lib/coach/goals";
import { formatShortDate } from "@/lib/utils/date";

export default function CoachPage() {
  return (
    <Suspense fallback={<div className="p-5 pt-[calc(1.5rem+var(--safe-top))] text-sm text-text-muted">Loading…</div>}>
      <CoachPageInner />
    </Suspense>
  );
}

function CoachPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialMode: CoachFlowMode = searchParams.get("mode") === "update" ? "update" : "new";

  const [mode, setMode] = useState<CoachFlowMode>(initialMode);
  const [flowKey, setFlowKey] = useState(0);

  const saved = useLiveQuery(async () => {
    const [plans, snapshots] = await Promise.all([getCoachPlans(), getPlanSnapshots()]);
    return { plans, snapshots };
  }, []);

  return (
    <div className="flex flex-col gap-4 p-5 pt-[calc(1.5rem+var(--safe-top))] pb-10">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-medium text-text-muted">
        <ChevronLeft size={16} />
        Back
      </button>

      <div className="flex items-center gap-2">
        <Sparkles size={20} className="text-accent" />
        <div className="text-2xl font-bold tracking-tight">AI Coach</div>
      </div>

      <div className="flex gap-2">
        {(
          [
            { key: "update", label: "Update my plan", hint: "Uses everything you've lifted" },
            { key: "new", label: "Start fresh", hint: "New intake, new program" },
          ] as const
        ).map((option) => (
          <button
            key={option.key}
            onClick={() => {
              setMode(option.key);
              setFlowKey((k) => k + 1);
            }}
            className={`flex-1 rounded-xl border px-3 py-2.5 text-left ${
              mode === option.key ? "border-accent bg-accent/10" : "border-border bg-surface-2"
            }`}
          >
            <span className="block text-sm font-medium">{option.label}</span>
            <span className="block text-[11px] text-text-muted">{option.hint}</span>
          </button>
        ))}
      </div>

      <CoachPlanFlow key={`${mode}-${flowKey}`} mode={mode} onApplied={() => router.push("/plan")} />

      {saved && saved.plans.length > 0 && (
        <Card>
          <div className="flex items-center gap-2">
            <History size={15} className="text-text-muted" />
            <CardLabel>Saved plans</CardLabel>
          </div>
          <div className="mt-2 flex flex-col gap-2">
            {saved.plans.map((p) => (
              <div key={p.id} className="rounded-xl bg-surface-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="text-xs text-text-muted">
                      {formatShortDate(p.createdAt)} · {goalByKey(p.goal).label} · {p.weeksCovered} weeks
                      {p.status === "applied" && " · applied"}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteCoachPlan(p.id)}
                    aria-label="Delete plan"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-danger active:brightness-90"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {saved && saved.snapshots.length > 0 && (
        <Card>
          <div className="flex items-center gap-2">
            <Undo2 size={15} className="text-text-muted" />
            <CardLabel>Undo a plan change</CardLabel>
          </div>
          <div className="mt-2 flex flex-col gap-2">
            {saved.snapshots.slice(0, 4).map((s) => (
              <button
                key={s.id}
                onClick={async () => {
                  if (!confirm(`Restore your program as it was: "${s.label}"?`)) return;
                  await restorePlanSnapshot(s.id);
                  router.push("/plan");
                }}
                className="rounded-xl bg-surface-2 px-3 py-2.5 text-left text-sm active:brightness-90"
              >
                <div className="truncate font-medium">{s.label}</div>
                <div className="text-xs text-text-muted">{formatShortDate(s.createdAt)}</div>
              </button>
            ))}
          </div>
        </Card>
      )}

      <Button variant="secondary" fullWidth onClick={() => setFlowKey((k) => k + 1)}>
        <RefreshCw size={16} />
        Start this flow over
      </Button>
    </div>
  );
}
