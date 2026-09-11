"use client";

import type { MuscleGroupKey } from "@/types/domain";
import type { MuscleVolume } from "@/lib/db/repo/analytics";

/**
 * Front and back body figures shaded by how much work each muscle got in the window. The shapes
 * are deliberately simple blocks rather than anatomy — at phone size, a readable silhouette
 * tells the story ("shoulders bright, legs grey") better than accurate outlines would.
 */

interface Region {
  muscle: MuscleGroupKey;
  side: "front" | "back";
  /** SVG shapes making up the region, in a 100 × 200 viewBox. */
  shapes: ({ type: "rect"; x: number; y: number; w: number; h: number; r?: number } | { type: "ellipse"; cx: number; cy: number; rx: number; ry: number })[];
}

const REGIONS: Region[] = [
  // ---- front ----
  { muscle: "front_delts", side: "front", shapes: [{ type: "ellipse", cx: 29, cy: 52, rx: 9, ry: 8 }, { type: "ellipse", cx: 71, cy: 52, rx: 9, ry: 8 }] },
  { muscle: "upper_chest", side: "front", shapes: [{ type: "rect", x: 36, y: 48, w: 28, h: 10, r: 4 }] },
  { muscle: "chest", side: "front", shapes: [{ type: "rect", x: 35, y: 58, w: 30, h: 14, r: 5 }] },
  { muscle: "biceps", side: "front", shapes: [{ type: "rect", x: 19, y: 62, w: 9, h: 20, r: 4 }, { type: "rect", x: 72, y: 62, w: 9, h: 20, r: 4 }] },
  { muscle: "forearms", side: "front", shapes: [{ type: "rect", x: 16, y: 83, w: 8, h: 22, r: 4 }, { type: "rect", x: 76, y: 83, w: 8, h: 22, r: 4 }] },
  { muscle: "core", side: "front", shapes: [{ type: "rect", x: 39, y: 74, w: 22, h: 26, r: 5 }] },
  { muscle: "quads", side: "front", shapes: [{ type: "rect", x: 35, y: 104, w: 13, h: 38, r: 6 }, { type: "rect", x: 52, y: 104, w: 13, h: 38, r: 6 }] },
  { muscle: "calves", side: "front", shapes: [{ type: "rect", x: 36, y: 146, w: 11, h: 30, r: 5 }, { type: "rect", x: 53, y: 146, w: 11, h: 30, r: 5 }] },
  // ---- back ----
  { muscle: "traps", side: "back", shapes: [{ type: "rect", x: 38, y: 40, w: 24, h: 14, r: 5 }] },
  { muscle: "rear_delts", side: "back", shapes: [{ type: "ellipse", cx: 29, cy: 53, rx: 9, ry: 8 }, { type: "ellipse", cx: 71, cy: 53, rx: 9, ry: 8 }] },
  { muscle: "lats", side: "back", shapes: [{ type: "rect", x: 33, y: 56, w: 34, h: 26, r: 6 }] },
  { muscle: "triceps", side: "back", shapes: [{ type: "rect", x: 19, y: 62, w: 9, h: 20, r: 4 }, { type: "rect", x: 72, y: 62, w: 9, h: 20, r: 4 }] },
  { muscle: "glutes", side: "back", shapes: [{ type: "rect", x: 36, y: 96, w: 28, h: 16, r: 7 }] },
  { muscle: "hamstrings", side: "back", shapes: [{ type: "rect", x: 35, y: 114, w: 13, h: 30, r: 6 }, { type: "rect", x: 52, y: 114, w: 13, h: 30, r: 6 }] },
  { muscle: "calves", side: "back", shapes: [{ type: "rect", x: 36, y: 148, w: 11, h: 28, r: 5 }, { type: "rect", x: 53, y: 148, w: 11, h: 28, r: 5 }] },
];

const MUSCLE_LABELS: Record<string, string> = {
  lateral_delts: "Side delts",
  lats: "Lats",
  rear_delts: "Rear delts",
  front_delts: "Front delts",
  upper_chest: "Upper chest",
  chest: "Chest",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  quads: "Quads",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  calves: "Calves",
  core: "Core",
  traps: "Traps",
  full_body: "Full body",
};

export function muscleLabel(key: MuscleGroupKey): string {
  return MUSCLE_LABELS[key] ?? key.replace(/_/g, " ");
}

function intensity(sets: number, max: number): number {
  if (sets <= 0 || max <= 0) return 0;
  return Math.min(1, sets / max);
}

function Figure({ side, byMuscle, max }: { side: "front" | "back"; byMuscle: Map<MuscleGroupKey, number>; max: number }) {
  return (
    <svg viewBox="0 0 100 200" className="h-full w-full" role="img" aria-label={`${side} view of trained muscles`}>
      {/* silhouette */}
      <g fill="var(--color-surface-2)">
        <ellipse cx="50" cy="26" rx="12" ry="14" />
        <rect x="33" y="42" width="34" height="60" rx="10" />
        <rect x="18" y="48" width="10" height="58" rx="5" />
        <rect x="72" y="48" width="10" height="58" rx="5" />
        <rect x="34" y="98" width="14" height="80" rx="7" />
        <rect x="52" y="98" width="14" height="80" rx="7" />
      </g>

      {REGIONS.filter((r) => r.side === side).map((region, ri) => {
        const level = intensity(byMuscle.get(region.muscle) ?? 0, max);
        if (level === 0) return null;
        return (
          <g key={`${region.muscle}-${ri}`} fill="var(--color-accent)" opacity={0.25 + level * 0.75}>
            {region.shapes.map((shape, si) =>
              shape.type === "rect" ? (
                <rect key={si} x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.r ?? 3} />
              ) : (
                <ellipse key={si} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} />
              )
            )}
          </g>
        );
      })}

      {/* lateral delts sit on the silhouette edge on both views */}
      {(() => {
        const level = intensity(byMuscle.get("lateral_delts") ?? 0, max);
        if (level === 0) return null;
        return (
          <g fill="var(--color-accent)" opacity={0.25 + level * 0.75}>
            <ellipse cx="24" cy="49" rx="7" ry="7" />
            <ellipse cx="76" cy="49" rx="7" ry="7" />
          </g>
        );
      })()}
    </svg>
  );
}

export function MuscleMap({ breakdown }: { breakdown: MuscleVolume[] }) {
  const byMuscle = new Map(breakdown.map((b) => [b.muscle, b.sets]));
  const max = Math.max(1, ...breakdown.map((b) => b.sets));

  return (
    <div className="flex items-stretch justify-center gap-4">
      <div className="flex flex-1 flex-col items-center">
        <div className="h-48 w-24">
          <Figure side="front" byMuscle={byMuscle} max={max} />
        </div>
        <div className="mt-1 text-[10px] uppercase tracking-wide text-text-faint">Front</div>
      </div>
      <div className="flex flex-1 flex-col items-center">
        <div className="h-48 w-24">
          <Figure side="back" byMuscle={byMuscle} max={max} />
        </div>
        <div className="mt-1 text-[10px] uppercase tracking-wide text-text-faint">Back</div>
      </div>
    </div>
  );
}
