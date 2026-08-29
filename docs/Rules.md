# Rules

## OPD Queue Platform — Engineering & AI Guardrails

**Status:** Draft v1
**Companion docs:** PRD.md · Architecture.md · Phases.md · Design.md · PROGRESS.md (build log)

These are the boundaries for building this project (human or AI). When a rule here conflicts with a quick shortcut, the rule wins. If a rule blocks you, stop and ask rather than working around it.

---

## 1. Golden Rules (non-negotiable)

1. **The backend/database is the only source of truth.** Never let a client decide queue state, token order, prices, or permissions.
2. **Every queue-changing action goes through a domain command** in the `queue` service, inside a DB transaction with a per-session `FOR UPDATE` lock. **No raw CRUD on `QueueEntry`/`OPDSession` status.**
3. **Tenant scoping is server-side, always.** Derive `hospital_id` from the caller's membership — never from request body/query/header. Every by-id fetch verifies the record belongs to the caller's hospital.
4. **Money is confirmed by the Razorpay webhook, not the client.** Token creation is idempotent on the order id.
5. **No secrets in the repo.** All keys/URLs come from environment variables.
6. **Validate all input with Zod** from the shared `contracts` package. No unvalidated request data reaches a service.
7. **Every queue-affecting action writes an `AuditLog` + `QueueEvent`.** Accountability is a feature, not optional.
8. **Never break the shared API contract silently.** Change `packages/contracts` first; backend and clients follow.

---

## 2. Tech Stack — Use / Avoid

**Use (the agreed stack — do not swap without approval):**
- Backend: NestJS, Prisma, PostgreSQL, ioredis, Socket.IO (+ Redis adapter), BullMQ, `nestjs-zod`, Passport (Google), Razorpay SDK, pino, Argon2 (password hashing).
- Web: Next.js (App Router), React, TanStack Query, Tailwind, shadcn/ui, socket.io-client.
- Mobile: Expo (Expo Router), React Native, TanStack Query, socket.io-client, Expo Notifications, `react-native-qrcode-svg`, expo-secure-store.
- Shared: Zod, TypeScript (strict).

**Avoid unless explicitly approved:**
- A different ORM (TypeORM/Sequelize/Knex), a different gateway, or a different realtime lib.
- Redux/MobX (use TanStack Query + local state; add a store only if genuinely needed).
- Moment.js (use date-fns / native `Intl`).
- ORM-bypassing raw SQL, except the intentional `SELECT … FOR UPDATE` lock and read-only reporting queries.
- Adding a new dependency for something the standard library or an existing dep already does.
- Introducing microservices, a message broker, event sourcing, or GraphQL in the MVP.

**Before adding any new dependency:** confirm it's necessary, actively maintained, and not duplicating an existing one. Prefer the smallest option.

---

## 3. Project Structure Rules

- Keep the monorepo layout from Architecture.md (`apps/api`, `apps/web`, `apps/mobile`, `packages/contracts`, `packages/config`).
- Backend code lives in feature **modules** under `apps/api/src/modules`. Each module = controller + service + its Prisma access.
- **No cross-module database access.** Module A must not read Module B's tables directly — call B's service.
- Shared DTOs/enums/types live **only** in `packages/contracts`. Do not redefine them per app.
- Cross-cutting concerns (guards, interceptors, filters, decorators, tenant context) live in `apps/api/src/common`.

---

## 4. Backend Rules

- **Controllers are thin.** They validate (Zod), authorize (guards), and delegate to services. No business logic in controllers.
- **Services own logic.** State transitions, invariants, and side effects live here.
- **Domain commands** (`callNextPatient`, `checkInPatient`, `completeConsultation`, …) each: lock the session → authorize → validate the state-machine transition → mutate → append `QueueEvent`+`AuditLog` → recompute ETA → schedule/cancel jobs → emit realtime **after commit**.
- **Never emit a realtime event before the transaction commits.** Emit only confirmed state.
- **State machine is explicit.** An entry may only move along legal transitions (see PRD §7.3). Reject illegal transitions with a clear error.
- **Concurrency:** any operation that reads-then-writes queue/session state must hold the session `FOR UPDATE` lock for the whole transaction.
- **Idempotency:** payment/webhook/join handlers must be safe to call twice (key on order id / idempotency key).

---

## 5. Data & Prisma Rules

- All schema changes go through **Prisma migrations** (`prisma migrate`). No manual DB edits; no `db push` against staging/production.
- **Every tenant-scoped table has `hospitalId`** and is indexed on it. Global tables: `Account`, `Patient` only.
- Money is stored in the **smallest currency unit (paise) as integers**, never floats.
- Store timestamps in **UTC**; convert for display in the client.
- `QueueEvent` and `AuditLog` are **append-only** — never update or delete rows.
- Use transactions for any multi-row invariant. Prefer unique constraints to enforce "one token per number per session," etc.
- No destructive migration (drop column/table) without an explicit, reviewed step.

---

## 6. API & Contract Rules

- **`packages/contracts` is the single source of truth** for request/response shapes and enums. Define the Zod schema there; infer types from it on all sides.
- **Reads** may be REST/resource-style. **Writes that change the queue** are command endpoints (`POST /sessions/:id/<command>`), never `PATCH status`.
- Responses use a consistent envelope and consistent error shape (see §7).
- **Versioning:** additive changes are fine; breaking changes require a contract update + coordinated client change. Never break a shipped mobile app's expectations without a fallback.
- Paginate list endpoints; never return unbounded lists.

---

## 7. Error Handling

- Throw typed, meaningful errors (e.g. `InvalidQueueTransition`, `NotCheckedIn`, `TenantMismatch`, `PaymentNotVerified`). Don't throw bare strings.
- A global exception filter maps errors to a **consistent JSON shape**:
  ```json
  { "error": { "code": "INVALID_QUEUE_TRANSITION", "message": "human-readable", "details": {} } }
  ```
- **Never leak internals** (stack traces, SQL, secrets) to clients. Log full detail server-side (pino), return a safe message + code.
- Use correct HTTP status codes (400 validation, 401 authn, 403 authz/tenant, 404, 409 conflict/transition, 422, 429 rate limit, 5xx server).
- **Fail loudly in development, safely in production.** No silent `catch {}` that swallows errors.
- Clients handle every request's loading / empty / error / success states — no unhandled promise rejections.

---

## 8. Realtime Rules

- Realtime is a **distribution mechanism only**, never the source of truth.
- On (re)connect, the client **fetches the REST snapshot first**, then subscribes to rooms.
- Authorize socket room joins on the server from the JWT — a patient cannot join hospital-only channels.
- Emit domain events (`entry.status_changed`, `eta.updated`, …) only after the DB transaction commits.
- Clients must tolerate missed/duplicate events (reconcile against snapshots); never assume perfect delivery.

---

## 9. Payments Rules

- Create the Razorpay order **server-side**; never trust an amount sent by the client — use the session fee.
- **Verify the webhook signature.** Treat the verified webhook as the confirmation of truth.
- Token issuance is **idempotent** on the order id; duplicate webhooks are no-ops.
- Reservations expire via a scheduled job if unpaid; releasing a slot must not affect a paid entry.
- Refunds go through the Razorpay refund API and are recorded in `Refund`, governed by `QueuePolicy.cancellationRules`.
- Keep Razorpay keys in env vars; test mode for MVP.

---

## 10. Auth & Security Rules

- Passwords hashed with **Argon2id**. Never store or log plaintext passwords or tokens.
- Access tokens short-lived; refresh tokens rotated. Store client tokens in **secure storage** (expo-secure-store / httpOnly cookies for web).
- Guard pipeline on protected routes: `JwtGuard` → `RolesGuard` → `TenantGuard`. **No sensitive endpoint is unguarded.**
- Authorization is enforced on the backend, never by hiding UI on the client.
- Rate-limit auth, join, and webhook endpoints.
- The QR check-in code is a **signed opaque reference** with no PII; validate server-side.
- Treat all patient data as sensitive (DPDP). Log access to sensitive data. India-region hosting.

---

## 11. Frontend Rules (web + mobile)

- Data comes through **TanStack Query**; refetch on reconnect; keep server state out of ad-hoc component state.
- Never hardcode secrets or full API URLs in code — use env config.
- Handle loading / empty / error / offline states on every screen.
- Mobile: assume flaky networks — retries, optimistic UI only where safe, always reconcile with server truth.
- Keep components small and typed; reuse the `contracts` types — no re-typing API shapes by hand.
- Accessibility and clear states matter (doctors/staff use this under time pressure); follow Design.md.

---

## 12. Testing Rules

- **Unit-test the queue state machine and ETA engine thoroughly** — these are the highest-risk logic. Cover every transition and edge case from PRD §8 (no-show, emergency, concurrency, doctor late/early/substitution).
- Integration-test domain commands against a real Postgres (transactions, locking, idempotency).
- Test payment flow with idempotent/duplicate webhooks.
- A new domain command is not "done" without tests for its happy path + illegal transitions + authz/tenant checks.

---

## 13. Git & Workflow Rules

- Never commit or push unless asked. Work on a branch, not the default branch.
- Small, focused commits with clear messages describing *why*.
- Never commit secrets, `.env` files, build artifacts, or `node_modules`.
- Run lint + typecheck + tests before proposing a change is complete.
- Prisma migrations are committed with the code that needs them.

---

## 14. AI Working Agreement (what the AI should / shouldn't do)

**Should:**
- Follow these rules, the PRD, and the Architecture. When unsure, re-read them before coding.
- Make the smallest change that fully solves the task; match existing patterns and naming.
- State assumptions and call out trade-offs. Ask before doing anything hard to reverse (schema drops, new external services, dependency swaps, deployments).
- Keep the shared contract, backend, and clients consistent when changing an API.
- Explain what changed and why, and how to run/verify it.
- **Append to `docs/PROGRESS.md`** what you did, what you decided, and why — see §16. Finishing a piece of work includes recording the reasoning behind it.

**Should NOT:**
- Invent libraries, endpoints, env vars, or fields that aren't defined — check `contracts` and the schema first.
- Bypass the queue engine, tenant scoping, validation, or auth "to keep it simple."
- Trust client-provided identity, amounts, prices, or `hospital_id`.
- Add dependencies, microservices, or scope beyond the current phase without approval.
- Weaken security, remove audit logging, or swallow errors to make something pass.
- Hardcode secrets, or mix mock/fake data into production paths.

**When blocked or ambiguous:** stop and ask a specific question rather than guessing or silently changing scope.

---

## 15. Parallel Agent Discipline

This project is built by **multiple agents working in parallel** using the wave model in
Phases.md §A. These rules keep parallel work from colliding or diverging. They are as
important as §1.

1. **Contract-first — respect the waves.** Do not start implementation (Wave 2) until the
   phase's **contract (`packages/contracts`) and Prisma schema (Wave 1) are locked and merged**.
   The frozen contract is the only thing that lets parallel streams integrate.
2. **Own exactly one directory.** Each parallel agent owns a single area — an `apps/api`
   module, an `apps/web` route, or `apps/mobile`. **Never edit another agent's files.** The
   safe fan-out is `apps/api ∥ apps/web ∥ apps/mobile`.
3. **Do not touch `packages/contracts` mid-wave.** If you discover the contract is wrong,
   **stop and raise a coordinated change** — never patch a local copy or diverge the shape of
   shared data. A contract change ripples to every stream and must be re-synced centrally.
4. **Command-per-file in the queue engine.** Each domain command is its own file/handler that
   `QueueService` composes, so command work parallelizes without two agents editing one file.
   Do not collapse commands into a single shared file.
5. **One worktree/branch per agent.** Work in isolation (`isolation: "worktree"`); branch
   name `phaseN/<stream>-<short-desc>`. Rebase on the merged Wave-1 before opening a PR.
   Merge order: **contract+schema → backend → web/mobile → integration.**
6. **Mock-then-integrate (UI).** Web/mobile agents build against the frozen contract with
   fixtures/mocks so they never block on the backend; switch to the real API at integration.
7. **Every phase has a named integration owner** who runs the final wave and the phase's
   end-to-end "Done-when" test before the phase is called complete.
8. **Stay in your phase and scope.** Don't pull work forward from a later phase or widen scope
   without coordination — it breaks the dependency assumptions other agents rely on.

---

## 16. Build Log (`docs/PROGRESS.md`)

`docs/PROGRESS.md` is the project's **append-only build log**. Code and git history already record
*what* changed; the log records *why* — and the things that leave no trace in a diff: the alternatives
rejected, the approach that failed, the constraint that forced a choice.

1. **Append an entry whenever you finish a unit of work** — a subtask, a wave, a phase, or a standalone
   decision. Do it then, not "later": the reasoning is only accurate while it is fresh.
2. **Every decision carries its *why*, and the alternatives you rejected.** "Used X" is worthless in
   three months. "Used X because Y failed on Z, and W would have broken V" is the entire value of this
   file.
3. **Record failures, dead ends and surprises, not just successes.** The approach that did *not* work is
   usually the highest-value entry — it stops the next attempt repeating it.
4. **Append, never rewrite.** Past entries are history, not documentation. If a decision is later
   reversed, write a *new* entry saying so and why; never edit an old entry to look correct in hindsight.
5. **Don't duplicate the scoreboard.** Phase and subtask *status* lives in `Phases.md` (the `☐` boxes and
   §0 Progress Board); PROGRESS.md holds the *narrative*. A completed subtask updates **both**: tick the
   box, append the entry.
6. **Read it before continuing work** — especially after a break, or when picking up a phase someone
   else started. It carries the context the code cannot.

The entry format is defined at the top of `docs/PROGRESS.md` itself. Follow it there rather than copying
it here, so the template has one source of truth (§6).
