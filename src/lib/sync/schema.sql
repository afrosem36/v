-- Cross-device sync storage. Run this once in the Supabase project's SQL editor
-- (Database -> SQL Editor). Vshape has no migration tooling of its own; this file
-- is the source of truth for what the "sync_rows" table should look like.
--
-- Design: one generic envelope table for every synced Dexie table's rows, keyed by
-- (user_id, table_name, row_id), storing the row as JSONB. This is a dumb per-user
-- replication bucket, not a queried relational backend -- IndexedDB stays the real
-- source of truth on each device. See src/lib/sync/tables.ts for which Dexie tables
-- are synced.

create table if not exists public.sync_rows (
  user_id uuid not null references auth.users(id) on delete cascade,
  table_name text not null,
  row_id text not null,
  data jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null,
  primary key (user_id, table_name, row_id)
);

alter table public.sync_rows enable row level security;

drop policy if exists "own rows only" on public.sync_rows;
create policy "own rows only" on public.sync_rows
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- pull.ts's query is `where user_id = :id and updated_at > :since order by updated_at` — it never
-- filters on table_name, so an index with table_name in the middle (as this used to be) forces
-- Postgres to scan/merge per table_name bucket instead of one ordered range scan across the whole
-- user. Matches the query's actual predicate shape instead.
drop index if exists sync_rows_pull_idx;
create index if not exists sync_rows_pull_idx on public.sync_rows (user_id, updated_at);

-- Last-write-wins, with deletes given permanent precedence: a stale incoming write (older
-- updated_at) is silently dropped, so a push from a device that's behind never clobbers a newer
-- write from another device. Once a row is tombstoned (deleted = true), it can never be
-- "resurrected" by a later write at all, even one with a newer timestamp — a device that was
-- offline when "Delete Everywhere" ran still has its pre-delete outbox entries, and if it flushed
-- them using ordinary timestamp comparison, its own (or a skewed) clock could make that stale
-- upsert look newer than the tombstone and silently undo an explicit, deliberate deletion. The
-- client applies the same "skip if locally unflushed" rule on pull -- see src/lib/sync/pull.ts.
create or replace function public.reject_stale_sync_write() returns trigger as $$
begin
  if TG_OP = 'UPDATE' and OLD.deleted = true then
    return null;
  end if;
  if TG_OP = 'UPDATE' and NEW.updated_at < OLD.updated_at then
    return null;
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists sync_rows_lww on public.sync_rows;
create trigger sync_rows_lww before update on public.sync_rows
  for each row execute function public.reject_stale_sync_write();

-- Enables near-real-time sync: the client subscribes to Postgres changes on this table (filtered
-- to its own user_id — RLS applies to Realtime the same as any other request) and pulls
-- immediately on any change, instead of waiting for the fallback poll. Safe to re-run; does
-- nothing if already added.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sync_rows'
  ) then
    alter publication supabase_realtime add table public.sync_rows;
  end if;
end $$;
