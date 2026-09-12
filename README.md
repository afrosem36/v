# Vshape

A personal training PWA built around one goal: a V-shaped physique (wider shoulders/lats, developed upper chest, strong arms and legs, lower waist over time). Local-first — all data lives in IndexedDB on your device and every screen reads from there, never from the network. If you set up Google sign-in (see below), your data also syncs in the background to your other devices signed into the same account.

## Run it locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). On an iPhone, open the same URL in Safari (once deployed to a real HTTPS URL — see below) and use Share → Add to Home Screen to install it as an app.

## Deploy (so it's installable on your phone)

PWA install and offline caching require HTTPS, so this needs to be deployed somewhere rather than just run on localhost:

```bash
npm i -g vercel   # once
vercel            # follow the prompts, links this folder to a Vercel project
vercel --prod     # deploy to your production URL
```

By default it's a static/client app with no environment variables needed. Two optional features need them, both in your Vercel project's environment variables (see `.env.local` locally for the same setup) — **and note Vercel only picks up new/changed variables on the next deployment, so redeploy after adding any of these**:

- **AI coaching** (session feedback, exercise explanations, the training-partner chat): set `GROQ_API_KEY` (and optionally `GROQ_MODEL`).
- **Google sign-in + cross-device sync**: set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from your Supabase project's Settings → API, enable the Google provider under Authentication → Providers, and run `src/lib/sync/schema.sql` once in the Supabase SQL editor to create the `sync_rows` table sync needs. Without these, the app runs as a single implicit local account with no login screen and no sync at all — signing in on a second device otherwise starts that device with an empty, brand-new local database.

## What's here

- The weekly program, exercise library, and equipment defaults are seeded on first run (`src/lib/db/seed/`) and are all editable in-app (Plan tab, Settings tab).
- The progression engine (`src/lib/engine/progression.ts`) is what decides next session's suggested weight/reps — see `CLAUDE.md` for the architecture notes.
- Export a full backup any time from Settings → Backup & Export (JSON for restore, CSV for a spreadsheet view of your set history).

## Phase 2 (not built yet)

Apple Health can't be read from a browser. Steps and body weight are manual entry for now; a small native iOS companion reading HealthKit and writing into the same data layer is the intended next step, without needing to rebuild this app.
