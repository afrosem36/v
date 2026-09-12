/**
 * Just the bit of Dexie's Table API this needs. Kept deliberately narrower than Dexie's own
 * `Table<T, TKey, TInsertType>` (rather than importing it directly) because that type's generated
 * `TInsertType` makes it contravariant in ways that fight generic inference here — every concrete
 * `EntityTable<Foo, "id">` still satisfies this structurally, so nothing is lost.
 */
interface DedupeableTable<T> {
  where(index: string): { equals(value: string): { toArray(): Promise<T[]> } };
  bulkDelete(keys: string[]): Promise<void>;
}

/**
 * Dexie Cloud sync can legitimately produce two local rows for what's meant to be a single
 * per-date (or per-exercise) record: each device can write its own row for today before either
 * has synced with the other. The schema used to declare that field `&unique`, which turned this
 * ordinary multi-device race into a fatal ConstraintError the moment the server's row for the
 * same date arrived with a different `id` (see db.ts version 6) — instead of self-healing, sync
 * got stuck. The index is now a plain (non-unique) one, so writes never crash; this helper is
 * what still enforces "one row per key" for callers, by keeping the most recently touched
 * duplicate and quietly deleting the rest whenever more than one is found.
 */
export async function findOneDeduped<T extends { id: string; updatedAt?: string; createdAt?: string }>(
  table: DedupeableTable<T>,
  index: string,
  value: string
): Promise<T | undefined> {
  const matches = await table.where(index).equals(value).toArray();
  if (matches.length <= 1) return matches[0];
  matches.sort((a, b) => (b.updatedAt ?? b.createdAt ?? "").localeCompare(a.updatedAt ?? a.createdAt ?? ""));
  const [keep, ...extras] = matches;
  await table.bulkDelete(extras.map((m) => m.id));
  return keep;
}
