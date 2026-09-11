# Vshape — code & training audit

Written 2026-09-11, after the accounts / AI-coach / bug-fix pass. Two halves: what the code
does badly, and what the app does badly *as a training tool*. Anything already fixed in this
pass is marked **[fixed]**; everything else is a real, open item.

---

## Part 1 — Bugs found and fixed

### The three you reported

**Steps capped at 999** — **[fixed]**
`NumberStepper` defaulted to `max = 999` and the steps screen never overrode it, so every value
above 999 was clamped on the way in. Typing was broken the same way: the field re-formatted on
every keystroke, so "5000" became 5 → 50 → 500 → clamped. The stepper now keeps a text draft
while focused and only commits on blur or Enter, and `max` defaults to unbounded. A field that
can legitimately hold a large number should never inherit a guessed ceiling.
`src/components/ui/NumberStepper.tsx`

**Wrong day's workout opening** — **[fixed]**
Three separate causes, all of which had to be fixed for this to actually work:

1. `getActiveSession()` did `.where("status").equals("active").first()`. On the `status` index,
   "first" is whichever row IndexedDB reaches first — effectively arbitrary. With a stale
   Tuesday session still open, that's the one you got. It now sorts newest-first.
2. Nothing ever closed a session left open on a previous day. A workout opened on Tuesday and
   abandoned stayed `active` forever and swallowed every later attempt to start anything.
   `finalizeStaleSessions()` now runs on app start: sessions from an earlier day with sets
   logged get completed (so the work still counts and still sets PRs), empty ones get abandoned.
3. `/plan/[dayId]` explicitly redirected to the open session on "Start This Workout", so
   tapping Wednesday genuinely did send you to Tuesday. It now asks which one you want.

On top of the fixes there's a proper answer to the underlying need: a `scheduleOverrides` table
pins any date to any routine, and **Do another day** on the home screen starts whichever session
you actually want to train, without editing your weekly plan.
`src/lib/db/repo/workouts.ts`, `src/components/workout/ChooseWorkoutSheet.tsx`

**Couldn't correct a logged set** — **[fixed]**
`deleteSet` existed in the repo but nothing in the UI called it, and there was no update path at
all. Logged sets are now tappable in both the active workout and in history, opening an editor
for weight / reps / RIR / pain, plus delete.

The non-obvious part is records. PRs were computed forward-only at session completion, so
correcting 25kg down to 20kg would have left a personal record nobody ever hit. Editing now
triggers `rebuildPRsForExercise()`, which replays that exercise's whole history oldest-first and
rebuilds its records from nothing. Deleting also renumbers the remaining sets so you don't end
up with "Set 1, Set 3".
`src/components/workout/EditSetSheet.tsx`, `src/lib/db/repo/records.ts`

### Bugs found along the way (not reported, all fixed)

- **A library version bump would have silently overwritten your program.** `syncLibraryIfNeeded`
  re-applied the seeded `workoutDayExercises` on every bump. The file's own comment flagged this
  as a known risk. Now gated behind `planCustomizedAt`, stamped the first time you edit a day or
  apply a coach plan.
- **Writing inside a Dexie live query.** The onboarding gate wrote to settings from inside
  `useLiveQuery`, which runs in a read-only transaction — instant `ReadOnlyError`. Moved to an
  effect. Worth knowing as a class of bug: **live query callbacks must be read-only.**
- **Backup didn't cover the new tables.** Restoring a backup would have silently dropped
  schedule overrides, coach plans and any custom exercises. Backup is now v2 and includes them;
  v1 files still import.
- **`Date.now()` read during render** in `GymClock` and `RestTimerBar` made both components
  impure — they re-rendered to different output with no state change. Replaced with a `useNow`
  hook. The rest timer's completion buzz also used a ref written during render; it's an effect
  keyed on the transition now.
- **Object URLs pushed through state** in the photos screen cost an extra render per photo and
  left the grid blank on first paint. Now a memo with revoke-on-cleanup.
- **ESLint was fully red** (16 errors) before this pass and is now clean, as is `tsc --noEmit`.
  A red linter is a linter nobody reads.

---

## Part 2 — Code quality: what's still worth fixing

Ranked by what would actually bite you.

### 1. There are no tests, and the engine deserves them
`src/lib/engine/` is pure functions with no I/O — progression, PR detection, plate maths,
time-budget trimming, calibration. This is the highest-value, lowest-effort test surface in the
codebase, and it's the code where a silent bug costs you months of training in the wrong
direction. `computeNextPrescription` alone has layoff back-off, double progression, pain
handling and deload branches that nothing verifies. Add Vitest and cover that file first, then
`pr.ts` and the new `coach/improve.ts`.

### 2. `getWeeklyVolumes` and friends read every set in the database
Several analytics functions call `db.exerciseSets.toArray()` and filter in JS. At a year of
training that's maybe 5,000 rows — fine today, visibly slow at five years, and it happens on
every Progress render. The indexes to do it properly (`completedAt`, `[exerciseId+completedAt]`)
already exist.

### 3. Repo functions do N+1 queries in loops
`collectTrainingHistory` and `getRecentSessionsSummary` call `getSessionSets` once per session
inside a loop. Correct, but it's one IndexedDB round trip per session where one ranged query
would do.

### 4. Local auth is real, but understand what it is and isn't
Passwords are PBKDF2-SHA256 at 210k iterations with a per-user salt — genuinely fine. What it
does **not** do is encrypt the training data. Anyone with the unlocked phone and devtools can
read IndexedDB directly without a password. The login separates accounts and keeps a casual
borrower out; it is not device encryption. That's the right trade for a gym log, but don't
mistake it for more than it is. It also requires a secure context (https or localhost) —
over a plain-http LAN IP there's no SubtleCrypto and the app says so rather than pretending.

### 5. `db` is a Proxy, and that deserves a second look eventually
Per-account databases are the right design (real isolation, and your existing data carried over
untouched by keeping the original `vshape` name for the first account). The Proxy that lets
every repo keep a static `import { db }` is the pragmatic part. It works, but it's indirection
that only pays off because sign-in and sign-out both hard-reload. If that reload ever goes away,
live queries bound to the previous account's database become a real cross-user leak.

### 6. `next.config.ts` shells out to git at build time
`getLastCommitISO()` runs `execSync("git log -1")` during config load. It has a fallback, but it
ties builds to a git checkout. Vercel sets `VERCEL_GIT_COMMIT_SHA` and friends — prefer those.

### 7. The service worker is hand-written and has no versioning story
Understandable (Turbopack vs. `@serwist/next`), but `public/sw.js` caches `/_next/static` cache-first
with no cache-busting on deploy beyond the static path hash. Worth a `CACHE_VERSION` constant
bumped on release, with old caches deleted on `activate`.

### 8. Groq API route has no rate limiting or input bounds
`/api/coach` accepts arbitrary-length strings and forwards them. It's your own deployment, so
the blast radius is your own API bill — but a `maxLength` check on the free-text fields costs
three lines.

---

## Part 3 — As a gym trainee: what this app should do better

This is the half that matters more. The code is in decent shape; the coaching has real gaps.

### What it already does well
Double progression with RIR, layoff detection that backs the weight off when you've been away,
equipment-aware substitution, priority-based trimming when you're short on time, and PR
detection that doesn't celebrate baselines. That's a better progression model than most paid
apps ship.

### Gaps worth closing, roughly in order of training impact

**1. No warm-up set logging.** `WarmupTip` tells you to warm up and `ExerciseSet.isWarmup`
exists in the schema, but nothing writes it. On a heavy compound the warm-up ramp *is* part of
the session — and without it, session duration and calorie estimates are systematically low.

**2. Nothing tracks how you actually felt.** There's per-set RIR and a pain flag, but no
session-level readiness (sleep, soreness, stress, energy). Two identical sessions on 8 hours
versus 4 hours of sleep are not the same session, and right now the progression engine can't
tell them apart. A single 1–5 "how do you feel" tap at session start would let the engine hold
weight instead of pushing on a bad day.

**3. No deload logic.** `progression.ts` handles a layoff and a single bad session, but not the
slow grind: 3–4 weeks of creeping fatigue where every lift technically holds but nothing moves.
Real programs plan a deload every 4–8 weeks. The imported coach plans now include one, but the
engine itself has no concept of it — it can't *trigger* one when your data says you need it.

**4. Stalls aren't surfaced.** The data to detect "this lift hasn't moved in four sessions" now
exists (`collectTrainingHistory` computes it for the coach prompt), but nothing tells you about
it inside the app. That's the single most actionable thing a training log can say.

**5. No supersets.** openGym supports them and they matter here: for a V-shape goal with a
60-minute cap, pairing lateral raises with face pulls buys back 8–10 minutes a session. The
data model would need a `supersetGroup` on `WorkoutDayExercise` and a logging flow that rests
only after the pair.

**6. Bodyweight exercises can't progress.** `stepForLoadType` returns 0 for bodyweight, so
pull-ups and dips can only ever progress by reps and never by added load. Anyone who gets past
12 clean pull-ups needs a weight belt entry.

**7. Cardio is barely modelled.** It's logged as reps-in-minutes with no distance, no speed, no
incline, no heart rate. For a fat-loss or V-taper goal, cardio is half the plan.

**8. Nutrition is a single Groq call at session end.** There's no protein target, no weight-trend
reconciliation ("you're eating at maintenance, and your goal says deficit"). The app knows the
body-weight trend and the goal weight — it could say something useful about the gap and doesn't.

**9. No rest-day or missed-workout awareness in the plan itself.** Rescheduling now works, but
nothing notices "you've trained legs once in three weeks" and offers to fix the week. The
muscle-balance map shows it; nothing acts on it.

**10. Estimated 1RM uses Epley everywhere.** Fine at 5–10 reps, increasingly optimistic above
that. It's correctly capped at 12 reps now, but Brzycki or a formula average would be more
honest in the 8–12 range where most of your sets live.

---

## Part 4 — What was added in this pass

- **Accounts**: email + password, PBKDF2-hashed on-device, multiple accounts per device with a
  fully separate database each. Your existing data became the first account's data untouched.
  Recovery is a documented manual flow (`src/lib/auth/admin-resets.ts`) — the only honest option
  without a server.
- **Plan-gated onboarding**: a new account can't enter the app until ChatGPT has written it a
  program and the app has validated it.
- **AI coach**: goal → intake → generated prompt → paste JSON → validate → auto-improve → apply,
  with a snapshot taken first so applying is always undoable. The improver is the part that
  matters: it resolves every exercise against your real library (fuzzy-matching names), enforces
  weekly volume ranges per muscle, puts compounds first, adds volume to the muscles your goal
  needs, and trims sessions to the time you said you have.
- **Update my plan**: a second prompt built from every lift you've logged — weights, best sets,
  estimated 1RMs, what's stalled, adherence, body-weight trend — so program two is written from
  evidence rather than a second questionnaire.
- **New screens**: profile with lifetime stats, exercise library with search and equipment
  filtering, 1RM + plate calculator, activity heatmap, front/back muscle-balance map, redesigned
  home dashboard with a week strip.
