/** PostgREST's default cap on rows per request — anything larger needs another page. */
export const SUPABASE_PAGE_SIZE = 1000;

/**
 * Runs `fetchPage(rangeStart, rangeEnd)` repeatedly, feeding each page's rows to `onPage`, until a
 * page comes back shorter than SUPABASE_PAGE_SIZE (the signal there's nothing left).
 *
 * `advanceOffset` picks between the two pagination shapes this app needs:
 *  - true (pull.ts): the query's filter doesn't change between pages, so each page asks for the
 *    next range.
 *  - false (deleteEverywhere.ts): each page's own side effect (tombstoning rows) shrinks the
 *    result set for that same filter, so every page must re-ask from the top — advancing would
 *    skip whatever just shifted into range.
 */
export async function paginateSupabase<T>(
  fetchPage: (rangeStart: number, rangeEnd: number) => Promise<T[]>,
  onPage: (rows: T[]) => Promise<void>,
  advanceOffset: boolean
): Promise<void> {
  let offset = 0;
  for (;;) {
    const rows = await fetchPage(offset, offset + SUPABASE_PAGE_SIZE - 1);
    if (rows.length === 0) break;
    await onPage(rows);
    if (rows.length < SUPABASE_PAGE_SIZE) break;
    if (advanceOffset) offset += SUPABASE_PAGE_SIZE;
  }
}
