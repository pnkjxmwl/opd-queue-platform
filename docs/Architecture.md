# Architecture

## OPD Queue Platform — Technical Architecture

**Status:** Draft v1
**Companion docs:** PRD.md · Rules.md · Phases.md · Design.md

---

## 1. Guiding Principles

1. **The backend/database is the single source of truth.** Clients (mobile, web) render state and send intents; they never own queue state. Realtime is only a distribution mechanism.
2. **Modular monolith, not microservices.** One backend deployment, cleanly split into domain modules. Extract services later only if a module needs independent scaling.
3. **Domain commands, not raw CRUD**, for anything that changes the queue. Each command validates state + permissions inside a transaction.
4. **Multi-tenant by construction.** Every hospital-owned row carries `hospital_id`; the backend scopes every query and never trusts the client.
5. **TypeScript end-to-end** with a **shared contract package**, so the API shape is defined once and reused by backend, web, and mobile.
6. **Privacy & auditability from day one** (India/DPDP): audit logs, access control, India-region hosting.

---

## 2. Technology Stack

| Layer | Choice | Why |
|---|---|---|
| **Patient app** | React Native + **Expo** (Expo Router) | iOS + Android from one codebase; Expo handles builds, push, secure storage. |
| **Web console** (doctor/staff/admin) | **Next.js** (App Router) + React | Mature, fast, one app with role-gated routes. |
| **Backend** | **NestJS** (Node + TS) | Structured modular monolith, DI, guards/interceptors — fits domain-command + RBAC design. |
| **Database** | **PostgreSQL** + **Prisma** | Relational data, transactions, row locks. Prisma = typed queries + migrations. |
| **Cache / locks / pub-sub** | **Redis** (ioredis) | Distributed locks, caching, and the Socket.IO scaling adapter. |
| **Realtime** | **Socket.IO** (+ Redis adapter) | Rooms per session, reconnection handling, horizontal scaling. |
| **Background jobs** | **BullMQ** (Redis-backed) | Grace-period timers, ETA refresh, reservation expiry, notifications. |
| **Payments** | **Razorpay** (test mode) | India-native gateway; webhook-driven, idempotent. |
| **Auth** | JWT (access + refresh) + Passport (Google OAuth) | Email/password + Google sign-in. |
| **Push notifications** | Expo Push (→ FCM/APNs) | Free, works on both platforms. |
| **Validation / contract** | **Zod** shared schemas (`nestjs-zod` on backend) | One source of truth for DTOs + runtime validation on every surface. |
| **Data fetching (clients)** | TanStack Query | Caching, refetch-on-reconnect, pairs well with realtime. |
| **UI (web)** | Tailwind + shadcn/ui | Fast, consistent, accessible components. |
| **Monorepo tooling** | pnpm workspaces + Turborepo | Share the contract package; one install, coordinated builds. |
| **Logging / errors** | pino + Sentry | Structured logs + error tracking. |

---

## 3. System Topology

```
   ┌──────────────┐     ┌──────────────────────┐     ┌───────────────────┐
   │ Patient app  │     │  Web console          │     │ Razorpay          │
   │ (Expo RN)    │     │  (Next.js)            │     │ (test)            │
   │ iOS/Android  │     │  doctor/staff/admin   │     └─────────┬─────────┘
   └──────┬───────┘     └──────────┬────────────┘               │ webhook
          │  HTTPS + WSS           │  HTTPS + WSS                │
          └────────────┬───────────┴───────────────┬────────────┘
                       ▼                            ▼
              ┌───────────────────────────────────────────────┐
              │            NestJS Backend (modular monolith)   │
              │  REST API  ·  Socket.IO gateway  ·  Job workers │
              └───────┬───────────────┬──────────────┬─────────┘
                      │               │              │
                 ┌────▼────┐     ┌────▼────┐    ┌────▼─────────┐
                 │ Postgres│     │  Redis  │    │ Expo Push    │
                 │ (truth) │     │cache/   │    │ (FCM/APNs)   │
                 │         │     │lock/pub │    └──────────────┘
                 └─────────┘     └─────────┘
```

- **Clients hold no authoritative state.** They fetch snapshots over REST and receive live deltas over WebSocket.
- **On reconnect:** client re-fetches the REST snapshot, then re-subscribes to the socket room. No trust in stale client state.

---

## 4. Repository Structure (monorepo)

```
opd-queue-platform/
├── apps/
│   ├── api/                # NestJS backend (the core)
│   ├── web/                # Next.js console (doctor + staff + admin)
│   └── mobile/             # Expo React Native patient app
├── packages/
│   ├── contracts/          # Zod schemas, DTOs, enums — the shared API contract
│   └── config/             # shared tsconfig, eslint, prettier
├── docker-compose.yml      # local Postgres + Redis
├── turbo.json
└── package.json            # pnpm workspaces
```

### 4.1 Backend internal structure (modular monolith)

```
apps/api/src/
├── main.ts
├── app.module.ts
├── common/                 # cross-cutting
│   ├── guards/             # JwtGuard, RolesGuard, TenantGuard
│   ├── interceptors/       # logging, audit, serialization
│   ├── filters/            # exception → clean error shape
│   ├── decorators/         # @CurrentUser, @CurrentHospital, @Roles
│   └── tenant/             # tenant context (hospital scoping)
├── prisma/
│   ├── schema.prisma
│   └── prisma.service.ts
├── realtime/               # Socket.IO gateway + Redis adapter + room helpers
├── jobs/                   # BullMQ queues + workers
├── modules/
│   ├── auth/               # signup/login/google/refresh
│   ├── accounts/           # user accounts
│   ├── patients/           # family profiles
│   ├── config/             # departments + doctors + schedules + queue policy (ADMIN)
│   ├── staff/              # memberships and invitations
│   ├── discovery/          # ★ patient READ model: cities/hospitals/departments/doctors/sessions
│   ├── sessions/           # OPD sessions + presence + session state
│   ├── queue/              # ★ the heart: state machine + domain commands
│   ├── eta/                # estimation engine
│   ├── payments/           # Razorpay orders, webhook, refunds
│   ├── notifications/      # push dispatch + records
│   ├── audit/              # audit + access logs
│   └── admin/              # config + RBAC management
└── ...
```

Each module owns its controller (HTTP), service (logic), and Prisma access. Cross-module calls go through services, not direct DB reads into another module's tables.

Two deliberate departures from the sketch above, both taken during the build and recorded in
`PROGRESS.md`:

- **`config/` is one module, not four.** Departments, doctors, schedules and the queue policy are
  edited together, are all ADMIN-only and tenant-scoped, and reference each other constantly. Splitting
  them would turn every ordinary read into a cross-module service call for no isolation gained.
- **`discovery/` reads tables it does not own** — the single exception to the rule above. It is
  read-only, writes nothing and exports no service. The owning services are scoped to a *staff*
  membership and apply admin visibility rules, which a patient has neither of; and a session card is
  one aggregate join across four tables, which split across services becomes a per-card N+1 on the
  hottest read path in the product. Do not extend the exception to anything that writes.

---

## 5. Data Model

Global (cross-hospital) entities: **Account, Patient**. Everything else is **tenant-scoped** (`hospital_id`).

### 5.1 Core entities (fields abbreviated)

```
Account            id, email(unique), passwordHash?, googleId?, createdAt
Patient            id, accountId(owner), name, dob, gender, relation(SELF|MOTHER|...),
                   abhaId?, createdAt

Hospital           id, name, city, area, address, status(PENDING|VERIFIED|SUSPENDED)
HospitalStaff      id, hospitalId, accountId, role(ADMIN|RECEPTION|DOCTOR),
                   permissions[], status         # a login's membership in a hospital
Department         id, hospitalId, name
Doctor             id, hospitalId, departmentId, accountId?, name, specialization,
                   defaultConsultMins           # seed for ETA cold-start
DoctorSchedule     id, hospitalId, doctorId, recurrence(weekday/date), startTime, endTime,
                   defaultFee

QueuePolicy        id, hospitalId, orderingStrategy, walkInEnabled, priorityEnabled,
                   gracePeriodSec, recallAttempts, requeueBehavior, checkInRequired,
                   registrationCutoff(SMART|CLOCK|MAX_TOKENS), maxOnlineTokens?,
                   cancellationRules(json)

OPDSession         id, hospitalId, departmentId,
                   originalDoctorId, currentProviderDoctorId,     # substitution-safe
                   date, scheduledStart, scheduledEnd,
                   status(SCHEDULED|OPEN_FOR_REGISTRATION|ACTIVE|COMPLETED|CANCELLED|ENDED_EARLY),
                   doctorPresence(NOT_PRESENT|PRESENT|ON_BREAK|LEFT),
                   queuePolicyId, tokenPrefix, fee, version

QueueEntry         id, hospitalId, sessionId, patientId, accountId,
                   tokenNumber, tokenLabel(e.g. "A027"),
                   type(ONLINE|WALK_IN|FOLLOW_UP|PRIORITY|EMERGENCY),
                   status(RESERVED|CONFIRMED|VIRTUAL_WAITING|CHECKED_IN|READY|CALLED|
                          IN_CONSULTATION|COMPLETED|CANCELLED|NO_SHOW|SKIPPED|RESCHEDULED),
                   priorityRank, checkInCode(signed),
                   joinedAt, checkedInAt, calledAt, consultStartedAt, completedAt,
                   estWindowStart, estWindowEnd

Payment            id, hospitalId, queueEntryId, accountId, amount, currency,
                   status(CREATED|PENDING|SUCCESS|FAILED|REFUNDED|PARTIALLY_REFUNDED),
                   razorpayOrderId, razorpayPaymentId, razorpaySignature, idempotencyKey
Refund             id, hospitalId, paymentId, amount, status, razorpayRefundId, reason

Consultation       id, hospitalId, queueEntryId, patientId, doctorId,
                   startedAt, endedAt, durationSec        # feeds ETA learning

QueueEvent         id, hospitalId, sessionId, entryId?, type, actorType, actorId,
                   metadata(json), createdAt              # append-only timeline
AuditLog           id, hospitalId?, actorType, actorId, action, entityType, entityId,
                   reason?, metadata(json), createdAt
Notification       id, accountId, type, payload(json), channel(PUSH), status, sentAt
```

### 5.2 Isolation rule (multi-tenancy)

- Every tenant-scoped table has `hospital_id` and is indexed on it.
- A `TenantGuard` derives the caller's active `hospital_id` from their `HospitalStaff` membership (never from the request body/query).
- All repository reads/writes for those tables are filtered by that `hospital_id`. Fetching a record by id also checks it belongs to the caller's hospital → defeats IDOR/BOLA.
- (Later hardening: Postgres Row-Level Security as a second safety net.)
- **Patients/Accounts are global**: a patient can visit any hospital. A hospital only ever sees a patient *through a QueueEntry in its own session*.

---

## 6. API Design

REST for request/response, WebSocket for live deltas. **Reads are REST/CRUD-ish; writes that touch the queue are domain commands.**

### 6.1 Auth & profiles
```
POST /auth/signup            email + password
POST /auth/login
POST /auth/google            Google ID token
POST /auth/refresh
POST /auth/logout
GET  /me                     account + memberships
GET/POST/PATCH /patients     family profiles under the account
```

### 6.2 Discovery (patient, session-first)

Built in Phase 3. Authenticated but NOT tenant-scoped: any signed-in patient may see any listable
hospital, which is expressed by the absence of a `:hospitalId` segment — `TenantGuard` keys off that
parameter, so every route here uses `:id`.

```
GET /cities
GET /hospitals?city=&area=&q=
GET /hospitals/:id
GET /departments?hospitalId=                → NOT /hospitals/:id/departments, see below
GET /departments/:id/sessions?date=today   → session cards (doctor + live queue + ETA + fee)
GET /sessions/:id                          → session detail + live queue snapshot
GET /doctors?q=&city=                      → doctor search (secondary path)
GET /doctors/:id                           → doctor profile
GET /doctors/:id/sessions?date=            → that doctor's sessions (matches CURRENT PROVIDER)
```

**Why departments hang off a query string.** `GET /hospitals/:id/departments` collides with the
admin route `GET /hospitals/:hospitalId/departments` from Phase 2. Express matches on route *shape*,
not parameter name, so one silently shadows the other — and the matched route's parameter name is what
decides whether `TenantGuard` engages, so a patient would get a 403 instead of a list. Guarded by a
test in `apps/api/test/discovery.e2e.test.ts`.

**The queue snapshot on these responses is a frozen shape.** `QueueSnapshot` in `packages/contracts`
declares `nowServingToken`, the two ahead-of-you counts, `registrationOpen` and the ETA window now;
Phase 4 fills the counts and Phase 7 the window. Adding a field is safe, renaming or removing one
breaks a shipped mobile app.

### 6.3 Join & payment (patient)
```
POST /sessions/:id/join            → creates RESERVED entry + Razorpay order
POST /webhooks/razorpay            → payment.captured → confirm entry, assign token (idempotent)
GET  /me/queue-entries             → active + past entries (recovers state after crash/relaunch)
POST /queue-entries/:id/cancel     → cancel per policy (may trigger refund)
```

### 6.4 Queue domain commands (doctor / staff — RBAC-guarded)
```
POST /sessions/:id/check-in            body: { checkInCode | tokenNumber }   (QR or manual)
POST /sessions/:id/call-next
POST /sessions/:id/start-consultation
POST /sessions/:id/complete-consultation
POST /sessions/:id/skip
POST /sessions/:id/no-show
POST /sessions/:id/pause  |  /resume
POST /sessions/:id/end
POST /sessions/:id/presence            body: { presence }
POST /sessions/:id/walk-in             body: { patient info }
POST /sessions/:id/priority            body: { entryId, reason }  (audited)
POST /sessions/:id/requeue             body: { entryId }
```

### 6.5 Admin config (RBAC: ADMIN)
```
CRUD /hospitals/:id/departments
CRUD /hospitals/:id/doctors
CRUD /hospitals/:id/schedules
CRUD /hospitals/:id/sessions          (or generate from schedules)
GET/PUT /hospitals/:id/queue-policy
CRUD /hospitals/:id/staff             invite + roles/permissions
GET  /hospitals/:id/reports/...
```

Every mutating endpoint: validated by a Zod DTO, authorized by `RolesGuard` + `TenantGuard`, and (for queue-affecting actions) writes an `AuditLog` + `QueueEvent`.

---

## 7. The Queue Engine (module: `queue`)

The most important subsystem. A `QueueService` exposes one method per domain command. **Every command follows the same skeleton:**

```
async command(sessionId, actor, input) {
  return prisma.$transaction(async (tx) => {
    // 1. Lock the session row so commands serialize per session
    const session = await tx.$queryRaw`SELECT ... FROM "OPDSession"
                                       WHERE id = ${sessionId} FOR UPDATE`;
    // 2. Authorize: actor's role + hospital + session state
    // 3. Validate the state-machine transition is legal
    // 4. Apply the mutation (entry status, timestamps, token, etc.)
    // 5. Append a QueueEvent + AuditLog (who/what/when/why)
    // 6. Recompute ETA for affected entries
    // 7. Schedule/cancel BullMQ jobs (grace timer, reservation expiry)
    // 8. Return new state; emit realtime events after commit
  });
}
```

Why this shape:
- **`SELECT … FOR UPDATE` on the session** serializes concurrent staff/doctor actions on the same queue → no double-`call-next`, no duplicate tokens (answers concurrency: PRD §11).
- **State-machine validation** means an entry can never jump to `COMPLETED` without going through `CALLED → IN_CONSULTATION`.
- **Append-only `QueueEvent`** gives the accountable timeline *and* the raw data the ETA engine learns from.

### 7.1 Call-order logic
- Eligible to be called = entries in `CHECKED_IN`/`READY` state.
- Order among eligible = `priorityRank` then `tokenNumber` (fairness = booking order), except `EMERGENCY` which is inserted at the front.
- The doctor never idles for not-yet-arrived patients (`VIRTUAL_WAITING` are not eligible).
- Walk-ins: created already `CHECKED_IN`, appended at the current max token.

### 7.2 No-show handling (BullMQ timers)
```
call-next → entry CALLED → schedule "grace-expiry" job (gracePeriodSec)
  patient checks in / consultation starts → cancel the job
  grace expires → recall (up to recallAttempts) → still absent → SKIPPED
                → requeue per policy (move to end of eligible pool) → notify patient
```

### 7.3 Token generation
`tokenLabel = tokenPrefix + zero-padded(tokenNumber)` (e.g. `A027`), unique per session. `tokenNumber` is assigned atomically inside the locked transaction on confirm.

---

## 8. ETA Engine (module: `eta`)

Pure function + light state, recomputed on relevant events (no ML in v1):

```
expected = weightedBlend(
   doctor.defaultConsultMins,        // cold-start seed
   doctorAllTimeAvg,                 // from past Consultations
   todaysRunningAvg                  // from today's Consultations (weighted highest)
)
remainingCurrent = max(minFloor, expected - currentPatientElapsed)
etaMinutes = remainingCurrent + (checkedInAhead * expected)
window = [now + etaMinutes - pad, now + etaMinutes + pad]
```

- Recomputed on: complete-consultation, check-in, walk-in/priority insert, presence change, and on a periodic BullMQ tick (so "time passing" while the doctor is idle/late is reflected).
- Latest window is stored on the `QueueEntry` for cheap reads and pushed via realtime.
- Also emits a **queue-health** signal when `todaysRunningAvg` >> `expected` ("running slower than usual").
- Displayed as a **window**, never an exact promise.

---

## 9. Realtime (module: `realtime`)

- **Socket.IO gateway** with the **Redis adapter** (so it scales across backend instances).
- **Rooms:**
  - `session:{id}` — everyone viewing that session's live queue (patients browsing, doctor, staff).
  - `account:{id}` — a patient's personal channel (their own entry status, nudges).
- **Events emitted after a command commits:**
  - `session.updated`, `entry.status_changed`, `eta.updated`, `session.status_changed`, `doctor.presence_changed`.
- **Auth on connect:** JWT verified in the handshake; server decides which rooms a socket may join (a patient can't join a hospital-only channel).
- **Reconnect contract:** client re-fetches the REST snapshot, then rejoins rooms. Realtime never replaces the snapshot as source of truth.

---

## 10. Payments (module: `payments`)

```
POST /sessions/:id/join
   → tx: create QueueEntry(status=RESERVED) + reserve token slot
   → create Razorpay order (amount = session.fee), store idempotencyKey
   → schedule "reservation-expiry" job (releases slot if unpaid)
   → return orderId to client

client → Razorpay Checkout → pays (test mode)

POST /webhooks/razorpay  (payment.captured)
   → verify signature
   → idempotent on razorpayOrderId (duplicate webhooks = no-op)
   → tx: Payment=SUCCESS, QueueEntry → CONFIRMED/VIRTUAL_WAITING, assign tokenNumber
   → cancel reservation-expiry job
   → emit realtime + enqueue push "Your token is A027"
```

- **The token is created from the server-verified webhook, never the client** → survives app crash before the success screen (PRD §Q). Client's own callback is only a UX hint; `GET /me/queue-entries` recovers truth on relaunch.
- **Refunds:** Razorpay refund API, tracked in `Refund`, driven by `QueuePolicy.cancellationRules`.

---

## 11. Auth & RBAC

- **Patients:** email/password (Argon2/bcrypt hash) or Google OAuth → JWT access (short) + refresh (rotating).
- **Doctor/staff/admin:** same account system, but authority comes from their `HospitalStaff` membership (`hospitalId` + `role` + `permissions`).
- **Guards pipeline:** `JwtGuard` (authn) → `RolesGuard` (role/permission) → `TenantGuard` (hospital scoping).
- **Rule:** no sensitive endpoint relies on the client hiding data; the backend authorizes every request against the caller's membership.

---

## 12. Background Jobs (module: `jobs`, BullMQ)

| Job | Trigger | Purpose |
|---|---|---|
| `reservation-expiry` | on join | Release token slot if payment not completed in TTL. |
| `grace-expiry` | on call-next | Drive recall → skip → requeue for no-shows. |
| `eta-tick` | periodic per active session | Refresh ETA as time passes / doctor idle. |
| `registration-cutoff` | periodic | Auto-close registration when ETA would exceed session end / cap hit. |
| `notification-dispatch` | on events | Send push via Expo. |
| `payment-reconcile` | periodic | Catch missed webhooks by polling Razorpay. |

---

## 13. Notifications (module: `notifications`)

- Central `NotificationService`; domain events enqueue notification jobs (no notification logic scattered in feature code).
- Channel: **Expo Push** (→ FCM/APNs) for MVP. Records stored for history/idempotency.
- Types: token issued, queue milestones, "leave/arrive now," called, delay, cancellation, refund, substitution.
- SMS/WhatsApp are pluggable later (needs India DLT registration).

---

## 14. Security & Privacy

- HTTPS/WSS everywhere; secrets in platform env vars (never in the repo).
- Tenant isolation enforced server-side (§5.2); IDOR checks on every by-id fetch.
- Rate limiting on auth + join endpoints; input validated by Zod DTOs.
- QR check-in code is a **signed, opaque reference** (no PII); validated server-side.
- **Audit + access logs** from day one; India-region hosting for data residency (DPDP).
- Passwords hashed (Argon2id). PII treated as sensitive; least-privilege access.

---

## 15. Hosting, Environments & CI/CD

### 15.0 Deployment model (monorepo ≠ monolith ≠ one deployment)

Two terms that sound alike but are independent:
- **Monorepo** = one git repository holding all three apps (so they share TypeScript types). It does **not** mean they deploy together.
- **Modular monolith** = only the **backend** (`apps/api`) is a single running service, internally split into modules. It does **not** include the web or mobile app.

From the one repo, the build tools produce **three separate artifacts** shipped to **three destinations**:

```
ONE GIT REPO
├── apps/api     ─build→  Backend server (Render/Railway)   ← the "modular monolith"; only this runs on a server
├── apps/web     ─build→  Vercel (website in a browser)
└── apps/mobile  ─build→  .aab/.ipa → Play Store / App Store → users' phones
```

- Deploying the backend builds/copies **only `apps/api`** to the server (configure the deploy root = `apps/api`). The mobile/web code is ignored. Push to GitHub → CI/CD deploys automatically; nothing is copied by hand.
- **The mobile app never runs on the server.** It is compiled into an installable app, distributed via the stores, installed on phones, and talks to the backend over HTTPS/WSS.
- Deploying one target does not touch the others. Backend changes don't require a new app release (and vice-versa) as long as the shared `contracts` API stays compatible.

### 15.1 Mobile app distribution (Expo EAS)

```
apps/mobile  ──eas build──▶  Android .aab / iOS .ipa
             ──eas submit──▶  Google Play Console / Apple App Store Connect
             ──review──▶      live on stores ──▶ users install
```

- **Developer accounts (only needed to publish):** Google Play — one-time **$25**; Apple Developer — **$99/year** (required for iOS incl. TestFlight). iOS builds run in EAS cloud — no Mac required.
- **Pre-release testing:** Expo Go / dev build on your own device; TestFlight (iOS) + Play internal-testing track for beta users.
- **Updates:** JS/UI-only changes ship instantly via **`eas update`** (OTA, no store review); native/permission changes need a new build + resubmit.

### 15.2 Environments & hosting

**Environments:** `local` (docker-compose Postgres+Redis) → `staging` → `production`.

| Component | Host (MVP) |
|---|---|
| Backend (API + WS + workers) | Render / Railway / Fly.io (container), **India region** |
| PostgreSQL | Managed (Neon / Render / Railway) |
| Redis | Managed (Upstash / Render) |
| Web console | Vercel |
| Mobile app | Expo EAS → TestFlight + Play internal → stores |

- **CI/CD:** GitHub Actions — install → lint → typecheck → test → `prisma migrate deploy` → deploy. Separate workflow for mobile (EAS build/submit).
- **Config:** all secrets (DB URL, Redis URL, JWT secrets, Razorpay keys, Expo tokens) via environment variables per environment.
- **Cost:** ~$20–50/month to start at pilot scale.

---

## 16. Observability

- **Logging:** pino structured logs, request IDs, per-command context.
- **Errors:** Sentry (backend + clients).
- **Health:** `/health` (liveness) + `/health/ready` (DB/Redis checks).
- **Metrics (later):** queue throughput, ETA accuracy (predicted vs actual), payment success rate, realtime connection counts.

---

## 17. Key End-to-End Scenarios (traced)

**A) Two staff press "check-in" for different patients at once**
→ both hit `POST /check-in` → each transaction takes `FOR UPDATE` on the session → they serialize → both succeed in order, queue stays consistent. Two `call-next` at once → second sees updated state, gets the *next* patient, not a duplicate.

**B) Payment succeeds, app crashes before token screen**
→ Razorpay webhook confirms server-side → token created + push sent → on relaunch `GET /me/queue-entries` shows the token. No duplicate (idempotent on order id), no loss.

**C) Doctor runs 30 min on one patient**
→ `eta-tick` + `todaysRunningAvg` push everyone's window later + queue-health flag → patients see updated windows in realtime. Nothing breaks.

**D) Patient backgrounds the app for 2 hours**
→ state is server-driven; push keeps them informed; on reopen, snapshot re-fetch + socket rejoin shows current status (even if called/skipped meanwhile).

---

## 18. What We Deliberately Defer

- Microservice extraction, event sourcing, CQRS.
- Live travel-time ETA, maps.
- SMS/WhatsApp, ABDM/ABHA, HIS/EMR, prescriptions, appointments, lab/pharmacy.
- ML-based ETA (v2+, once event data exists).
- Offline-first reception (MVP is online + resilient reconnect).
