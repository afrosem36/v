"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronRight, Download, Upload, Trash2, UserRound, Sparkles, Dumbbell } from "lucide-react";
import { Card, CardLabel } from "@/components/ui/Card";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Button } from "@/components/ui/Button";
import { db } from "@/lib/db/db";
import { getSettings, updateSettings } from "@/lib/db/repo/settings";
import { setEquipmentAvailability } from "@/lib/db/repo/exercises";
import { EQUIPMENT_SEED } from "@/lib/db/seed/equipment";
import { exportAllDataJSON, importAllDataJSON, exportWorkoutHistoryCSV, clearAllData } from "@/lib/db/backup";
import { downloadTextFile } from "@/lib/utils/download";
import { todayStr } from "@/lib/utils/date";
import { LastUpdated } from "@/components/LastUpdated";
import { useAuth } from "@/lib/auth/AuthProvider";

function useSettingsData() {
  return useLiveQuery(async () => {
    const settings = await getSettings();
    const userEquipment = await db.userEquipment.toArray();
    return { settings, userEquipment };
  }, []);
}

export default function SettingsPage() {
  const data = useSettingsData();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  if (!data) return <div className="p-5 pt-[calc(1.5rem+var(--safe-top))] text-sm text-text-muted">Loading…</div>;

  const { settings, userEquipment } = data;

  async function handleExportJSON() {
    const json = await exportAllDataJSON();
    downloadTextFile(`vshape-backup-${todayStr()}.json`, json, "application/json");
  }

  async function handleExportCSV() {
    const csv = await exportWorkoutHistoryCSV();
    downloadTextFile(`vshape-history-${todayStr()}.csv`, csv, "text/csv");
  }

  async function handleImport(file: File | undefined) {
    if (!file) return;
    if (!confirm("This replaces all current workout data with the contents of this backup file. Continue?")) return;
    setBusy(true);
    try {
      const text = await file.text();
      await importAllDataJSON(text);
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    if (!confirm("This permanently deletes all workouts, history, and settings from this device. This cannot be undone. Continue?")) return;
    await clearAllData();
    window.location.reload();
  }

  return (
    <div className="flex flex-col gap-4 p-5 pt-[calc(1.5rem+var(--safe-top))] pb-10">
      <div className="text-2xl font-bold tracking-tight">Settings</div>

      <Link href="/profile">
        <Card className="flex items-center justify-between active:brightness-95">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <UserRound size={18} />
            </div>
            <div className="min-w-0">
              <div className="truncate font-medium">{user.name}</div>
              <div className="truncate text-xs text-text-muted">{user.email}</div>
            </div>
          </div>
          <ChevronRight size={16} className="text-text-faint" />
        </Card>
      </Link>

      <Link href="/coach">
        <Card className="flex items-center justify-between active:brightness-95">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-accent" />
            <span className="font-medium">AI Coach &amp; plan import</span>
          </div>
          <ChevronRight size={16} className="text-text-faint" />
        </Card>
      </Link>

      <Link href="/exercises">
        <Card className="flex items-center justify-between active:brightness-95">
          <div className="flex items-center gap-2">
            <Dumbbell size={16} className="text-text-muted" />
            <span className="font-medium">Exercise library</span>
          </div>
          <ChevronRight size={16} className="text-text-faint" />
        </Card>
      </Link>

      <Card>
        <CardLabel>Body Weight Units</CardLabel>
        <div className="mt-2">
          <SegmentedControl
            options={[
              { value: "kg", label: "kg" },
              { value: "lb", label: "lb" },
            ]}
            value={settings.units}
            onChange={(v) => updateSettings({ units: v })}
            size="md"
          />
        </div>
        <p className="mt-2 text-xs text-text-muted">Gym equipment is always logged in kg. This only affects how body weight is displayed.</p>
      </Card>

      <Card>
        <CardLabel>Daily Step Goal</CardLabel>
        <div className="mt-2">
          <NumberStepper
            value={settings.stepGoal}
            onChange={(v) => updateSettings({ stepGoal: Math.max(1000, Math.round(v)) })}
            step={500}
            max={100_000}
            decimals={0}
            size="md"
          />
        </div>
      </Card>

      <Card>
        <CardLabel>Rest Timer Defaults</CardLabel>
        <div className="mt-2 flex flex-col gap-3">
          <div>
            <div className="mb-1 text-xs text-text-muted">Compound</div>
            <NumberStepper
              value={settings.defaultRestCompoundSec}
              onChange={(v) => updateSettings({ defaultRestCompoundSec: Math.max(15, Math.round(v)) })}
              step={15}
              decimals={0}
              suffix="sec"
              size="md"
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-text-muted">Isolation</div>
            <NumberStepper
              value={settings.defaultRestIsolationSec}
              onChange={(v) => updateSettings({ defaultRestIsolationSec: Math.max(15, Math.round(v)) })}
              step={15}
              decimals={0}
              suffix="sec"
              size="md"
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-text-muted">Abs</div>
            <NumberStepper
              value={settings.defaultRestAbsSec}
              onChange={(v) => updateSettings({ defaultRestAbsSec: Math.max(15, Math.round(v)) })}
              step={15}
              decimals={0}
              suffix="sec"
              size="md"
            />
          </div>
        </div>
      </Card>

      <Card>
        <CardLabel>Equipment Increments</CardLabel>
        <div className="mt-2 flex flex-col gap-3">
          <div>
            <div className="mb-1 text-xs text-text-muted">Dumbbell step</div>
            <NumberStepper
              value={settings.equipmentIncrements.dumbbellStepKg}
              onChange={(v) => updateSettings({ equipmentIncrements: { ...settings.equipmentIncrements, dumbbellStepKg: v } })}
              step={0.5}
              decimals={2}
              suffix="kg"
              size="md"
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-text-muted">Smallest plate</div>
            <NumberStepper
              value={settings.equipmentIncrements.plateStepKg}
              onChange={(v) => updateSettings({ equipmentIncrements: { ...settings.equipmentIncrements, plateStepKg: v } })}
              step={0.25}
              decimals={2}
              suffix="kg"
              size="md"
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-text-muted">Machine step</div>
            <NumberStepper
              value={settings.equipmentIncrements.machineStepKg}
              onChange={(v) => updateSettings({ equipmentIncrements: { ...settings.equipmentIncrements, machineStepKg: v } })}
              step={1}
              decimals={2}
              suffix="kg"
              size="md"
            />
          </div>
        </div>
      </Card>

      <Link href="/plan">
        <Card className="flex items-center justify-between active:brightness-95">
          <span className="font-medium">Training Schedule</span>
          <ChevronRight size={16} className="text-text-faint" />
        </Card>
      </Link>

      <Card>
        <CardLabel>Available Equipment</CardLabel>
        <p className="mt-1 text-xs text-text-muted">Untoggle anything your gym doesn&apos;t have — exercises auto-substitute.</p>
        <div className="mt-3 flex flex-col gap-1.5">
          {EQUIPMENT_SEED.filter((eq) => eq.key !== "bodyweight").map((eq) => {
            const row = userEquipment.find((u) => u.equipmentKey === eq.key);
            const available = row?.available ?? true;
            return (
              <button
                key={eq.key}
                onClick={() => setEquipmentAvailability(eq.key, !available)}
                className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2.5 text-sm active:brightness-90"
              >
                <span>{eq.label}</span>
                <span
                  className={`flex h-6 w-11 items-center rounded-full px-0.5 transition-colors ${available ? "bg-accent justify-end" : "bg-border justify-start"}`}
                >
                  <span className="h-5 w-5 rounded-full bg-white" />
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardLabel>Backup &amp; Export</CardLabel>
        <div className="mt-3 flex flex-col gap-2">
          <Button variant="secondary" onClick={handleExportJSON}>
            <Download size={16} />
            Export Full Backup (JSON)
          </Button>
          <Button variant="secondary" onClick={handleExportCSV}>
            <Download size={16} />
            Export Workout History (CSV)
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => handleImport(e.target.files?.[0])}
          />
          <Button variant="secondary" disabled={busy} onClick={() => fileInputRef.current?.click()}>
            <Upload size={16} />
            Import Backup
          </Button>
        </div>
      </Card>

      <Card className="border-danger/30">
        <CardLabel>Danger Zone</CardLabel>
        <Button variant="danger" fullWidth className="mt-3" onClick={handleReset}>
          <Trash2 size={16} />
          Reset All Data
        </Button>
      </Card>

      <p className="text-center text-xs text-text-faint">
        Vshape · Dark theme · Data stored on this device · <LastUpdated />
      </p>
    </div>
  );
}
