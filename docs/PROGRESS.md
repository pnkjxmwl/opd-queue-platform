# PROGRESS — Build Log

## OPD Queue Platform

**Location:** this file lives in `docs/`. **Companion docs:** PRD.md · Architecture.md · Rules.md · Phases.md · Design.md

---

## What this file is

An **append-only build log**. Every unit of work done on this project gets an entry here, in order,
with the decisions that were made and *why*. It is the answer to "what has actually been built, and
why is it like this?" when you come back after a break — or when a new agent needs context that the
code alone does not carry.

**Rules for this file:**

1. **Append, never rewrite.** Past entries are history. If a decision is later reversed, write a *new*
   entry that says so and links back — do not edit the old one.
2. **One entry per unit of work** (a subtask, a wave, a phase, or a significant decision).
3. **Decisions get a "why".** A decision without its reasoning is worthless in three months.
4. **Record surprises and dead ends too.** "We tried X, it failed because Y" saves the next attempt.
5. Phase/subtask *status* lives in **Phases.md** (the `☐` boxes and §0 Progress Board). This file holds
   the *narrative*. Don't duplicate the scoreboard here.

**Entry template:**

```markdown
## YYYY-MM-DD — <short title>  ·  <phase/subtask id if any>

**Did:** what changed, concretely.
**Decided:** the choices made, each with a one-line why.
**Surprises:** anything that did not go as the docs predicted. (omit if none)
**Next:** the immediate next step.
```

---

> **New session? Jump to the 📌 HANDOFF section at the very bottom of this file first.**

## Current state (update the one-liner, keep the history below)

> **Where we are:** **Phases 0 and 1 complete** and tagged; ready to start Phase 2 (Hospital Configuration).
> Private repo `pnkjxmwl/opd-queue-platform`, **CI green**. 49 tests (40 api + 9 contracts) incl. the
> 24-case tenant-isolation + IDOR suite. Web auth shell verified end-to-end; mobile verified on a physical
> device (Expo Go, SDK 54) including session persistence across a force-quit.
> One carried gap: `P1-BE-02`'s Google ID-token exchange is implemented but unverified - it needs real
> OAuth client ids in `GOOGLE_CLIENT_IDS`. The local folder still wants renaming to match the project.

---

# Log

## 2026-08-30 — Design docs reviewed end to end · pre-Phase-0

**Did:** Read all five design docs in full — PRD.md, Architecture.md, Rules.md, Phases.md, Design.md —
plus the source `Chats.txt`. Confirmed they are internally consistent and that Phases.md is a complete,
buildable decomposition of the PRD.

**Decided:**
- **Build in dependency order straight from Phases.md**, starting at Phase 0. No re-planning — the plan
  is sound and re-deriving it would waste the design work already done.
- **The monorepo root is `C:\Projects\New folder` itself**, with the design docs living at the repo root
  next to `apps/` and `packages/`. Why: Phases.md and Rules.md tell every agent to read `Rules.md`,
  `Phases.md`, `Architecture.md` by name at the repo root, and `CLAUDE.md` must sit at the root to
  auto-load. Nesting the code in a subfolder would break those references for no benefit.

**Surprises:** none — the docs were more complete than expected. Architecture.md §4/§5 gave the exact
directory layout and data model, so Phase 0 needs no invention.

**Next:** upgrade Phases.md with the execution detail needed to actually drive the build.

---

## 2026-08-30 — Phases.md upgraded v3 → v4 (execution kit + tracking)

**Did:** Reviewed Phases.md for gaps and added ~640 lines across every phase. Specifically:
- **§0 Progress Board** — per-phase checkbox, size (S/M/L/XL), focused-day estimate, parallel-agent
  count, git tag. Plus a Definition-of-Ready entry gate.
- **§A.8 kickoff protocol** — the five things every agent prompt must carry, a copy-paste template, and
  the rules for launching (one agent per directory, worktree isolation, cap fan-out at what you can review).
- **§A.9 rollback & recovery conventions** — tag every phase, disposable agent branches, never edit a
  merged migration, append-only tables, expand-then-contract after Phase 10.
- **Per phase (0–10):** a `🤖 Agent kickoff` section with concrete per-wave agent briefs, a
  `⚠️ Risks & pitfalls` section, and an `↩️ If it goes wrong` note. Plus `Size:`/`Status:` headers.
- **`☐` checkbox on all 89 subtask rows**, and **Appendix 6 — Phase sign-off log**.
- **New subtask `P0-DOC-01`** — seed `CLAUDE.md` from Rules.md, in Wave 1, before any other agent runs.

**Decided:**
- **Estimates are in "focused days", not calendar days** (~47–66 for the MVP, ~4–5 months calendar at
  3–4 productive days/week). Why: the honest bottleneck for a solo dev driving agents is *review time*,
  which does not parallelize; quoting calendar days would flatter the plan and mislead planning.
- **`CLAUDE.md` is a Phase 0 Wave 1 blocker, not a nice-to-have.** Why: Rules.md §14/§15 only bind agents
  if they auto-load. Without it every launched agent starts unguarded and the rules get re-explained forever.
- **Post-MVP phases 11–13 left thin, deliberately.** Why: detailing work that is 4+ months out and will be
  reshaped by pilot feedback is speculative — YAGNI.

**Next:** install the requested tooling, then start Phase 0 Wave 1.

---

## 2026-08-30 — Toolchain setup + ponytail plugin · P0 prerequisites

**Did:**
- Verified environment: Node v24.16.0, Docker 29.4.3, git 2.54.0. `pnpm` was **not** installed.
- Installed **pnpm 9.15.4** globally via `npm i -g pnpm` and verified it resolves on `PATH`.
- `git init` on the project root, branch `main`, user identity configured.
- Inspected and added the **ponytail** plugin marketplace (`DietrichGebert/ponytail`) at the user's request.

**Decided:**
- **Used `npm i -g pnpm` instead of `corepack enable`.** Why: `corepack enable` needs write access to
  `C:\Program Files\nodejs` and failed with `EPERM`. npm's global prefix is under `AppData\Roaming\npm`,
  which is user-writable, and it yields a plain `pnpm` command rather than a `corepack pnpm` prefix.
- **Pinned pnpm to 9.15.4** rather than `latest`. Why: the lockfile format is tied to the major version;
  a floating version means a future `pnpm install` can silently rewrite the lockfile.
- **Audited the ponytail plugin's source before installing it.** Why: it registers `SessionStart`,
  `SubagentStart` and `UserPromptSubmit` hooks that execute Node scripts on every session. Verified the
  hook scripts use only `fs`/`path`/`os`, make no network calls, and never shell out — safe.

**Surprises:**
- `claude plugin install ponytail@ponytail` was **blocked by the permission classifier**. The marketplace
  is registered but the install itself must be run by the user (`/plugin install ponytail@ponytail`).
- The plugin was not findable by name at first because it is a **third-party marketplace plugin**, not a
  built-in skill — the install lines were in the last two lines of `Chats.txt`.

**Next:** Phase 0 Wave 1 — `P0-INFRA-01` (monorepo scaffold) + `P0-DOC-01` (CLAUDE.md).

---

## 2026-08-30 — Phase 0 Wave 1: monorepo scaffold + CLAUDE.md · P0-INFRA-01, P0-DOC-01

**Did:** Created the repo root: `package.json` (pnpm workspaces + turbo scripts), `pnpm-workspace.yaml`,
`turbo.json`, `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`), `.gitignore`, `.editorconfig`,
`.npmrc`, `docker-compose.yml`. Wrote `CLAUDE.md` — 12 sections distilled from Rules.md, so every agent
launched in this repo auto-loads the guardrails.

**Decided:**
- **`tsconfig.base.json` lives at the repo root; `packages/config` holds only eslint + prettier.** Why:
  Phases.md `P0-CFG-01` lists all three in `packages/config`, but apps extending
  `../../tsconfig.base.json` is a plain relative path that works before anything is installed, whereas
  `@opd/config/tsconfig.json` needs the workspace resolved first. One base config, one location, no duplication.
- **Postgres on 5433 and Redis on 6380, not the defaults.** Why: Phases.md flags 5432 as commonly bound on
  Windows dev machines. Choosing non-default ports up front is cheaper than debugging "connection refused".

---

## 2026-08-30 — Phase 0 Wave 2: contracts, config, database · P0-CFG-01, P0-CONTRACT-01, P0-DB-01

**Did:**
- `packages/config`: shared ESLint flat config (with `no-empty` / `allowEmptyCatch: false` to enforce
  Rules.md §7's "no swallowed errors") and a Prettier config.
- `packages/contracts`: `QueueEntryStatus` (all 12 states), the `ApiError` envelope + `ErrorCode` enum, and
  `HealthResponse` / `ReadinessResponse`. Zod schemas with types inferred from them, per Rules.md §6.
- `apps/api/prisma/schema.prisma`: the six Phase-0 models — `Account`, `Patient`, `Hospital`,
  `HospitalStaff`, `Department`, `Doctor` — plus the `Gender`, `PatientRelation`, `HospitalStatus`,
  `StaffRole` and `StaffStatus` enums. Every tenant-scoped table carries an indexed `hospitalId`.
- Ran the first migration (`init`) and confirmed all six tables exist in Postgres.

**Decided:**
- **Seeded `ErrorCode` with the four domain codes Rules.md §7 names by example**
  (`INVALID_QUEUE_TRANSITION`, `NOT_CHECKED_IN`, `TENANT_MISMATCH`, `PAYMENT_NOT_VERIFIED`) even though
  their phases are later. Why: the alternative is each future agent inventing its own spelling of the same
  code — exactly the contract drift Rules.md §15.3 exists to prevent. Cost: one line each.
- **Prisma schema strictly limited to the six Phase-0 models.** Why: Rules.md §15.8 — no pulling Phase 2/4
  work forward. `QueueEntry`, `OPDSession` and `Payment` belong to their own phases' Wave 1.
- **DB-level uniqueness, not application checks:** `unique([hospitalId, accountId])` on `HospitalStaff`,
  `unique([hospitalId, name])` on `Department`. Why: Rules.md §5 — application checks lose races.

---

## 2026-08-30 — Phase 0 Wave 3: three apps + verification · P0-BE-01, P0-WEB-01, P0-MOB-01

**Did:**
- **`apps/api`** — NestJS with Zod env validation that refuses to boot on bad config, pino structured
  logging with request ids and credential redaction, a global exception filter producing the one canonical
  error shape, `PrismaService` / `RedisService` with reachability probes, and `/health` + `/health/ready`.
- **`apps/web`** — Next.js App Router with the full Design.md palette, type scale, radii and shadows
  transcribed into `tailwind.config.ts`, plus a placeholder page.
- **`apps/mobile`** — Expo Router app with `theme.ts` (the RN mirror of the Tailwind theme) and a
  monorepo-aware `metro.config.js`.
- **CI** — `.github/workflows/ci.yml`: Postgres + Redis service containers, then
  install → prisma generate → lint → typecheck → test → build.

**Verified by running it, not by assuming:**
- `GET /health` → `200 {"status":"ok","uptimeSec":N}`
- `GET /health/ready` → `200 {"status":"ok","checks":{"database":"up","redis":"up"}}`
- **`docker compose stop postgres` → `/health/ready` returns `503 {"status":"degraded", database:"down"}`
  while `/health` stays `200`** — the exact done-when Phases.md specifies for `P0-BE-01`.
- `GET /nope` → `404` in the canonical envelope, carrying a `requestId`.
- Web renders on :3001, and the compiled CSS contains `14 124 123` (#0E7C7B), `20 184 166` (#14B8A6) and
  `247 250 252` (#F7FAFC) — the Design.md tokens are genuinely applied, not merely configured.
- `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` — **all 5/5 tasks green.**

**Decided:**
- **Vitest, not Jest, as the test runner.** Why: Rules.md §2 names no test runner, and Vitest runs
  TypeScript directly with no `ts-jest` transform config to maintain. See the caveat below.
- **Nest CLI (`nest build` / `nest start --watch`) instead of `tsx`.** Forced — see surprise 1.
- **The exception filter is registered via `APP_FILTER` in the module, not `app.useGlobalFilters()`.**
  Why: `nestjs-pino`'s `PinoLogger` is transient-scoped, so `app.get(PinoLogger)` throws at boot.
- **The filter uses `@nestjs/common`'s `Logger`, not an injected `PinoLogger`.** Why: `main.ts` already
  routes the global logger into pino via `app.useLogger()`, so the plain Logger reaches pino anyway —
  without any scoped-injection complexity.
- **Design tokens are deliberately duplicated** across `apps/web/tailwind.config.ts` and
  `apps/mobile/theme.ts`, each commented to point at the other. Why: a shared `packages/design` is not in
  the locked Architecture.md §4 layout, and inventing a package to avoid duplicating ~40 constants is not
  worth deviating from it. **Trigger to revisit:** the first time the two drift and cause a visible bug.

**Surprises — three real failures, each caught only by actually running things:**

1. **`tsx` silently breaks NestJS dependency injection.** `this.prisma` was `undefined` at runtime, with a
   misleading `Cannot read properties of undefined` error pointing at the controller. Cause: `tsx` uses
   esbuild, and **esbuild does not implement `emitDecoratorMetadata`**, so Nest has no constructor
   parameter types to resolve. `tsc` (the build path) was correct the entire time — only dev mode was
   broken, which is why the build passed while the server failed. Fixed by moving to the Nest CLI, which
   compiles with `tsc`. **This cost more time than anything else in Phase 0.**

2. **`node-linker=hoisted` broke the web build.** It was set initially on Phases.md's advice that Metro
   struggles with pnpm symlinks. But hoisting forces **one** React across the whole repo, and `apps/web`
   needs React 19 (Next 15 App Router) while `apps/mobile` is pinned to React 18.3.1 by Expo SDK 52.
   Next's prerender died with `Cannot read properties of null (reading 'useRef')` — the classic
   mismatched-React symptom. **Reverted to pnpm's default isolated linking**, leaving the monorepo
   `metro.config.js` (`watchFolders` + `nodeModulesPaths` + `disableHierarchicalLookup`) to solve the
   Metro problem instead. Both apps now build.

3. **`eslint .` fails on generated files.** An empty `lib/` made ESLint error on an unmatched pattern, and
   Next's generated `next-env.d.ts` trips `@typescript-eslint/triple-slash-reference`. Both now ignored.

> ### ⚠️ Known issue — read before writing integration tests in Phase 2/4
> **Vitest uses esbuild, so it carries the *same* `emitDecoratorMetadata` gap that broke `tsx` above.**
> Pure unit tests are unaffected — and the Phase-4 state machine and ETA engine are deliberately pure
> functions (Rules.md §4), so they will be fine. But the moment a test builds a Nest module with DI
> (`Test.createTestingModule(...)`), it will fail exactly the same way.
> **Fix when you get there:** add `unplugin-swc` to `apps/api/vitest.config.ts`.
> Do not lose a day rediscovering this.

**Next:** verify the Expo app on a real device, then push to a GitHub remote to prove CI green. Those two
close Phase 0's integration checkpoint; then Phase 1 (Identity & Tenancy) can start — beginning with its
Wave 1 contract + schema, which blocks everything else in that phase.

---

## 2026-08-30 — Docs moved into `docs/` · housekeeping

**Did:** Moved `PRD.md`, `Architecture.md`, `Rules.md`, `Phases.md`, `Design.md` and `PROGRESS.md` into
`docs/`. Rewrote every cross-reference that pointed at the old root paths: 15 files (code comments in
`apps/*` and `packages/*`, `.gitignore`, `.env.example`, and `CLAUDE.md`'s doc index), plus the two
`READ FIRST:` lines in the Phases.md agent-kickoff prompts.

**Decided:**
- **`CLAUDE.md` stays at the repo root — it is deliberately NOT in `docs/`.** Why: Claude Code only
  auto-loads `CLAUDE.md` from the project root. In `docs/` it would silently stop loading, and every agent
  launched afterwards would run without the guardrails — with no error to reveal it. This is the one file
  that cannot be tidied away.
- **Left the `Companion docs:` header lines inside each doc as bare filenames** (`PRD.md`, not
  `docs/PRD.md`). Why: those docs are now siblings in `docs/`, so bare names still resolve correctly.
  Only references from *outside* `docs/` needed rewriting — smallest correct diff.
- **Rewrote the `READ FIRST:` lines in the agent-kickoff prompts to `docs/…` paths.** Why: unlike the
  companion-doc headers, those are instructions handed to agents that start at the repo root, so a bare
  `Rules.md` would send them looking in the wrong place.
- **`Chats.txt` left at the repo root.** It is the raw ChatGPT design transcript, not a maintained doc.
  Move it to `docs/` too if the bare root matters more than the distinction.

---

## 2026-08-30 — Regression fixed: two `@types/react` in one program · follow-up to the hoisting revert

**What broke:** `pnpm --filter @opd/mobile typecheck` failed with `TS2786: 'Stack' cannot be used as a JSX
component`, ending in `Type 'bigint' is not assignable to type 'ReactNode'` — the signature of **two
different `@types/react` copies in one program**.

**Why it was mine:** switching from `node-linker=hoisted` to pnpm's isolated layout (see the Phase 0 Wave 3
entry) is what let two React typings coexist. Under hoisting, one version won globally and this could not
happen.

**Why it surfaced late — the more useful lesson:** **Turbo cached the passing result from before the
linking change.** The suite reported `5 successful` with `3 cached`, and the mobile typecheck inside that
count never actually re-ran against the new layout. The green tick was reporting history, not the present.
**Any time the dependency layout changes, re-run with `turbo run … --force` before believing a green
result.** The final verification for this work was `turbo run lint typecheck test build --force` →
**16/16 successful, 0 cached.**

**Root cause:** pnpm hoists a single `@types/react` into its hidden store directory
(`node_modules/.pnpm/node_modules/`). Packages *inside* the store — `@react-navigation/native-stack`,
reached via `expo-router` — resolve their React typings from there and got **19.2.18** (pulled in by
`apps/web`/Next 15), while `apps/mobile` itself compiled against its own **18.3.31** (Expo SDK 52).

**Fixed by** pinning the `react` type specifier in `apps/mobile/tsconfig.json` `paths`
(`react`, `react/jsx-runtime`, `react/jsx-dev-runtime` → `./node_modules/@types/react`), which forces one
React typing across the whole program regardless of how the store is laid out.

**Rejected alternatives, and why:**
- **`hoist-pattern[]=!@types/react` in `.npmrc`** — tried it; the negation did not remove the package from
  the hidden hoist dir, and the reinstall it forced took over 10 minutes. Reverted so no dead config is
  left behind pretending to do something.
- **A repo-wide `pnpm.overrides` pin of `@types/react`** — rejected: there is no single correct version.
  `apps/web` genuinely needs 19 and `apps/mobile` genuinely needs 18; forcing either breaks the other.
- **Reverting to `node_modules` hoisting** — rejected: that is what broke the web build in Phase 0.

**Known cosmetic issue (not fixed):** every build prints
`WARNING no output files found for task @opd/mobile#build`, because mobile's `build` script is a
placeholder (it ships via EAS in Phase 10) while `turbo.json` declares build outputs globally. Silence it
when convenient with an `apps/mobile/turbo.json` containing
`{ "extends": ["//"], "tasks": { "build": { "outputs": [] } } }`.

**Next:** unchanged — verify the Expo app on a real device, then push to a GitHub remote to prove CI green.
Those two close Phase 0's integration checkpoint.

---

## 2026-08-30 — The build log became a rule · docs/Rules.md §16

**Did:** Added **§16 "Build Log"** to `docs/Rules.md` — six numbered rules making PROGRESS.md updates a
project obligation rather than a good habit. Added a matching bullet to §14's "Should" list, added
PROGRESS.md to the companion-docs header, and promoted the rule in `CLAUDE.md` out of a trailing clause in
a run-on list into its own **"Build log — not optional"** paragraph beside the Git rules.

**Decided:**
- **Made it a numbered section, not just a bullet.** Why: a bare "append to PROGRESS.md" says nothing about
  *when* or *what*, so it gets complied with badly or skipped. §16 pins down the trigger (finishing a unit
  of work), the minimum content (the decision, its why, and the rejected alternatives), and append-only.
- **§16 deliberately does not restate the entry template** — it points at the template at the top of this
  file. Why: Rules.md §6 is itself a single-source-of-truth rule; duplicating the format across two files
  guarantees they drift apart.
- **Explicitly required recording failures and dead ends, not just successes.** Why: this session proved
  the point twice over. The `tsx` decorator-metadata trap and the stale-turbo-cache `@types/react`
  regression are the two entries most likely to save real time later, and neither leaves any trace in a
  diff or a commit message.
- **Mirrored the rule into `CLAUDE.md` rather than only citing Rules.md.** Why: CLAUDE.md is what actually
  auto-loads into every agent's context. A rule that lives only in a doc an agent has to remember to open
  is a rule that gets followed inconsistently.

**Next:** unchanged — verify the Expo app on a device, and push to a GitHub remote to prove CI green.
Those two close Phase 0's integration checkpoint.

---

## 2026-08-30 — Phase 1 Wave 1: auth contracts + refresh-token store · P1-CONTRACT-01, P1-DB-01

**Did:**
- `packages/contracts`: `auth/dto.ts` (Signup/Login/GoogleAuth/Refresh/Logout/AuthTokens/
  HospitalMembership/MeResponse), `patients/dto.ts` (Patient + Create/Update), `enums/staff.ts`
  (`Role`, `StaffStatus`), `enums/patient.ts` (`Gender`, `PatientRelation`). Added `INVALID_CREDENTIALS`
  and `EMAIL_ALREADY_REGISTERED` to `ErrorCode`.
- `apps/api/prisma`: new `RefreshToken` model (`familyId`, unique `tokenHash`, `expiresAt`, `revokedAt`)
  + migration `auth_refresh_tokens`. `Account` auth fields and `HospitalStaff(role, permissions)` already
  existed from Phase 0, so no change was needed there.

**Decided:**
- **Only the SHA-256 of a refresh token is stored, never the token.** Why: a database leak must not hand
  the attacker usable sessions. Access tokens are stateless JWTs and are not stored at all.
- **Refresh tokens carry a `familyId`.** Why: it is what makes reuse detection possible — see the Wave 2
  entry. A flat token table cannot distinguish "leaked and replayed" from "just old".
- **Password policy is length-only (min 10), no character-class rule.** Why: length is what actually
  resists guessing; composition rules push users toward predictable substitutions (`P@ssw0rd!`).
- **Skipped the `Permission` enum that P1-CONTRACT-01 asks for.** No Phase-1 endpoint checks a permission —
  authorization is role-based, and `HospitalStaff.permissions` already exists in the schema as the escape
  hatch. Defining ten permission values that nothing reads is the speculative contract Rules.md §15.3
  warns about. **Add when the first command needs finer-grained authz than a role**, at which point that
  phase adds only the values it actually checks.
- **Two distinct auth error codes rather than reusing `CONFLICT`/`UNAUTHORIZED`.** Why: the client needs
  to say "that email is already registered" versus "wrong password" — a generic code forces the UI to
  match on message strings, which is exactly what stable codes exist to prevent.

---

## 2026-08-30 — Phase 1 Wave 2: auth, guards, patients · P1-BE-01 … P1-BE-04

**Did:**
- **`TokenService`** — issue / rotate / revoke. Rotation revokes the presented token and mints a successor
  in the same family.
- **`AuthService`** — Argon2id signup, login, Google ID-token exchange, `/me` with hospital memberships.
- **Three global guards** — `JwtGuard` (opt out with `@Public()`), `TenantGuard`, `RolesGuard`, registered
  via `APP_GUARD` in that order.
- **`PatientsService`/`Controller`** — account-scoped family-profile CRUD.
- **`ZodBody` pipe** — validates against the shared contract schemas and reports through our error envelope.
- Explicit `.env` loading via Node's built-in `process.loadEnvFile()`.

**Decided:**
- **Refresh-token reuse revokes the entire family, not just the replayed token.** Why: a token that is
  presented after it was already consumed has leaked. Revoking only that row leaves the *attacker's*
  freshly-minted token valid — the victim gets logged out and the attacker keeps the session, which is
  precisely backwards. There is a test for this.
- **`TenantGuard` is global and keys off the `:hospitalId` route parameter**, rather than a per-controller
  decorator. Why: this is the single highest-consequence design choice in the phase. A decorator must be
  *remembered* on every future hospital-scoped route, and the failure mode of forgetting once is a
  cross-hospital data leak with no error to reveal it. Keyed off the route parameter, every such route
  added in any later phase is scoped by construction. Rejected the decorator approach for that reason.
- **Cross-tenant access returns 403 `TENANT_MISMATCH` for both "not your hospital" and "no such hospital".**
  Why: a 404-vs-403 difference is an enumeration oracle for which hospital ids exist. Tested explicitly.
- **`PatientsService` puts `accountId` in the `WHERE` clause and uses `updateMany`/`deleteMany`.** Why:
  the natural `update({ where: { id } })` would edit another account's row. There is deliberately no
  fetch-then-check pattern anywhere — a wrong id simply matches nothing and 404s, which also avoids
  leaking that the record exists.
- **Login returns an identical error for "no such email" and "wrong password".** Why: any difference turns
  the endpoint into an account-enumeration oracle. Tested by comparing the two responses field by field.
- **Google-only accounts cannot be logged into by password** (`passwordHash` is null → reject). Tested.

**Deviations from Rules.md §2 — flagged deliberately, not accidents:**
1. **`google-auth-library` instead of Passport for Google.** Rules.md names Passport, but
   `passport-google-oauth20` implements the *browser redirect* flow. Our contract is
   `POST /auth/google { idToken }` — a native client obtains the ID token and exchanges it. That is
   `verifyIdToken()`, three lines, versus a strategy plus redirect handling we would never use. Passport
   is the wrong tool here, not merely the bigger one.
2. **A 15-line `ZodBody` pipe instead of `nestjs-zod`.** Our schemas are plain Zod in `packages/contracts`
   and our error envelope is custom, so `nestjs-zod`'s main contributions (`createZodDto`, Swagger
   integration) are unused and its error output would need overriding anyway.
3. **`/me` lives in the auth module, not a separate `accounts` module** as Architecture.md §4.1 sketches.
   One endpoint does not earn a module. Split it out when accounts grow real behaviour.

Say the word if you want any of these three reverted to the letter of the doc.

---

## 2026-08-30 — Phase 1 Wave 3: the security suite · P1-TEST-01

**Did:** 24 integration tests in `apps/api/test/tenant-isolation.e2e.test.ts` plus 8 auth-flow tests in
`auth.e2e.test.ts`, running against real Postgres through the full HTTP stack (supertest + the real guard
pipeline). **38 tests pass** across the three api test files.

Coverage is every endpoint introduced in Phases 0–1, not a sample: cross-hospital access (6 cases),
cross-account IDOR on `/patients` (4), unauthenticated and garbage-token rejection for all 6 guarded
routes (12), tampered tokens, and health staying public.

**Decided:**
- **A test-only `TenantProbeController` mounted in the testing module.** Phase 1 introduces no real
  hospital-scoped route — those arrive in Phase 2 — so without a probe the global `TenantGuard` would ship
  completely unverified until then. The probe echoes the resolved tenant, so a guard that ever failed open
  would return another hospital's context and fail the test.
- **Tests run against the development database and `TRUNCATE` between cases**, guarded by a check that
  refuses to run against a non-local URL or `NODE_ENV=production`. Why: local dev data is regenerable, so
  the cost of the shortcut is a re-seed. Marked with a `ponytail:` comment naming the upgrade path — give
  the suite its own database once seed data becomes expensive to rebuild. Rejected building a separate
  test database now: it needs its own creation and migration step, and on Windows an env-var-prefixed
  script needs `cross-env`, which is three moving parts to solve a problem we do not have yet.

**Surprises — five failures, four of them real bugs the suite caught:**

1. **Making `JwtGuard` global broke `/health` — it returned 401.** This is the most valuable catch of the
   phase: in production the orchestrator's liveness probe has no credentials, reads 401 as unhealthy, and
   *kills the service*. Phase 0's health endpoints were silently broken the moment Phase 1's auth landed.
   Fixed with `@Public()` on the health controller.
2. **`Nest can't resolve dependencies of the JwtGuard`.** A global guard resolves in the AppModule context,
   but `JwtService` was scoped to AuthModule. Fixed with `JwtModule.register({ global: true })`.
3. **`apps/web` typecheck failed on a clean tree** — `next-env.d.ts` triple-slash-references
   `.next/types/validator.ts`, which only `next build` generates. It had been passing purely because a
   previous build left the directory behind. Fixed with an `apps/web/turbo.json` making `typecheck` depend
   on that package's own `build`. Same class of latent failure as the Phase-0 cache incident: green because
   of leftover state, not because it worked.
4. **The shared ESLint `no-unused-vars` rule rejected `const { omitted, ...rest } = obj`.** Fixed centrally
   in `packages/config` with `ignoreRestSiblings` + `varsIgnorePattern`, and `apps/api`'s lint script now
   covers `test/` as well as `src/` — it had been linting only half the code.
5. **`@nestjs/testing` was simply missing** from devDependencies.

**The Phase-0 prediction paid off:** the `unplugin-swc` note left at the end of Phase 0 was needed exactly
as written. Vitest's esbuild does not emit decorator metadata, so `Test.createTestingModule` resolves every
constructor param as `undefined`. Adding the plugin was a two-minute fix because the diagnosis was already
written down — this is the concrete return on Rules.md §16.

**Verification:** `turbo run lint typecheck test build --force` → **16/16 tasks, 0 cached**. Plus a manual
smoke test against `nest start` (not just the testing module, since Phase 0 proved those runtimes differ):
signup → `/me` → auto-created SELF profile → add family member → 401 without a token → refresh → **replay
of the consumed refresh token correctly returns "reuse detected; session revoked"** → `/health` still public.

**NOT done in this phase — deliberately, and not blocked:**
- **`P1-WEB-01`** (web auth shell) and **`P1-MOB-01` / `P1-MOB-02`** (mobile auth + family screens) are not
  started. The backend they consume is finished and frozen, so both are unblocked and can proceed in
  parallel against the contract.
- **`P1-BE-02` is half-verified.** `/me` is done and tested; the Google ID-token exchange is implemented
  and wired but **never verified against a real Google token** — `GOOGLE_CLIENT_IDS` is empty, and the only
  test asserts that the endpoint refuses cleanly when unconfigured. It needs real iOS/Android/web client
  ids to be called done.

**Next:** either finish Phase 1's clients (WEB-01, MOB-01/02) or start Phase 2 (hospital configuration),
whose Wave 1 `QueuePolicy` shape is the input to the entire Phase-4 queue engine and deserves a careful
review before merging.

---

## 2026-08-30 — Phase 1 clients: web auth shell + mobile auth & family profiles · P1-WEB-01, P1-MOB-01, P1-MOB-02

**Did:**
- **`apps/web`** — `/login` page, `/api/auth/{login,logout}` route handlers, `middleware.ts` (route
  protection + silent refresh), role-aware `(console)` layout reading `/me`, overview page, logout button.
- **`apps/mobile`** — `lib/auth.tsx` (SecureStore-backed session + `authedFetch` with refresh-on-401),
  `lib/ui.tsx` (Field/Button/ErrorNote from Design.md tokens), an auth gate in `_layout.tsx`,
  `(auth)/login` + `(auth)/signup`, `(app)/index` home, and `(app)/patients` full family-profile CRUD
  via TanStack Query.

**Decided:**
- **Web tokens never reach the browser.** The page posts to a Next route handler, which calls the API and
  writes the tokens into **httpOnly** cookies (docs/Rules.md §10). Verified two `HttpOnly` cookies are set.
  Rejected storing the access token in memory/localStorage in a client component: an XSS payload on the
  console could then exfiltrate a live staff session.
- **Token refresh lives in `middleware.ts`.** Why: middleware is the only place in the App Router that can
  both read cookies and *write* them during an ordinary navigation — a server component can read but not
  set. Without this, every console session would hard-expire after `JWT_ACCESS_TTL_SEC` (15 min) and bounce
  the user to /login mid-task.
- **Middleware decodes the JWT `exp` without verifying the signature.** Verification is the API's job and
  middleware only needs to decide whether refreshing is worthwhile; a forged token is rejected by the API on
  the very next call. Rejected verifying in middleware: it would mean shipping the JWT secret to the edge
  runtime for no security gain.
- **Login navigates with `window.location.href`, not `router.push`.** A client-side push does not re-run
  middleware, so the new cookies would not be picked up until a later hard navigation.
- **`?next=` is validated with `startsWith('/')`.** Without it, `?next=https://evil.com` turns our own login
  page into an open redirect.
- **The role-aware nav is explicitly *not* the security boundary.** It hides links the caller's role cannot
  use, and the layout says so in a comment, because the API authorizes every request against the membership
  regardless of what the client renders.
- **Mobile keeps tokens in `expo-secure-store`** (OS keychain/keystore), never AsyncStorage, and shows a
  spinner until the keychain read resolves — otherwise already-signed-in users get a flash of the login
  screen on every launch.
- **Mobile `authedFetch` refreshes once on 401, then signs out if that fails.** A failed refresh means the
  session is genuinely dead or was revoked for reuse, so continuing to retry would loop.

**Surprises — three real resolution failures, all from pnpm's isolated layout meeting Metro:**

1. **`@expo/metro-runtime` could not be resolved.** Caused by `disableHierarchicalLookup: true`, which I had
   copied into `metro.config.js` during Phase 0. That setting is advice for **hoisted** monorepos; under
   pnpm's isolated layout transitive deps live only in their parent's nested `node_modules`, and Metro must
   be allowed to walk into them. Removed it.
2. **`@babel/runtime/helpers/interopRequireDefault` could not be resolved.** A phantom dependency:
   `babel-preset-expo` emits requires for it, but it is not a direct dep of `apps/mobile`, and pnpm does not
   expose transitives. Fixed by declaring `@babel/runtime` and `@expo/metro-runtime` explicitly — the
   documented pnpm+Expo approach, and more honest than relying on lookup luck.
3. **Metro resolved the runtime `react` import to `@types/react`** and died on a package with no JS. This is
   the most interesting one: **two of my own fixes collided.** The tsconfig `paths` mapping added earlier to
   resolve the @types/react 18-vs-19 conflict was being honored by Metro, because Expo enables
   `experiments.tsconfigPaths` by default. Fixed by setting `tsconfigPaths: false` in `app.json`, scoping
   that mapping to type-checking only, with a comment on both files pointing at each other. We use no
   runtime path aliases, so nothing is lost.

**Verification:**
- **Web, end to end against the real API:** `GET /` with no session → `307` to `/login?next=%2F` · wrong
  password → `401 INVALID_CREDENTIALS` (the API's envelope passed straight through) · correct password →
  `200` with **two HttpOnly cookies** · `GET /` with the session → console renders the hospital name, the
  `ADMIN` role, the role-gated *Configuration* link, and the signed-in email.
- **Mobile:** `expo export --platform android` produces a **2.66 MB Hermes bundle**. This proves Metro
  resolves the whole graph including the `@opd/contracts` workspace package — the failure mode Phases.md
  called Phase 0's "#1 time sink". It does **not** prove runtime behaviour.
- `turbo run lint typecheck test build --force` → **16/16 tasks, 0 cached.**

**Still outstanding on Phase 1:**
- **`P1-MOB-01` / `P1-MOB-02` need one device session.** The code is complete and bundles, but
  "login persists across restart" and "add Father → persists" are only provable on a real device or
  simulator. Run `pnpm --filter @opd/mobile dev`; set `EXPO_PUBLIC_API_URL` to `http://10.0.2.2:3000`
  on an Android emulator or your LAN IP on a physical device, because `localhost` there is the phone.
- **`P1-BE-02` Google exchange remains unverified** — needs real client ids in `GOOGLE_CLIENT_IDS`.

**Also fixed along the way:** `apps/mobile`'s lint script was only covering `app/`, missing the new `lib/`
entirely — now `eslint .`, matching the same fix made to `apps/api` earlier.

---

## 2026-08-30 — Full review of everything built so far (Phases 0–1)

A deliberate audit before starting Phase 2, rather than a code change. **Three real defects found and
fixed; three trade-offs confirmed as accepted debt.** Everything else held up.

### Defects found and fixed

**1. Refresh-token rotation was not atomic — the most serious finding.**
`TokenService.rotate` did read-then-write: `findUnique` → check `revokedAt` → `update`. Two concurrent
refreshes with the same token would *both* pass the check and *both* mint a successor. Two consequences,
the second worse than the first: the account ends up with two live sessions in one family, and **genuine
token replay stops being detectable**, because neither request observes the other's revocation — exactly
the attack the family design exists to catch. Replaced with a single conditional `UPDATE`
(`updateMany where { tokenHash, revokedAt: null }`) so exactly one caller can ever claim a token; a
`count` of 0 now means "already consumed" and revokes the family. Regression test fires two refreshes with
`Promise.all` and asserts the statuses are exactly `[200, 401]` — it would have read `[200, 200]` before.

**2. A comment documented a validation that did not exist.** `CreatePatientRequest.dob` carried
`/** Rejected if in the future - a patient cannot be born tomorrow. */` above a plain
`z.string().datetime()`. Nothing rejected future dates. This is the worst kind of comment: a future reader
(or agent) trusts it and does not add the check. Implemented the `.refine()`, plus a test asserting a
tomorrow-dated `dob` is a 400 and a 2015 one is a 201.

**3. `pnpm seed` at the repo root was a broken command** — it delegated to `@opd/api seed`, a script that
does not exist (the tsx-based one was dropped when the API moved to the Nest CLI in Phase 0). Removed the
root alias; `P2-BE-06` reinstates it together with the actual seed file. A command that only fails is worse
than a missing one.

### Confirmed as accepted debt, not bugs

- **Expired/revoked `RefreshToken` rows are never cleaned up.** The table grows monotonically. Harmless at
  pilot scale and correctness is unaffected (expiry is checked on use). Belongs with the Phase-8 background
  workers, where a scheduled job already fits the design.
- **`GET /patients` is unbounded**, against Rules.md §6 "paginate list endpoints; never return unbounded
  lists". Family profiles are bounded by the size of a human family, so pagination would add UI and
  contract surface for perhaps five rows. **Recorded as a conscious deviation** — but the rule stands for
  every genuinely open-ended list (sessions, queue entries, reports), where it must be honoured.
- **The Google first-login race** already carried a `ponytail:` marker naming the ceiling and the fix.

### Checked and clean

- **Secret hygiene.** `apps/api/.env` and `apps/web/.env.local` are gitignored and carry real generated
  secrets; both `.env.example` files contain placeholders only. Nothing sensitive is tracked.
- **Guard coverage.** Every `/auth/*` route is explicitly `@Public()`; `/me` and all of `/patients` are
  not. Health is `@Public()` (fixed during Phase 1 after the suite caught it returning 401).
- **No stray `TODO`/`FIXME`** anywhere in app or package source.
- **Password policy asymmetry is correct**: signup enforces min length, login accepts `min(1)` — so the
  login endpoint does not leak the policy or hint at which half of the credential pair was wrong.
- **Web open-redirect** is closed (`?next=` must start with `/`).
- **Tenant isolation** is proven by 24 tests, including the 403-vs-404 enumeration check.

### State at the end of the review

`turbo run lint typecheck test build --force` → **16/16 tasks, 0 cached**. **40 tests passing.**

**Verdict: good to move forward to Phase 2.** The one thing I would not carry further unexamined is the
pagination deviation above — Phase 2 introduces the first genuinely unbounded lists (departments, doctors,
schedules, sessions), and those must paginate.

**Still open, unchanged by this review:** mobile needs one device session (`P0-MOB-01`, `P1-MOB-01/02`),
CI needs a GitHub remote to prove green (`P0-INFRA-02`), and the Google ID-token exchange needs real client
ids (`P1-BE-02`).

---

## 2026-08-30 — Pushed to GitHub; CI proven green · P0-INFRA-02

**Did:** Named the project **`opd-queue-platform`** (root `package.json` + Architecture.md §4), committed
everything in two logical commits, installed the GitHub CLI, and pushed to a **private** repo at
`pnkjxmwl/opd-queue-platform`. Then fixed two failures the first CI runs exposed and got a green run.

**Decided:**
- **Two commits, not a fabricated per-phase history.** Phases 0 and 1 were developed together with no
  meaningful intermediate states to reconstruct, and the files interleave (e.g. `app.module.ts` changed in
  both). Split by the one boundary that is real and clean: `docs: …` (docs + CLAUDE.md + the source
  transcript) and `feat: …` (all code). Inventing a granular history would have been fiction.
- **Added `.gitattributes` with `* text=auto eol=lf` before committing any code.** Git warned on the first
  commit that it would rewrite LF→CRLF. Without normalisation, a Windows checkout commits CRLF, CI on
  Ubuntu sees every file as fully rewritten, and diffs become useless.
- **No `phase-0-done` / `phase-1-done` tags yet.** §A.9 says tag when the *integration checkpoint* passes.
  Phase 0's checkpoint requires all three apps to boot, and mobile is still unverified on a device. Tagging
  now would put a "known-good floor" marker on something not actually known good.

**Surprises — CI caught two real bugs on its first two runs, both invisible locally. This is the whole
argument for CI, demonstrated inside ten minutes:**

1. **`packages/contracts` test script only worked on Windows.**
   `node --test --experimental-strip-types src/**/*.test.ts` relied on the *shell* expanding the glob.
   Git Bash swallowed the non-matching pattern and exited 0; Linux passes the literal string through, so
   Node tried to open a file named `src/**/*.test.ts` and exited 9. Replaced with vitest (matching
   `apps/api`) and wrote **9 real tests** for the schema logic that actually has behaviour — email
   trimming/lowercasing, the signup password floor and its deliberate absence on login, the relation
   default, and the date-of-birth future rejection added during the review.

2. **Turbo was stripping every environment variable.** The API tests failed with `DATABASE_URL: Required`
   even though the workflow plainly sets it. Cause: **Turbo 2 runs tasks in a filtered environment** and
   only `NODE_ENV` was declared in `turbo.json`. This could never fail on a dev machine, because
   `process.loadEnvFile()` reads `apps/api/.env` directly and bypasses Turbo entirely — CI has no `.env`,
   so the vars simply vanished. Fixed with `globalPassThroughEnv` listing the connection strings, JWT
   secrets and client URLs. Chose `globalPassThroughEnv` over `globalEnv` deliberately: passthrough vars
   are not part of the cache hash, so rotating a secret does not invalidate every cached task.

**Verification:** CI run `33277067473` → **conclusion: success**, on a clean Ubuntu runner with its own
Postgres and Redis: install → prisma generate → migrate deploy → lint → typecheck → test → build.
**49 tests** now (40 api + 9 contracts). Locally, `turbo run lint typecheck test build --force` → 16/16.

This closes the gap flagged since Phase 0: *the project had never been built on a machine that isn't this
one.* It now has been, and needed two fixes to get there.

**Known, non-blocking:** GitHub warns that `actions/checkout@v4`, `actions/setup-node@v4` and
`pnpm/action-setup@v4` target Node 20, which is deprecated on runners — they are being forced onto Node 24
and still pass. Bump the action majors when convenient; nothing is broken today.

**Repo notes for later:** renaming the GitHub repo is safe (GitHub permanently redirects the old URL; update
the local remote with `git remote set-url`). Renaming the local folder is safe for the code — no tracked
file contains an absolute path — but Claude Code keys its per-project memory to the folder path, so the
memory directory must be copied to the new key or future sessions start blank.

**Next:** the local folder is still `C:\Projects\New folder`; rename it to match the project, then Phase 2.

---

## 2026-08-30 — Mobile upgraded Expo SDK 52 -> 57; two workarounds deleted

**Why:** preparing the device check surfaced a blocker. Expo Go on the app stores supports only roughly the
latest one or two SDKs, and the project was pinned to **SDK 52 while 57 is current** - so Expo Go could not
have run the app at all. That pin was a poor default chosen in Phase 0, not a considered decision.

**Did:** `expo install expo@^57` then `expo install --fix`, which aligned the whole managed dependency set:
**react 19.2.3**, **@types/react 19.2.18**, react-native 0.86.3, expo-router 57, and the rest.

**The payoff - two accumulated workarounds are now obsolete and were deleted:**
Web (Next 15) needed React 19 while Expo SDK 52 pinned React 18.3.1, and that split caused two separate
hacks recorded earlier in this log:
1. a `paths` mapping in `apps/mobile/tsconfig.json` forcing one React typing, added to stop `TS2786` on
   every JSX element; and
2. `experiments.tsconfigPaths: false` in `app.json`, needed because Metro honoured that same mapping and
   resolved the **runtime** `react` import to a types-only package.

SDK 57 uses React 19, so both apps now agree and **both hacks are gone**. Mobile typechecks and bundles
without either. This is the cleanest outcome available: the root cause was removed rather than papered over
a third time.

**Decided:**
- **Pinned `typescript` back to `^5.7.2`.** `expo install --fix` proposed TypeScript **6.0.3**, but the rest
  of the monorepo - including NestJS 10 with decorator metadata - is on 5.x. Mixed compiler versions across
  one workspace is a trap, and a TS major upgrade deserves its own change, not a side effect of an SDK bump.
- **Kept `@babel/runtime` and `@expo/metro-runtime` as explicit dependencies.** Still correct under pnpm's
  isolated layout regardless of SDK.

**Verification:** mobile typecheck clean, `expo export --platform android` produces a **2.8 MB** Hermes
bundle, and `turbo run lint typecheck test build --force` -> **16/16, 0 cached**.

**Also, on git identity:** commits up to `559bc69` were authored as `pankajxemwal123@gmail.com`, taken from
the machine profile rather than the GitHub account - so they are not linked to `pnkjxmwl` on GitHub. The
history rewrite that would have fixed them was deliberately abandoned (rewriting shared history is rarely
worth it), and the local branch was reset back to match the remote. **From this point on commits use
`Pankaj Semwal <81282394+pnkjxmwl@users.noreply.github.com>`**, which is the GitHub-linked noreply address -
it attributes correctly without publishing a real email.

**Next:** the device check is now unblocked - Expo Go can run an SDK 57 app.

---

## 2026-08-30 — Corrected the SDK target: 57 -> 54, driven by the actual device

**What happened:** after upgrading to SDK 57, Expo Go on the real phone still reported the project as
incompatible. The Play Store was serving that device **Expo Go 54.0.8, which supports SDK 54** - not the
current 57.0.9 client. Play serves the newest client an Android version can run, so a device below the
requirement for Expo Go 55+ is capped at 54 no matter how current the project is.

**Decided: target SDK 54.** Chasing the newest SDK is pointless when the hardware in the room cannot run
its client. Verified first that this does **not** cost us the Phase-1 cleanup: SDK 54 pins **React 19.1.0**
and `@types/react` 19.1.17, so it still matches Next 15's React 19. **Both React-version workarounds stay
deleted** - the tsconfig `paths` pin and `experiments.tsconfigPaths: false`.

Rejected the alternatives: sideloading a newer Expo Go APK would likely fail on the same OS-version
constraint that capped the Play Store build, and a development build means installing Android Studio to
solve a problem that picking the right SDK solves for free.

**Lesson worth keeping:** "latest" was the wrong target twice in a row here. Phase 0 pinned SDK 52 because
it was familiar; the upgrade went to 57 because it was newest. The correct input was neither - it was
*which client the test device can actually install*, which nobody had checked. Check the target environment
before choosing a version.

**Result:** expo 54.0.37, react-native 0.81.5, expo-router 6.0.24, React 19.1.0, TypeScript still pinned at
5.7.2 for monorepo consistency. Mobile typecheck and lint clean, `expo export` produces a **2.71 MB**
Hermes bundle, and `turbo run lint typecheck test build --force` -> **16/16, 0 cached**.

---

## 2026-08-30 — Device check passed; Phases 0 and 1 signed off

**Did:** Ran the mobile app on a physical phone through Expo Go (SDK 54) and walked the full journey:
sign up -> home -> family profiles (the SELF profile was already there, created server-side at signup) ->
added "Father" -> **force-quit the app entirely and reopened**. Still signed in, Father still listed.

**Why that last step was the whole point:** every earlier mobile check proved the code *builds*.
`expo export` producing a Hermes bundle says Metro resolved the graph - it says nothing about whether
`expo-secure-store` actually persists to the OS keychain. Only a real force-quit and relaunch shows that,
and it is the difference between "users log in once" and "users log in every single time they open the app".

**Ticked:** `P0-MOB-01`, `P1-MOB-01`, `P1-MOB-02`. That closes both integration checkpoints -
Phase 0 ("all three apps boot; /health green; CI green") and Phase 1 ("real login on mobile + web;
P1-TEST-01 green").

**Tagged `phase-0-done` and `phase-1-done`** - the known-good floor that Phases.md §A.9 calls for. This is
the first tag in the repo; none was created earlier precisely because the checkpoints were not genuinely met.

**Carried gap, deliberately not hidden behind a tag:** `P1-BE-02` remains unticked. `/me` is done and
tested, but the Google ID-token exchange has never run against a real Google token - `GOOGLE_CLIENT_IDS` is
empty and the only test asserts the endpoint refuses cleanly when unconfigured. It needs iOS/Android/web
OAuth client ids. Everything else in Phase 1 is verified.

**Next:** Phase 2 - Hospital Configuration. Its Wave 1 freezes the `QueuePolicy` shape, which is the input
to the entire Phase-4 queue engine; Phases.md flags that changing it later means reworking the engine
rather than running a migration, so that diff deserves a slow read before it is merged.

---

# 📌 HANDOFF — read this first in a new session

*Written at the end of the session that built Phases 0 and 1. Everything above is chronological history;
this section is the distilled "what you need to know before touching anything".*

## Where the project actually stands

**Phases 0 and 1 are complete and tagged** (`phase-0-done`, `phase-1-done`). CI is green on GitHub
(`pnkjxmwl/opd-queue-platform`, private). 49 tests pass. Phase 2 has not been started.

Working today, verified rather than assumed:
- API: signup / login / refresh / logout, `/me`, account-scoped patient CRUD, `/health` + `/health/ready`
- Three global guards, with a 24-case tenant-isolation + IDOR suite proving cross-hospital and
  cross-account access is blocked
- Web console: login through httpOnly cookies, middleware-driven silent refresh, role-aware nav
- Mobile: auth + family profiles, verified on a physical device including session survival across force-quit

## The five things most likely to waste your time

1. **A green Turbo result can be a lie.** Turbo caches aggressively, and twice this session a "passing"
   task had not actually run — once hiding a broken mobile typecheck, once hiding a stale `@types/react`
   conflict. **Before believing any green result that matters, run
   `pnpm exec turbo run lint typecheck test build --force`.** That is the trustworthy signal.
2. **Vitest and `tsx` use esbuild, which does not implement `emitDecoratorMetadata`.** NestJS DI then
   resolves every constructor parameter as `undefined`, with a misleading error. `apps/api` already has
   `unplugin-swc` wired into `vitest.config.ts` — do not remove it, and do not switch the API's dev/build
   away from the Nest CLI back to `tsx`.
3. **Turbo runs tasks in a filtered environment.** Any new env var must be added to `globalPassThroughEnv`
   in `turbo.json` or the task simply will not see it. This is invisible locally, because
   `process.loadEnvFile()` reads `apps/api/.env` directly and bypasses Turbo entirely. CI has no `.env`,
   so CI is where it bites.
4. **pnpm's isolated layout means transitive deps are not resolvable.** `apps/mobile` declares
   `@babel/runtime` and `@expo/metro-runtime` explicitly for exactly this reason. If Metro reports
   "unable to resolve" for something you never imported, declare it rather than fighting the resolver.
5. **Check the target environment before picking a version.** The Expo SDK was wrong twice — pinned to 52
   out of familiarity, then bumped to 57 because it was newest. The correct input was which Expo Go the
   test device can install: **SDK 54**. Do not "upgrade" it without checking that first.

## Conventions that are not obvious from the code

- **`docs/Rules.md` §16 is binding**: append to this file whenever you finish a unit of work — what you
  did, what you decided, **why**, and the alternatives you rejected. Failures and dead ends are the
  highest-value entries. Append only; never edit a past entry to look right in hindsight.
- **Tick the `☐` in `docs/Phases.md` too.** Phases.md is the scoreboard, PROGRESS.md is the narrative.
- **Tag a phase only when its integration checkpoint genuinely passes.** No tag existed until the device
  check actually happened, deliberately.
- **Never commit unless asked** (Rules.md §13). Commits use
  `Pankaj Semwal <81282394+pnkjxmwl@users.noreply.github.com>`. Commits before `55185f9` carry a different
  email and are attributed to another GitHub account — that is known and was deliberately left alone.
- `CLAUDE.md` must stay at the repo root; it only auto-loads from there.

## Known gaps carried forward

- **`P1-BE-02`** — the Google ID-token exchange is implemented but has never run against a real token
  (`GOOGLE_CLIENT_IDS` is empty). Needs iOS/Android/web OAuth client ids.
- **`GET /patients` is unbounded**, a conscious deviation from Rules.md §6. Family size is naturally
  bounded — **but Phase 2 introduces genuinely open-ended lists (departments, doctors, schedules,
  sessions) and those must paginate.**
- **Expired `RefreshToken` rows are never cleaned up.** Harmless now; belongs with the Phase-8 workers.
- **CI actions warn about Node 20 deprecation.** Not breaking; bump the action majors when convenient.
- **The local folder is still `C:\Projects\New folder`.** Renaming is safe for the code (no tracked file
  contains an absolute path), but Claude Code keys its per-project memory to the folder path, so the
  memory directory must be copied to the new key or the next session starts with no memory.

## Starting Phase 2 — the one thing to be careful about

Phase 2's Wave 1 freezes the **`QueuePolicy` shape**, which is the input to the entire Phase-4 queue
engine. Phases.md is explicit that changing it later means reworking the engine, not just running a
migration. Read that diff slowly against PRD.md §8 before merging it, and resist the urge to parallelise
Wave 2 until it is locked.
