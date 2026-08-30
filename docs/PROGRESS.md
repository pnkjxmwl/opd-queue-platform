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

## 2026-08-30 — Phase 2 Wave 1: the frozen config contract + schema

**Did:** `P2-CONTRACT-01` and `P2-DB-01`. New contracts (`enums/config.ts`, `config/dto.ts`,
`common/pagination.ts`), five Prisma models/enum groups, migration
`20260830004758_phase2_hospital_config`, and 12 new contract tests. Wave 2 is deliberately NOT started —
the shape below is the input to the entire Phase-4 engine and was put in front of the user first.

### The one thing that changed from the design docs: registration cutoff

`docs/Architecture.md` §5.1 sketches `registrationCutoff(SMART|CLOCK|MAX_TOKENS)` — an enum, so a hospital
picks **one**. `docs/PRD.md` §8.12 words the same rule **additively**: *"auto-close when a new joiner's ETA
would exceed session end, **plus** optional `max_online_tokens` cap, **plus** manual staff close."*

Those two readings are not compatible, and the enum version is the dangerous one: a hospital that sets a
token cap silently loses the ETA-overrun guard — the rule that stops someone joining a queue they cannot
physically be seen in. That guard is the product promise, not a preference.

**Decided:** three independent limits, ANDed — registration is open only while every enabled one permits a
join:

- `cutoffOnEtaOverrun: boolean` (default true) — the SMART rule
- `cutoffMinsBeforeEnd: int | null` (default null) — the CLOCK rule, which the enum never had a value for;
  `CLOCK` mode was unimplementable as sketched because nothing said *what* time
- `maxOnlineTokens: int | null` (default null) — the cap
- manual staff close is the third PRD mechanism, is per-session rather than per-hospital, and therefore
  lives on `OPDSession.registrationClosedAt`

The `RegistrationCutoff` enum named in the Phases.md Wave-1 line does not exist. That is the deviation;
PRD.md is the authority on product intent.

### The one field neither doc put anywhere

PRD §4.2 rules out maps-based "leave now" and replaces it with *"a hospital-configured 'arrive N minutes
before your window'"*. No model in Architecture.md §5.1 has that field. It is hospital configuration, and
`QueuePolicy` is the table that holds hospital configuration, so it is now `arriveBeforeMins` (default 30).
Found by walking PRD §8 and §4.2 line by line against the field list rather than transcribing the
Architecture.md sketch — which is exactly what the "review this diff slowly" instruction was for.

### Decisions, and what was rejected

**Clock times are `"HH:mm"` strings, not DateTimes.** A schedule of 10:00–13:00 is a rule about clock
faces; it becomes an instant only when combined with a date at generation time. A DateTime silently carries
a date nobody meant — the timezone bug Phases.md predicts. Zero-padded HH:mm compares lexicographically
exactly as it compares chronologically, so `endTime > startTime` is a real database CHECK, not just a Zod
refine. *Rejected:* `@db.Time` (Prisma maps it to a JS Date with a junk date attached — the same trap in a
costume) and `Int` minutes-from-midnight (arithmetic-safe, but an API returning `startMin: 600` is hostile
and needs a codec in four places). **Known ceiling, marked `ponytail:` in the schema:** no SQL arithmetic on
schedule times. Nothing in the MVP needs it; schedule-overlap detection would.

**`OPDSession.date` is a separate `@db.Date` column** alongside the UTC instants. Phase 3 discovery asks
"today's sessions" constantly; with only instants, every one of those queries is timezone arithmetic. One
denormalised IST calendar date turns it into an equality test — and it is the *fix* for the timezone trap,
not an instance of it.

**Idempotency is `@@unique([originalDoctorId, date, scheduledStart])`.** Phases.md demands a database
constraint, not an application check, because staff will double-click. Verified against the live database:
the second identical insert is rejected. *Cost accepted:* a CANCELLED session cannot be regenerated at the
same slot. Real, but Phase-2 config is regenerable and the alternative is a partial unique index that has to
know about queue states this phase does not own yet.

**Policy defaults live once, in `DEFAULT_QUEUE_POLICY` in contracts** — the Prisma columns carry no
`@default`. Two sets of defaults drift apart, and the one in the database is the one nobody reads. Every
field of `UpdateQueuePolicyRequest` defaults, so `PUT {}` is a valid "reset to defaults" and a hospital that
never opened the config screen still yields a complete policy. The engine must never meet a half-filled one.

**`cancellationRules` stays a JSON column** (Architecture.md and Rules.md §11.3 both name it), but every
field in its Zod schema has a default. That is the actual hazard mitigation: a row written today must still
parse after Phase 5 adds a key, rather than throwing on read in production. There is a test for exactly that.

**`OrderingStrategy` has one value, `TOKEN_ORDER`.** PRD §8.5 says the *policy* decides ordering, so the
decision needs a home; §8.3 pins v1 to token order. Adding a value later is an additive `ALTER TYPE`, which
is cheap — changing what the engine *means* by ordering is not, which is why the semantics are pinned now.
*Rejected:* inventing `WALK_IN_ALTERNATE` because Indian hospitals often alternate online/walk-in lanes. It
is not in the PRD, and a second strategy the engine does not implement is a lie in a dropdown.

**No knob for the rules that must not be breakable.** Token number is not call order, a late check-in slots
into its natural token position, every mutation is audited — all locked engine behaviour, deliberately with
no configuration. Making them configurable makes them breakable.

**Sessions are created `OPEN_FOR_REGISTRATION` with no `status` in the create DTO.** Rules.md §1.2 forbids
raw CRUD on session status; every later change is a Phase-4 command. `SCHEDULED` is therefore unreachable
until a phase adds advance scheduling — that is correct, not an oversight.

**Pagination is offset-based** (`PageQuery` + `paginated()`), because the admin console shows numbered pages
over small config lists and wants a total. Phase 3 discovery scrolls on mobile and may want a cursor; the
two can coexist because they serve different screens. Every Phase-2 list uses this — the unbounded
`GET /patients` was a one-off, not a precedent.

### Surprises

- **`prisma generate` failed with `EPERM`** on the query-engine DLL. The cause was three dev servers still
  running from the previous session (started 02:15, five hours earlier) holding the file open on Windows.
  Stopping the API dev-server chain fixed it. Worth knowing before debugging Prisma itself.
- **Vitest passed while the build did not.** `as const` on the `path` arrays passed to `.refine()` makes them
  readonly, which Zod's types reject — but esbuild strips types without checking them, so 22 tests went green
  on code that could not compile. This is the third time in this project a green result has been the wrong
  signal, and the second time `--force` plus a real `build` is what caught it.

### Verified

`pnpm exec turbo run lint typecheck test build --force` → **16/16, 0 cached**. Migration applied to the
local database, and every CHECK constraint exercised directly with `psql`: both-recurrences rejected,
neither-recurrence rejected, `endTime <= startTime` rejected, unpadded `"9:00"` rejected, `weekday 7`
rejected, negative `gracePeriodSec` rejected, `maxOnlineTokens 0` rejected, session `end <= start` rejected,
duplicate doctor+date+start rejected, valid rows accepted. Fixtures removed afterwards.

---

## 2026-08-30 — Phase 2 Wave 1 reviewed against PRD 8; three fixes before the freeze

**Did:** Reviewed the previous session's `P2-CONTRACT-01` + `P2-DB-01` diff line by line against
PRD.md 8 rather than re-building it, then applied three fixes and re-froze. Wave 2 is still NOT started.

### Traceability first, opinions second

Walked all 13 locked rules of PRD 8 and asked, for each, "where does this live and can the engine read
it". All 13 have a home. The four rules that deliberately have **no** knob (token != call order, late
check-in natural position, unified typed queue, audited commands) stayed knob-less. The 8.12 deviation
from Architecture.md's `registrationCutoff(SMART|CLOCK|MAX_TOKENS)` enum was re-examined and kept: PRD
wording is additive, and the enum version silently drops the ETA-overrun guard for any hospital that
wants a token cap. Confirming a previous session's deviation is worth as much as finding a new one.

### Three things the review caught

**`SessionListQuery` had no pagination.** It carried `date/departmentId/doctorId/status` and no
`limit/offset` — in the same commit that added `PageQuery` specifically because Phase 2 introduces the
first unbounded lists. Sessions accumulate every single day, and this was the schema Wave 2 would have
copied. Now `PageQuery.extend({...})`. The lesson generalises: adding a pagination helper does not
paginate anything; the list schemas have to actually use it.

**`DELETE /departments` and `DELETE /doctors` were unimplementable.** Phases.md lists both endpoints
this phase. `Doctor.department`, `OPDSession.department`, `OPDSession.originalDoctor` and
`.currentProvider` are all `onDelete: Restrict`, so a hard DELETE stops working the day a department or
doctor is first used — permanently, including for the real case of a doctor who leaves the hospital.
Found by asking what each listed endpoint does on day two, not day one.

*Decided:* `isActive Boolean @default(true)` on `Department` and `Doctor`; DELETE deactivates; lists hide
inactive rows unless `includeInactive=true`. This matches the lifecycle-not-deletion pattern the codebase
already uses (`Hospital.status`, `HospitalStaff.status`), and Phase 3 needs it anyway — Phases.md says
inactive config must not appear in discovery. *Rejected:* hard DELETE with a 409 when referenced. It is
honest and costs no schema, but it gives a doctor who leaves the hospital no answer at all, which is the
case that actually happens.

*Also decided:* `UpdateDoctorRequest`/`UpdateDepartmentRequest` accept `isActive`, because a
deactivate-only door with no way back is a trap for the admin who mis-clicks.

**`OPDSession.queuePolicyId` was redundant, and redundancy here is a tenant-leak seat.** `QueuePolicy`
is `@unique` on `hospitalId`, so `queuePolicyId` is `hospitalId` restated — one fact stored twice. Two
copies of one fact can disagree, and the disagreement available here is "a session running on another
hospital's rules", which no constraint would have caught. It also looked like a per-session policy
snapshot and was not one: it points at the single mutable row, so editing the policy at 11:00 silently
changes the rules for a queue that started at 09:00.

*Decided:* drop the column. Phase 4 reads the policy by `hospitalId` (unique-indexed, one lookup).
Deleting it also removed a required `Restrict` FK that made session creation depend on a policy row
already existing. *Rejected:* keeping it as a join convenience, which is what Architecture.md 5.1
sketches. One join hop is not worth a column that can contradict `hospitalId`. *Not chosen, and worth
naming:* making it a genuine per-session snapshot, so mid-session policy edits cannot retroactively
change a running queue. That is arguably more correct, the PRD does not ask for it, and it is a much
bigger model. If it is ever wanted, this column is where it goes.

### Two comments, because an undefined enum value is a bug waiting for Phase 4

`RequeueBehavior.NO_REQUEUE` had no defined landing state — `SKIPPED` or `NO_SHOW` was left to whoever
writes the command. Pinned as **terminal `NO_SHOW`**, refunded by `cancellationRules.noShowRefundPct`,
deliberately the same terminal state as "booked and never arrived" (PRD 8.9) so there is exactly one
no-show refund path rather than a second one nobody configured. Same discipline that gave
`OrderingStrategy` a single value: pin the meaning while it is still free.

`checkInRequired: false` disables a rule PRD 8.2 states as locked (Architecture.md sanctions the knob).
Its engine semantics are now written down: a booked entry is callable without ever checking in, and
PRD 8.9 is consequently unenforceable for that hospital. Phase 4 must not have to guess this.

**`includeInactive` is `z.enum(['true','false']).transform(...)`, deliberately not `z.coerce.boolean()`.**
Coercion follows JS truthiness, so `?includeInactive=false` would coerce to `true` — a filter that means
the exact opposite of what it says. There is a test asserting that, because the trap is invisible on read.

### Wave-2 landmines, recorded here so they are not rediscovered

- The `@@unique([originalDoctorId, date, scheduledStart])` constraint fires on manual `POST /sessions`
  too, not just on generate. Map Prisma `P2002` to **409**, never let it surface as a 500.
- "Today" and a schedule's `weekday` must both be computed in `Asia/Kolkata`, on the server, via one
  shared helper. An inline `new Date()` anywhere in the generate path is the 00:30-IST bug.
- Prisma returns `@db.Date` as a JS `Date` at UTC midnight. Serialise with `toISOString().slice(0,10)`;
  a locale formatter shifts the day on any machine behind UTC.
- A schedule's `hospitalId` matching its doctor's, and a session's department matching its doctor's, are
  enforced by application code only — no composite FK. Needs an explicit test, not a code review.
- Nothing creates the `QueuePolicy` row yet. Something must upsert `DEFAULT_QUEUE_POLICY` before Phase 4
  reads it. Dropping `queuePolicyId` removed the hard ordering dependency but not the need.

### Limitations now locked at database level (named, not objected to)

Sessions cannot cross midnight (`endTime > startTime` CHECK), so a 21:00-01:00 OPD is unrepresentable.
A CANCELLED session cannot be regenerated in its own slot. `Doctor.defaultConsultMins` carries a
`@default(10)` in both Prisma and contracts — the exact drift `QueuePolicy` deliberately avoids, left
alone because it predates this phase.

### Deliberately not added

An ETA window width (PRD 9 says ETA is "always a window", but Phase 7 may derive it from variance rather
than a fixed +/-N; an additive column later is cheap). A second `OrderingStrategy`.

### Surprises

- **`prisma migrate reset` is blocked in this environment.** The migration was uncommitted and dev-only,
  so amending it in place was correct, but the DB could not be re-created the normal way. Path taken:
  apply the delta by hand in `psql`, drop the `_prisma_migrations` row, `prisma migrate resolve --applied`
  to let Prisma recompute the checksum — then prove the real thing with
  `prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma
  --shadow-database-url <scratch db> --exit-code` → **"No difference detected", exit 0.** That replays
  every migration onto an empty database and diffs the result against `schema.prisma`, which is a
  stronger check than `migrate status` and does not touch the dev database. Worth reusing whenever a
  migration is hand-edited.
- **A `psql` fixture check deadlocked against the test suite.** The background `turbo run test` was
  TRUNCATE-ing the same tables (AccessExclusiveLock) while the fixtures held RowExclusiveLock. Not a
  schema problem at all. Do not run manual DB checks and the integration suite at the same time.

### Verified

`pnpm exec turbo run lint typecheck test build --force` → **16/16, 0 cached** — twice: once as a baseline
before touching anything, once after the fixes. Contract tests 22 → 25 (session-list pagination, the
`includeInactive=false` coercion trap, reactivating a deactivated doctor). Migration replay diff clean.
In `psql`: `isActive` defaults true on both new columns, a session inserts with no `queuePolicyId`, and a
duplicate doctor+date+start is still rejected by name. All fixtures rolled back; tables left empty.

---

## 2026-08-30 — Phase 2 Wave 2: config API, sessions, staff, seed and the admin console

**Did:** `P2-BE-01` … `P2-BE-06` and `P2-WEB-01` … `P2-WEB-05`. Three new API modules
(`config`, `sessions`, `staff`), a shared IST helper, a seed script, a 27-case integration suite,
and five admin screens under `/config`.

### Module layout: one `config` module, not four

Phases.md sketches `apps/api/src/{departments,doctors,schedules,policy}`. Built instead as one
`modules/config` owning all four tables, because docs/CLAUDE.md 3 forbids a module reading another
module's tables and these four reference each other constantly — a schedule needs its doctor, a doctor
needs its department, a session needs all three. Four modules would have turned every ordinary read
into a cross-module service call and bought no isolation. `sessions` and `staff` are separate modules
and reach config only through its exported services.

*Rejected:* letting `sessions` query the Doctor table directly. It is two lines shorter and it is the
exact rule that stops a module from quietly acquiring a second owner.

### The three landmines from the Wave-1 review, closed

**`common/ist.ts` is the only place a clock face becomes an instant.** IST is UTC+05:30 with no DST,
so a fixed offset is correct and a timezone library would buy nothing. Its test asserts the specific
bug Phases.md predicts: 19:00 UTC on 29 Aug is 00:30 IST on the 30th, so `istDateOf` returns the 30th
while `toISOString().slice(0,10)` returns the 29th. `generate` takes its date from this, never from
the client — the sessions screen sends no date at all when the admin means "today".

**`common/prisma-errors.ts` maps P2002 → 409 once**, where every caller routes through. The
idempotency constraint fires on a hand-created session as well as on generate, so both paths would
otherwise have surfaced Prisma internals as a 500. There is a test for each.

**`@db.Date` is read with `toISOString().slice(0,10)`**, never a locale formatter, in the one place
that converts it.

### Decisions

**DELETE deactivates, everywhere it can.** Departments and doctors set `isActive = false`; schedules
really are deleted, because sessions keep their provenance through `onDelete: SetNull` and nothing
restricts them. So the flag exists exactly where the foreign keys make deletion impossible, and
nowhere else.

**Generation skips deactivated doctors.** Discovered by asking what "deactivate a doctor" means the
next morning: without the filter their recurring schedule would keep manufacturing sessions for
someone who no longer works there.

**Session creation guarantees a `QueuePolicy` row exists** (`QueuePolicyService.ensure`, an upsert
from `DEFAULT_QUEUE_POLICY`). A GET that writes once is impure, and it is the cheapest way to make
"the engine never meets a missing policy" true rather than merely intended.

**The staff invite is one transaction**, with the doctor link written through `DoctorsService`
rather than by touching the Doctor table. The validation that can fail for ordinary reasons — doctor
not found, inactive, already has a login — runs *before* the transaction opens, so the only failure
left inside it is a genuine database error.

**The seed lives in `src/seed.ts`, not `prisma/seed.ts`.** There is no TypeScript runner in this repo
and adding `tsx` for one script is a dependency for something `nest build` already does. Marked
`ponytail:` with the upgrade path. It refuses to run when `NODE_ENV=production` *and* refuses if the
database holds a hospital it did not create — fixed UUIDs are what make "did not create" checkable,
and the same fixed ids are what make re-running converge instead of multiply. Verified by running it
twice: 6 sessions created, then 0 created / 6 already present.

### The console uses server actions, not TanStack Query — flagging this

docs/CLAUDE.md 9 lists TanStack Query for web server state. The console is entirely server
components reading through `apiGet` with an httpOnly cookie, and a client-side query cache cannot
read that cookie. These five screens are plain forms an admin uses during onboarding, which is
exactly what Phases.md asks for, so they are `<form action={serverAction}>` with `revalidatePath` —
no client JavaScript at all, no new dependency, and the token never leaves the server.

TanStack Query stays in `package.json` because Phase 6/7's live queue screens genuinely need it:
those are client-side, realtime, and reconnect-driven. **This is a deviation from CLAUDE.md 9 for the
config screens only** and is called out rather than quietly made.

Server rejections surface as a `?error=` banner rather than an error page (docs/Rules.md 9: the
console must show what the server said). Only a deliberate `ApiCallError` becomes a banner; anything
unexpected still reaches the error boundary, so a real fault stays loud.

### Pagination, since it was the standing instruction

Every list endpoint added in this wave paginates: departments, doctors, schedules and sessions, all
through `PageQuery`. Four assertions cover it — the envelope shape, the offset, the 100-item cap
returning 400, and the session list specifically. `ConfigListQuery.includeInactive` deliberately
avoids `z.coerce.boolean()`, which reads the string `"false"` as `true`.

### Known gaps carried forward

- **An invited person cannot yet complete their invitation.** The account exists with a null
  `passwordHash`, and `/auth/signup` rejects an email that already exists, so there is no way to set
  that password. `P2-BE-05`'s done-when is "invite doctor account; membership created", which is met,
  and an accept-invite flow is not in this phase — but the invite is not usable end to end until one
  exists. Whoever owns the next auth work should start here.
  *(Closed later the same day — see the accept-invite entry below. Left as written: this file
  is append-only, and a past entry is never edited to look right in hindsight.)*
- Two `/me` calls per config page render (the layout and the page each resolve the hospital).
  Harmless for an admin console, wasteful if this pattern spreads to a hot path.

### Verified

`pnpm exec turbo run lint typecheck test build --force` -> **16/16, 0 cached, exit 0**, run after every
change rather than once at the end. **97 tests pass** (was 49 at the end of Phase 1): 72 in `apps/api`
across 5 files, 25 in `packages/contracts`. The 27 new integration cases in `test/config.e2e.test.ts`
cover, specifically: the paginated envelope on every list plus the 100-item cap returning 400; a
receptionist blocked from admin config; a cross-hospital read answered 403 from outside and 404 from
inside; a duplicate department name as 409 rather than 500; a doctor refused a department from another
hospital; `end <= start` and both-recurrences rejected; policy PUT replacing rather than patching and
`{}` resetting to defaults; per-hospital policy isolation; a session created OPEN_FOR_REGISTRATION with
`10:00` IST stored as `04:30Z`; a duplicate slot as 409; generate returning created 1 / skipped 0 then
created 0 / skipped 1; generation skipping a deactivated doctor; and the doctor invite flipping
`hasLogin` while leaving `passwordHash` null.

The seed was run twice against the live database: 6 sessions created, then 0 created / 6 already
present.

**NOT verified, and the reason the Phase 2 box in Phases.md 0 stays unticked:** nobody has driven the
five admin screens in a browser. The integration checkpoint is "admin builds
hospital->dept->doctor->schedule->session end to end", and only the API half of that is proven, by the
suite above. `next build` type-checks and compiles the console but these pages are dynamic - they read
cookies - so the build never renders them. That click-through, with `pnpm dev` and a real login, is
what earns the box and the `phase-2-done` tag.


---

## 2026-08-30 — Phase 2 integration checkpoint, run against the real servers

**Did:** Ran the checkpoint end to end rather than inferring it from the unit and integration suites.
Re-seeded (the e2e suite TRUNCATEs the dev database, so the seed has to be re-applied first), started
`@opd/api` and `@opd/web` dev servers, authenticated through the console's own `/api/auth/login` route
so the session arrived as real httpOnly cookies, and drove the console with those cookies.

### What was actually proven

- **All five `/config` pages render 200 with seeded data**, not empty states: departments shows
  Cardiology / Orthopaedics / General Medicine; doctors shows Dr. Anita Sharma and her specialization;
  schedules shows her working block at 10:00 with a ₹500.00 fee; sessions shows today's date and
  `OPEN FOR REGISTRATION`; policy shows every control group. This is the half `next build` cannot
  reach - these pages read cookies, so they are dynamic and the build never renders them.
- **A server action persists.** Posted the create-department form exactly as a JavaScript-less browser
  would - multipart body carrying the `$ACTION_ID_…` hidden field lifted out of the rendered HTML -
  and got `303` plus a real row in the database. That is the whole write path in one shot: form ->
  server action -> httpOnly cookie -> API -> Postgres -> redirect. Nothing else in the suite covers it,
  because the tests call the API directly and never go through Next.
- **The error path renders as designed.** A duplicate name redirected to
  `?error=A department with this name already exists` and the page rendered the banner with
  `role="alert"` and the API's own message. Server rejections surface instead of failing silently
  (docs/Rules.md 9).
- **Authorization holds in the running app, not just in tests.** `reception@apollo.test` hitting
  `/config/departments` got `307 -> /`, and an unauthenticated call straight to the API got `401`.

### Surprises

- **`grep "Every Sunday"` missed on a page that renders it correctly.** React server-rendering splits
  `Every {day}` into `Every<!-- -->Sunday`, so a naive string search finds nothing. Worth remembering
  before treating a grep miss as a rendering bug - the fix was to search for `>Sunday<`.
- **Stopping the dev servers did not stop them.** Killing the `pnpm --filter … dev` wrappers left the
  actual node processes listening on 3000 and 3001; `prisma generate` would then have hit the `EPERM`
  file-lock trap recorded earlier in this log. Killing by listening port
  (`netstat -ano` -> `taskkill //PID … //F`) is what actually worked, and `prisma generate` was re-run
  afterwards to prove the lock was gone.

### Status

The checkpoint passes for everything reachable without a human looking at the screen. What remains is
visual only - layout, spacing, whether the forms read well. The Phase 2 box and the `phase-2-done` tag
stay unticked until that eyeball happens, per the convention that a phase is tagged only when its
checkpoint genuinely passes.

Test fixture (`Checkpoint Ward`) was deleted afterwards; the database holds exactly the seeded 5
departments, 6 doctors and 6 sessions.

---

## 2026-08-30 — Accept-invite: closing the gap that made P2-BE-05 unusable

**Did:** Built the missing half of the staff invitation. An invited doctor or receptionist can now set
a password and log in. New contract types, two columns on `HospitalStaff`, a migration, a public
`POST /auth/accept-invite`, an `/accept-invite` page, and 10 integration tests that are mostly about
attacks rather than the happy path.

### The gap, stated precisely

`P2-BE-05` created an `Account` with a null `passwordHash` and a membership in `INVITED`. There was
then no way to set that password: `/auth/login` rejects an account with no hash, and `/auth/signup`
rejects an email that already exists. The invite was created and then stranded.

### Why not the obvious fix

The tempting one-liner is to let signup complete an invitation - if the account exists with no
password, set it instead of returning 409. **That is a privilege escalation.** Anyone who guesses
`dr.sharma@hospital.in` could sign up first and inherit a DOCTOR role inside that hospital, before the
real doctor ever saw their invite. There is a test asserting signup still refuses.

**Decided:** a single-use, expiring token, generated at invite time. It is the only thing that proves
the invitation reached its intended recipient.

### Decisions

**The invitation lives on `HospitalStaff`, not in its own table.** Two nullable columns,
`inviteTokenHash` and `inviteExpiresAt`. One account invited to two hospitals is two memberships and
therefore two independent invitations, which falls out for free; a separate `StaffInvite` table would
have needed its own uniqueness rules to say the same thing.

**Only the SHA-256 is stored**, the rule `RefreshToken` already follows. A database leak must not
yield usable invitations. There is a test asserting the stored value is a 64-hex-character string and
is not the token.

**Both columns are cleared on acceptance**, in the same statement that flips the status. That makes
the token single-use *by construction* rather than by a flag someone has to remember to check, and it
means the "already used" case needs no separate branch.

**The status and the token are in the WHERE of that update, not checked beforehand.** Two simultaneous
accepts of the same token both pass the lookup; only one can win the `updateMany`, and the loser gets
the same rejection as a forged token. The check-then-act version would have activated twice.

**The password is set only if the account has none.** An existing user invited to a second hospital
keeps the password they already have, and accepting only activates the new membership. Otherwise
"invite this address" would be an account-takeover primitive against any existing user. Tested from
both sides: the attacker-chosen password does not work, the original still does, and the membership
is active regardless.

**Every failure returns the same `UnauthorizedError` with the same message.** Unknown, expired and
already-used are indistinguishable to the caller - telling them apart says which guesses were close.
A test asserts the two messages are byte-identical.

**Argon2id runs outside the transaction.** It is deliberately slow; hashing inside would hold locks
for the duration for no reason.

**Re-inviting an outstanding invitation reissues the token rather than 409-ing.** Invitations get lost
and expire, and the alternative is an admin with no way to resend one. Re-inviting an *active* member
is still a 409. This changed behaviour an existing Phase-2 test asserted, so that test was rewritten
rather than worked around - it now asserts the new contract, and points at the accept-invite suite
which proves the replaced token stops working.

### Module boundary: caught and fixed rather than shipped

The first working version had `AuthService` reading and writing `HospitalStaff` directly. That table
belongs to the staff module, and docs/CLAUDE.md 3 forbids exactly this. It typechecked and would have
passed every test.

Reworked so `StaffService` owns both halves - `findOpenInvitation` and `consumeInvitation`, the latter
taking an optional transaction client - and `AuthService` orchestrates: it owns `Account` and the
tokens, and asks the staff module about memberships. `AuthModule` imports `StaffModule`; no cycle,
because `StaffService` never reaches back into auth.

Worth recording because the rule caught something a passing test suite would not have: the violation
was invisible at runtime and only visible against the architecture.

### Delivery: how the token reaches the invitee

MVP has no email channel - PRD 4.2 rules out SMS/WhatsApp, and push notifications go to app users, who
an invitee by definition is not yet. So the admin passes the link on, and the console shows it once,
on the doctors screen, immediately after inviting.

**It is handed over in a short-lived httpOnly cookie, not a `?token=` redirect.** A query parameter
would land in browser history, the Next server log, and any proxy log in between. The cookie is
scoped to that one page and expires in three minutes; the API returns the token exactly once, so that
render is the only chance to display it.

`/accept-invite` had to be added to the middleware matcher's exclusion list alongside `/login` - an
invitee has no session, so the protected-route redirect would otherwise bounce them to a login they
cannot complete.

### Still open

- **No rate limit on `/auth/accept-invite`.** The token is 32 random bytes, so guessing is not the
  practical risk, but the endpoint is public and unthrottled. Rate limiting is Phase 9 and this
  endpoint belongs on that list with signup, login and the webhook.
- **No way to revoke an outstanding invitation** short of re-inviting to burn the old token. Nobody
  has asked for it; noting it so the absence is a decision rather than an oversight.


### Surprises

- **The web build failed where every typecheck passed.** `INVITE_COOKIE` was exported from the
  `'use server'` actions module, and such a module may only export async functions. `tsc --noEmit`
  is happy; the Next build is not. Fourth time in this project a green signal has been the wrong one,
  and the second caused by a rule the type system does not model. The constant moved to `_run.ts`
  with a comment saying why it lives there rather than beside the action that uses it.

### Verified

`pnpm exec turbo run lint typecheck test build --force` -> **16/16, 0 cached, exit 0**.
**92 tests** (was 82 before this work, 49 at the end of Phase 1): 82 in `apps/api` across 6 files,
25 in `packages/contracts`. Migration replay against a scratch database: "No difference detected".

---

## 2026-08-30 — Generate reports what it did; server actions can now return a result

**Did:** Closed a gap found while writing the manual verification steps: the sessions screen called
`generate` and threw the answer away. The contract returns `{ created, skipped }` and
`packages/contracts` documents `skipped` as *"the visible proof that re-running changed nothing"* —
but the admin saw only a page refresh. An admin who clicks twice could not tell idempotency from a
silent failure, which is precisely the thing docs/Phases.md says to prove.

**Decided:** `runAction` accepts a string back from its work callback and appends it to the success
redirect, so an action can report what it did. `generateSessions` returns
`created=<n>&skipped=<m>` and the page renders `role="status"` with
*"0 sessions created, 4 already existed — running this twice is safe."*

*Rejected:* a second cookie like the invite token uses. Cookies are for values that must not appear
in a URL; these are two non-secret integers, and a query parameter survives a copy-pasted link and a
reload, which a 3-minute cookie does not. The rule is now written into `runAction`'s comment so the
distinction is explicit rather than remembered: **counts go in the query, secrets go in a cookie.**

Found by writing the user-facing walkthrough rather than by testing. Describing what someone would
see is a different check from asserting what the server returns, and it caught something 92 passing
tests did not.

### Verified

`pnpm exec turbo run lint typecheck test build --force` -> **16/16, 0 cached, exit 0**, re-run after
this change rather than trusting the earlier green. 92 tests. The dev database was re-seeded
afterwards, because `turbo run test` TRUNCATEs it.

---

## 2026-08-30 — The console linked to a route that does not exist; found by the user, in the browser

**Did:** The user ran the Phase 2 walkthrough and hit a **404 on "Queue"** immediately after accepting
a doctor invitation. `/queue` is the doctor and staff console, which is **Phase 6** — the nav link was
written in Phase 1 as a placeholder pointing at a route nobody had built.

**This is the failure docs/Phases.md predicts by name.** Its Phase 3 risk list says: *"The Join button
is visible but inert here. Make that obvious in the UI (disabled, with a reason), or you will file
bugs against your own placeholder."* The same principle applies to nav, we did not apply it, and the
predicted bug arrived on schedule — reported by a human, because no test asserts that every rendered
link resolves.

**Decided:** nav items carry a `ready` flag. A route that does not exist yet still appears — the shape
of the console should be visible from day one — but renders as greyed text with a `Soon` badge and
`aria-disabled`, never as an `<a>`. Verified by fetching the page as RECEPTION and confirming no
`href="/queue"` is emitted at all.

*Rejected:* deleting the link until Phase 6. It hides that the queue console is coming, which is the
one thing the sidebar is for. *Also rejected:* a `/queue` stub page saying "coming soon" — a route
that exists only to apologise is worse than a label that never pretended to be clickable.

**Second, smaller thing the same report exposed:** the Overview greeted every role with *"Admins can
set up departments, doctors, schedules..."*, which is wrong and slightly insulting for the doctor who
had just logged in and can do none of it. It is now role-aware: an ADMIN gets the configuration
sentence, everyone else gets *"Your queue console arrives in a later phase. Nothing to do here yet."*

### What this says about the test suite

92 tests, and none of them would ever have caught this: they assert what the API returns, and this was
a link in a layout. The cheap general guard would be a test that every `href` rendered by the console
resolves to a real route. Not written now — with three routes it would be ceremony — but worth having
once Phase 6 adds the queue consoles and the nav stops being trivially checkable by eye.

### Verified

`pnpm exec turbo run lint typecheck test build --force` -> **16/16, 0 cached, exit 0**, run after the
fix so the green result covers the code the user actually exercised rather than the version they
reported the bug against. 92 tests. Fetched the console as RECEPTION and confirmed no `href="/queue"`
is emitted. Database re-seeded afterwards.

---

## 2026-08-30 — Google sign-in verified against a real token · P1-BE-02 closed

**Did:** The user created a Google Cloud project and a **Web** OAuth client, obtained a real ID token
through Google's OAuth Playground, and the exchange was tested end to end. `P1-BE-02` had been carried
as unticked since Phase 1 with the note *"implemented but unverified"*. It is now genuinely verified.

### What was proven, not assumed

| Path | Result |
|---|---|
| `POST /auth/google` with a real Google ID token | **200**, access + refresh tokens issued |
| Account created | `googleId` set, `passwordHash` null (Google-only), email from the verified claim |
| `GET /me` with the issued token | 200, `linkedGoogle: true`, `hasPassword: false` |
| Signing in twice | still **one** account — no duplicate |
| **Existing password account, same email, then Google** | **linked**: same account id before and after, `googleId` added, `passwordHash` preserved, still exactly one row |
| Password login after linking | **200** — linking does not break the original credential |
| Garbage token | **401** `Invalid Google token` |
| Well-formed token minted for a **different** `aud` | **401** — the audience check is real, not decorative |

The linking case is the one worth having tested by hand. "Same verified email as an existing password
account: link, don't duplicate" is a branch that only runs against a genuine Google token, and getting
it wrong either strands the user with two accounts or lets an unverified email claim an existing one.

### A client secret landed in the repo directory, and got caught

The user downloaded Google's credentials JSON and put it in `docs/`. It was still **untracked** —
`git status` showed `??`, so nothing leaked — but `docs/` is a tracked directory and the next
`git add .` would have pushed a client secret to GitHub.

**Did:** moved the file to `~/.opd-secrets/` (outside the repo) and added `client_secret*.json` plus
`*-oauth-credentials.json` to `.gitignore`, then proved the pattern works by creating
`docs/client_secret_test.json` and confirming `git status` ignored it.

**Decided:** the guard goes in `.gitignore`, not into a code-review habit. Google names these downloads
`client_secret_<id>.apps.googleusercontent.com.json` and the browser saves them wherever it likes; the
next person will do the same thing, and a rule that depends on someone noticing is not a rule.
docs/Rules.md §5 says no secrets in the repo — this makes the common accident impossible rather than
merely forbidden.

**Note:** only the **client id** is needed by the backend, and it is not a secret. It lives in
`apps/api/.env` (gitignored — `git check-ignore` was run to confirm). `.env.example` keeps
`GOOGLE_CLIENT_IDS=""` empty. The client *secret* is not used by this codebase at all; it was only
needed for the Playground to mint a token, and the backend never sees it.

### What this does NOT mean

**No user can sign in with Google yet.** Grepping both clients found zero Google code: `apps/mobile`
and `apps/web` have no Google button. `P1-MOB-01` was scoped as "auth screens + secure-store tokens +
protected nav", and the Google path was never built. The endpoint works and is proven; nothing calls it.

Shipping it needs iOS and Android OAuth client ids (the Android one needs the app's SHA-1 fingerprint)
and `expo-auth-session` wired into the mobile sign-in screen. `GOOGLE_CLIENT_IDS` is comma-separated
precisely so those get appended without a code change. Deliberately not built now: no patient can
reach a sign-in that leads anywhere until Phase 3 gives them something to browse.

### Verified

The dev database was left exactly as the seed leaves it — the test account was deleted afterwards and
the count confirmed zero. The ID token was written to a temp file for the curl and removed after.

---

## 2026-08-30 — Phase 3: Discovery (patient read path) — built, tested, checkpoint passed

**Did:** the whole phase in one session — Wave 1 (`P3-CONTRACT-01`), Wave 2 backend (`P3-BE-01..03`),
Wave 2 mobile (`P3-MOB-01..04`) and the integration checkpoint. Read-only throughout: no new writes,
no new tables, no migration.

A patient can now sign in and browse **city → hospital → department → today's session cards → session
detail**, plus the secondary path **doctor search → doctor → their sessions**. 21 new e2e tests, 6 new
contract tests. Suite: **103 tests**, `turbo run lint typecheck test build --force` → **16/16, 0 cached**.

---

### Wave 1 — the frozen bit is the queue snapshot, not the whole contract

New file `packages/contracts/src/discovery/dto.ts`. Phase 2's frozen thing was `QueuePolicy` (the
engine's input); Phase 3's is the **response shape**, because Phase 7 has to fill it without breaking
an already-shipped mobile app. `docs/Phases.md` is explicit: *"ETA and queue-snapshot fields must be
present and nullable now… do not omit them."*

`QueueSnapshot` — six fields, all declared now, half of them inert until later phases:

| Field | Today | Filled by |
|---|---|---|
| `nowServingToken` | `null` | Phase 4 |
| `checkedInCount` | `0` | Phase 4 |
| `bookedNotArrivedCount` | `0` | Phase 4 |
| `registrationOpen` | **computed** from the session alone | Phase 5 ANDs in the policy limits |
| `joinNowEtaFrom` / `joinNowEtaTo` | `null` | Phase 7 |

**Decided: two counts, never one.** `docs/PRD.md` 4.2/7.3 calls this the honest two-number model —
"X checked in ahead of you, Y booked but not arrived". Rejected a single `waitingCount`: collapsing
them is exactly the half-truth that makes a queue app feel like it is lying, and a derived total is
one line of arithmetic on the card.

**Decided: separate `Public*` DTOs from the Phase-2 admin DTOs**, even where the table is the same.
`Department` (admin) carries `isActive`; `PublicDepartment` carries `todaySessionCount` and nothing
internal. Rejected reusing one shape per table — that is how an internal field ends up on a public
endpoint, and the two audiences genuinely differ.

**Decided: the card headlines the CURRENT PROVIDER**, not the doctor the session was booked with, plus
an `isSubstitute` flag. After a substitution (`docs/PRD.md` 8.11) a patient browsing now cares about
who is in the room. `GET /doctors/:id/sessions` matches on the provider for the same reason — a
covering doctor's page shows the clinic they are actually taking, and the booked doctor's does not.

**Decided: `registrationOpen` ships half-computed, and says so.** Phase 3 knows `status`,
`registrationClosedAt` and `scheduledEnd`; the three policy limits (ETA overrun, `cutoffMinsBeforeEnd`,
`maxOnlineTokens`) all need queue data that does not exist until Phase 4. The flag can therefore only
get **stricter** later, never more permissive, and the contract says outright that it is advisory —
`docs/Rules.md` 1 still makes the server the only thing that decides at join time. Rejected omitting
it: without a server-supplied reason the client has to reimplement PRD 8.12, which `docs/CLAUDE.md` 9
forbids.

---

### An endpoint from `docs/Architecture.md` had to change: a route collision

`Architecture.md` 6.2 specifies `GET /hospitals/:id/departments`. Phase 2 already shipped
`GET /hospitals/:hospitalId/departments` for the admin console.

**Express matches on route SHAPE, not on parameter name.** Both are `GET /hospitals/:x/departments`.
Whichever module registered first would win, and the parameter name of the *matched* route is what
`TenantGuard` keys off — so the patient route would either be shadowed (every patient gets a 403 from
TenantGuard) or would shadow the admin one. Silent either way; nothing would have failed to compile.

**Decided:** `GET /departments?hospitalId=<uuid>`, paginated. Same information, no ambiguity.

Rejected: (a) relying on registration order — fragile and invisible; (b) moving the Phase-2 admin route
to `/hospitals/:hospitalId/config/departments` — rework of a signed-off phase, touching the web console
and its tests, to satisfy a doc sketch; (c) inlining departments into `GET /hospitals/:id` — that is an
unbounded list, and the standing instruction is that every list paginates.

`discovery.e2e.test.ts` now asserts both halves: a patient gets **403** on the admin path (proving it
still resolves to the ADMIN controller) and the admin gets the **admin shape** (`isActive` present,
`todaySessionCount` absent). A future route added at a colliding shape fails that test.

Every other discovery route uses `:id`, never `:hospitalId` — the absence of that segment is precisely
what makes `TenantGuard` pass through. Renaming one of them would silently demand a staff membership
and lock every patient out. That is written at the top of the controller.

---

### Wave 2 backend — `apps/api/src/modules/discovery`

Endpoints (all authenticated, none tenant-scoped):

```
GET /cities
GET /hospitals?city=&area=&q=
GET /hospitals/:id
GET /departments?hospitalId=
GET /departments/:id/sessions?date=
GET /doctors?q=&city=
GET /doctors/:id
GET /doctors/:id/sessions?date=
GET /sessions/:id
```

**Decided: authenticated, not `@Public()`.** `docs/Phases.md` calls this path "deliberately public",
which means *not tenant-scoped* — any signed-in patient may see any listed hospital. It does not mean
unauthenticated. `docs/PRD.md` 6.1 has the patient signed in before browsing anyway, and an anonymous
endpoint is one more thing to rate-limit in Phase 9 for nothing gained today.

**Decided, and it is a documented exception: `discovery` reads tables it does not own.**
`docs/CLAUDE.md` 3 forbids cross-module table access, and last session that rule caught a real bug
(`AuthService` writing `HospitalStaff`). This is a deliberate departure, recorded here rather than
quietly taken:

- Nothing here writes. The rule exists to stop two modules mutating the same invariants.
- The owning services are tenant-scoped to a **staff membership** and apply **admin** visibility rules.
  A patient has neither. Routing through them would mean adding a parallel public-read method to each.
- A session card is one join across Hospital × Department × Doctor × OPDSession. Split across four
  services it becomes the per-card N+1 that `docs/Phases.md` names as this phase's headline risk.

The module exports no service, so nothing else in the API can grow a dependency on it. Rejected
alternative: scatter the read endpoints into `config` and `sessions` — that removes the one place the
public visibility rules live, which is the thing most likely to leak.

**Visibility — one shared `where`, not a rule per query:**

| Hidden | Why |
|---|---|
| hospitals not `VERIFIED` | PENDING is unfinished onboarding, SUSPENDED is deliberate; everything else hangs off the hospital, so this one filter hides their departments, doctors and sessions too |
| `isActive: false` departments and doctors | Phase 2 decided DELETE deactivates; this is the other half of that decision |
| `CANCELLED` sessions | cancelled means gone, not merely closed |

`COMPLETED` and `ENDED_EARLY` sessions **stay visible** on purpose. A patient browsing at 16:00 should
see that the morning clinic ran and is over, rather than an empty screen that reads as a broken app.
The card carries the status and `registrationOpen` is false, so nothing about it invites a join.

**N+1, killed by construction.** Two private helpers are the only places a per-card number is produced:
`todayCountsBy()` (one `groupBy` per page for hospital and department session counts) and `snapshots()`
(one map for a page of sessions). `snapshots()` returns zeros today and is the **single** function
Phase 4 and Phase 7 edit — swap the body for a `groupBy` over `QueueEntry.status` and an ETA call, and
every card and detail response fills at once with no call site touched.

**Surprise:** Prisma's `groupBy` infers the row shape from the `by` literal, so a computed key
(`by: [key]`) loses the type and a cast leaks into the *argument* position, producing an error message
about the array type of the return value. Fixed by branching on the key with two literal calls — two
lines longer, zero casts, and `group.hospitalId` is provably a string.

---

### Wave 2 mobile — seven screens

`app/(app)/discover/index` (cities + doctor search) · `discover/[city]` (hospitals) ·
`hospital/[id]` (detail + departments) · `department/[id]` (**the session cards**) ·
`session/[id]` (detail) · `doctors` (search) · `doctor/[id]` (profile + sessions).

Shared: `lib/api.ts` (one `useApi` hook — the path IS the query key), `lib/format.ts`,
`lib/discovery.tsx` (`Pill`, `QueryState`, `Row`, `SessionCardView`, `JoinButton`, `MoreNote`).

**Decided: IST is arithmetic, not `Intl`.** `lib/format.ts` adds a fixed +05:30 and slices the ISO
string, mirroring `apps/api/src/common/ist.ts`. IST has no DST, ever. The reason not to use
`Intl.DateTimeFormat({ timeZone })` is Hermes: the `timeZone` option is the part of Intl that cannot be
relied on across both platforms, and a Mumbai clinic reading 04:30 on a phone set to London is a bug
nobody would notice in a simulator set to IST.

**Decided: `QueryState` handles loading / error / empty in one component.** `docs/Rules.md` 9 requires
all three on every screen; writing them per screen is how one goes missing. A transport failure is
reported as "You appear to be offline" rather than "Network request failed", and every state offers a
retry.

**Decided: one large page (`limit=50`) plus an honest `MoreNote`, not infinite scroll.** The API
paginates; the client says "Showing 50 of N. Narrow your search" instead of silently hiding rows.
Marked `ponytail:` with the upgrade path (`useInfiniteQuery`) for the first real city that overflows.

**The Join button is present, disabled, and says why** — "Booking opens soon", or "Registration closed"
when the server says registration is closed. This is the exact failure `docs/Phases.md` predicts for
this phase (*"or you will file bugs against your own placeholder"*), and it is the same failure the
user hit last session with the `/queue` nav link. Twice is a pattern; every inert control now carries
its reason in text, not just in a disabled style.

Status is never colour-only (`docs/Design.md` 5.3): every pill is dot + written label. Live numbers use
`fontVariant: ['tabular-nums']` so they will not jitter when Phase 7 makes them move.

---

### The fifth wrong green signal — expo-router's typed routes were never being checked

`experiments.typedRoutes: true` has been on since Phase 0. The declaration that makes it real,
`.expo/types/router.d.ts`, is written **only by `expo start`**, and `.expo/` is gitignored.

So on a fresh checkout — which is every CI run — `Href` degrades to `string`, and
`router.push('/dpeartment/[id]')` typechecks perfectly. The mobile typecheck was silently not checking
the one thing typed routes exist for.

Found by accident: the stale local declaration listed only the Phase-0/1 routes, so the first typecheck
of the new screens produced **nine** errors. Regenerating it made all nine legitimate — but the same
nine would have sailed through CI.

**Fixed** rather than noted: `apps/mobile/scripts/generate-router-types.cjs` calls expo-router's
`getTypedRoutesDeclarationFile` directly (synchronously — the exported `regenerateDeclarations` is
debounced 1s and needs the process kept alive) and is wired into the `typecheck` script, so it runs
everywhere instead of only where someone remembered to start the dev server. Marked `ponytail:` because
it reaches into `expo-router/build`; there is no public CLI for this, and an SDK upgrade that moves the
path fails loudly, which is correct.

This is the **fifth** time a green signal in this project was wrong, and the second where the flaw was
that a check silently was not running.

---

### The seed had nothing open to look at

The integration checkpoint is a manual browse, and every session card read **"Registration closed"**.
Not a bug: the seeded schedules are realistic (10:00–13:00 and 15:00–18:00 IST) and the browse happened
at 20:00 IST, so `scheduledEnd > now` was correctly false everywhere. But it makes the open state
impossible to see or demo.

**Did:** the seed now also upserts **one live-now session per hospital** — starts an hour ago, runs four
hours, fee ₹600, token prefix `B`.

Two details that matter:
- **Upserted by a fixed id**, so re-seeding *moves* the window instead of accumulating a session per run.
- **`scheduledStart` has its seconds set to 30.** A generated session always starts on an exact minute
  because it is built from an `"HH:mm"` clock face, so a 30-second offset can never collide with
  `unique(originalDoctorId, date, scheduledStart)`. Without it, seeding at exactly 16:00 IST would hit
  a P2002 against that doctor's own 15:00 session.

---

### Decisions, condensed

| Decision | Rejected alternative |
|---|---|
| `QueueSnapshot` declared in full now, half of it null | omitting the ETA fields and adding them in Phase 7 — a breaking change to a shipped app |
| Two separate ahead-of-you counts | one `waitingCount` |
| `GET /departments?hospitalId=` | `GET /hospitals/:id/departments` — collides with the Phase-2 admin route |
| Discovery owns read-only queries across four tables | routing through config/sessions services — reintroduces per-card N+1 |
| Authenticated, not `@Public()` | anonymous browse — nothing gained, a Phase-9 rate-limit target created |
| Card headlines the current provider + `isSubstitute` | headlining the booked doctor |
| `COMPLETED` sessions stay listed | hiding them — an empty screen reads as broken |
| Fixed +05:30 arithmetic on the client | `Intl` with a `timeZone` — unreliable on Hermes |
| `limit=50` + "showing N of M" | infinite scroll for lists that hold two hospitals |
| Live-now session added to the seed | leaving the checkpoint undemonstrable |

### Known gaps carried forward

- **No `date` picker in the mobile UI** — Phase 3 shows the server's IST today only. The API accepts
  `?date=` and it is tested; no screen sends it.
- **`registrationOpen` is the session-local half of PRD 8.12.** Phase 5 must AND in the policy limits.
  Grep `isRegistrationOpen` in `discovery.service.ts` — the comment says so.
- **No caching**, deliberately (`docs/Phases.md`: an admin edits config in Phase 2 and will not
  understand why their change does not appear). Redis caching is a Phase-9 job, with invalidation.
- **Discovery is unthrottled** like every other endpoint; it joins the Phase-9 rate-limit list, and it
  is the highest-volume read path in the product.
- **`hospitalCount` on `GET /cities` pages in memory** after grouping every listed hospital. Marked
  `ponytail:` — the grouped set is one row per *city*, and the total requires the full grouping anyway.

### Verified

- `pnpm exec turbo run lint typecheck test build --force` → **16/16 successful, 0 cached**, 103 tests.
- 21 new e2e tests against real Postgres, passing first run. They cover: an unverified hospital never
  appearing (asserted via `hospitalCount`, so a leak changes a number rather than merely adding a row),
  deactivated departments and doctors, cancelled sessions, a substituted session, the manual-close flag,
  the explicit-date path, pagination on every list, and the admin-route-collision guard.
- **Integration checkpoint, live against the running API and the seed:** signed up a patient, then
  `city → hospital → departments → session cards → session detail → doctor search → doctor's sessions`.
  Apollo Clinic, Mumbai, 4 sessions today, three departments, cards for Dr. Sharma and Dr. Menon plus
  the live-now one at ₹600 with `registrationOpen: true`, and the detail response carrying all nineteen
  fields with the snapshot nulls intact.

---

## 2026-08-30 — Correction: Phase 3's mobile half was ticked without ever being run

**Reversing the entry above.** That entry says the Phase 3 integration checkpoint passed. It did not,
in the sense `docs/Phases.md` means it. What was actually proven was the **API** path — 21 e2e tests
against real Postgres, plus a live `curl` walk of city -> hospital -> department -> session cards ->
detail -> doctor search against the seed. The **mobile app was never rendered**. Not on a device, not in
a simulator, not once.

`P3-MOB-01..04` were ticked on the strength of typecheck + lint. Their Done-when columns say "browse
seeded hospitals", "drill into departments", "session-first list renders", "search doctor -> sessions" —
every one of those requires the app to run. **Un-ticked**, along with the Phase 3 box in the Progress
Board. `P3-CONTRACT-01` and `P3-BE-01..03` stay ticked; those are genuinely proven.

**This is the same mistake, twice.** Last session the console linked to `/queue`, which 404'd; 92 green
tests never noticed, and the user found it in a browser within a minute. `apps/mobile` has **no test
script at all** (`"test": "echo \"no mobile tests yet\" && exit 0"`), so for the mobile app a green
suite carries almost no information about whether it works. Writing "checkpoint passed" when only the
server half was exercised is exactly the hindsight-flattering claim the append-only rule exists to stop.

**Did, to get closer without a device:** `expo export --platform android` — the app bundles, 1032
modules, compiles to Hermes bytecode. That proves every import resolves and every file compiles for the
target. It proves nothing about layout, navigation, or whether the IST clock formatter shows 10:00
rather than 04:30.

**Found while writing the test steps:** `apps/mobile/.env` still pointed at `10.190.102.149`, a LAN IP
from a previous network. The machine is now on `192.168.0.3`, so a physical device would have failed to
reach the API with a bare "offline" error and no clue why. Updated. This will go stale again every time
the Wi-Fi changes — the comment in that file already says so, and it is now the first step of the
walkthrough.

**Decided:** Phase 3 stays open until the device walkthrough passes. The rule the project already has —
tick a phase only when its integration checkpoint genuinely passes — was applied to Phase 2 and should
not have been relaxed here.

---

## 2026-08-30 — The only navigation cycle in the app, found by the user on a device

**Reported:** Cardiology -> Dr. Neha Gupta's session -> "See this doctor's other sessions" -> a card ->
that session -> the same link again... Every round trip pushed **two** more screens, so after a few
loops getting back to the department list took ten or twelve taps.

**Root cause, not the symptom.** Mapping every `router.push` in `apps/mobile/app` showed the whole
navigation graph was a DAG except for one edge:

```
department/[id] -> session/[id]        doctors -> doctor/[id]
hospital/[id]   -> department/[id]     doctor/[id] -> session/[id]
discover/[city] -> hospital/[id]       session/[id] -> doctor/[id]   <- the cycle
```

`session/[id] -> doctor/[id]` closed a loop with `doctor/[id] -> session/[id]`. Nothing bounded it,
because a stack push is unbounded by design.

**Decided: delete the link rather than bound the cycle.** It was also *redundant*. `Doctor` carries a
single non-null `departmentId`, and a session's department is copied from its doctor
(`sessions.service.ts:132,184`), so a doctor's sessions are always a **subset of the department list
the user arrived from**. The link offered a cycle and no information. Deleting it makes the graph a
DAG, with a maximum depth of five (discover -> city -> hospital -> department -> session).

**Rejected:**
- `dangerouslySingular` (expo-router's built-in "one instance of this route in the stack"). It would
  have bounded the depth at three and kept the link — but it is an opt-in escape hatch whose name is a
  warning, and it would keep a feature that shows strictly less than the screen behind it.
- `router.replace` on one edge — traced it: the stack still grows by one per round trip, just slower.
- `replace` on **both** edges — bounded at two, but it wrecks the primary path: coming from doctor
  search, back from a session would skip the doctor profile you were reading and land on the search
  results.

**What this says about the phase.** This is the third UI defect in a row found by a human on a real
device or browser, after the `/queue` 404 and the seed with nothing open to look at. None of the 103
tests could have caught any of them, and `apps/mobile` still has no test script at all. The device
walkthrough is not a formality on this project; it is the only test the client code gets.

**Verified:** lint, typecheck (with the generated route types) and `expo export --platform android`
all clean — 1032 modules, bundles to Hermes bytecode. `P3-MOB-01..04` stay UNTICKED pending the rest
of the walkthrough.

---

## 2026-08-30 — Phase 3 device walkthrough passed · P3-MOB-01..04 ticked · phase complete

The walkthrough the correction entry above said was owed has now been run by the user on a real device
against the seed. Everything passed. `P3-MOB-01..04` and the Phase 3 box in the Progress Board are
ticked; this time they are ticked because the app was used, not because it compiled.

| Checked | Result |
|---|---|
| Browse city -> hospital -> department -> session cards -> detail | works |
| **IST clock conversion** — cards read 10:00-13:00, not 04:30-07:30 | correct |
| Doctor search by name and by speciality -> profile -> that doctor's sessions | works |
| Offline state, empty state, loading state | all three render |
| Deactivate a department in the console -> it disappears from the patient app, hospital count drops | works |
| Admin console `Configuration -> Departments` still renders with Active/Inactive pills | works |

The IST check was the highest-risk item: nothing in the 103 automated tests touches the client-side
formatter, so a phone-timezone bug would have shipped invisibly. It is right.

The last row is the route-collision regression from earlier this phase, confirmed by hand. That console
page loads by calling `GET /hospitals/{id}/departments?includeInactive=true`; if the new patient route
`/departments` had shadowed it, the page would have 403'd or rendered patient-shaped rows. It renders
the admin shape.

The department-deactivation row is the only check that exercises Phase 2 and Phase 3 together, and it
is the reason discovery has **no caching**: `docs/Phases.md` warns that an admin edits config and then
cannot understand why it does not appear. Caching stays a Phase 9 job, with explicit invalidation.

### What the walkthrough cost, and what that says

Three defects reached the device, and a human found all three:

1. `apps/mobile/.env` pointed at a stale LAN IP, then at the **Hyper-V virtual adapter** with the port
   typo'd to `300` — the app simply said "offline" with no clue why.
2. The `session <-> doctor` navigation cycle, which needed a dozen back-taps to escape.
3. Before that, the seed had no open session to look at, so every card read "Registration closed".

None was catchable by the test suite, because `apps/mobile` has no test script at all. **On this project
the device walkthrough is not a formality — it is the only test the client code gets.** That should be
assumed for every future phase that ships a mobile screen, and budgeted for.

### State at the close of Phase 3

- 103 tests; `pnpm exec turbo run lint typecheck test build --force` -> 16/16, 0 cached.
- Contract, backend and mobile all done. Read-only throughout: no writes, no new tables, no migration.
- **Uncommitted.** Nothing has been committed, branched or tagged; the user has not asked.

---

## 2026-08-31 — Mobile UI rebuild: location-first home, bottom tab bar, real design tokens

**Did:** rebuilt the patient app's presentation layer against `docs/Design.md`. The user's verdict on
the Phase-3 screens was that they looked unfinished. That turned out to be mostly diagnosable rather
than a matter of taste.

**Nothing server-side moved.** No contract, API, schema, seed or test change: 103 tests and
`turbo run lint typecheck test build --force` at 16/16, 0 cached, before and after.

### The largest cause was a bug, not styling

`app/(app)/_layout.tsx` was a bare `<Stack />`. The root layout's `screenOptions` — teal tint, surface
header, canvas background — apply to the **root** stack, whose only children are the route groups.
**A nested navigator inherits nothing**, so those options reached no screen, and every screen in the
app had been rendering React Navigation's stock default header since Phase 0. Header styling now lives
in `(discover)/_layout.tsx` and is shared with the profile stack from one exported object.

### Decisions

| Decision | Why · rejected alternative |
|---|---|
| **Location-first home.** City chosen once on `/location`, remembered, home *is* the hospital list for it | `docs/PRD.md` 6.1 already describes "select city/area → browse hospitals"; only the persistence is new. Rejected asking for the city on every visit — that was a whole screen of friction per session |
| **City in `expo-secure-store`** under `opd.city` | Already a dependency (it holds the tokens). `@react-native-async-storage/async-storage` is the idiomatic home but is **not in the workspace at all** — a genuinely new dep for one short string. Marked `ponytail:` with the swap noted |
| **The city is a display filter, never an authority** | `docs/Rules.md` 1 is intact: the value is passed as `?city=` and the **server** filters, exactly as for a caller who has never opened the app. Nothing about queue state, prices or permissions moved to the phone |
| **Search searches doctors AND hospitals** | A box that only filtered hospitals returns nothing for "Sharma" and reads as broken. Both endpoints already take `city` and `q` and were already tested this phase — no API change |
| **First run shows a prompt, not a redirect** | The root layout's auth Gate already redirects inside an effect. A second effect-driven redirect is how navigation loops start |
| **Each tab owns its own Stack** | So the tab bar stays visible on detail screens. Without that it would not fix the "press back five times" complaint it exists to solve. Rejected pushing details above the tabs — the tab bar would be hidden exactly where it is most needed |
| **Feather from `@expo/vector-icons`** | `docs/Design.md` 6 names Lucide; **Lucide is a fork of Feather**, and Feather ships inside `@expo/vector-icons`, which comes with Expo. So the specified set, no new download, no `react-native-svg` |
| **System fonts, not Inter** | `docs/Design.md` 3 says "Inter, with system fallback". SF/Roboto cost nothing, need no splash gate, and read as more native. Icons and spacing moved the needle far more than the typeface would |

### Route tree

`(discover)` and `profile` are per-tab stacks. Because `(discover)` is a **route group** it does not
appear in URLs, so every existing `router.push` target survived the move unchanged — confirmed against
the generated `router.d.ts`. Deleted: the old home and `discover/[city]`. The city route is
deliberately `/location`, not `/[name]` at group root, which would have been a catch-all swallowing
`/doctors` and `/profile`.

### Smaller things that were actually wrong

- **Android press feedback.** Every `Pressable` faded opacity; Android expects a ripple. One
  `pressable()` helper now returns `android_ripple` on Android and opacity on iOS, and everything
  tappable goes through it. This was the one genuinely new thing the UI research turned up.
- **`theme.ts` had no shadow tokens** despite `docs/Design.md` 4 defining three levels. Added — with
  **both** the iOS `shadow*` family and Android's `elevation` on every level, because setting one
  gives a card raised on one platform and flat on the other.
- **No safe-area handling** — `react-native-safe-area-context` was installed and unused.
- **Empty states were grey text**; they are now an icon in a teal-50 circle per `docs/Design.md` 10.
- **Status pills were colour + label**; they now carry an icon too, which is what §5.3/§2.4 specify.

### Surprises

- **`theme` being `as const` narrowed a default parameter to a literal.** `pressable(radius = theme.radius.md)`
  inferred `radius: 10`, so passing `radius.lg` was a type error. Annotating `radius: number` fixes it.
  Worth knowing: every helper that defaults to a token needs an explicit widening annotation.
- The typed-route generator wired in earlier this phase paid for itself immediately — moving nine
  screens produced a valid `router.d.ts` on the first try and would have caught any stale `href` as a
  compile error rather than a runtime 404.

### Verified

`turbo run lint typecheck test build --force` → 16/16, 0 cached, 103 tests.
`expo export --platform android` → bundles clean, 1056 modules (up from 1032 — the icon package),
2.81 MB Hermes bytecode.

**Not yet verified: the device walkthrough.** `apps/mobile` has no test script, so nothing above is
evidence that the app *looks* right or that the tab bar behaves. That check is owed before this is
committed, and `P3-MOB-01..04` were already ticked on the previous UI — the rebuild replaces what was
walked through, so it needs walking again.

---

## 2026-08-31 — Avatar was inert; Design.md and Architecture.md brought back in line with what was built

**Reported:** tapping the avatar on the home screen did nothing. It should open Profile — an avatar in
the top-right corner is a link everywhere else in the world, so a dead one is a defect, not a missing
feature.

**Fixed:** it now pushes `/profile`. Worth noting the mechanic: `/profile` belongs to the **other
tab**, and expo-router switches tabs for a route that lives in one rather than pushing it onto the
current stack. So this crosses tabs and does not deepen the Discover stack — the same discipline that
killed the session↔doctor cycle.

### The docs had drifted, and one line was actively wrong

`PROGRESS.md` had the UI rebuild, but the two authoritative docs did not. Corrected:

**`docs/Architecture.md`**
- §6.2 listed **`GET /hospitals/:id/departments`**, which is the route that **cannot exist** — it
  collides with Phase 2's admin route, and Express matches on shape rather than parameter name, so one
  silently shadows the other. Replaced with the real `GET /departments?hospitalId=`, plus the
  rationale and a pointer to the test that guards it. The three doctor endpoints built in Phase 3 were
  missing entirely; added. Noted that the `QueueSnapshot` in these responses is a frozen shape.
- §4's module tree still listed `hospitals/ departments/ doctors/ schedules/` as four separate modules,
  which was never built that way — it has been wrong since Phase 2 and nobody corrected it. Now shows
  `config/`, `staff/`, `discovery/`, with both deliberate departures written down: why `config` is one
  module, and why `discovery` is allowed to read tables it does not own.

**`docs/Design.md`** — the rebuild followed this doc, so these are *as-built* annotations rather than
changes to the system. They exist so a later session does not "fix" a deliberate choice:
- §3 — mobile ships the **system font** on purpose. The doc already sanctioned the fallback; the note
  records what Inter would actually cost (a dependency, ~400KB, a splash gate) and that the native
  faces read as less templated, not more.
- §5.9 — the shipped tab set is **Discover + Profile**; My Visits waits for Phase 5 because a tab that
  leads nowhere is worse than an absent one. Also records that each tab owns a stack, and why.
- §5.10 (new) — the **location-first home** pattern, with the layout, the both-kinds search box, the
  first-run prompt, and the reminder that the city is a display filter and never an authority.
- §6 — pins the icon set actually used: **Feather via `@expo/vector-icons`**, which is what "e.g.
  Lucide" resolves to given Lucide is a fork of Feather and Feather ships with Expo.
- §12 — two React Native facts that cost time: elevation needs **both** the iOS `shadow*` family and
  Android's `elevation` on every level, and press feedback must be a ripple on Android.

**Decided:** annotate rather than rewrite. These docs describe intent; where the build justifiably
diverged, the divergence and its reason belong beside the original line, not in place of it. A future
session reading §3 should see both "Inter" and why mobile does not use it.

---

# 📌 HANDOFF (Phases 0–1) — SUPERSEDED

> **Superseded by 📌 HANDOFF v2 at the bottom of this file.** Kept, not deleted: its
> "five things most likely to waste your time" are all still true, and this file does not
> rewrite its own history. Where the two disagree about project state, v2 wins.

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

---

# 📌 HANDOFF v2 (Phase 2) — SUPERSEDED

*Written at the end of the session that reviewed Phase 2's frozen contract, built all of Phase 2
Wave 2, and added the accept-invite flow. Supersedes the Phases 0–1 handoff above, which is kept
because the traps it records are all still true.*

---

## 1. Where the project actually stands

| Phase | State |
|---|---|
| 0 — Foundation | ✅ complete, tagged `phase-0-done` |
| 1 — Identity & Tenancy | ✅ complete, tagged `phase-1-done` |
| 2 — Hospital Config + Admin + Seed | 🟡 **built and verified, NOT signed off** — see §2 |
| 3 — Discovery | ☐ not started |
| 4 — Queue Engine | ☐ not started |

**Everything from Phase 2 onward is UNCOMMITTED.** 34 changed/new paths, two migrations. Nothing has
been committed or tagged, because the user has not asked. `git status` is the inventory.

**Health:** `pnpm exec turbo run lint typecheck test build --force` → **16/16, 0 cached**.
**92 tests** (82 in `apps/api` across 6 files, 25 in `packages/contracts`). Was 49 at the end of
Phase 1.

Working and proven end to end: signup / login / refresh / logout, `/me`, patient CRUD, the three
global guards, the web console login, departments / doctors / schedules / queue-policy / sessions /
staff-invite APIs, the five admin screens, the seed, and accept-invite.

---

## 2. The ONE thing standing between here and `phase-2-done`

A human has to look at the five admin screens. Everything reachable without eyes is already proven:
all five pages render with real seeded data, a server action persists through the whole stack, the
error banner renders, and a receptionist is redirected away. What is **not** verified is visual —
layout, spacing, whether the forms read well.

### The steps the user agreed to run

Docker (`opd-postgres`, `opd-redis`) should already be up; start it with `docker compose up -d` if
not. **Re-seed first** — the test suite TRUNCATEs the dev database, so a `turbo run test` leaves the
console showing empty screens:

```
pnpm seed
```

**1. Two separate terminals**, both from the repo root. They stay running, so do not use Claude
Code's `!` prefix, which blocks:

```
pnpm --filter @opd/api dev     # terminal A — wait for "Nest application successfully started"
pnpm --filter @opd/web dev     # terminal B — wait for "Ready in ..."
```

**2. Log in** at http://localhost:3001/login as `admin@apollo.test` / `Demo@12345`.
Sidebar should read "Apollo Clinic · ADMIN". Click **Configuration**.

**3. Walk the five screens.** Expected seeded content for Apollo: **3 departments**
(Cardiology, Orthopaedics, General Medicine), **4 doctors** (Anita Sharma, Rohit Menon, Kavita Rao,
Suresh Iyer), **28 schedules**, **4 sessions today**.

- **Departments** — add one; rename inline and Save; Deactivate (the row stays, flips to
  `○ Inactive` with a Reactivate button); add a duplicate name and expect a red "Error:" banner.
- **Doctors** — edit a row and Save. In the **Login** column enter any email → Invite. A **green
  panel appears at the top** with `/accept-invite?token=…`. **Copy the whole link**; it is shown once
  and the cookie holding it expires in 3 minutes.
- **Schedules** — 28 blocks means pagination is visible: "Page 1 of 2". Click Next. Edit a row.
  Set End earlier than Start and expect an error banner.
- **Sessions** — click **Generate** with the date blank → expect
  *"0 sessions created, 4 already existed — running this twice is safe."* Then filter to a future
  date, Generate again, expect *"4 sessions created, 0 already existed."* Check "Window (IST)" reads
  10:00–13:00 / 15:00–18:00 and is **not** shifted by 5½ hours.
- **Queue policy** — every control filled, none blank. Change Grace period to 300, Save, reload,
  confirm it stuck. **This screen mirrors the frozen schema field-for-field — wrong or confusing
  wording here matters, because it is the shape the entire Phase-4 engine reads.**

**4. Test the invitation** in a **private/incognito window** (so it does not share the admin
session): paste the copied link, set a password twice (10+ chars), submit. Expect to land in the
console with the sidebar reading "Apollo Clinic · DOCTOR". Paste the same link again → expect
"This invitation is not valid" (the token is single-use).

**5. Ctrl+C both terminals.** This matters — a running dev server holds a lock on the Prisma engine
DLL and the next `prisma generate` fails with `EPERM`. That already cost a session once.

**6. Report back.** Then tick the Phase 2 box in `docs/Phases.md` §0 and tag `phase-2-done`,
**only if the user asks** for the commit and tag.

---

## 3. Traps — the ones that have actually cost time

Carried from the Phases 0–1 handoff, all still true:

1. **A green Turbo result can be a lie.** It has cached "passing" tasks that never ran. Verify
   anything that matters with `pnpm exec turbo run lint typecheck test build --force`.
2. **esbuild (Vitest, `tsx`) does not implement `emitDecoratorMetadata`**, so NestJS DI silently
   resolves every constructor parameter as `undefined`. `unplugin-swc` is wired into
   `apps/api/vitest.config.ts` — do not remove it, and do not move the API's dev/build off the Nest CLI.
3. **Turbo runs tasks in a filtered environment.** A new env var must go in `globalPassThroughEnv`
   in `turbo.json` or the task never sees it. Invisible locally, because `process.loadEnvFile()`
   bypasses Turbo; it bites in CI.
4. **pnpm's isolated layout hides transitive deps** — declare them explicitly.
5. **Expo SDK is pinned to 54 deliberately** — it is what the test device's Expo Go supports.

Added this session:

6. **`--force` plus a real `build` has now caught four wrong green signals.** The newest:
   `tsc --noEmit` passes on a `'use server'` module that exports a plain constant, and the Next build
   fails on it. A `'use server'` file may export **only async functions**. Non-function shared values
   go in `app/(console)/config/_run.ts`.
7. **`prisma migrate reset` and `prisma migrate dev` are both unusable here** — reset is blocked by
   the permission classifier, and `migrate dev` needs a TTY. The working recipe for a hand-written
   migration is: write `migration.sql` by hand (or generate it with `prisma migrate diff --script`),
   `prisma migrate deploy`, then **prove it** with
   `prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --shadow-database-url postgresql://opd:opd_local_dev@localhost:5433/opd_shadow?schema=public --exit-code`
   → must say "No difference detected". Create `opd_shadow` first and drop it afterwards. This is a
   stronger check than `migrate status` and never touches the dev database.
8. **Stopping a dev server does not stop it.** Killing the `pnpm --filter … dev` wrapper leaves the
   node process listening. Kill by port: `netstat -ano | grep ":3000 .*LISTENING"` → `taskkill //PID <pid> //F`.
9. **Never run manual `psql` checks while the integration suite is running.** They deadlock — the
   suite holds AccessExclusiveLock via TRUNCATE while fixtures hold RowExclusiveLock.
10. **React server-rendering splits `Every {day}` into `Every<!-- -->Sunday`.** A grep for the rendered
    phrase misses on a page that renders it correctly. Search for `>Sunday<` instead.
11. **The e2e suite TRUNCATEs the dev database.** Run `pnpm seed` after any `turbo run test` if you
    want a browsable console.

---

## 4. Decisions that constrain future work

Read the full reasoning in the entries above; these are the ones a new session will trip over.

- **`QueuePolicy` is frozen** and is the input to the entire Phase-4 engine. Three registration
  limits are ANDed, not an either/or enum. `RequeueBehavior.NO_REQUEUE` means **terminal `NO_SHOW`**,
  refunded by `cancellationRules.noShowRefundPct`. `checkInRequired: false` means a booked entry is
  callable without checking in, and makes PRD 8.9 unenforceable for that hospital.
- **`OPDSession` holds no `queuePolicyId`.** `hospitalId` determines the policy (it is `@unique` on
  `QueuePolicy`). Read the policy by `hospitalId`; `QueuePolicyService.ensure()` guarantees a row.
- **DELETE deactivates** departments and doctors (`isActive`), because every FK to them is
  `onDelete: Restrict`. Schedules really are deleted — sessions keep provenance via `SetNull`.
- **Every clock↔instant conversion goes through `apps/api/src/common/ist.ts`.** Never an inline
  `new Date()` in the generate path. `@db.Date` is read with `toISOString().slice(0,10)`, never a
  locale formatter.
- **P2002 → 409 is mapped once**, in `apps/api/src/common/prisma-errors.ts`.
- **One `config` module owns departments, doctors, schedules and policy.** `sessions` and `staff`
  reach it only through exported services — docs/CLAUDE.md §3 forbids cross-module table access.
  This rule already caught a real violation (`AuthService` writing `HospitalStaff`) that typechecked
  and passed every test.
- **The admin console uses Next server actions, not TanStack Query.** A deliberate, user-approved
  deviation from CLAUDE.md §9: the console is server-components-only and a client cache cannot read
  the httpOnly cookie. TanStack Query stays installed for Phase 6/7's realtime screens, where it fits.
- **In a server action: counts go in the query string, secrets go in a short-lived cookie.**
- **Sessions are created `OPEN_FOR_REGISTRATION`** and there is no `status` on the create DTO. Every
  later status change is a Phase-4 domain command (Rules.md §1.2).

---

## 5. Known gaps carried forward

- ~~**Google ID-token exchange has never run against a real token.**~~ **CLOSED** — verified against a
  real token; `P1-BE-02` is ticked. What remains is that **no client has a Google button**: `apps/mobile`
  and `apps/web` contain zero Google code, so the working endpoint is unreachable by a user. Needs iOS +
  Android client ids and `expo-auth-session` in the mobile sign-in screen.
- **`/auth/accept-invite` is public and unthrottled.** The token is 32 random bytes so guessing is
  not the practical risk, but it belongs on the Phase-9 rate-limit list beside signup, login and the
  Razorpay webhook.
- **No way to revoke an outstanding invitation** short of re-inviting to burn the old token.
- **`GET /patients` is unbounded** — a conscious one-off. Every Phase-2 list paginates.
- **Expired `RefreshToken` rows are never pruned** — belongs with the Phase-8 workers.
- **Two `/me` calls per config page render** (layout + page each resolve the hospital). Harmless for
  an admin console; do not let the pattern spread to a hot path.
- **CI actions warn about Node 20 deprecation.** Not breaking.
- **The folder is still `C:\Projects\New folder`.** Renaming is safe for the code, but Claude Code
  keys per-project memory to the folder path — copy the memory directory to the new key first.

---

## 6. Prompt for the next session

Paste this to pick the work back up:

> Continue building the OPD Queue Platform. Read `docs/PROGRESS.md` — start at the 📌 HANDOFF v2
> section at the bottom, which is the current brief; the handoff above it is superseded.
>
> Phases 0 and 1 are complete and tagged. **Phase 2 is built and verified but not signed off**: all
> subtasks are ticked, 92 tests pass, and I still owe it the manual browser walkthrough described in
> §2 of that handoff. Nothing from Phase 2 is committed yet — do not commit or tag unless I ask.
>
> Before anything else, tell me: (a) whether I have reported back on the Phase 2 walkthrough, and if
> not, whether you want me to run it now; (b) what you plan to do first.
>
> Then continue with **Phase 4 — Queue Engine** unless I say otherwise. Read `docs/Phases.md`
> Phase 4 in full first. It is the highest-risk phase in the project and Phases.md says explicitly
> to slow down: Wave 1 is the contract + schema, Wave 2 is the pure table-driven state machine plus
> the `SELECT … FOR UPDATE` transaction skeleton, and Wave 3 is command-per-file. **Do not
> parallelise Wave 3 unless every command really is its own file.** Show me the Wave 1 diff before
> Wave 2, the same way Phase 2's frozen contract was reviewed.
>
> Three standing rules from previous sessions:
> - Verify with `pnpm exec turbo run lint typecheck test build --force`. A cached green result has
>   lied four times now.
> - Every list endpoint paginates. `GET /patients` is the one documented exception, not a precedent.
> - Append to `docs/PROGRESS.md` as you go — what you did, what you decided, **why**, and what you
>   rejected. Failures and dead ends are the most valuable entries. Tick the ☐ in `docs/Phases.md`.
>
> Run `pnpm seed` before any manual browser check — the test suite truncates the dev database.
> Docker may need `docker compose up -d`.

*(If Phase 3 — Discovery is wanted instead, it is lower risk and read-only, and the seed already
gives it something to show. Phases.md says 3 and 4 can run in parallel.)*

---

# 📌 HANDOFF v3 — read this first in a new session

*Supersedes HANDOFF v2. The two handoffs above are history; this one is the brief.*

## 1. Where the project actually stands

| Phase | State |
|---|---|
| 0 — Foundation | ✅ done, merged, tagged `phase-0-done` |
| 1 — Identity & Tenancy | ✅ done, merged, tagged `phase-1-done` |
| 2 — Hospital Config + Admin + Seed | ✅ done, merged, tagged `phase-2-done` |
| 3 — Discovery | ✅ **complete** — device walkthrough passed; **not committed** |
| 4 — Queue Engine | ☐ next, and the highest-risk phase in the project |

`main` was clean and green before Phase 3 started. **Phase 3 is uncommitted** — do not commit, branch
or tag unless the user asks. Its integration checkpoint passed on a real device on 2026-08-30 — all
eight P3 subtasks and the Phase 3 board box are ticked.

**Budget for a device walkthrough in every phase that ships a mobile screen.** `apps/mobile` has no
test script, so lint + typecheck + bundle is the entire automated evidence for seven screens. Three
defects reached the device in Phase 3 and a human found all three.

- **103 tests.** `pnpm exec turbo run lint typecheck test build --force` → 16/16, 0 cached.
- The patient app now browses city → hospital → department → session card → detail, plus doctor search.
  Nothing in it writes.
- Everything a patient sees is decided by the server, including whether the Join button says "Join" or
  "Closed". Join itself is inert until Phase 5, and says so on screen.

## 2. To look at it yourself

```bash
docker compose up -d
pnpm --filter @opd/api seed        # the test suite TRUNCATEs the dev database - re-seed after any test run
pnpm --filter @opd/api start       # API on :3000
pnpm --filter @opd/mobile dev      # Expo; set EXPO_PUBLIC_API_URL to your LAN IP for a physical device
```

Sign up any new account in the app (a patient needs no staff membership) → **Browse hospitals**.
Seeded logins for the admin console are `admin@apollo.test` / `Demo@12345`.

The seed guarantees at least one card reading **Open** — it upserts a live-now session per hospital
precisely so the open state is visible whatever time you look. The other cards are the realistic
10:00–13:00 and 15:00–18:00 IST clinics and will read "Registration closed" outside those hours. That
is correct behaviour, not a bug.

## 3. Traps — the ones that have actually cost time

Carried forward and still true:

1. **A green Turbo result can be a lie.** Verify with `--force`. **Five wrong greens so far.**
2. **esbuild does not implement `emitDecoratorMetadata`** — `unplugin-swc` in `apps/api/vitest.config.ts`
   is load-bearing. Do not remove it; do not move the API off the Nest CLI.
3. **Turbo runs tasks in a filtered environment** — a new env var must go in `globalPassThroughEnv`.
4. **pnpm's isolated layout hides transitive deps** — declare them explicitly.
5. **Expo SDK is pinned to 54 deliberately** — it is what the test device's Expo Go supports.
6. **A `'use server'` file may export only async functions.** `tsc --noEmit` passes; `next build` fails.
7. **`prisma migrate reset` and `migrate dev` are both unusable here** (permission classifier / no TTY).
   Hand-write `migration.sql`, `migrate deploy`, then prove it with
   `prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --shadow-database-url postgresql://opd:opd_local_dev@localhost:5433/opd_shadow?schema=public --exit-code`
   → must say "No difference detected".
8. **Stopping a dev server does not stop it.** Kill by port:
   `netstat -ano | grep ":3000 .*LISTENING"` → `taskkill //PID <pid> //F`.
9. **Never run manual `psql` checks while the integration suite runs** — TRUNCATE vs fixtures deadlocks.
10. **React SSR splits `Every {day}` into `Every<!-- -->Sunday`** — grep for `>Sunday<`.
11. **The e2e suite TRUNCATEs the dev database.** Re-seed before any manual browse.

Added this session:

12. **Express matches routes by SHAPE, not by parameter name.** `GET /hospitals/:id/departments` and
    `GET /hospitals/:hospitalId/departments` are the same route; one silently shadows the other, and the
    matched route's parameter name is what decides whether `TenantGuard` engages. Discovery routes
    therefore use `:id` and never `:hospitalId`. `discovery.e2e.test.ts` guards both halves of this.
13. **Prisma `groupBy` infers row shape from the `by` literal.** A computed key kills the typing and the
    cast surfaces as a confusing error about the *argument*. Branch on the key instead of casting.
14. **expo-router typed routes were never checked in CI** — `.expo/` is gitignored and only `expo start`
    writes `router.d.ts`, so `Href` silently degrades to `string`. Now generated by
    `apps/mobile/scripts/generate-router-types.cjs` inside the `typecheck` script. If mobile typecheck
    starts failing on route strings after an SDK upgrade, that script is where to look.
15. **The seed's `unique(originalDoctorId, date, scheduledStart)` is easy to trip.** Generated sessions
    always start on an exact minute; the seed's live-now session sets seconds to 30 to stay clear of it.

## 4. Decisions that constrain future work

Phases 0–2 decisions still hold (read HANDOFF v2 §4). Added by Phase 3:

- **The discovery response shape is frozen.** `QueueSnapshot`'s six fields are named and typed now;
  Phase 4 fills the counts and `nowServingToken`, Phase 7 fills the ETA window. **Changing the shape
  breaks a shipped mobile app** — adding a field is fine, renaming or removing one is not.
- **`snapshots()` in `discovery.service.ts` is the ONE place per-card queue numbers are produced.**
  Phase 4 replaces its body with a single `groupBy` over `QueueEntry.status` keyed by sessionId; Phase 7
  adds the ETA call. No call site should need to change. Per-card queries are the named risk here.
- **`registrationOpen` is currently the session-local half of PRD 8.12.** Phase 5 must AND in
  `cutoffOnEtaOverrun`, `cutoffMinsBeforeEnd` and `maxOnlineTokens`. It can only get stricter.
- **`discovery` is a read-only projection module and deliberately reads tables `config` and `sessions`
  own** — an explicit, recorded exception to `docs/CLAUDE.md` 3. It writes nothing and exports no
  service. Do not extend the exception to anything that writes.
- **Public visibility rules live in exactly two constants** — `LISTABLE_HOSPITAL` and
  `listableSession()` at the top of `discovery.service.ts`. A new patient-facing read must use them.
- **`GET /departments?hospitalId=`**, not `/hospitals/:id/departments` (see trap 12).
- **The card shows the current provider, not the booked doctor**, and `/doctors/:id/sessions` matches
  the provider. Phase 4's substitution command inherits that meaning.

## 5. Known gaps carried forward

- **No client has a Google sign-in button.** The endpoint is verified against a real token; nothing
  calls it. Needs iOS + Android client ids and `expo-auth-session`.
- **No date picker in mobile discovery** — the API accepts `?date=` and it is tested; no screen sends it.
- **No caching on discovery**, deliberately — Phase 9, with explicit invalidation.
- **`/auth/accept-invite` and all of discovery are unthrottled** — Phase 9 rate-limit list, alongside
  signup, login and the Razorpay webhook.
- **No way to revoke an outstanding invitation** short of re-inviting to burn the old token.
- **`GET /patients` is unbounded** — the one documented exception. Everything since paginates.
- **Expired `RefreshToken` rows are never pruned** — Phase 8 workers.
- **Two `/me` calls per config page render** — harmless for an admin console; keep it off hot paths.
- **The folder is still `C:\Projects\New folder`.** Renaming is safe for the code, but Claude Code keys
  per-project memory to the folder path — copy the memory directory to the new key first.

## 6. Prompt for the next session

> Continue building the OPD Queue Platform. Read `docs/PROGRESS.md` — start at **📌 HANDOFF v3** at the
> bottom, which is the current brief; the two handoffs above it are superseded.
>
> Phases 0, 1 and 2 are complete, merged and tagged. **Phase 3 (Discovery) is built, tested and its
> integration checkpoint passed, but is not committed** — 103 tests, `turbo run lint typecheck test
> build --force` green at 16/16, 0 cached. Do not commit, branch or tag unless I ask.
>
> Next is **Phase 4 — Queue Engine**. Read `docs/Phases.md` Phase 4 in full before touching anything.
> It is the highest-risk phase in the project and Phases.md says explicitly to slow down: Wave 1 is the
> contract + schema, Wave 2 is the pure table-driven state machine plus the `SELECT … FOR UPDATE`
> transaction skeleton, and Wave 3 is command-per-file. **Do not parallelise Wave 3 unless every command
> really is its own file.** Show me the Wave 1 diff before starting Wave 2, the way Phase 2's frozen
> contract and Phase 3's response shape were both reviewed.
>
> Two things Phase 3 left for you, both marked in the code:
> - `snapshots()` in `apps/api/src/modules/discovery/discovery.service.ts` is the single place per-card
>   queue numbers are produced. Fill it with ONE `groupBy` over `QueueEntry.status` keyed by sessionId —
>   never a query per card.
> - `QueueSnapshot` in `packages/contracts/src/discovery/dto.ts` is a frozen response shape the mobile
>   app already renders. Fill `nowServingToken`, `checkedInCount` and `bookedNotArrivedCount`; do not
>   rename or remove anything.
>
> Standing rules:
> - Verify with `pnpm exec turbo run lint typecheck test build --force`. A cached green has lied five times.
> - Every list endpoint paginates. `GET /patients` is the one documented exception, not a precedent.
> - Append to `docs/PROGRESS.md` as you go — what you did, what you decided, **why**, and what you
>   rejected. Failures and dead ends are the most valuable entries. Tick the ☐ in `docs/Phases.md`.
>
> Run `pnpm --filter @opd/api seed` before any manual browser or app check — the test suite truncates the
> dev database. Docker may need `docker compose up -d`.

*(Phase 3 and Phase 4 were designed to run in parallel; Phase 3 is now done, so Phase 4 has no
competition for attention. Phases 5–7 all depend on it.)*
