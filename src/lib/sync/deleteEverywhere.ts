import { supabase } from "@/lib/supabase/client";
import { paginateSupabase } from "./paginate";

interface CandidateRow {
  table_name: string;
  row_id: string;
}

/**
 * Tombstones every one of this account's rows in Supabase (marks deleted:true with a fresh
 * updated_at) rather than hard-deleting them — every OTHER signed-in device only learns about a
 * deletion by pulling a row whose `updated_at` is newer than its own cursor (see pull.ts); a hard
 * DELETE from sync_rows would just vanish with nothing left for that "since" filter to ever match,
 * so other devices would keep their local copies forever, believing nothing had changed.
 *
 * Deliberately separate from the ordinary "Reset This Device" action (backup.ts's clearAllData):
 * that one only ever touches the device it's tapped on. This one is a distinct, explicitly
 * destructive action that reaches every device signed into the account — callers should always
 * gate it behind a real, hard-to-misclick confirmation (see Settings' 10-second countdown).
 */
export async function deleteEverywhere(userId: string): Promise<void> {
  if (!supabase) return;
  const now = new Date().toISOString();

  // advanceOffset: false — each page's write shrinks the `deleted = false` result set (tombstoned
  // rows drop out of it), so an advancing offset would skip straight past whatever just shifted
  // into the range a later page thinks it's asking for. Re-querying from the top every time is
  // what caught (and fixed) "200 of 1200 rows silently left un-tombstoned" when this was first
  // tested against the real database.
  await paginateSupabase<CandidateRow>(
    async (start, end) => {
      const { data, error } = await supabase!.from("sync_rows").select("table_name,row_id").eq("user_id", userId).eq("deleted", false).range(start, end);
      if (error) throw error;
      return (data ?? []) as CandidateRow[];
    },
    async (rows) => {
      const tombstones = rows.map((row) => ({ user_id: userId, table_name: row.table_name, row_id: row.row_id, data: {}, deleted: true, updated_at: now }));
      const { error } = await supabase!.from("sync_rows").upsert(tombstones, { onConflict: "user_id,table_name,row_id" });
      if (error) throw error;
    },
    false
  );
}
