@AGENTS.md

# Vshape — personal V-shape physique training PWA

Local-first Next.js (App Router) PWA. IndexedDB (via Dexie) is the source of truth on every device and the app works fully offline by design — every read the UI does comes from Dexie, never from a network round-trip. When Supabase is configured (Google sign-in), user data also syncs across a person's own devices in the background (`src/lib/sync/`) via a per-user table in Supabase Postgres; without Supabase configured, the app runs as a single implicit local account with no sync at all. Deployed to Vercel purely as a static/app host — there's no custom backend beyond that Supabase project.

## Architecture
- `src/types/domain.ts` — all domain types (Exercise, WorkoutSession, ExerciseSet, etc.)
- `src/lib/db/db.ts` — Dexie schema. Bump `.version(n)` for any index/shape change; `.where("field")` requires that exact field to be indexed or Dexie throws at runtime (silently breaks whatever `useLiveQuery` call hits it — check this first if a page gets stuck on "Loading…").
- `src/lib/db/seed/` — exercise library, equipment list, default weekly program. Seeded once on first run (`ensureSeeded`).
- `src/lib/db/repo/` — all reads/writes go through here, never touch `db` directly from components.
- `src/lib/engine/` — pure functions, no I/O: progression algorithm (`progression.ts`), weight/plate math, PR detection, time-budget trimming, calibration/return-after-break logic. Unit-testable in isolation.
- `src/lib/hooks/useActiveWorkoutSession.ts` — the core reactive query joining program + equipment substitution + last performance + prescription for the active workout screen.
- `src/store/active-workout-store.ts` — zustand, ephemeral only (rest timer, current exercise index within a page load). Actual workout data always lives in Dexie so a refresh mid-workout is recoverable — the active-workout page recomputes resume position from logged sets, not from this store.
- `src/lib/sync/` — the cross-device sync engine. `tables.ts` lists exactly which Dexie tables sync (reference/library data and `progressPhotos` never do — see its own comments); `outbox.ts` registers Dexie hooks that enqueue every local write to a `syncOutbox` table (no repo file needs to know sync exists); `push.ts`/`pull.ts` move rows to/from one generic Supabase table (`sync_rows`, schema in `schema.sql`) keyed by `(user_id, table_name, row_id)`, last-write-wins by an `updated_at` a Postgres trigger enforces; `bootstrap.ts` runs once per device per account (`KnownAccount.syncBootstrappedAt`) to decide whether this device pushes its existing data up or wipes its freshly-seeded placeholders and pulls the real thing down; `engine.ts` is the polling loop wired into `AuthProvider`.
- Auth is Google sign-in via Supabase when configured (`src/lib/auth/`), single implicit local account otherwise. Either way, each account still gets its own IndexedDB database per device — sync is what makes multiple devices converge, not a shared database.

## Known constraints / decisions
- Exercise weight is always logged in kg (Indian gym plates are kg-labeled); the kg/lb unit setting only affects body-weight display.
- `NumberStepper`'s optional `suffix` needs real horizontal room — avoid it in 3-column (or narrower) grids; several settings fields were broken this way until fixed (see git history / past bugs).
- Apple HealthKit cannot be read from a browser. Steps/weight are manual-entry in Phase 1; a native Swift companion is the planned Phase 2 bridge, writing into the same repo-layer tables.
- Turbopack is Next 16's default bundler for both dev and build — `@serwist/next`'s webpack-based service worker plugin doesn't support it, so the PWA service worker (`public/sw.js`) is hand-written instead (network-first for navigations, cache-first for `/_next/static` and `/icons`).

## Testing
No automated test suite yet. Verify UI changes with the `agent-browser` skill against `npm run dev`, emulating an iPhone viewport (`set device "iPhone 14"`) — several real bugs (stuck "Log Set" button from a missing React `key`, a missing Dexie index silently breaking History/Summary PR queries, layout overlap in dense NumberStepper grids) were only caught this way, not by `npm run build` or TypeScript.

