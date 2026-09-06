# Product Requirements Document (PRD)
## OPD Queue Platform

**Status:** Draft v1 (design locked)
**Market:** India
**Last updated:** 2026-08-29

---

## 1. Overview

A digital **OPD (Out-Patient Department) queue management platform** that lets patients remotely join a hospital doctor's live queue, watch their position and estimated consultation time update in real time, and arrive at the hospital only when their turn is near — instead of physically sitting in a waiting room for hours.

The **queue is the core product**, not a side feature. The differentiator is: *remote queue joining + live queue visibility + accurate, dynamic ETA.*

The platform serves three types of users over one shared core domain:
- **Patients** — a mobile app (iOS + Android).
- **Doctors** — a simple web console.
- **Hospital staff & admins** — a web console for operations and configuration.

---

## 2. Problem Statement

Today, seeing a doctor at an OPD means: travel to the hospital → register at reception → buy a paper token → sit and wait, often for hours, with no idea how long the wait will be. This wastes patients' time and crowds hospital waiting areas.

**The platform solves this by:**
- Letting patients discover a hospital, department, and doctor, and see the *live* queue before deciding to join.
- Letting them join the queue and pay from home, receiving a digital token.
- Continuously predicting when their turn will come and telling them when to leave.
- Giving hospital staff and doctors a real-time tool to run the queue in an orderly, accountable way.

---

## 3. Target Users & Personas

### 3.1 Patient (primary consumer)
- Wants to see a doctor without wasting a half-day waiting.
- Uses the mobile app to discover hospitals, join queues, track ETA, and manage visits for **themselves and family members**.
- Example: *Pankaj books a cardiology consultation for his father, watches the queue from home, and drives over when the app says "leave now."*

### 3.2 Doctor
- Wants to focus on patients, not administration.
- Uses a minimal web console: see the current patient and who's next, call the next patient, start/complete consultations, take breaks, end the session.

### 3.3 Reception / Operations Staff
- The operational backbone at the hospital.
- Checks patients in, verifies tokens, adds walk-ins, handles no-shows, inserts authorized priority/emergency cases, assists with cancellations.

### 3.4 Hospital Admin
- Configures the hospital: departments, doctors, schedules, fees, queue policy, staff accounts and permissions.
- Onboards the hospital onto the platform.

### 3.5 Platform Super-Admin (internal)
- Onboards and verifies hospitals, oversees the platform, handles support and disputes.

---

## 4. Goals & Non-Goals (MVP)

### 4.1 Goals (what the MVP must deliver)
1. Patients can sign up, add family members, and discover hospitals by city/area.
2. Patients can browse Hospital → Department → Doctor → today's **OPD Session** and see the **live queue** and **dynamic ETA**.
3. Patients can **join the queue, pay (Razorpay), and receive a token** remotely.
4. Patients see their **live position, ETA window, and arrival nudges** in real time, plus **push notifications**.
5. Staff can **check patients in**, add walk-ins, and manage no-shows.
6. Doctors can run the queue: call next, start/complete consultation, pause, end session.
7. Hospital admins can **configure** their hospital and **queue policy**.
8. The system is **multi-tenant** (many hospitals, strictly isolated), **real-time**, and **auditable**.

### 4.2 Non-Goals (explicitly out of MVP)
- **Prescriptions / clinical records** (structured Rx, diagnoses) — later phase.
- **Appointment booking** (fixed-time slots) — later phase; will coexist, not replace queues.
- **Lab reports, pharmacy, insurance, billing, teleconsultation** — later phases.
- **HIS/EMR integration** — the platform *is* the hospital's OPD queue system for v1, not a layer on top of existing software.
- **ABDM/ABHA** — architecture stays ABDM-ready, but ABHA is not required to use the platform.
- **SMS/WhatsApp notifications** — push only for MVP.
- **Live travel-time / maps-based "leave now"** — MVP uses a hospital-configured "arrive N minutes before your window."

---

## 5. Core Concepts (Domain Glossary)

| Concept | Meaning |
|---|---|
| **Account** | The login (a person using the app). Owns one or more Patient profiles. |
| **Patient** | The person actually receiving care. May be the account holder or a family member. |
| **Hospital** | A tenant on the platform. Owns departments, doctors, staff, sessions. |
| **Department** | A unit within a hospital (e.g. Cardiology). |
| **Doctor** | A provider who runs OPD sessions in a department. |
| **OPD Session** | A doctor's specific working block on a specific date (e.g. Dr. Sharma, Cardiology, 26 Aug, 10:00–13:00). **The queue belongs to the session, not permanently to the doctor.** |
| **Queue** | The ordered set of entries for one OPD session. |
| **Queue Entry / Token** | One patient's place in a session's queue. Token number = an immutable label in booking order; it is **not** the call order. |
| **Check-in** | Staff confirming a patient is physically present. Only checked-in patients are eligible to be called. |
| **Consultation / Visit** | The actual appointment with the doctor, created when the patient is called in. |
| **Queue Policy** | Per-hospital configuration governing ordering, walk-ins, priority, no-show handling, cutoffs, cancellation/refunds. |
| **ETA** | A continuously recalculated *estimate window* of when the patient will be seen. |

**Core hierarchy:**
`Hospital → Department → Doctor → OPD Session → Queue → Queue Entry → Check-in → Consultation`

---

## 6. Features by Surface

### 6.1 Patient App (iOS + Android)
- **Auth:** sign up / log in with **email + password** or **Google sign-in**.
- **Family profiles:** add and manage multiple patient profiles (self, mother, father, child); choose "who is this for" when booking.
- **Discovery (session-first):** select city/area → browse hospitals → departments → **today's OPD sessions**. Each session card headlines the **doctor**, plus timing, status, "now serving," queue size, join-now ETA, and fee. Browsing/searching by **doctor** is a secondary entry point that leads to that doctor's session(s). **The joinable unit is always a session** (this also handles a doctor running two sessions in a day as two cards, and hides doctors with no OPD today).
- **Live queue view:** current token being served, "X checked in ahead of you," "Y booked but not arrived," and an **ETA window**.
- **Join & pay:** join a session's queue, pay the fee via Razorpay, receive a **digital token that includes a scannable QR code** (shown on the token screen for fast check-in).
- **Live tracking:** real-time position, ETA updates, and **arrival nudges** ("almost your turn — please reach and check in").
- **Notifications:** push for booking confirmation, queue movement milestones, "leave/arrive now," being called, delays, cancellations, refunds.
- **My visits:** list of active and past queue entries with status.
- **Cancellation:** cancel per hospital policy (with refund handling).

### 6.2 Doctor Web Console
- **Today view:** current session, current patient, next patients.
- **Queue actions (domain commands):** Start Session, Call Next, Start Consultation, Complete Consultation, Skip, Mark No-Show, Pause/Resume Queue, Take Break, End Session.
- **Presence:** mark present / on-break / left (tracked separately from session state).
- Minimal, few-clicks UI — no administrative clutter.

### 6.3 Staff (Reception) Web Console
- **Check-in (QR-first):** scan the patient's token **QR code** with the device camera to instantly mark them checked-in; **manual token-number/name search** as a fallback. The QR encodes a signed, opaque reference (no patient data); the backend validates it belongs to this hospital/session and is in a check-in-able state, then runs the audited `CHECK_IN` command. Idempotent (double-scan is safe).
- **Walk-ins:** register a walk-in patient (auto-checked-in, appended in token order).
- **No-show handling:** grace period, recall, requeue per policy.
- **Priority / Emergency:** insert authorized priority or emergency cases (audited, with reason).
- **Assist:** cancellations, requeues, operational fixes.

### 6.4 Hospital Admin Web Console
- **Configuration:** departments, doctors, doctor schedules, consultation fees.
- **OPD sessions:** create/generate sessions from schedules.
- **Queue Policy:** ordering strategy, walk-in rules, priority rules, no-show behavior, grace period, registration cutoff, `max_online_tokens`, cancellation/refund rules.
- **Staff & RBAC:** invite doctors and staff, assign roles and permissions.
- **Reports:** basic operational reporting (volumes, average wait, no-shows).

### 6.5 Platform Super-Admin (internal, minimal for MVP)
- Onboard/verify hospitals, manage tenants, support tooling.

---

## 7. Key User Flows

### 7.1 Patient joins a queue remotely
```
Sign in → Add/select patient → Choose city → Hospital → Department
→ See today's OPD sessions (doctor + live queue + ETA on each card) → Open a session
→ Join queue → Pay (Razorpay)
→ Server verifies payment (webhook) → Token issued → VIRTUAL_WAITING
→ Track ETA at home → "Leave/arrive now" nudge → Arrive → Staff scans QR (or manual search)
→ CHECKED_IN → READY → Doctor calls → IN_CONSULTATION → COMPLETED
```

### 7.2 Doctor runs the session
```
Start Session → mark Present → Call Next (next checked-in patient in token order)
→ Start Consultation → Complete → Call Next → ... → (Break/Resume as needed)
→ End Session
```

### 7.3 Queue Entry state machine (core business logic)
```
CONFIRMED → VIRTUAL_WAITING → CHECKED_IN → READY → CALLED → IN_CONSULTATION → COMPLETED
```
Alternate paths: `CANCELLED`, `NO_SHOW`, `SKIPPED` (missed call → grace/recall → move to end),
`RESCHEDULED` (doctor leaves early / session ends early), `SESSION_CANCELLED`.
Payment sub-states are tracked separately from queue state.

---

## 8. Queue Engine Rules (locked)

1. **Token number ≠ call order.** Token is an immutable booking-order label; the engine computes the live call order.
2. **Only checked-in patients are callable.** The doctor never idles waiting for someone still at home.
3. **Fairness:** among checked-in patients, call order is token order (earliest booking first), except audited Priority/Emergency insertions.
4. **Late check-in** slots into its natural token position among currently-waiting checked-in patients.
5. **Unified queue** per session; the Queue Policy decides ordering. **As built (Phase 4), an entry carries two separate fields, not one:** `type` = ONLINE / WALK_IN / FOLLOW_UP, which records how the entry arrived and is never rewritten, and `priority` = NORMAL / PRIORITY / EMERGENCY, set only by the audited priority command. Folding escalation into `type` would mean an escalated walk-in stops being recorded as a walk-in, corrupting the volume reporting in §6.4 and erasing the fact that an ONLINE entry has a payment behind it.
6. **Walk-ins** are auto-checked-in and appended in token order; no arbitrary placement.
7. **Emergency** inserts at the front; everyone behind shifts; patients see "queue changed due to a priority case" with **no sensitive details**.
8. **No-show** (checked-in then absent): grace period → recall → SKIPPED → move to end (all configurable). "Move to end" is implemented (Phase 4) as a `requeuedAt` stamp that sorts a returning patient behind everyone who has not been requeued — the token number is immutable and the call order is computed, so there is nothing else that could move.
9. **Reservations that never arrive** are never called; at session end they become NO_SHOW, refund per policy. This is distinct from §8.11's early finish: at session end, a patient who **never arrived** becomes NO_SHOW, while one who **was present and simply not reached** becomes RESCHEDULED. Two different facts about two different people, and they drive different refunds.
10. **OPD session state** (SCHEDULED → OPEN_FOR_REGISTRATION → ACTIVE → COMPLETED; +CANCELLED/ENDED_EARLY) is **independent of doctor presence** (NOT_PRESENT → PRESENT → ON_BREAK → LEFT). Two consequences settled in Phase 4: there is no separate "start session" command — the first `call-next` moves a session to ACTIVE — and presence is **mostly** recorded rather than validated, with one guard, widened during Phase 8 device testing: **`call-next` and `start-consultation` are refused while presence is ON_BREAK or LEFT** — two distinct errors, because a break is waited out and a departure ends the session. **`NOT_PRESENT` blocks them too, as of 2026-09-07 — a deliberate reversal of the original rule.** It used to block nothing, on the argument that it is the default for every session and therefore the absence of information rather than a statement, and that blocking it makes marking the doctor present a mandatory ceremony before the first patient of every clinic. That argument is still true and the ceremony was accepted anyway: what the old rule permitted, found on a real console, was a receptionist calling patients in and completing consultations for a doctor nobody had ever said was in the building — writing a `Consultation` row, and teaching the ETA engine a duration, for a doctor who might not be there. One extra press at the start of a clinic is a smaller cost than a clinical record nobody stands behind. Either role performs it: the doctor marks themselves present, or reception does it on their behalf, and the queue board offers it as a single **Mark doctor present** button beside the disabled Call next. `check-in`, `walk-in` and `complete-consultation` are never blocked by presence — patients keep arriving at a reception desk whatever a dropdown says, and a consultation that has started must always be closable or a patient is stranded IN_CONSULTATION for good. The original rule (LEFT only) treated the console's own presence control as decoration: a doctor who selects On break and watches the queue carry on has a button that does nothing. See docs/PROGRESS.md, 2026-09-02.
11. **Doctor late** → the session and the queue are unaffected — patients keep booking, arriving and checking in, and the ETA recalculates — but **nobody can be called in until the doctor is marked present** (see §10, reversed 2026-09-07). Being late costs the clinic one press, not a blocked front desk. **Doctor leaves early** → session ends, remaining patients rescheduled per policy. **Doctor substitution** → preserve original doctor + actual provider; notify patients.
12. **Registration cutoff** default: auto-close when a new joiner's ETA would exceed session end, plus optional `max_online_tokens` cap, plus manual staff close.
13. **All queue mutations** go through audited backend domain commands inside locked transactions (no client-driven state changes).

---

## 9. ETA (Estimation) Requirements

- ETA is **arithmetic over timestamps**, recomputed on every relevant state change and pushed to clients in real time.
- Formula (v1): `ETA = now + remaining_time_of_current_patient + (checked_in_ahead × expected_duration)`.
- `expected_duration` blends: a **seeded default** (cold start) + the **doctor's all-time average** + **today's running average** (weighted most heavily).
- Always shown as a **window** (e.g. 11:10–11:30), never an exact promise.
- The system also flags **queue health** (e.g. "running slower than usual") for staff visibility.
- No machine learning in v1; the engine improves automatically as consultation timestamps accumulate.

---

## 10. Payments (MVP)

- Gateway: **Razorpay**, running in **test mode** for MVP (real integration, sandbox money).
- Full state machine: initiated → pending → successful / failed → refunded / partially-refunded.
- **Idempotent:** the token is created from the **server-verified Razorpay webhook**, keyed on the order ID — never from the client. Duplicate webhooks never create duplicate tokens.
- **Slot reservation:** joining briefly reserves a place; if payment fails/expires, the reservation is released.
- **Refunds:** driven by the hospital's configurable cancellation policy.
- Business/settlement model (who ultimately receives the money) is a later, go-live decision; MVP proves the flow.

---

## 11. Non-Functional Requirements

- **Multi-tenancy & isolation:** every hospital-owned record carries `hospital_id`; the backend scopes every query to the caller's hospital and never trusts the client. Defends against IDOR/BOLA.
- **Real-time:** queue/ETA/status changes propagate to patient, doctor, and staff clients via WebSocket; clients re-fetch authoritative state on reconnect.
- **Source of truth:** the backend/database is authoritative. Realtime is only a distribution mechanism.
- **Concurrency:** per-session locking + idempotency keys so simultaneous staff/doctor actions never corrupt the queue.
- **Auditability:** every queue-affecting action is logged (who, what, when, why) from day one.
- **Privacy (India / DPDP):** treat all patient data as sensitive; audit logs, access logs, and consent/privacy-notice versioning built in from the start. Host in an India region for data residency.
- **Security:** strong auth, authorization on every sensitive endpoint, encrypted transport, secure secrets, rate limiting.
- **Availability:** MVP is online-only but resilient to brief connectivity drops (reconnect-and-resync; check-in not tied to a single device).
- **Performance:** live queue views and ETA updates should feel instant (sub-second propagation for typical loads).

---

## 12. Phasing (summary — see Phases.md for detail)

- **Phase 1 — Core Queue MVP:** auth, discovery, sessions, live queue, join+pay+token, check-in, realtime ETA, doctor console, staff console, admin config, push notifications.
- **Phase 2 — Operational maturity:** advanced priority policies, better ETA, analytics, appointments, richer no-show/refund flows, SMS/WhatsApp.
- **Phase 3 — Clinical records:** consultations, prescriptions, follow-ups, visit history, documents.
- **Phase 4 — Ecosystem:** ABDM/ABHA, HIS/EMR, lab, pharmacy, insurance, teleconsultation.

---

## 13. Success Metrics (MVP)

- **Patient time saved:** reduction in in-hospital waiting time vs baseline.
- **ETA accuracy:** actual vs predicted consultation time (target: within the shown window most of the time).
- **Adoption:** % of a hospital's OPD patients joining via the app; repeat usage.
- **Operational:** no-show rate, queue-health incidents, successful check-in rate.
- **Reliability:** realtime uptime, payment success rate, zero duplicate-token incidents.

---

## 14. Assumptions & Open Items

- Launch scale is small (≈1–3 pilot hospitals); hosting sized accordingly.
- First hospitals are onboarded manually ("white-glove"); doctors/staff are admin-invited, not self-signup.
- Patient auth is email/password + Google; no phone-OTP in MVP.
- Going live with real money later requires a registered business entity, KYC, and settlement account; hospitals require verification/KYC.
- Exact business/settlement model and cancellation/refund defaults per hospital to be finalized with pilot partners.
