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

create index if not exists sync_rows_pull_idx on public.sync_rows (user_id, table_name, updated_at);

-- Last-write-wins: silently drop an incoming write that's older than what's already
-- stored, so a push from a device that's behind never clobbers a newer write from
-- another device. The client still applies the same "skip if locally unflushed" rule
-- on pull -- see src/lib/sync/pull.ts.
create or replace function public.reject_stale_sync_write() returns trigger as $$
begin
  if TG_OP = 'UPDATE' and NEW.updated_at < OLD.updated_at then
    return null;
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists sync_rows_lww on public.sync_rows;
create trigger sync_rows_lww before update on public.sync_rows
  for each row execute function public.reject_stale_sync_write();
