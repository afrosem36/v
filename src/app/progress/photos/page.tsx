"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronLeft, Plus, Trash2 } from "lucide-react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { addProgressPhoto, getAllProgressPhotos, deleteProgressPhoto } from "@/lib/db/repo/body";
import { todayStr, formatFriendlyDate } from "@/lib/utils/date";
import type { PhotoAngle, ProgressPhoto } from "@/types/domain";

const ANGLES: { key: PhotoAngle; label: string }[] = [
  { key: "front", label: "Front" },
  { key: "side", label: "Side" },
  { key: "back", label: "Back" },
];

/**
 * Object URLs are created in a memo and revoked on cleanup rather than pushed through state —
 * the state round-trip cost an extra render per photo and left the grid blank on first paint.
 */
function useObjectUrl(blob: Blob | null | undefined): string | null {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);
  return url;
}

function PhotoThumb({ photo, onOpen }: { photo: ProgressPhoto; onOpen: () => void }) {
  const url = useObjectUrl(photo.blob);

  return (
    <button onClick={onOpen} className="aspect-square overflow-hidden rounded-xl bg-surface-2">
      {/* next/image can't process blob: URLs — these photos only ever exist in this browser. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url && <img src={url} alt={`${photo.angle} ${photo.date}`} className="h-full w-full object-cover" />}
    </button>
  );
}

export default function PhotosPage() {
  const router = useRouter();
  const photos = useLiveQuery(() => getAllProgressPhotos(), []);
  const fileInputs = useRef<Record<PhotoAngle, HTMLInputElement | null>>({ front: null, side: null, back: null });
  const [viewing, setViewing] = useState<ProgressPhoto | null>(null);
  const viewUrl = useObjectUrl(viewing?.blob);

  async function handleFile(angle: PhotoAngle, file: File | undefined) {
    if (!file) return;
    await addProgressPhoto(todayStr(), angle, file);
  }

  return (
    <div className="flex flex-col gap-4 p-5 pt-[calc(1.5rem+var(--safe-top))] pb-10">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-medium text-text-muted">
        <ChevronLeft size={16} />
        Back
      </button>

      <div className="text-2xl font-bold tracking-tight">Progress Photos</div>
      <p className="text-xs text-text-muted">Optional monthly check-ins. Stored only on this device.</p>

      <div className="grid grid-cols-3 gap-3">
        {ANGLES.map(({ key, label }) => (
          <div key={key}>
            <input
              ref={(el) => {
                fileInputs.current[key] = el;
              }}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => handleFile(key, e.target.files?.[0])}
            />
            <button
              onClick={() => fileInputs.current[key]?.click()}
              className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-surface-2 text-text-muted active:brightness-90"
            >
              <Plus size={18} />
              <span className="text-xs font-medium">{label}</span>
            </button>
          </div>
        ))}
      </div>

      {photos && photos.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">All Photos</div>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <PhotoThumb key={p.id} photo={p} onOpen={() => setViewing(p)} />
            ))}
          </div>
        </div>
      )}

      <BottomSheet open={viewing != null} onClose={() => setViewing(null)} title={viewing ? formatFriendlyDate(viewing.date) : ""}>
        {viewing && viewUrl && (
          <div className="pb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={viewUrl} alt={viewing.angle} className="w-full rounded-xl" />
            <div className="mt-2 flex items-center justify-between text-sm text-text-muted">
              <span className="capitalize">{viewing.angle}</span>
              <button
                onClick={async () => {
                  await deleteProgressPhoto(viewing.id);
                  setViewing(null);
                }}
                className="flex items-center gap-1 text-danger"
              >
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
