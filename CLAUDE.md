# OPD Queue Platform — Agent Guardrails

A multi-tenant OPD (out-patient) queue platform for Indian hospitals. Patients join a doctor's live
queue remotely, watch a dynamic ETA, and arrive only when their turn is near.

**The queue is the product.** Everything else supports it.

**Authoritative docs — read before non-trivial work:**
`docs/PRD.md` (what & why) · `docs/Architecture.md` (how) · `docs/Rules.md` (full rules) · `docs/Phases.md` (build plan) ·
`docs/Design.md` (visual system) · `docs/PROGRESS.md` (build log — append what you did + why).

This file is the always-on summary. **`docs/Rules.md` wins on any conflict.**

---

## 1. Non-negotiables

1. **The backend/database is the only source of truth.** A client never decides queue state, token
   order, prices, or permissions.
2. **Every queue-changing action is a domain command** in the `queue` module, inside a DB transaction
   holding a per-session `SELECT … FOR UPDATE` lock. **No raw CRUD on `QueueEntry` / `OPDSession` status.**
3. **Tenant scoping is server-side, always.** Derive `hospitalId` from the caller's `HospitalStaff`
   membership — **never** from request body, query, or header. Every by-id fetch verifies the row belongs
   to the caller's hospital.
4. **Money is confirmed by the Razorpay webhook, not the client.** Token creation is idempotent on the
   order id. Never trust a client-sent amount — derive it from the session fee.
5. **No secrets in the repo.** Everything via env vars. `.env` is gitignored; commit `.env.example` only.
6. **Validate all input with Zod** from `packages/contracts`. No unvalidated data reaches a service.
7. **Every queue-affecting action writes an `AuditLog` + `QueueEvent`.** Accountability is a feature.
8. **Never break the shared contract silently.** Change `packages/contracts` first; backend and clients follow.

---

## 2. Stack (do not swap without approval)

- **Backend:** NestJS · Prisma · PostgreSQL · ioredis · Socket.IO (+ Redis adapter) · BullMQ ·
  `nestjs-zod` · Passport (Google) · Razorpay SDK · pino · Argon2id
- **Web:** Next.js (App Router) · TanStack Query · Tailwind · shadcn/ui · socket.io-client
- **Mobile:** Expo (Expo Router) · TanStack Query · socket.io-client · expo-notifications ·
  expo-secure-store · react-native-qrcode-svg
- **Shared:** Zod · TypeScript (strict)

**Avoid unless approved:** another ORM, another realtime lib, Redux/MobX, Moment.js, GraphQL,
microservices, a message broker, event sourcing. Raw SQL only for the intentional `FOR UPDATE` lock and
read-only reporting queries.

**Before adding any dependency:** confirm it is necessary, maintained, and not duplicating an existing
one. Prefer the standard library, then an already-installed dep, then the smallest new option.

---

## 3. Layout

```
apps/api        NestJS backend  — the modular monolith (the only thing that runs on a server)
apps/web        Next.js console — doctor + staff + admin
apps/mobile     Expo app        — patients
packages/contracts   Zod schemas, DTOs, enums — THE shared API contract
packages/config      shared tsconfig / eslint / prettier
```

- Backend features live in modules under `apps/api/src/modules`. Each = controller + service + its Prisma access.
- **No cross-module DB access.** Module A must not read Module B's tables — call B's service.
- Shared DTOs/enums live **only** in `packages/contracts`. Never redefine them per app.
- Cross-cutting (guards, interceptors, filters, decorators, tenant context) lives in `apps/api/src/common`.

---

## 4. Backend rules

- **Controllers are thin:** validate (Zod) → authorize (guards) → delegate. No business logic.
- **Services own logic.** State transitions, invariants, side effects.
- **Every domain command, in this order:** lock the session → authorize → validate the state-machine
  transition → mutate → append `QueueEvent` + `AuditLog` → recompute ETA → schedule/cancel jobs →
  **emit realtime after commit**.
- **Never emit a realtime event before the transaction commits.** Only confirmed state goes out.
- **Never make an HTTP call inside a transaction** (no Razorpay, push, or socket emit). Keep transactions short.
- **The state machine is explicit and table-driven.** Transition logic lives in one place, never as
  scattered `if`s across command files. Reject illegal transitions with a typed error.
- **Command-per-file** in the queue engine, so parallel agents never edit the same file.
- **Idempotency:** join / webhook / payment handlers must be safe to call twice.

---

## 5. Data & Prisma

- All schema changes go through **Prisma migrations**. No manual DB edits; no `db push` on staging/prod;
  `migrate deploy` (never `migrate dev`) against a deployed environment.
- **Every tenant-scoped table has `hospitalId`, indexed.** Global tables: `Account`, `Patient` only.
- **Money in paise as integers**, never floats.
- **Timestamps in UTC**; convert for display (`Asia/Kolkata`) in the client.
- **`QueueEvent` and `AuditLog` are append-only** — never update or delete. Correct with a compensating row.
- Prefer DB unique constraints over application checks (e.g. `unique(sessionId, tokenNumber)`) — app
  checks lose races.
- No destructive migration without an explicit reviewed step.

---

## 6. API & errors

- Reads may be REST/resource-style. **Writes that change the queue are commands**
  (`POST /sessions/:id/<command>`), never `PATCH status`.
- Paginate list endpoints; never return unbounded lists.
- Throw typed errors (`InvalidQueueTransition`, `NotCheckedIn`, `TenantMismatch`, `PaymentNotVerified`).
- A global filter maps them to one shape:
  ```json
  { "error": { "code": "INVALID_QUEUE_TRANSITION", "message": "human-readable", "details": {} } }
  ```
- **Never leak internals** (stack traces, SQL, secrets). Log full detail with pino; return a safe message.
- Correct status codes: 400 validation · 401 authn · 403 authz/tenant · 404 · 409 conflict/transition ·
  422 · 429 rate limit · 5xx server.
- **Fail loudly in dev, safely in prod.** No silent `catch {}`.

---

## 7. Realtime

- Realtime is a **distribution mechanism only**, never the source of truth.
- On (re)connect the client **fetches the REST snapshot first**, then subscribes. Never replay events.
- **Authorize socket room joins server-side** from the JWT — a patient cannot join hospital-only channels.
- Send minimal payloads: a queue update must not carry other patients' PII.
- Clients tolerate missed/duplicate events and reconcile against snapshots.

---

## 8. Auth & security

- Passwords: **Argon2id**. Never store or log plaintext passwords or tokens.
- Short-lived access tokens; **rotating** refresh tokens. Client storage: `expo-secure-store` (mobile),
  httpOnly cookies (web).
- Guard pipeline: `JwtGuard` → `RolesGuard` → `TenantGuard`. **No sensitive endpoint is unguarded.**
  Register `TenantGuard` globally with an explicit, greppable opt-out — never per-controller.
- Authorization is enforced on the backend, never by hiding UI.
- Rate-limit auth, join, and webhook endpoints (but do not throttle legitimate Razorpay retries).
- The QR check-in code is a **signed, opaque reference** — no PII, no enumerable id.
- Treat all patient data as sensitive (**DPDP**): log access, scrub PII from error reports, India-region hosting.

---

## 9. Frontend (web + mobile)

- Server state via **TanStack Query**; refetch on reconnect. Keep it out of ad-hoc component state.
- Handle **loading / empty / error / offline** on every screen. Assume flaky networks on mobile.
- Reuse types from `packages/contracts` — never re-type an API shape by hand.
- No hardcoded secrets or API URLs — use env config.
- Follow `docs/Design.md`: teal `#0E7C7B` primary, Inter, status is **never colour-only** (always label + icon),
  tabular numerals for live numbers, ≥44×44 touch targets, WCAG AA contrast.
- **Never reimplement queue logic in the frontend.** Consoles call domain commands and surface server
  rejections clearly rather than failing silently.

---

## 10. Testing

- **Unit-test the queue state machine and ETA engine thoroughly** — highest-risk logic. Cover every
  transition, plus no-show, emergency, concurrency, doctor late/early/substitution.
- Integration-test domain commands against a **real Postgres** (transactions, locking, idempotency).
- Test the payment flow with **duplicate/replayed webhooks**.
- A domain command is not done without: happy path + illegal transitions + authz/tenant tests.

---

## 11. Parallel agent discipline

1. **Contract-first.** Do not start implementation (Wave 2) until the phase's `packages/contracts` +
   Prisma schema (Wave 1) are locked and merged.
2. **Own exactly one directory.** Never edit another agent's files. Safe fan-out:
   `apps/api ∥ apps/web ∥ apps/mobile`.
3. **Do not touch `packages/contracts` mid-wave.** If the contract is wrong, **stop and raise it** — never
   patch a local copy or diverge the shape of shared data.
4. **One worktree/branch per agent:** `phaseN/<stream>-<short-desc>`. Merge order:
   contract+schema → backend → web/mobile → integration.
5. **Stay in your phase and scope.** Don't pull work forward from a later phase.

---

## 12. Working agreement

**Do:** follow these rules, the PRD and the Architecture · make the smallest change that fully solves the
task · match existing patterns and naming · state assumptions and trade-offs · keep contract, backend and
clients consistent · explain what changed and how to verify it.

**Don't:** invent libraries, endpoints, env vars or fields that aren't defined (check `contracts` and the
schema first) · bypass the queue engine, tenant scoping, validation or auth "to keep it simple" · trust
client-provided identity, amounts, prices or `hospitalId` · add dependencies or scope beyond the current
phase without approval · weaken security, remove audit logging, or swallow errors to make something pass ·
hardcode secrets or mix fake data into production paths.

**Build log — not optional:** append to `docs/PROGRESS.md` whenever you finish a unit of work (a subtask,
a wave, a phase, a standalone decision). Record what you did, what you **decided and why**, and which
alternatives you rejected — plus failures, dead ends and surprises, which are the highest-value entries.
It is **append-only**: never edit a past entry to look right in hindsight; write a new one that reverses
it. Also tick the `☐` in `docs/Phases.md` — that is the scoreboard, PROGRESS.md is the narrative. Read it
before continuing work. Full rule: `docs/Rules.md` §16.

**Git:** never commit or push unless asked. Work on a branch. Never commit secrets, `.env`, build
artifacts, or `node_modules`. Run `lint + typecheck + test` before calling work complete.

**When blocked or ambiguous:** stop and ask a specific question rather than guessing or silently
changing scope.
