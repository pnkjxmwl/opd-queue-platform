# Phases — Master Build & Parallel Execution Plan

## OPD Queue Platform

**Status:** Draft v4 (detailed · human-readable · parallel-agent-ready · trackable)
**Companion docs:** PRD.md · Architecture.md · Rules.md · Design.md · PROGRESS.md (build log)

> This is the authoritative build plan. Every phase has three layers:
> - **A human layer** (📦 what you'll have · 🔄 how the flow looks now · 🔌 endpoints · ➡️ next) so you can follow the story.
> - **A build layer** (🛠️ waves + subtask tables) so multiple agents can execute in parallel.
> - **An execution layer** (🤖 agent kickoff · ⚠️ risks & pitfalls · ↩️ if it goes wrong) so you can actually drive it.
>
> Track progress in **§0 Progress Board**. Read **§A Parallel Execution Model** and **§A.8 kickoff protocol**
> before starting any phase. Every subtask row carries a `☐` — tick it when its *Test / Done-when* passes.

---

# 0. Progress Board

Tick a phase box the moment its **Integration checkpoint** passes — not when the code is written.
Every subtask row in this doc carries its own `☐`; tick those as you go and the phase box last.
Narrative history, decisions and surprises go in **PROGRESS.md**; this table is just the scoreboard.

| ✓ | Phase | Size | Est. focused days | Parallel agents | Tag when done |
|---|---|---|---|---|---|
| ☐ | 0 — Foundation / Scaffold | S | 1–2 | 3 | `phase-0-done` |
| ☐ | 1 — Identity & Tenancy | M | 3–4 | 3 | `phase-1-done` |
| ☐ | 2 — Hospital Config + Admin + Seed | L | 5–7 | 4 | `phase-2-done` |
| ☐ | 3 — Discovery | M | 3–4 | 4 | `phase-3-done` |
| ☐ | 4 — Queue Engine | XL | 8–12 | 4 (with care) | `phase-4-done` |
| ☐ | 5 — Join + Payment → Token | L | 5–7 | 3 | `phase-5-done` |
| ☐ | 6 — Doctor + Staff Consoles | L | 5–7 | 4 | `phase-6-done` |
| ☐ | 7 — Realtime + ETA | L | 5–7 | 4 | `phase-7-done` |
| ☐ | 8 — Notifications + Background Jobs | M | 4–5 | 5 | `phase-8-done` |
| ☐ | 9 — Hardening | L | 5–7 | 6 | `phase-9-done` |
| ☐ | 10 — Staging Deploy + Pilot | M | 3–4 | 3 | `phase-10-done` |

**MVP total: ~47–66 focused days.**

## 0.1 How to read the estimates

- A **focused day** is ~5–6 hours of you actively driving agents, reading diffs and testing — not a calendar day.
- These assume **one person driving Claude Code**, not a team. The "parallel agents" column is how many agents
  can work *simultaneously*, which compresses wall-clock time but **not your review time**. You are the
  bottleneck, and review does not parallelize — see §A.8.2.
- Realistic calendar time at 3–4 productive days a week: **~4–5 months** to a pilot-ready staging build.
- **Sizing legend:** `S` = 1–2 days · `M` = 3–5 · `L` = 5–7 · `XL` = 8–12.
- Two estimates that bite if ignored: **Phase 4 is the one to slow down on** (it *is* the product), and
  **Phase 10 has calendar-time dependencies** — Apple/Google developer accounts, business KYC, hospital
  paperwork — that no amount of coding speed fixes. Start that paperwork during Phase 8.

## 0.2 Phase entry gate (Definition of Ready)

Do not start a phase until all of these are true:

- [ ] The previous phase's **Integration checkpoint** passed and is tagged.
- [ ] `main` is green (lint + typecheck + test); all previous phase branches are merged or deleted.
- [ ] You have re-read this phase's **⚠️ Risks & pitfalls** section.
- [ ] The Wave 1 owner is decided (usually you, or one foundation agent you review closely).
- [ ] Any calendar-time dependency for a *later* phase has already been started (see §0.1).

---

# A. Parallel Execution Model

The point of this doc is to let you run several agents at once and still get a coherent system.
Parallelism is organized into **waves** inside each phase.

## A.1 Waves (the core mental model)

```
Wave 1  — CONTRACT + SCHEMA        (1 agent, sequential, BLOCKS everything else in the phase)
Wave 2  — PARALLEL IMPLEMENTATION  (N agents, one per app/stream, no shared files)
Wave 3+ — INTEGRATION + E2E        (1 agent wires streams together, runs the phase test)
```

- **Everything in the same wave with no dependency between them can run simultaneously** on separate agents.
- **Never start Wave 2 until Wave 1 is merged.** The frozen contract is what lets the parallel streams not collide.
- Some phases (e.g. the Queue Engine) add an extra wave for a shared core (the state machine) before the parallel command work.

## A.2 Work streams (who owns which files)

| Stream | Owns (directories) | Notes |
|---|---|---|
| **CONTRACT** | `packages/contracts` | Zod DTOs, enums, error codes. The shared interface. |
| **DB** | `apps/api/prisma` | Prisma schema + migrations. |
| **BE** | `apps/api/src` | NestJS modules, services, commands, workers. |
| **WEB** | `apps/web` | Next.js console (doctor/staff/admin). |
| **MOB** | `apps/mobile` | Expo patient app. |
| **INFRA** | root, `.github`, deploy config | Monorepo, CI, docker, hosting. |
| **TEST** | co-located with owner | Unit/integration/E2E. Often the same agent as the stream. |

**The golden parallel rule:** parallel agents must own **different directories**. The safe fan-out is
`apps/api` ∥ `apps/web` ∥ `apps/mobile`. Within `apps/api`, split by **module** or **command-per-file**
so two BE agents never edit the same file.

## A.3 Contract-first rule (critical)

1. Wave 1 defines the phase's `packages/contracts` Zod schemas **and** the Prisma schema changes.
2. These are reviewed and merged **before** any Wave 2 agent starts.
3. If a Wave 2 agent discovers the contract is wrong → **stop, fix the contract centrally, re-sync all streams.** Do not let two streams diverge on the shape of data. (Rules.md §1.8, §15)

## A.4 Isolation & merge

- Run each parallel agent in **its own git worktree or branch** (the Agent tool supports `isolation: "worktree"`).
- Branch naming: `phaseN/<stream>-<short-desc>` (e.g. `phase4/be-noshow-commands`).
- Merge order per phase: **CONTRACT+DB → BE → WEB/MOB → integration.** Rebase Wave-2 branches on the merged Wave-1 before opening PRs.

## A.5 Mock-then-integrate (keeps UI agents unblocked)

- WEB/MOB agents build against the **frozen contract** using mocked responses (fixtures / MSW) so they never wait on the backend.
- At the integration wave, point them at the real API and run the end-to-end test.

## A.6 Suggested agent roster

- **1 × Foundation agent** — Wave 1 (contract + schema). Often becomes the BE agent.
- **1–3 × Feature agents** — Wave 2 (BE modules, WEB screens, MOB screens), one per directory.
- **1 × Integration/Test agent** — Wave 3 (wire + E2E). Can be you driving it.

Scale the number to the phase (Phase 0 needs ~1–2; Phase 6 splits nicely across 3–4).

## A.7 Definition of Done (every subtask)

A subtask is done only when its **Test / Done-when** passes **and** the Rules.md cross-cutting checklist holds:
tenant-scoped, Zod-validated, audit+event written (for queue actions), consistent errors, `lint + typecheck + test` green.

---

## A.8 How to launch an agent (kickoff protocol)

The plan is only as good as the prompt you hand the agent. A vague prompt produces an agent that invents
its own contract, edits files it doesn't own, and reports "done" without a passing test.

Every kickoff prompt must carry **five things**:

| # | Element | Why it matters |
|---|---|---|
| 1 | **Identity** — subtask ID + stream | Anchors the agent to one row of one table. |
| 2 | **Boundary** — the directories it may write to | The single most important line. Prevents parallel agents colliding. |
| 3 | **Contract** — what Wave 1 already froze | Stops the agent redefining types that already exist. |
| 4 | **Done-when** — the row's test, verbatim | Turns "done" into something falsifiable. |
| 5 | **Guardrails** — Rules.md + Appendix 4 | Tenant scoping, Zod, audit, error shape. |

### A.8.1 The template

```text
You are the <STREAM> agent for <SUBTASK-ID> — OPD Queue Platform.

READ FIRST: docs/Phases.md (Phase <N>), docs/Rules.md, docs/Architecture.md <§section>.

YOU OWN (write only here): <directories>
READ-ONLY: everything else. Do NOT edit packages/contracts unless you are the CONTRACT agent.
If you believe the contract is wrong, STOP and report — do not work around it.

TASK: <task text, copied from the subtask table>

ALREADY FROZEN — import, do not redefine:
  <Zod types / Prisma models produced by Wave 1>

DONE WHEN: <Test / Done-when text, copied verbatim>

BEFORE YOU REPORT DONE:
  - pnpm lint && pnpm typecheck && pnpm test   → all green
  - every hospital-scoped query is tenant-scoped
  - every input validated with a shared Zod schema from packages/contracts
  - queue-affecting actions write an audit log + queue event
  - report: files changed, assumptions made, anything you could not verify
```

### A.8.2 Rules for launching

- **One agent per directory.** Two agents inside `apps/api/src/queue` will clobber each other. Split by
  module, or by *command-per-file*, or run them sequentially.
- **Worktree isolation** for every Wave-2+ agent: launch with `isolation: "worktree"` so each gets its own
  checkout. Branch naming: `phaseN/<stream>-<short-desc>`.
- **Never launch Wave 2 before Wave 1 is merged.** This is the rule that makes the whole model work (§A.3).
- **Give UI agents fixtures, not promises.** If the backend isn't ready, tell the agent explicitly to mock
  against the frozen contract (§A.5).
- **Review the diff yourself.** Agents parallelize the typing, not the judgement. A green test on a wrong
  contract is still wrong.
- **When an agent reports a contract problem, stop the wave.** Fix centrally, re-sync every stream, then
  resume. Never let two streams patch around the same mismatch.
- **Cap fan-out at what you can review.** Four agents finishing at once is four diffs to read. Three is
  usually the honest ceiling for one person.

## A.9 Rollback & recovery conventions

Things will go wrong. These conventions make "go wrong" cheap:

- **Tag every completed phase**: `git tag phase-N-done`. That is your known-good floor.
- **A bad agent branch is disposable.** Delete the worktree and re-cut from the merged Wave 1 — do not try
  to salvage a confused branch. Re-running an agent with a sharper prompt beats untangling its output.
- **Never edit a merged migration.** Add a new one. In dev, `prisma migrate reset && pnpm seed` is free —
  treat that freedom as a Phase 0–5 privilege only.
- **Append-only tables are never deleted from** — `QueueEvent`, `AuditLog`, `Payment`, `Refund`. Correct with
  a compensating row, never a `DELETE`.
- **Feature-flag anything risky** (workers, socket gateway, notifications) so it can be switched off without
  a redeploy.
- **Point of no return:** once a real hospital is on staging/production (Phase 10), migrations must be
  **expand-then-contract**, and rollback means deploying the previous build — not reversing the database.

Each phase below carries an **↩️ If it goes wrong** note with the phase-specific version of this.

---

# B. Phase-level dependency graph

```
0 Foundation
      │
      ▼
1 Identity & Tenancy
      │
      ▼
2 Hospital Config + Admin + Seed
      │
   ┌──┴───────────────┐
   ▼                  ▼
3 Discovery      4 Queue Engine        (3 and 4 can overlap: different streams)
   │                  │
   └────────┬─────────┘
            ▼
5 Join + Payment → Token
            │
            ▼
6 Doctor + Staff Consoles
            │
            ▼
7 Realtime + ETA
            │
            ▼
8 Notifications + Background Jobs
            │
            ▼
9 Hardening
            │
            ▼
10 Staging Deploy + Pilot
```

> **Cross-phase parallelism:** once a phase's contract exists, a UI stream for the *next* phase can
> often start early. Most obvious: **Phase 3 (Discovery, mobile-heavy)** and **Phase 4 (Queue Engine,
> backend-heavy)** run largely in parallel — different streams, different files.

---

# MVP — Core Queue

Subtask IDs: `P{phase}-{STREAM}-{n}`.

---

## Phase 0 — Foundation / Scaffold

**Goal:** A running skeleton all code stands on. No user features yet.
**Prerequisites:** none.
**Size:** `S` · ~1–2 focused days · up to 3 parallel agents
**Status:** ☐ not started → tick in §0 when the integration checkpoint passes

### 📦 What you'll have after this phase
An empty-but-running workshop: three apps that boot (backend, web, mobile), a local Postgres + Redis
in Docker, a shared types package, and CI that checks every push. Nothing a user can *do* yet — but the
whole toolchain is proven to work together.

### 🔄 How the flow looks now
You run `docker compose up`, start the three apps: the backend answers `/health`, the web app shows a
placeholder page, the mobile app opens a placeholder screen. That's the entire "flow" — it exists to
prove the plumbing.

### 🔌 Endpoints introduced
```
GET /health          — liveness
GET /health/ready     — readiness (checks DB + Redis)
```

### 🛠️ Build detail
**Wave 1 (blocks all):** `P0-INFRA-01` init monorepo + `P0-DOC-01` seed CLAUDE.md (agent guardrails — do this before launching anything else).

| ID | Task | Stream | Wave | Deps | Test / Done-when |
|---|---|---|---|---|---|
| ☑ P0-INFRA-01 | pnpm workspaces + Turborepo, root tsconfig/gitignore/editorconfig | INFRA | 1 | — | `pnpm install` clean; `turbo run build` runs across empty workspaces |
| ☑ P0-DOC-01 | **CLAUDE.md at repo root** — distil Rules.md into always-on agent guardrails | INFRA/DOC | 1 | INFRA-01 | file exists, <200 lines, contradicts nothing in Rules.md; **land this before any other agent runs** |
| ☑ P0-CFG-01 | `packages/config`: base tsconfig, eslint, prettier | INFRA | 2 | 01 | `pnpm lint` runs repo-wide, no config errors |
| ☑ P0-CONTRACT-01 | `packages/contracts` skeleton: Zod, index barrel, sample enum (`QueueEntryStatus`) | CONTRACT | 2 | 01 | `pnpm --filter contracts build`; importable elsewhere |
| ☑ P0-DB-01 | Prisma init; docker-compose (Postgres+Redis); core schema (Account, Patient, Hospital, HospitalStaff, Department, Doctor); first migration | DB | 2 | 01 | `docker compose up`; `prisma migrate dev` creates tables; `prisma studio` shows them |
| ☑ P0-BE-01 | NestJS skeleton: env validation (Zod), pino logger, exception filter + error envelope, `/health` + `/health/ready` | BE | 3 | CFG-01, DB-01 | `curl /health` → 200; `/health/ready` 200 only when DB+Redis up; kill DB → 503 |
| ☑ P0-WEB-01 | Next.js skeleton: App Router, Tailwind + shadcn, Design.md theme tokens, placeholder page | WEB | 3 | CFG-01 | `pnpm --filter web dev`; page renders; teal primary applied |
| ☐ P0-MOB-01 | Expo skeleton: Expo Router, theme (Inter + palette), placeholder screen | MOB | 3 | CFG-01 | `pnpm --filter mobile start`; opens in simulator/Expo Go — **code + typecheck/lint done; needs a device to verify** |
| ☐ P0-INFRA-02 | CI (GitHub Actions): install → lint → typecheck → test → build | INFRA | 4 | all | CI green on a test PR — **workflow written; needs a GitHub remote + push to prove** |

**Parallelization:** Wave 3 → `BE-01 ∥ WEB-01 ∥ MOB-01` (three agents, three directories).
**Integration checkpoint:** all three apps boot; `/health` + `/health/ready` green; CI green.

### 🤖 Agent kickoff

**Wave 1 — do this first, before any other agent runs:**
```text
You are the INFRA agent for P0-INFRA-01 + P0-DOC-01 — OPD Queue Platform.
READ FIRST: docs/Phases.md (Phase 0, §A), docs/Rules.md, docs/Architecture.md.
YOU OWN: the repository root only (package.json, pnpm-workspace.yaml, turbo.json,
         tsconfig.base.json, .gitignore, .editorconfig, CLAUDE.md).
TASK: 1) Initialise a pnpm + Turborepo monorepo with empty workspaces:
         apps/api, apps/web, apps/mobile, packages/contracts, packages/config.
      2) Write CLAUDE.md at the repo root by distilling Rules.md into always-on
         guardrails: golden rules, tenant scoping, contract-first, libraries to
         use/avoid, error handling, and the AI working agreement.
DONE WHEN: `pnpm install` is clean, `turbo run build` runs across all workspaces,
           and CLAUDE.md exists, is under ~200 lines, and contradicts nothing in Rules.md.
```

**Wave 3 — three agents in parallel (three directories, zero overlap):**

| Agent | Subtask | Owns | Brief |
|---|---|---|---|
| BE | P0-BE-01 | `apps/api` | NestJS skeleton: Zod env validation, pino logger, global exception filter + error envelope, `/health`, `/health/ready`. **Done when** `/health` → 200, `/health/ready` → 200 only with DB+Redis up, and killing DB gives 503. |
| WEB | P0-WEB-01 | `apps/web` | Next.js App Router + Tailwind + shadcn/ui, Design.md tokens, placeholder page. **Done when** it renders with teal primary applied. |
| MOB | P0-MOB-01 | `apps/mobile` | Expo + Expo Router, Inter + Design.md palette, placeholder screen. **Done when** it opens in a simulator / Expo Go. |

### ⚠️ Risks & pitfalls

- **Expo + pnpm workspaces is the #1 time sink here.** Metro does not resolve symlinked workspace packages by
  default. Configure `metro.config.js` (`watchFolders` + `nodeModulesPaths`) in this phase, or the MOB stream
  will fight it in every phase after.
- **Prisma client in a monorepo:** pin the generator `output` path and wire generation into `postinstall`, or
  CI will build against a stale client and fail confusingly.
- **Docker on Windows:** port 5432 is often already taken by a local Postgres install. Map to 5433 now rather
  than debugging "connection refused" later.
- **Skipping CI "to save a day" is the expensive choice.** Without `P0-INFRA-02`, every later phase merges
  blind and you find breakage three phases downstream.
- **CLAUDE.md is not optional.** Without it every agent you launch starts without the guardrails, and you
  re-explain the same rules forever.

### ↩️ If it goes wrong

Nothing to roll back — there is no data and no users. If the scaffold fights you, delete the directory and
re-init; the cost is hours, not days. Do not carry a half-working toolchain into Phase 1: every later phase
inherits this one's problems. Tag `phase-0-done` before starting Phase 1.

### ➡️ Next
Give people a way to log in — accounts, profiles, and the multi-tenant wall (Phase 1).

---

## Phase 1 — Identity & Tenancy

**Goal:** Login works; the multi-tenant boundary is enforced from day one.
**Prerequisites:** Phase 0.
**Size:** `M` · ~3–4 focused days · up to 3 parallel agents
**Status:** ☐ not started → tick in §0 when the integration checkpoint passes

### 📦 What you'll have after this phase
Real accounts. A patient can sign up / log in (email or Google) on mobile and add family members
(mother, father, child). Staff/admins can log into the web console. The tenant wall is up: a hospital's
users can only ever touch their own hospital's data.

### 🔄 How the flow looks now
Open the mobile app → sign up → add "Mother" and "Father" as patient profiles. Open the web console →
a staff member logs in → lands on an (empty) console. Nobody can browse hospitals or queues yet — there's
no hospital data in the system.

### 🔌 Endpoints introduced
```
POST /auth/signup        — email + password
POST /auth/login
POST /auth/google         — Google ID token
POST /auth/refresh
POST /auth/logout
GET  /me                  — account + hospital memberships
GET  /patients            — list family profiles
POST /patients            — add a profile
PATCH/DELETE /patients/:id
```

### 🛠️ Build detail
**Wave 1:** `P1-CONTRACT-01` (auth/patient/membership DTOs + Role/Permission enums) + `P1-DB-01` (auth fields, refresh tokens, membership).

| ID | Task | Stream | Wave | Deps | Test / Done-when |
|---|---|---|---|---|---|
| ☑ P1-CONTRACT-01 | DTOs: Signup/Login/GoogleAuth/AuthTokens/Patient/Me; enums Role, Permission | CONTRACT | 1 | — | schemas compile; shared types importable |
| ☑ P1-DB-01 | Account auth fields, refresh-token store, HospitalStaff(role,permissions); migration | DB | 1 | — | migration applies |
| ☑ P1-BE-01 | Auth: signup (Argon2id), login, JWT access + rotating refresh, logout | BE | 2 | Wave 1 | signup→login→refresh→logout; wrong password rejected |
| ☐ P1-BE-02 | Google OAuth + `/me` | BE | 2 | P1-BE-01 | `/me` **done & verified**; Google ID-token exchange **implemented but unverified** — needs real Google client ids in `GOOGLE_CLIENT_IDS` |
| ☑ P1-BE-03 | `JwtGuard`, `RolesGuard`, `TenantGuard` + tenant context | BE | 2 | Wave 1 | unit: role allow/deny; **tenant test: A scoped to A only** |
| ☑ P1-BE-04 | Patients: family-profile CRUD scoped to account | BE | 2 | P1-BE-03 | CRUD works; **IDOR test: can't fetch another account's patient** |
| ☑ P1-WEB-01 | Auth shell: login, httpOnly cookie, protected routes, role-aware layout | WEB | 2 | Wave 1 | **verified**: unauth → 307 /login?next=; bad password → 401; login sets 2 HttpOnly cookies; console renders role-gated nav |
| ☐ P1-MOB-01 | Auth screens + expo-secure-store tokens + protected nav | MOB | 2 | Wave 1 | login persists across restart — **code complete; Metro bundle verified (`expo export` succeeds); needs a device to prove persistence** |
| ☐ P1-MOB-02 | Family-profile screens (add/list/edit, choose-who-for) | MOB | 2 | P1-MOB-01 | add "Father" → persists — **code complete; needs a device** |
| ☑ P1-TEST-01 | **Tenant-isolation + IDOR test suite** | TEST | 3 | BE-03,04 | proves cross-hospital + cross-account access blocked |

**Parallelization:** Wave 2 → `BE (01–04) ∥ WEB-01 ∥ MOB (01–02)`. UI mocks auth until BE ready.
**Integration checkpoint:** real login on mobile + web; **P1-TEST-01 green** (protects the whole product).

### 🤖 Agent kickoff

**Wave 1 — one agent, blocks everything:** `P1-CONTRACT-01` + `P1-DB-01`.
Owns `packages/contracts` + `apps/api/prisma`. Auth/patient/membership DTOs, `Role` + `Permission` enums;
Account auth fields, refresh-token store, `HospitalStaff(role, permissions)` + migration. **Freeze and merge
before Wave 2 launches.**

**Wave 2 — three agents:**

| Agent | Subtasks | Owns | Brief |
|---|---|---|---|
| BE | P1-BE-01..04 | `apps/api/src/{auth,patients,common/guards}` | Argon2id signup, JWT access + rotating refresh, Google OAuth, `/me`, family-profile CRUD, and the three guards. **Register `TenantGuard` globally with an explicit opt-out**, never per-controller. |
| WEB | P1-WEB-01 | `apps/web` | Auth shell, httpOnly cookie session, protected routes, role-aware layout. Mock the API against the frozen contract. |
| MOB | P1-MOB-01..02 | `apps/mobile` | Auth screens, tokens in `expo-secure-store` (**never** AsyncStorage), protected nav, family-profile screens. |

**Wave 3 — one agent:** `P1-TEST-01`. Give it this instruction verbatim:
> *"Prove that hospital A's staff cannot read, write or enumerate any hospital B row, and that account X
> cannot fetch account Y's patient profiles. Cover every endpoint introduced in Phases 0–1, not a sample."*

### ⚠️ Risks & pitfalls

- **A per-controller tenant guard will leak data.** One forgotten decorator on one route is a cross-hospital
  breach. Make it global with an explicit `@Public()` / `@NoTenant()` opt-out that is easy to grep for.
- **Refresh-token rotation without reuse detection** means a stolen token works forever. Store the token
  family; on reuse of an already-rotated token, revoke the whole family.
- **Argon2id native builds fail often on Windows.** If `argon2` won't build, use `@node-rs/argon2` — same
  algorithm, prebuilt binaries.
- **Google OAuth needs separate client IDs** for iOS, Android and web, and device testing needs the right
  redirect scheme. Budget half a day; it is fiddly rather than hard.
- **`P1-TEST-01` is the highest-value test in the repo.** It is the only thing standing between you and a
  multi-tenant data leak. Do not defer it to Phase 9 — "we'll harden later" is how leaks ship.

### ↩️ If it goes wrong

Auth schema changes are still additive and cheap here. If the token model turns out wrong, it costs a
migration plus "everyone logs in again" — trivial now, painful once real patients exist. **This is the last
comfortable moment to change how identity works.**

### ➡️ Next
Let a hospital put its departments, doctors and sessions into the system (Phase 2).

---

## Phase 2 — Hospital Configuration + Admin Console + Seed

**Goal:** A hospital's data can be entered; dev has realistic data.
**Prerequisites:** Phase 1.
**Size:** `L` · ~5–7 focused days · up to 4 parallel agents
**Status:** ☐ not started → tick in §0 when the integration checkpoint passes

### 📦 What you'll have after this phase
A hospital can be fully set up. An admin uses the web console to create departments, doctors, schedules,
fees and queue rules, and to generate today's OPD sessions. A seed script fills the dev database with fake
hospitals so there's something to browse in later phases.

### 🔄 How the flow looks now
An admin logs into the console → creates "Cardiology" → adds "Dr. Sharma" → sets a 10:00–13:00 schedule
with a ₹500 fee → clicks "generate today's session." That session now exists in the database (status
`OPEN_FOR_REGISTRATION`). Patients still can't see it — discovery is the next phase.

### 🔌 Endpoints introduced
```
GET/POST/PATCH/DELETE /hospitals/:id/departments
GET/POST/PATCH/DELETE /hospitals/:id/doctors
GET/POST/PATCH/DELETE /hospitals/:id/schedules
GET/PUT               /hospitals/:id/queue-policy
GET/POST              /hospitals/:id/sessions          — create
POST                  /hospitals/:id/sessions/generate  — from a schedule
POST                  /hospitals/:id/staff              — invite doctor/staff + assign role
```

### 🛠️ Build detail
**Wave 1:** `P2-CONTRACT-01` (config DTOs + enums: SessionStatus, DoctorPresence, OrderingStrategy, RegistrationCutoff) + `P2-DB-01` (models + migration).

| ID | Task | Stream | Wave | Deps | Test / Done-when |
|---|---|---|---|---|---|
| ☐ P2-CONTRACT-01 | Config DTOs + session/policy enums | CONTRACT | 1 | — | compiles |
| ☐ P2-DB-01 | Department, Doctor, DoctorSchedule, QueuePolicy, OPDSession + migration + indexes | DB | 1 | — | migration applies; `hospitalId` indexes present |
| ☐ P2-BE-01 | Departments + Doctors CRUD (tenant-scoped, RBAC=ADMIN) | BE | 2 | Wave 1 | CRUD; non-admin blocked; cross-tenant blocked |
| ☐ P2-BE-02 | Schedules CRUD + fees | BE | 2 | Wave 1 | create schedule; end>start validation |
| ☐ P2-BE-03 | QueuePolicy get/put | BE | 2 | Wave 1 | put→get; invalid values rejected |
| ☐ P2-BE-04 | OPDSession create + generate-from-schedule | BE | 2 | P2-BE-01,02 | generate today's session; appears `OPEN_FOR_REGISTRATION` |
| ☐ P2-BE-05 | Staff invite + role assignment | BE | 2 | Wave 1 | invite doctor account; membership created |
| ☐ P2-BE-06 | **Seed script** | BE/INFRA | 2 | P2-BE-04 | `pnpm seed` → browsable dev DB; idempotent |
| ☐ P2-WEB-01..05 | Admin UIs: Departments · Doctors · Schedules · Policy · Sessions | WEB | 2 | Wave 1 | each screen creates/edits and persists |

**Parallelization:** Wave 2 BE (01–06) ∥ WEB (01–05). **WEB splits across 2–3 agents** (each screen its own route/files).
**Integration checkpoint:** admin builds hospital→dept→doctor→schedule→session end-to-end; seed populates dev DB.

### 🤖 Agent kickoff

**Wave 1 — one agent, and read this diff carefully:** `P2-CONTRACT-01` + `P2-DB-01`.
Owns `packages/contracts` + `apps/api/prisma`.

> ⚠️ The **`QueuePolicy` shape frozen here is the input to the entire Phase-4 engine.** Review it against
> PRD.md before merging. Changing it later means reworking the queue engine, not just running a migration.

**Wave 2 — four agents:**

| Agent | Subtasks | Owns | Brief |
|---|---|---|---|
| BE-1 | P2-BE-01,02,03 | `apps/api/src/{departments,doctors,schedules,policy}` | Tenant-scoped, ADMIN-only CRUD. Validate `end > start` on schedules. |
| BE-2 | P2-BE-04,05,06 | `apps/api/src/{sessions,staff}`, `prisma/seed.ts` | Session create + generate-from-schedule (**idempotent**, unique on doctor+date+slot), staff invite, seed script guarded on `NODE_ENV !== 'production'`. |
| WEB-1 | P2-WEB-01,02 | `apps/web/app/(admin)/{departments,doctors}` | Plain CRUD forms. Use Design.md components — no design invention. |
| WEB-2 | P2-WEB-03,04,05 | `apps/web/app/(admin)/{schedules,policy,sessions}` | Same. The policy screen must mirror the frozen `QueuePolicy` schema field-for-field. |

### ⚠️ Risks & pitfalls

- **Timezone is the classic bug in this phase.** Store UTC, render `Asia/Kolkata`. "Generate today's session"
  run at 00:30 IST must not create yesterday's session. Write that test.
- **Generate-from-schedule must be idempotent.** Running it twice must not create two sessions for the same
  doctor/date/slot — enforce with a unique constraint, not just application logic. Staff *will* double-click.
- **The seed script must never be runnable against production.** Guard on `NODE_ENV` and refuse to run if the
  database already contains real hospitals.
- **This is where scope creep starts.** Five admin screens invite polish. Keep them plain forms — a hospital
  admin uses them during onboarding, not daily.
- **Fee belongs on the schedule/session, not the doctor.** Phase 5 derives the payment amount server-side from
  the session; if the fee is modelled in the wrong place, you discover it during payments.

### ↩️ If it goes wrong

Config data is fully regenerable — `prisma migrate reset && pnpm seed` costs nothing. **This is the last phase
where a wide schema change is cheap**, because Phase 4 onward writes append-only operational history you
cannot casually reset. Get the model right here.

### ➡️ Next
Let patients discover these sessions (Phase 3).

---

## Phase 3 — Discovery (patient read path)  *(runs in parallel with Phase 4)*

**Goal:** Patients can browse to a doctor's live session (read-only).
**Prerequisites:** Phase 2 (needs sessions + seed).
**Size:** `M` · ~3–4 focused days · up to 4 parallel agents
**Status:** ☐ not started → tick in §0 when the integration checkpoint passes

### 📦 What you'll have after this phase
Patients can browse. From the mobile app: pick a city → see hospitals → departments → **today's sessions**,
each card headlining the doctor + queue size + fee. Read-only — no joining yet.

### 🔄 How the flow looks now
A patient opens the app → selects "Mumbai" → "Apollo" → "Cardiology" → sees a card: *"Dr. Sharma · 10:00–13:00
· now serving A18 · 6 in queue · ₹500."* Taps it to see detail. The **Join** button is visible but not wired
yet (it needs the queue engine + payment). ETA shows a placeholder until Phase 7.

### 🔌 Endpoints introduced
```
GET /cities
GET /hospitals?city=&area=&q=
GET /hospitals/:id
GET /hospitals/:id/departments
GET /departments/:id/sessions?date=today   — session-first cards (doctor + queue snapshot + fee)
GET /sessions/:id                           — session detail + live queue snapshot
GET /doctors/:id                            — secondary path (doctor → their sessions)
```

### 🛠️ Build detail
**Wave 1:** `P3-CONTRACT-01` (CityList, HospitalCard/Detail, DepartmentList, **SessionCard**, SessionDetail, DoctorProfile — ETA + queue-snapshot fields placeholder).

| ID | Task | Stream | Wave | Deps | Test / Done-when |
|---|---|---|---|---|---|
| ☐ P3-CONTRACT-01 | Discovery DTOs (session-first) | CONTRACT | 1 | — | compiles |
| ☐ P3-BE-01 | Cities + hospital search + hospital detail | BE | 2 | Wave 1 | seeded hospitals returned; filters + pagination |
| ☐ P3-BE-02 | Departments + today's sessions with snapshot | BE | 2 | Wave 1 | session cards from seed |
| ☐ P3-BE-03 | Session detail + doctor profile | BE | 2 | Wave 1 | detail returns snapshot; doctor→sessions |
| ☐ P3-MOB-01 | City select + hospital list | MOB | 2 | Wave 1 | browse seeded hospitals |
| ☐ P3-MOB-02 | Hospital detail + departments | MOB | 2 | Wave 1 | drill into departments |
| ☐ P3-MOB-03 | **Session cards** (Design 5.5) + detail | MOB | 2 | Wave 1 | session-first list renders |
| ☐ P3-MOB-04 | Doctor profile (secondary) | MOB | 2 | Wave 1 | search doctor → sessions |

**Parallelization:** Wave 2 BE (01–03) ∥ MOB (01–04, split across agents). MOB mocks until BE ready.
**Integration checkpoint:** patient browses full path city→hospital→dept→session→detail from seed.

### 🤖 Agent kickoff

**Wave 1 — one agent:** `P3-CONTRACT-01`. Discovery DTOs, session-first. Tell it explicitly:
> *"ETA and queue-snapshot fields must be present and nullable now, and filled in Phase 7. Do not omit them —
> Phase 7 must not have to change this response shape."*

**Wave 2 — four agents (BE and MOB are fully independent):**

| Agent | Subtasks | Owns | Brief |
|---|---|---|---|
| BE | P3-BE-01,02,03 | `apps/api/src/discovery` | Cities, hospital search + detail, departments, today's sessions with queue snapshot, session detail, doctor profile. **One aggregate query for card counts — no per-card N+1.** |
| MOB-1 | P3-MOB-01,02 | `apps/mobile/app/(discovery)/{city,hospital}` | City select, hospital list + detail, departments. Mock against the frozen contract. |
| MOB-2 | P3-MOB-03 | `apps/mobile/app/(discovery)/session` | **Session cards (Design.md §5.5) + detail.** This is the product's shop window — match the design spec precisely. |
| MOB-3 | P3-MOB-04 | `apps/mobile/app/(discovery)/doctor` | Doctor search → their sessions. Secondary path; keep it simple. |

### ⚠️ Risks & pitfalls

- **N+1 queries on session cards.** Every card needs a live queue count. Done naively that is one query per
  card per page load, on the hottest read path in the product. Aggregate in a single query from the start.
- **Nullable ETA fields are a contract decision, not an oversight.** If an agent "tidies up" by omitting them,
  Phase 7 becomes a breaking change to an already-shipped mobile app.
- **Do not cache hospital/department lists in Redis yet.** Admins edit config in Phase 2 and will not
  understand why their change doesn't appear. Add caching in Phase 9, with explicit invalidation.
- **Tenant leakage through discovery is easy to miss** because this path is deliberately public. Inactive,
  draft or cancelled sessions and unpublished hospitals must not appear.
- **The Join button is visible but inert here.** Make that obvious in the UI (disabled, with a reason), or you
  will file bugs against your own placeholder.

### ↩️ If it goes wrong

This is a read-only path — no writes, no data risk, safe to rewrite entirely. The only thing worth protecting
is the **response shape**, because Phase 7 and the shipped mobile app both build on it.

### ➡️ Next
Build the engine that actually runs the queue (Phase 4) — being built in parallel with this.

---

## Phase 4 — Queue Engine (core, no UI)  *(highest-risk core; parallel with Phase 3)*

**Goal:** A correct, concurrency-safe queue drivable entirely via API/tests.
**Prerequisites:** Phase 2 (sessions + policy).
**Size:** `XL` · ~8–12 focused days · up to 4 parallel agents
**Status:** ☐ not started → tick in §0 when the integration checkpoint passes

### 📦 What you'll have after this phase
The brain of the product. A correct, concurrency-safe queue that can be driven entirely through API
calls/tests: check-in, call-next, start/complete consultation, skip, no-show, requeue, pause/resume, end,
walk-in, priority, emergency. No UI yet — for testing, entries are created via the walk-in command or seed.
Every action is audited and every illegal move is rejected.

### 🔄 How the flow looks now
Behind the scenes (via tests/API), a session's queue can be run from start to finish. The PRD rules are now
*enforced*: only checked-in patients get called, the doctor never idles for someone still at home, an
emergency jumps to the front, and two staff pressing "call next" at the same instant can't double-serve.
Patients and UIs don't touch it yet — this phase is the engine on a test bench.

### 🔌 Endpoints introduced (domain commands)
```
POST /sessions/:id/check-in
POST /sessions/:id/call-next
POST /sessions/:id/start-consultation
POST /sessions/:id/complete-consultation
POST /sessions/:id/skip
POST /sessions/:id/no-show
POST /sessions/:id/pause   |  /resume
POST /sessions/:id/end
POST /sessions/:id/presence
POST /sessions/:id/walk-in
POST /sessions/:id/priority     — audited, with reason
POST /sessions/:id/requeue
```
*(Real patient "join" that feeds this queue arrives in Phase 5.)*

### 🛠️ Build detail
**Wave 1:** `P4-CONTRACT-01` (QueueEntry DTOs, all status/type enums, command I/O, QueueEvent types, error codes) + `P4-DB-01` (QueueEntry, QueueEvent, AuditLog, Consultation + indexes + unique(token,session)).
**Wave 2 (shared core):** `P4-BE-01` state machine + `P4-BE-02` command skeleton.

| ID | Task | Stream | Wave | Deps | Test / Done-when |
|---|---|---|---|---|---|
| ☐ P4-CONTRACT-01 | Queue DTOs, enums, command I/O, error codes | CONTRACT | 1 | — | compiles |
| ☐ P4-DB-01 | QueueEntry, QueueEvent(append-only), AuditLog, Consultation; unique(token,session) | DB | 1 | — | migration applies; unique enforced |
| ☐ P4-BE-01 | **State machine** (states, transitions, guards) — pure | BE | 2 | Wave 1 | **table-driven: every legal transition ok, illegal rejected** |
| ☐ P4-BE-02 | QueueService skeleton: `$transaction` + `SELECT … FOR UPDATE` + audit/event helper | BE | 2 | P4-BE-01 | lock serializes two txns; event+audit atomic |
| ☐ P4-BE-03 | Commands A: checkIn, callNext, start/complete (+ token gen) | BE | 3 | BE-02 | token unique; complete writes Consultation |
| ☐ P4-BE-04 | Commands B: skip, noShow, requeue | BE | 3 | BE-02 | called→absent→recall→skip→move-to-end |
| ☐ P4-BE-05 | Commands C: pause, resume, endSession, presence | BE | 3 | BE-02 | pause blocks callNext; end → remaining RESCHEDULED |
| ☐ P4-BE-06 | Commands D: walkIn, priority + eligibility/call-order | BE | 3 | BE-02 | walk-in auto-checked-in; emergency first; **doctor never idles** |
| ☐ P4-TEST-01 | **Scenario + concurrency suite** | TEST | 3 | BE-03..06 | 2× racing callNext = no dup; 10-reserve-3-arrive; doctor late/early/substitution |

**Parallelization:** Wave 3 → commands split by group (BE-03 ∥ BE-04 ∥ BE-05 ∥ BE-06), safe **only** with **command-per-file**.
**Integration checkpoint:** scripted full session (check-in→call→consult→complete + no-show + walk-in) passes; P4-TEST-01 green.

### 🤖 Agent kickoff

> This is the phase to slow down on. It *is* the product. Prefer redoing a wave over patching a confused one.

**Wave 1 — one agent; read this diff line by line yourself:** `P4-CONTRACT-01` + `P4-DB-01`.
Queue DTOs, every status/type enum, command I/O, `QueueEvent` types, error codes; `QueueEntry`, `QueueEvent`
(append-only), `AuditLog`, `Consultation`, `unique(sessionId, tokenNumber)`.

**Wave 2 — one agent, sequential, no parallelism:**
```text
You are the BE agent for P4-BE-01 + P4-BE-02 — the core of the product.
OWNS: apps/api/src/queue/{state-machine,queue.service}

TASK: 1) A PURE, TABLE-DRIVEN state machine: an explicit transition table
         (fromState x command -> toState + guards). No transition logic
         anywhere else in the codebase, ever.
      2) A QueueService skeleton providing: an interactive $transaction, a
         `SELECT ... FOR UPDATE` lock on the SESSION row (always the session,
         always first), and an atomic audit-log + queue-event write helper.

CONSTRAINTS: no HTTP calls inside a transaction. Keep transactions short.
             Events are emitted AFTER commit, never inside it.

DONE WHEN: a table-driven test asserts every legal transition succeeds and every
           illegal one is rejected, and a test proves two concurrent transactions
           serialise on the session lock.
```

**Wave 3 — four agents, but ONLY with command-per-file.** Each command lives in its own file under
`apps/api/src/queue/commands/`. If you are not confident the agents will respect that, **run this wave
sequentially** — a merge conflict in the queue engine costs more than the parallelism saves.

| Agent | Subtask | Owns (files) | Brief |
|---|---|---|---|
| BE-A | P4-BE-03 | `commands/{check-in,call-next,start-consultation,complete-consultation}.ts` | Token generation inside the lock; complete writes a `Consultation` row. |
| BE-B | P4-BE-04 | `commands/{skip,no-show,requeue}.ts` | grace → recall → SKIPPED → end of the **checked-in** pool. Every threshold from `QueuePolicy`, none hardcoded. |
| BE-C | P4-BE-05 | `commands/{pause,resume,end-session,presence}.ts` | Pause blocks `callNext`; end-session moves remaining to RESCHEDULED. Doctor presence stays independent of session status. |
| BE-D | P4-BE-06 | `commands/{walk-in,priority}.ts` + `call-order.ts` | Walk-in auto-checked-in, appended in token order; emergency inserts at front; **effective call order is computed, never stored.** |

**Wave 3 (test) — one agent. Write these first if you can:**
> *"Assert: (1) two concurrent `callNext` calls never serve the same entry; (2) with 10 booked and 3 checked
> in, the doctor is offered one of the 3 and never idles for the 7; (3) a patient who checks in late slots
> into their natural token position among currently-waiting checked-in patients; (4) an emergency insertion
> does not corrupt the relative order of everyone else."*

### ⚠️ Risks & pitfalls

- **Every command must lock the same row, the same way.** `SELECT ... FOR UPDATE` on the **session** row,
  first, in every single command. One command that forgets it silently defeats the entire scheme — and the
  bug only appears under real concurrency, in a hospital.
- **Always lock in the same order** (session, then entries). Inconsistent lock ordering produces deadlocks
  that only reproduce under load.
- **Never make an HTTP call inside a transaction** — no Razorpay, no push, no socket emit. Emit after commit.
  A transaction held open across a network call is a throughput collapse waiting to happen.
- **The state machine must be pure and table-driven.** If transitions become scattered `if` statements across
  twelve command files, illegal states *will* reach production and you will not be able to reason about them.
- **Do not persist a call-order column.** It goes stale the instant anything changes. Effective order is
  computed live from token number + status + type, every time.
- **The two rules most often implemented wrong:** "the doctor never idles for a not-yet-arrived patient" and
  "a late check-in slots into its natural token position". Write those two tests before the commands.
- **`unique(sessionId, tokenNumber)` must be a database constraint**, not an application check. Application
  checks lose races.
- **Parallelising Wave 3 without command-per-file will hurt.** Four agents editing one `queue.service.ts` is
  the worst merge you will have on this project.

### ↩️ If it goes wrong

**Do not patch a wrong state machine — redo it.** Everything from Phase 5 onward is built on this; a subtle
ordering or locking bug here surfaces months later as "the hospital's queue went wrong", with no clean fix.
Tag before and after this phase. `QueueEvent` and `AuditLog` are append-only: correct mistakes with a
compensating event, never a `DELETE`. In dev, `migrate reset` is still free — use it freely while you can.

### ➡️ Next
Let real patients join and pay to get into this queue (Phase 5).

---

## Phase 5 — Join + Payment (Razorpay) → Token

**Goal:** Patient reserves → pays (test) → gets a token, reliably and idempotently.
**Prerequisites:** Phase 4 (confirm/token path), Phase 3 (patient reaches a session).
**Size:** `L` · ~5–7 focused days · up to 3 parallel agents
**Status:** ☐ not started → tick in §0 when the integration checkpoint passes

### 📦 What you'll have after this phase
Real tokens. A patient can join a session, pay with a Razorpay **test** card, and receive a token (with a QR)
— reliably, even if the app crashes mid-payment. Cancel + refund works. Their entry becomes a real row in
the Phase-4 queue.

### 🔄 How the flow looks now
From discovery (Phase 3), the patient taps **Join** → pays a test ₹500 → gets **Token A027** with a QR and
status "Waiting." The token was created by the verified Razorpay webhook, so a crash before the token screen
still recovers on relaunch, and a duplicate webhook never makes a second token. Doctor/staff still drive the
queue via API — their real screens come in Phase 6.

### 🔌 Endpoints introduced
```
POST /sessions/:id/join            — creates RESERVED entry + Razorpay order
POST /webhooks/razorpay            — payment.captured → verify → issue token (idempotent)
GET  /me/queue-entries             — active + past entries (crash recovery)
POST /queue-entries/:id/cancel     — cancel per policy (may refund)
```

### 🛠️ Build detail
**Wave 1:** `P5-CONTRACT-01` (Join/Webhook/Payment/MyQueueEntries/Cancel DTOs) + `P5-DB-01` (Payment, Refund; reservation fields).
**Dev infra:** `P5-INFRA-01` public webhook tunnel (ngrok/cloudflared) + Razorpay test keys.

| ID | Task | Stream | Wave | Deps | Test / Done-when |
|---|---|---|---|---|---|
| ☐ P5-CONTRACT-01 | Payment/join/webhook DTOs | CONTRACT | 1 | — | compiles |
| ☐ P5-DB-01 | Payment, Refund, reservation fields; migration | DB | 1 | — | applies; index on orderId |
| ☐ P5-INFRA-01 | Webhook tunnel + test keys via env | INFRA | 1 | — | Razorpay test dashboard reaches local webhook |
| ☐ P5-BE-01 | join: RESERVED entry + server-side order + idempotency key + expiry job | BE | 2 | Wave 1 | amount = session fee (not client); entry RESERVED |
| ☐ P5-BE-02 | webhook: verify signature + idempotent confirm → token | BE | 2 | P5-BE-01 | valid → token; **replay = no dup**; bad signature rejected |
| ☐ P5-BE-03 | reservation-expiry worker | BE | 2 | P5-BE-01 | unpaid released; paid untouched |
| ☐ P5-BE-04 | my-queue-entries + cancel + refund | BE | 2 | P5-BE-02 | crash-recovery; cancel→refund per policy |
| ☐ P5-MOB-01 | Join UI → Razorpay Checkout → **token card** (Design 5.6) | MOB | 2 | Wave 1 | test pay → token; kill pre-token → recovers |
| ☐ P5-MOB-02 | My-visits list + cancel | MOB | 2 | Wave 1 | list active/past; cancel |

**Parallelization:** Wave 2 BE (01–04) ∥ MOB (01–02).
**Integration checkpoint:** full join→pay→token on a device; duplicate-webhook + crash-recovery green.

### 🤖 Agent kickoff

**Wave 1 — one agent, plus one setup task you do yourself:**
`P5-CONTRACT-01` + `P5-DB-01` — join/webhook/payment DTOs; `Payment`, `Refund`, reservation fields, an index
on the Razorpay order id and a **unique constraint on the payment id**.
`P5-INFRA-01` is yours: start a tunnel (cloudflared/ngrok), put the Razorpay **test** keys in `.env`, and
register the webhook URL in the Razorpay test dashboard.

**Wave 2 — three agents:**

| Agent | Subtasks | Owns | Brief |
|---|---|---|---|
| BE-1 | P5-BE-01,02 | `apps/api/src/payments` | join → RESERVED entry + **server-derived amount** + Razorpay order + idempotency key. Webhook: verify the signature against the **raw body**, then idempotently confirm → issue the token via the Phase-4 command. |
| BE-2 | P5-BE-03,04 | `apps/api/src/payments/workers`, `apps/api/src/me` | Reservation-expiry worker; `/me/queue-entries`; cancel + refund per policy. |
| MOB | P5-MOB-01,02 | `apps/mobile/app/(visit)` | Join → Razorpay Checkout → token card (Design.md §5.6); my-visits list + cancel. **The client never creates the token — it re-fetches until the server has one.** |

Give BE-1 this line verbatim:
> *"The token must be created only from a signature-verified webhook, must be idempotent on the Razorpay
> order id, and must survive the webhook arriving before the client returns from checkout."*

### ⚠️ Risks & pitfalls

- **Never trust a client-sent amount.** Derive the fee server-side from the session. This is the single most
  common payment vulnerability and it is trivially exploitable.
- **Signature verification needs the raw request body.** Nest's JSON parser will already have consumed and
  re-serialised it, and re-serialised JSON does not match the signature. Configure a raw-body route for the
  webhook *before* writing the verification, or you will chase a phantom "invalid signature" for hours.
- **The webhook can arrive before the client returns from checkout.** Design for it: the token is created by
  the webhook and the app re-fetches. Never create the token in the client's success handler.
- **A replayed webhook must be a silent no-op** — not an error, and not a second token. Enforce with the
  unique constraint on payment id, then treat the constraint violation as success.
- **Reservation expiry can race a late webhook** — a payment captured for a reservation that just expired.
  Decide the rule now (reinstate, or auto-refund), write it down, and test it. It *will* happen in production.
- **Refunds are asynchronous too.** They need their own webhook-driven state machine, not a fire-and-forget
  API call whose success you assume.
- **A free-tier ngrok URL changes on every restart**, silently breaking your webhook registration. Use a
  stable tunnel, or re-register as part of your start-up routine.
- **Keys live in `.env`, never in the repo.** Test keys become live keys later, and git remembers everything.

### ↩️ If it goes wrong

Payment tables are financial history: **append-only, never deleted from.** Correct with a compensating row.
In dev, `migrate reset` is still available. Once pointed at a real Razorpay account, reconcile through the
Razorpay dashboard rather than editing rows. If the join/token flow is wrong, fix it *before* Phase 6 — the
consoles assume real entries exist and behave correctly.

### ➡️ Next
Give doctors and reception real screens to run the session (Phase 6).

---

## Phase 6 — Operational UIs (Doctor + Staff consoles)

**Goal:** Staff and doctors can run a real session.
**Prerequisites:** Phase 4 (commands), Phase 5 (real entries), Phase 1 (RBAC).
**Size:** `L` · ~5–7 focused days · up to 4 parallel agents
**Status:** ☐ not started → tick in §0 when the integration checkpoint passes

### 📦 What you'll have after this phase
The hospital side becomes usable by real people. A doctor gets a clean "current patient + call next" screen;
reception gets **QR check-in** (scan the patient's token), plus walk-in, priority/emergency, and no-show tools.
The product is now operable end-to-end — just not yet live-updating.

### 🔄 How the flow looks now
Patient arrives → receptionist **scans their token QR** → status becomes CHECKED_IN → the doctor sees them in
the list → taps **Call Next** for A027 → **Start** → **Complete** → moves to the next. A walk-in with no app is
added by staff and slots in by token order. Everything still updates only on page refresh — realtime is Phase 7.

### 🔌 Endpoints introduced
```
(No new business endpoints — the consoles call the Phase-4 command endpoints.)
POST /sessions/:id/check-in now accepts { code }  — the scanned QR (signed, opaque)
GET  /queue-entries/:id/qr  (or QR embedded in the token response)
```

### 🛠️ Build detail
**Wave 1:** `P6-CONTRACT-01` (check-in-by-code/token, walk-in, QR payload) + `P6-BE-01` (signed QR code gen + check-in validation).

| ID | Task | Stream | Wave | Deps | Test / Done-when |
|---|---|---|---|---|---|
| ☐ P6-CONTRACT-01 | Check-in/walk-in/QR DTOs | CONTRACT | 1 | — | compiles |
| ☐ P6-BE-01 | Signed QR code on token; check-in accepts {code\|tokenNumber} + validates | BE | 1 | P4 | scan works; tampered rejected; double-scan idempotent |
| ☐ P6-WEB-01 | **Doctor console** (Design 5.7): current patient + all session commands + presence | WEB | 2 | Wave 1 | run a full session vs seed entries |
| ☐ P6-WEB-02 | **Staff: QR check-in** (camera) + manual search fallback | WEB | 2 | Wave 1 | scan token QR → CHECKED_IN; manual works |
| ☐ P6-WEB-03 | **Staff: walk-in** registration | WEB | 2 | Wave 1 | walk-in appears auto-checked-in |
| ☐ P6-WEB-04 | **Staff: priority/emergency + cancel/requeue** (audited) | WEB | 2 | Wave 1 | emergency reorders + audited |

**Parallelization:** Wave 2 → `WEB-01 ∥ WEB-02 ∥ WEB-03 ∥ WEB-04` (separate routes → 3–4 agents).
**Integration checkpoint:** doctor + receptionist run a complete session (QR check-in → call → consult → complete + a no-show + a walk-in).

### 🤖 Agent kickoff

**Wave 1 — one agent:** `P6-CONTRACT-01` + `P6-BE-01`. Owns `packages/contracts` + `apps/api/src/checkin`.
A signed, opaque QR payload (no PII, no enumerable id); `check-in` accepts `{ code | tokenNumber }`; a
tampered code is rejected; a double-scan is idempotent.

**Wave 2 — four agents, one route each:**

| Agent | Subtask | Owns | Brief |
|---|---|---|---|
| WEB-A | P6-WEB-01 | `apps/web/app/(doctor)` | Doctor console (Design.md §5.7): current patient, call/start/complete/skip, presence toggle. |
| WEB-B | P6-WEB-02 | `apps/web/app/(staff)/check-in` | Camera QR scan → CHECK_IN, plus manual token/name search fallback. **Camera needs HTTPS or localhost.** |
| WEB-C | P6-WEB-03 | `apps/web/app/(staff)/walk-in` | Walk-in registration; the entry appears auto-checked-in. |
| WEB-D | P6-WEB-04 | `apps/web/app/(staff)/priority` | Priority/emergency (reason required, audited) + cancel/requeue. |

Give every WEB agent this line verbatim:
> *"The console calls Phase-4 command endpoints. Do not reimplement any queue logic in the frontend, and
> surface server rejections to the user instead of failing silently."*

### ⚠️ Risks & pitfalls

- **Browser camera access requires HTTPS** (or `localhost`). The staff console will be used on a real device
  on the hospital's network — plan a dev certificate or a tunnel now, not on pilot day.
- **Staff will scan twice.** Double-scan must be idempotent and show "already checked in", not an error.
- **The QR must be opaque and signed.** No PII in the payload, and no raw entry id that could be enumerated
  or forged. Short payload — long ones scan badly on cheap cameras.
- **There is no realtime yet.** Two staff members can act on stale data, so a command may be legitimately
  rejected by the server. Surface that clearly ("someone already called this patient") rather than silently
  failing or, worse, retrying.
- **Do not rebuild queue logic in the frontend.** The temptation is to sort or filter locally "just for
  display" — that is where the UI and the engine start to disagree.
- **Priority/emergency must always require a reason and write an audit row.** That audit trail is the only
  control against the feature being abused to jump paying patients.

### ↩️ If it goes wrong

UI only — no schema risk, no data risk. Screens are safe to throw away and redo. The one thing to verify
before moving on is that every console action goes through a domain command, because Phase 7 assumes every
state change emits an event.

### ➡️ Next
Make every screen live and predict wait times — the product's USP (Phase 7).

---

## Phase 7 — Realtime + ETA

**Goal:** Live position + accurate moving ETA window for everyone.
**Prerequisites:** Phase 4 (events), Phase 6 (consoles), Phase 3 (patient views).
**Size:** `L` · ~5–7 focused days · up to 4 parallel agents
**Status:** ☐ not started → tick in §0 when the integration checkpoint passes

### 📦 What you'll have after this phase
The "magic moment." Queue position and ETA update **live** on every screen with no refresh, and the ETA engine
predicts when each patient will be seen (as a *window*). This is the core differentiator coming online.

### 🔄 How the flow looks now
The doctor taps **Complete** on A026 → the waiting patient's phone *instantly* shows "now serving A027 — you're
next — seen ~11:10–11:30," and the staff screen and other patients' screens update too, all without refreshing.
If the doctor runs long on one patient, everyone's window quietly shifts later. Reconnecting after a network drop
re-syncs from a fresh snapshot.

### 🔌 Endpoints introduced (WebSocket, not REST)
```
WS  connect (Socket.IO, JWT in handshake)
    rooms:  session:{id}   (live queue for a session)
            account:{id}   (a patient's personal updates)
    events: entry.status_changed · eta.updated · session.status_changed · doctor.presence_changed
(ETA now fills the fields that were placeholders in Phase 3's REST responses.)
```

### 🛠️ Build detail
**Wave 1:** `P7-CONTRACT-01` (event schemas, room names, ETA window DTO).

| ID | Task | Stream | Wave | Deps | Test / Done-when |
|---|---|---|---|---|---|
| ☐ P7-CONTRACT-01 | Event + ETA DTOs, room naming | CONTRACT | 1 | — | compiles |
| ☐ P7-BE-01 | Socket.IO gateway + Redis adapter + JWT handshake + room-join authz | BE | 2 | Wave 1 | patient can't join hospital room |
| ☐ P7-BE-02 | Wire emit-after-commit into every queue command | BE | 2 | P7-BE-01 | commit → event received; nothing on rollback |
| ☐ P7-BE-03 | **ETA engine** (blend seed/all-time/today; window; queue-health) | BE | 2 | Wave 1 | **known inputs → expected window**; no-history/idle/overrun cases |
| ☐ P7-BE-04 | eta-tick worker (recompute over time) | BE | 2 | P7-BE-03 | idle doctor → ETA drifts on tick |
| ☐ P7-MOB-01 | Socket client + reconnect→snapshot→resubscribe + live ETA | MOB | 2 | Wave 1 | server change → UI updates; drop/restore resyncs |
| ☐ P7-WEB-01 | Socket client in consoles | WEB | 2 | Wave 1 | doctor/staff queue live |

**Parallelization:** Wave 2 → BE gateway/ETA ∥ MOB-01 ∥ WEB-01 (clients build against event contract). ETA-03 unit-testable in parallel.
**Integration checkpoint:** two clients; one triggers a change, the other updates live; ETA moves on a delay; reconnect resyncs.

### 🤖 Agent kickoff

**Wave 1 — one agent:** `P7-CONTRACT-01`. Event schemas, room naming, ETA window DTO.
The ETA DTO fills the nullable fields frozen in Phase 3 — **it must not change that response shape.**

**Wave 2 — four agents:**

| Agent | Subtasks | Owns | Brief |
|---|---|---|---|
| BE-1 | P7-BE-01,02 | `apps/api/src/realtime` | Socket.IO gateway + Redis adapter + JWT handshake + **room-join authorisation**. Wire emit-after-commit into every queue command. Minimal payloads. |
| BE-2 | P7-BE-03,04 | `apps/api/src/eta` | ETA engine: blend seeded default + doctor all-time average + today's running average (today weighted highest); output a **window**, never a point. Plus the eta-tick worker. Pure and unit-testable. |
| MOB | P7-MOB-01 | `apps/mobile` | Socket client; on reconnect **fetch a snapshot then resubscribe** — never replay events. Live position + ETA window. |
| WEB | P7-WEB-01 | `apps/web` | Socket client in both consoles. |

Give BE-2 this line verbatim:
> *"Handle three cold cases explicitly: a doctor with no history, an idle doctor (the window must drift later
> on each tick), and a doctor running long. Never divide by zero, and never emit a window narrower than the
> policy minimum."*

### ⚠️ Risks & pitfalls

- **Emit after commit, never inside the transaction.** An event emitted inside a transaction that then rolls
  back produces a "ghost update": the patient sees they were called, and the database disagrees.
- **Add the Redis adapter now, even on a single instance.** The day you scale to two, every socket bug you
  have will be an invisible one where half the users get no updates.
- **Authorise room joins.** A patient must not be able to subscribe to another hospital's session room. Send
  minimal payloads too — a queue update should not carry other patients' names (DPDP).
- **Reconnect must fetch a snapshot, not replay events.** Event replay after a drop produces duplicated or
  out-of-order state. Snapshot, then resubscribe.
- **ETA thrash is a real UX bug.** Recomputing on every single event makes the number jump around and
  destroys trust. Smooth it, always present a window, and never widen and narrow it on every tick.
- **Cold start must not divide by zero.** A brand-new doctor has no history — fall back to the seeded default
  and say so honestly in the UI.
- **The eta-tick worker plus per-event emits can flood a busy session.** Batch per session and throttle.

### ↩️ If it goes wrong

Realtime is additive: the gateway can be feature-flagged off and every REST path still works. **Keep it that
way** — never build a feature that *only* works over the socket, or a dropped connection becomes a broken
product rather than a stale one. The ETA engine is pure, so it can be rewritten freely behind its interface.

### ➡️ Next
Nudge patients via push and let the timers run themselves (Phase 8).

---

## Phase 8 — Notifications + Background Jobs

**Goal:** The system nudges patients and self-manages timers unattended.
**Prerequisites:** Phase 7 (events + ETA), Phase 5 (reservation expiry), Phase 4 (no-show flow).
**Size:** `M` · ~4–5 focused days · up to 5 parallel agents
**Status:** ☐ not started → tick in §0 when the integration checkpoint passes

### 📦 What you'll have after this phase
The "wait at home" promise fully working. Patients get **push notifications** (token issued, getting close,
"leave now," called, delays). Background workers handle no-show grace/recall, reservation expiry, and
registration cutoffs automatically — with nobody watching a screen.

### 🔄 How the flow looks now
A patient joins from home → gets pushes as the queue moves → "please reach and check in" → arrives → gets
scanned in → "you're being called." If a called patient is absent, the grace timer recalls, then skips them
on its own. Registration auto-closes when the day is realistically full. The product now runs itself between
human actions.

### 🔌 Endpoints introduced
```
POST /me/push-tokens     — register a device push token
(Plus background workers — no REST: grace-expiry, reservation-expiry,
 registration-cutoff, eta-tick, notification-dispatch, payment-reconcile.)
```

### 🛠️ Build detail
**Wave 1:** `P8-CONTRACT-01` (notification types/payloads, push-token) + `P8-DB-01` (Notification, PushToken).

| ID | Task | Stream | Wave | Deps | Test / Done-when |
|---|---|---|---|---|---|
| ☐ P8-CONTRACT-01 | Notification + push-token DTOs | CONTRACT | 1 | — | compiles |
| ☐ P8-DB-01 | Notification, PushToken; migration | DB | 1 | — | applies |
| ☐ P8-BE-01 | Push-token registration + NotificationService (Expo) + templates | BE | 2 | Wave 1 | register token; test push recorded |
| ☐ P8-BE-02 | Wire events → notification jobs | BE | 2 | P8-BE-01 | each event enqueues correct push |
| ☐ P8-BE-03 | Worker: grace-expiry (recall→skip→requeue) | BE | 2 | Wave 1 | absent-called timer fires no-show flow |
| ☐ P8-BE-04 | Worker: registration-cutoff | BE | 2 | Wave 1 | past ETA-end → registration closes |
| ☐ P8-BE-05 | Worker: payment-reconcile | BE | 2 | Wave 1 | missed webhook reconciled |
| ☐ P8-MOB-01 | Push permission + registration + foreground/background/tap→deep-link | MOB | 2 | Wave 1 | receive push; tap opens token screen |

**Parallelization:** Wave 2 → workers split across agents (BE-03 ∥ BE-04 ∥ BE-05, each its own file) ∥ BE-01/02 ∥ MOB-01.
**Integration checkpoint:** patient gets the full push sequence on a device; no-show + cutoff timers fire automatically.

### 🤖 Agent kickoff

**Wave 1 — one agent:** `P8-CONTRACT-01` + `P8-DB-01` (notification types/payloads, `PushToken` model).

**Wave 2 — five agents (the workers are independent files):**

| Agent | Subtasks | Owns | Brief |
|---|---|---|---|
| BE-1 | P8-BE-01,02 | `apps/api/src/notifications` | Push-token registration, Expo NotificationService, templates, event → job wiring. Handle `DeviceNotRegistered` by pruning the token. |
| BE-2 | P8-BE-03 | `apps/api/src/workers/grace-expiry.ts` | recall → skip → requeue, every threshold driven by `QueuePolicy`. |
| BE-3 | P8-BE-04 | `apps/api/src/workers/registration-cutoff.ts` | Auto-close registration when a new joiner's ETA would exceed session end. |
| BE-4 | P8-BE-05 | `apps/api/src/workers/payment-reconcile.ts` | Reconcile payments whose webhook never arrived. |
| MOB | P8-MOB-01 | `apps/mobile` | Permission + token registration + foreground/background handling + tap → deep-link to the token screen. |

Give every worker agent this line verbatim:
> *"Workers mutate state only by calling the Phase-4 domain commands — never by writing to the database
> directly. Every job must be idempotent and carry a stable `jobId`."*

### ⚠️ Risks & pitfalls

- **A worker that writes rows directly bypasses the state machine, the audit log and the events.** This is the
  single most damaging shortcut available in this phase. Workers call commands, full stop.
- **Every job must be idempotent with a stable `jobId`.** BullMQ can deliver twice. A repeatable job firing
  twice must not skip a patient twice or send two "you're next" pushes.
- **Notification storms destroy trust faster than no notifications.** "Getting close" must fire once per
  patient per session, not on every ETA tick. Cap and dedupe per patient.
- **Expo push tokens rotate and expire.** Handle `DeviceNotRegistered` and prune, or you accumulate dead
  tokens and your delivery rate quietly rots.
- **Timezone, again.** Cutoffs and grace windows computed in UTC, rendered in `Asia/Kolkata`.
- **Workers need Redis running and the process alive.** This is exactly why the Render free tier was ruled
  out — a spun-down instance stops every timer in this phase and the product silently stops working.
- **Start the Apple/Google developer account paperwork now**, during this phase. It is calendar time, and
  Phase 10 blocks on it.

### ↩️ If it goes wrong

Give every worker its own env-flag kill switch, so a misbehaving timer can be disabled without a redeploy.
Notifications are fire-and-forget: a bad send cannot be recalled, so test templates against your own device
before wiring them to real events. Jobs are replayable — if a worker was off, the reconcile worker should be
able to catch the system up rather than requiring manual repair.

### ➡️ Next
Harden it for real patients and real money (Phase 9).

---

## Phase 9 — Hardening

**Goal:** Safe, observable, trustworthy for real patients and money.
**Prerequisites:** Phases 0–8.
**Size:** `L` · ~5–7 focused days · up to 6 parallel agents
**Status:** ☐ not started → tick in §0 when the integration checkpoint passes

### 📦 What you'll have after this phase
Production-grade safety. Rate limiting, a security sweep (every sensitive route guarded, IDOR-proof), error
tracking, clean loading/empty/error/offline states on every screen, and basic admin reports (volumes, average
wait, no-show rate, ETA accuracy).

### 🔄 How the flow looks now
The same journeys as before, but now they fail *gracefully* — bad network, bad input, or abuse are handled
cleanly — and an admin can open a report to see how the day's OPD performed. Nothing new for the patient to do;
everything just becomes trustworthy.

### 🔌 Endpoints introduced
```
GET /hospitals/:id/reports/volumes
GET /hospitals/:id/reports/avg-wait
GET /hospitals/:id/reports/no-show
GET /hospitals/:id/reports/eta-accuracy
(Rate limiting added to auth/join/webhook — no new routes.)
```

### 🛠️ Build detail
Almost fully parallel — largely independent workstreams.

| ID | Task | Stream | Wave | Deps | Test / Done-when |
|---|---|---|---|---|---|
| ☐ P9-BE-01 | Rate limiting (auth, join, webhook) | BE | 1 | — | over limit → 429 |
| ☐ P9-SEC-01 | Security pass: guards on every route; IDOR sweep; authz/tenant test matrix | TEST/BE | 1 | — | matrix covers all endpoints |
| ☐ P9-OBS-01 | Sentry + request tracing (BE + clients) | INFRA | 1 | — | error appears in Sentry with request id |
| ☐ P9-WEB-01 | Console error/empty/offline states | WEB | 1 | — | every screen has the states |
| ☐ P9-MOB-01 | Patient error/empty/offline states | MOB | 1 | — | airplane-mode graceful; retries |
| ☐ P9-BE-02 | Admin reports queries | BE | 1 | — | report matches known data |
| ☐ P9-WEB-02 | Reports UI | WEB | 2 | P9-BE-02 | reports render |
| ☐ P9-TEST-01 | E2E core flows + coverage gaps | TEST | 2 | all | discover→join→pay→check-in→consult→complete green |

**Parallelization:** Wave 1 is 5–6 independent agents. Very high parallelism.
**Integration checkpoint:** security/observability/error-state checklists pass; P9-TEST-01 E2E green.

### 🤖 Agent kickoff

**Wave 1 — six agents, almost fully independent. This is the highest-parallelism phase in the plan.**

| Agent | Subtask | Owns | Brief |
|---|---|---|---|
| BE-1 | P9-BE-01 | `apps/api/src/common/throttle` | Rate limits on auth, join, webhook. **Exempt or generously limit the webhook — Razorpay retries legitimately.** |
| SEC | P9-SEC-01 | `apps/api` (tests) | Enumerate routes **from the router**, not by hand; assert a guard on each; IDOR sweep; authz/tenant matrix. |
| OBS | P9-OBS-01 | root, `apps/*` | Sentry + request-id tracing across BE/WEB/MOB. **Scrub patient PII from error payloads (DPDP).** |
| WEB | P9-WEB-01 | `apps/web` | Loading / empty / error / offline states on every console screen. |
| MOB | P9-MOB-01 | `apps/mobile` | The same for the patient app; airplane mode must degrade gracefully with retry. |
| BE-2 | P9-BE-02 | `apps/api/src/reports` | Volumes, avg wait, no-show rate, ETA accuracy — plus the indexes those queries need. |

**Wave 2 — two agents, in order:** `P9-WEB-02` (reports UI, needs BE-02) then `P9-TEST-01` (full E2E).

### ⚠️ Risks & pitfalls

- **Rate-limiting the webhook route will drop legitimate Razorpay retries** and silently lose payments.
  Allowlist it, or set a high limit and rely on signature verification as the real gate.
- **A hand-written route list drifts immediately.** Generate the authz matrix from the router so a new
  unguarded endpoint fails the test the day it is added, not at audit time.
- **Sentry will capture patient names and phone numbers unless you scrub them.** Under DPDP that is a real
  compliance problem, not a tidiness issue. Configure `beforeSend` scrubbing before enabling in staging.
- **Report queries over the full event table will be slow** and get slower every day the product runs. Add
  the indexes in this phase, and check the query plans against seeded volume, not against ten rows.
- **"Error states on every screen" quietly expands.** Enumerate the screens first, then work the list — or
  this phase never ends.
- **ETA-accuracy reporting is your feedback loop for Phase 7.** It is the only way you will learn whether the
  ETA engine is actually any good before a hospital tells you.

### ↩️ If it goes wrong

Everything here is additive and independently revertible — no schema rewrites, no data risk. The one item
worth blocking on is `P9-SEC-01`: if the authz matrix finds an unguarded route, fix it before Phase 10 rather
than noting it. Nothing else in this phase is worth delaying a pilot for.

### ➡️ Next
Put it on real servers for a pilot hospital (Phase 10).

---

## Phase 10 — Staging Deploy + Pilot Readiness

**Goal:** The whole system runs off your machine; ready for a first hospital.
**Prerequisites:** Phase 9.
**Size:** `M` · ~3–4 focused days · up to 3 parallel agents
**Status:** ☐ not started → tick in §0 when the integration checkpoint passes

### 📦 What you'll have after this phase
The whole system running on real servers (India region), the web console on a public URL, and installable test
builds of the mobile app on TestFlight + Play internal testing. Ready to onboard a first hospital.

### 🔄 How the flow looks now
The full journey — a patient discovers → joins → pays → is nudged → arrives → is scanned in → consulted →
completed — works from a **real phone against staging**. A pilot hospital's staff and doctor can be onboarded
using the runbook.

### 🔌 Endpoints introduced
```
(None new — this phase deploys everything already built.)
```

### 🛠️ Build detail

| ID | Task | Stream | Wave | Deps | Test / Done-when |
|---|---|---|---|---|---|
| ☐ P10-INFRA-01 | Provision backend host (India) + managed Postgres + Redis | INFRA | 1 | — | services up; `migrate deploy` applied |
| ☐ P10-INFRA-02 | Env/secrets per environment | INFRA | 1 | — | staging boots; no secret in repo |
| ☐ P10-BE-01 | Backend deploy + Razorpay webhook public URL | BE/INFRA | 2 | 01,02 | webhook reachable; health green |
| ☐ P10-WEB-01 | Web console → Vercel | WEB | 2 | 02 | console loads on staging |
| ☐ P10-MOB-01 | Mobile → EAS build → TestFlight + Play internal | MOB | 2 | 02 | installable on a real phone |
| ☐ P10-TEST-01 | Staging smoke test + onboarding runbook | TEST | 3 | all | **full flow on a real phone**; runbook written |

**Parallelization:** Wave 2 → BE deploy ∥ WEB deploy ∥ MOB EAS build (independent targets).
**Integration checkpoint:** end-to-end patient→staff→doctor flow on staging from a real device.

### 🤖 Agent kickoff

> **Do this during Phase 8 — it is calendar time, not work time.** Apple Developer and Google Play developer
> accounts, plus business entity/KYC paperwork if you intend to take real money. No amount of coding speed
> compensates for a week lost to app-store enrolment.

**Wave 1 — you, not an agent:** `P10-INFRA-01,02`. Provision the India-region host, managed Postgres and
Redis, and set per-environment secrets. Nothing here should be delegated blind.

**Wave 2 — three agents, three independent targets:**

| Agent | Subtask | Brief |
|---|---|---|
| BE | P10-BE-01 | Deploy the API; `prisma migrate deploy` (**never** `migrate dev`); register the production webhook URL with its own secret; health checks green. |
| WEB | P10-WEB-01 | Web console to Vercel, pointed at the staging API. |
| MOB | P10-MOB-01 | EAS build → TestFlight + Play internal testing. |

**Wave 3 — you:** `P10-TEST-01`. Run the full journey on a real phone against staging, then write the hospital
onboarding runbook while it is still fresh in your head.

### ⚠️ Risks & pitfalls

- **`prisma migrate deploy`, never `migrate dev`, against a deployed environment.** `migrate dev` can reset
  the database. Make this a deploy-script guard, not a thing you remember.
- **Free tiers spin down and break everything this product depends on** — WebSockets drop, BullMQ timers stop.
  This was already decided: pay for always-on instances before you test realtime on staging.
- **Every environment needs its own Razorpay webhook secret.** Sharing one between local and staging means a
  local tunnel can process staging payments.
- **App store review and TestFlight setup are measured in days.** Start early (see the note above).
- **Test a backup restore once, before a hospital is on it.** An untested backup is not a backup.
- **India region for backend and database** — for latency and DPDP data residency. Vercel edge is fine for the
  web console; the data must not be.

### ↩️ If it goes wrong

Roll back by deploying the previous build, not by reversing the database. From this phase on, migrations must
be **expand-then-contract**: add the new column, backfill, switch the code, drop the old column in a later
release. Keep the previous build deployable at all times. Once a pilot hospital is live, "just reset the
database" stops being available, permanently.

### ➡️ Next
Onboard a pilot hospital, gather feedback → Phase 11+ (operational maturity, clinical records, ecosystem).

---

# Post-MVP (high-level — detail when reached)

## Phase 11 — Operational Maturity
**What you'll have:** advanced priority policies · statistical/better ETA · analytics dashboards · **appointments**
(coexist, convert to a queue entry on check-in) · SMS/WhatsApp (India DLT) · richer refund/cancellation.

## Phase 12 — Clinical Records
**What you'll have:** consultation detail · **prescriptions** (structured, immutable-after-sign with amend/reissue) ·
follow-ups · visit history · documents/attachments.

## Phase 13 — Ecosystem
**What you'll have:** ABDM/ABHA linking + consent exchange · HIS/EMR · lab · pharmacy · insurance · teleconsultation.

---

# Appendices

## Appendix 1 — Feature → Phase map (MVP)

| PRD feature | Phase |
|---|---|
| Auth (email/Google), family profiles | 1 |
| Multi-tenancy / RBAC | 1 (carried everywhere) |
| Hospital/dept/doctor/schedule/policy config | 2 |
| OPD session generation + seed | 2 |
| Session-first discovery | 3 |
| Queue state machine + domain commands | 4 |
| Join + Razorpay + token | 5 |
| QR / manual check-in | 6 |
| Doctor console | 6 |
| Staff console (walk-in, priority, no-show) | 6 |
| Realtime updates | 7 |
| Dynamic ETA | 7 |
| Push notifications + arrival nudges | 8 |
| No-show timers, reservation expiry, cutoffs | 8 |
| Security, reports, observability | 9 |
| Deploy | 10 |

## Appendix 2 — Endpoint map by phase (quick reference)

| Phase | New endpoints |
|---|---|
| 0 | `/health`, `/health/ready` |
| 1 | `/auth/*`, `/me`, `/patients` |
| 2 | `/hospitals/:id/{departments,doctors,schedules,queue-policy,sessions,staff}` |
| 3 | `/cities`, `/hospitals`, `/departments/:id/sessions`, `/sessions/:id`, `/doctors/:id` |
| 4 | `/sessions/:id/{check-in,call-next,start-consultation,complete-consultation,skip,no-show,pause,resume,end,presence,walk-in,priority,requeue}` |
| 5 | `/sessions/:id/join`, `/webhooks/razorpay`, `/me/queue-entries`, `/queue-entries/:id/cancel` |
| 6 | QR check-in (extends `/check-in`), `/queue-entries/:id/qr` |
| 7 | WebSocket rooms + events (no REST) |
| 8 | `/me/push-tokens` (+ workers) |
| 9 | `/hospitals/:id/reports/*` |
| 10 | none (deploy) |

## Appendix 3 — Testing strategy (what "tested" means per level)

| Level | Where | Used most in |
|---|---|---|
| **Unit** | state machine, ETA formula, guards, worker logic | 1, 4, 7, 8 |
| **Integration** (real Postgres) | domain commands, payments, config CRUD | 2, 4, 5 |
| **Contract** | Zod schema validation both sides | every phase Wave 1 |
| **Concurrency** | racing transactions, idempotent webhooks | 4, 5 |
| **Realtime E2E** | two clients, emit/receive, reconnect | 7 |
| **End-to-end** | discover→join→pay→check-in→consult→complete | 9, 10 |

## Appendix 4 — Per-subtask Definition of Done (recap)

- [ ] Its **Test / Done-when** passes.
- [ ] New domain commands have unit + integration + illegal-transition + authz/tenant tests.
- [ ] Tenant scoping enforced on every new hospital-scoped endpoint.
- [ ] All inputs validated with shared Zod schemas from `packages/contracts`.
- [ ] Audit log + queue event written for every queue-affecting action.
- [ ] Consistent error shape; no leaked internals; no swallowed errors.
- [ ] `lint + typecheck + test` green in CI.

## Appendix 5 — Parallel-agent checklist (before spinning up Wave 2)

- [ ] Wave 1 (contract + schema) merged and stable.
- [ ] Each parallel agent assigned a **distinct directory** (`apps/api` module / `apps/web` route / `apps/mobile`).
- [ ] Each agent on its **own worktree/branch** (`phaseN/<stream>-<desc>`).
- [ ] UI agents have fixtures/mocks so they don't block on backend.
- [ ] A named **integration owner** for the phase's final wave.
- [ ] Nobody edits `packages/contracts` mid-wave without a coordinated re-sync.
## Appendix 6 — Phase sign-off log

Fill a row the day a phase's integration checkpoint passes. This is your record of where you actually are —
useful when you come back after a break, and the first thing to hand a second developer if you ever add one.
Keep the *narrative* (what you built, what you decided, what broke) in **PROGRESS.md**; this table is the index.

| Phase | Started | Signed off | Actual focused days | Tag | What surprised you |
|---|---|---|---|---|---|
| 0 |  |  |  |  |  |
| 1 |  |  |  |  |  |
| 2 |  |  |  |  |  |
| 3 |  |  |  |  |  |
| 4 |  |  |  |  |  |
| 5 |  |  |  |  |  |
| 6 |  |  |  |  |  |
| 7 |  |  |  |  |  |
| 8 |  |  |  |  |  |
| 9 |  |  |  |  |  |
| 10 |  |  |  |  |  |

**Track your estimate error.** After Phase 2, compare your actual days against the §0 estimate and scale every
remaining phase by the same factor. Your own multiplier is far more accurate than the numbers in this doc.
