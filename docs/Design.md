# Design

## OPD Queue Platform — Visual System

**Status:** Draft v1
**Theme:** Calm clinical · Light mode (MVP) · Inter
**Companion docs:** PRD.md · Architecture.md · Rules.md · Phases.md

---

## 1. Design Principles

1. **Calm & trustworthy.** This is healthcare — soft teal, generous white space, nothing loud or alarming.
2. **Clarity under pressure.** Doctors and staff use this with patients waiting. Big touch targets, obvious primary action per screen, minimal clutter.
3. **Status at a glance.** A patient should understand "where am I, when am I seen, what do I do next" in one look.
4. **Never color alone.** Every status pairs a color with a label + icon (accessibility + clarity).
5. **One primary action per screen.** Especially the doctor console — the main action is always the largest, most obvious element.
6. **Honest, gentle language.** ETA is a *window*, not a promise; changes are explained calmly (see §11 Tone).

---

## 2. Color Palette

### 2.1 Brand — Teal
```
teal-50   #F0FDFA
teal-100  #CCFBF1
teal-200  #99F6E4
teal-300  #5EEAD4
teal-400  #2DD4BF
teal-500  #14B8A6   ← Accent
teal-600  #0D9488
teal-700  #0E7C7B   ← Primary
teal-800  #115E59
teal-900  #134E4A
```
- **Primary** `#0E7C7B` — primary buttons, active nav, key highlights, links.
- **Accent** `#14B8A6` — secondary highlights, focus rings, subtle emphasis.
- **On-primary text** `#FFFFFF`.

### 2.2 Neutrals — Slate
```
slate-50  #F8FAFC
slate-100 #F1F5F9
slate-200 #E2E8F0   ← Border
slate-300 #CBD5E1
slate-400 #94A3B8   ← Disabled / placeholder
slate-500 #64748B   ← Muted / secondary text
slate-600 #475569
slate-700 #334155
slate-800 #1E293B
slate-900 #0F172A   ← Primary text
```
- **App background** `#F7FAFC`
- **Surface / card** `#FFFFFF`
- **Border / divider** `#E2E8F0`
- **Text primary** `#0F172A` · **secondary** `#64748B` · **disabled** `#94A3B8`

### 2.3 Semantic
```
Success  text #16A34A   bg #DCFCE7   line #BBF7D0   (positive, in-consultation, paid)
Warning  text #B45309   bg #FEF3C7   line #FDE68A   (attention, called, delays)
Danger   text #DC2626   bg #FEE2E2   line #FECACA   (no-show, cancelled, emergency, errors)
Info     text #2563EB   bg #DBEAFE   line #BFDBFE   (neutral info, virtual-waiting)
```

**Warning moved from `#D97706` to `#B45309` (2026-09-05).** The old value is 3.4:1 on
white: it fails AA for body text, and it was being *used* for body text — the
running-behind sentence on the console's pace panel. The new one is 4.9:1. §8 has
demanded AA since Phase 1 and one of this table's own values did not meet it.

**Each semantic colour now has a third value, `line`.** A banner is a fill, a hairline
and a word; without a matching border every banner in the console reached for an
arbitrary `/20` opacity of its own, and three of them picked different ones.

### 2.4 Queue-status colors (app-specific — reuse everywhere)

| Status | Meaning | Dot / badge | Text | Icon |
|---|---|---|---|---|
| `VIRTUAL_WAITING` | Booked, not arrived | Info blue `#2563EB` / bg `#DBEAFE` | "Waiting" | home |
| `CHECKED_IN` / `READY` | Present, eligible | Teal `#0E7C7B` / bg `#CCFBF1` | "Checked in" | check-circle |
| `CALLED` | Your turn — go in | Warning `#D97706` / bg `#FEF3C7` | "Called" | bell |
| `IN_CONSULTATION` | With the doctor | Success `#16A34A` / bg `#DCFCE7` | "In consultation" | stethoscope |
| `COMPLETED` | Done | Slate `#64748B` / bg `#F1F5F9` | "Completed" | check |
| `NO_SHOW` | Missed | Danger `#DC2626` / bg `#FEE2E2` | "No-show" | x-circle |
| `SKIPPED` | Passed for now | Warning muted `#B45309` / bg `#FEF3C7` | "Skipped" | skip-forward |
| `CANCELLED` | Cancelled | Slate `#94A3B8` / bg `#F1F5F9` | "Cancelled" | slash |
| `PRIORITY` / `EMERGENCY` (type) | Escalated | Danger `#DC2626` / bg `#FEE2E2` | "Priority" / "Emergency" | alert-triangle |

### 2.5 No gradients

Tried and removed. A teal gradient header and a gradient token card were built in the
2026-09-04 refresh and taken out again the same day: the reference screens the product
is being built to (`docs/ui-screens/`) use none, and against a light, card-based app a
gradient reads as decoration rather than as structure.

**Colour does one job here: it marks an action or a state.** Surfaces are white or the
pale canvas. If a screen needs more presence, it needs better hierarchy, not a
gradient.

---

## 3. Typography

**Family:** `Inter`, with system fallback (`-apple-system, Roboto, "Segoe UI", sans-serif`).

> **As built (corrected 2026-09-05):** both clients now load Inter. This note previously said
> the mobile app shipped the system font on purpose — that was a rationalisation of a bug.
> `theme.ts` and `tailwind.config.ts` had both *named* Inter since Phase 1 and **neither client
> ever loaded the face**, so the console rendered in Segoe UI and the app in Roboto for nine
> phases while the token table looked correct. Now: `next/font/google` on web,
> `@expo-google-fonts/inter` via `useFonts` on mobile, gated on the splash that already waits
> for the keychain read.
>
> **Every font token sets `fontWeight` alongside `fontFamily`.** A named face like
> `Inter_700Bold` already is the bold, so the weight looks redundant — but if the face fails to
> load, Android falls back to the system font at REGULAR WEIGHT EVERYWHERE. No bold headings,
> no semibold buttons, no weight on a token number. The failure mode of a redundant weight is a
> slightly heavy glyph; the failure mode of a missing one is an app with no hierarchy at all.
**Numerals:** use **tabular figures** for token numbers, counts, and times so they don't jitter as they update.

> **The two mirrors share a palette and a spacing rhythm, not a type scale
> (2026-09-05).** They are different machines used by different people. The table below
> is the PHONE: 28px screen titles and 16px body are right for a patient holding a
> device at arm's length who may be sixty. The console is a dense desktop tool a
> receptionist stares at for a whole shift on a 1440px monitor, and that scale wastes a
> third of its vertical space — so `apps/web/tailwind.config.ts` runs one step tighter
> throughout (display 30, h1 22, h2 17, h3 15, body 13.5, label 13) with negative
> tracking on everything above 18px. Inter is drawn loose at display sizes, and
> headings set at zero tracking are the most reliable tell that a UI was assembled from
> defaults rather than typeset.
>
> This is a divergence, not a drift: the colours, the spacing scale, the radii and the
> status vocabulary stay identical, and a change to any of those still changes both.

**`eyebrow` (web) is the `Overline` row below**, named for what it does rather than for
where it sits, and it is the console's section marker and column head.

| Token | Size / Line | Weight | Use |
|---|---|---|---|
| Display | 40 / 48 | 700 | Token number hero, "now serving" number |
| H1 | 28 / 36 | 700 | Screen titles |
| H2 | 22 / 30 | 600 | Section headers |
| H3 | 18 / 26 | 600 | Card titles (doctor name, etc.) |
| Body-lg | 16 / 24 | 400 | Primary body |
| Body | 14 / 22 | 400 | Default text |
| Label | 14 / 20 | 500 | Buttons, field labels |
| Caption | 12 / 16 | 500 | Meta, timestamps, helper text |
| Overline | 11 / 16 | 600, tracked +4% | Status tags, small headers (UPPERCASE) |

Rules: max ~2 weights per screen; primary text `slate-900`, secondary `slate-500`; never below 12px.

---

## 4. Spacing, Radius, Elevation

**Spacing scale (4-based):** `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`. Default screen padding 16 (mobile) / 24 (web). Card padding 16–20.

**Radius:**
```
xs   4    the focus-ring corner
sm   6    small chips
md   8    buttons, badges, inputs (web)
control 12  buttons and inputs (mobile only - they are 52pt tall)
lg   14   cards
xl   20   sheets
full      pills, avatars, status dots
```

A `card` (18) and `hero` (28) step were added during the 2026-09-04 refresh and removed
again with the gradients they existed for.

**The scale tightened on 2026-09-05** (md 10 → 8, lg 16 → 14, xl 24 → 20). A 16pt corner
on a full-bleed card is most of the way to a lozenge on a 390pt phone, and on a console
holding nine cards it is what made a considered tool read as a consumer app. Tighter
corners are most of what separates "product" from "template" at a glance.

**`control` exists because it already did.** Every mobile button and input hardcoded
`borderRadius: 12` — a value in no token table — while `pressable()` masked its Android
ripple to `md`. So the ripple was clipped to a 10pt corner inside a 12pt button, on
every press in the app. One token, used by both.

**Elevation (soft, low-opacity shadows — never harsh):**
```
sm    0 1 2   rgba(15,23,42,0.06)    subtle lift (list rows)
card  0 2 8   rgba(15,23,42,0.05)    the standard card - PLUS a 1px border
md    0 4 12  rgba(15,23,42,0.08)    raised cards
lg    0 12 28 rgba(15,23,42,0.12)    sheets, modals
```

**On the console, borders do the work and shadows only say "this floats"
(2026-09-05).** The web scale is `xs` (0 1 2 / 0.04) for cards, with `md` and `lg`
reserved for things that genuinely overlay — the mobile nav drawer, a menu. A 12px blur
under every card on a screen holding nine of them is not a hierarchy, it is haze.

**The console also needs four surfaces, not two.** It had used `canvas` for the page,
the rail, every table hover, every neutral pill and every skeleton — so a hovered row,
an inactive status and a loading placeholder were the same colour as the page behind
them. `canvas` #F7FAFC (page) · `surface` #FFFFFF (card) · `sunken` #F1F5F9 (rails,
table heads, inert pills) · `hover` #F8FAFC (interaction tint).

**`card` is a shadow *and* a hairline border, never one alone.** A shadow this soft
disappears against `canvas` on a cheap LCD in daylight; a border alone reads as a
wireframe. Together they hold an edge in both conditions, which is the whole job of a
card on a phone that gets used outdoors.

---

## 5. Components

### 5.1 Buttons
- **Primary:** teal `#0E7C7B` fill, white text, radius md, height 48 (mobile) / 40 (web). Pressed → `teal-800`. Disabled → `slate-200` bg / `slate-400` text.
- **Secondary:** white bg, `slate-200` border, `slate-900` text.
- **Ghost:** transparent, `teal-700` text.
- **Destructive:** `#DC2626` fill, white text (cancel/no-show/end session).
- Full-width on mobile primary actions. Min touch target 44×44.

### 5.2 Cards
White surface, radius lg, shadow md, padding 16–20, 1px `slate-200` border optional for flat sections.

### 5.2b The token chip — the product's atom

A fixed-width slab with its own hairline: the same width whatever the digits, findable
at a glance down a column of names, and identical on the board, the check-in desk, the
walk-in list and the patient's own list.

**It had no component until 2026-09-05,** and it is the one string a receptionist reads
aloud, matches against a printed slip and types into a field. It was `font-semibold
tabular-nums` on the board, plain text in the walk-in list and a bare `<span>` at the
desk. Three sizes: `sm` in a chip row, `md` in a roster, `lg` for the patient in the
room. The patient app's token screen is the exception and keeps its own display-sized
treatment (§5.6) — there the token is the whole screen, not an item in a list.

### 5.3 Status badge / pill
Rounded-full, `bg` + `text` from §2.4, 12px overline text, small leading dot or icon. Always includes a label.

### 5.4 Inputs
Height 48, radius sm, `slate-200` border, `slate-50` or white fill, focus ring `teal-500` 2px. Label above, helper/caption below, error in `#DC2626`.

### 5.5 Session card (patient discovery — the key browse unit)
```
┌─────────────────────────────────────────────┐
│ Dr. Sharma                     ● OPEN        │  ← doctor H3 + status pill
│ Cardiology · 10:00–13:00                     │  ← caption, slate-500
│ ───────────────────────────────────────────  │
│ Now serving  A18      In queue  6            │  ← labels + tabular numbers
│ Join now → seen ~11:10–11:30                 │  ← ETA window, teal accent
│                                              │
│ ₹500                         [  Join  ]      │  ← fee + primary button
└─────────────────────────────────────────────┘
```

### 5.10 Home & location (patient — as built in Phase 3)
The patient app is **location-first**: the city is chosen once on a dedicated screen, remembered
between launches, and home *is* the hospital list for it. `docs/PRD.md` 6.1 describes the same flow —
only the persistence is new, and it removes a full screen of friction from every visit.

```
┌─────────────────────────────────────────────┐
│ ⌖ Mumbai  ⌄                          (PS)   │  ← city chip (teal-50, pill) · avatar → Profile
│ Good evening, Pankaj                        │  ← H2, time-of-day greeting
│ ┌─────────────────────────────────────────┐ │
│ │ ⌕  Doctors, hospitals, specialities     │ │  ← h48, radius md, surface + shadow-sm
│ └─────────────────────────────────────────┘ │
│ HOSPITALS IN MUMBAI                         │  ← overline
│ ┌─────────────────────────────────────────┐ │
│ │ (AC)  Apollo Clinic                   › │ │  ← initials avatar (§10)
│ │       Andheri West                      │ │
│ │       ● 5 OPD today                     │ │  ← status pill, never colour alone
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

- **The search box searches doctors AND hospitals.** With text in it, a *Doctors* section appears
  above *Hospitals*. A box that only filtered hospitals returns nothing for a doctor's name and reads
  as broken.
- **First run** shows a prompt with a **Select city** button, never an automatic redirect — the auth
  gate already redirects in an effect and a second one is how navigation loops start.
- The city is a **display filter, never an authority**: it is sent as `?city=` and the server does the
  filtering (`docs/Rules.md` §1).

### 5.6 Token card (patient — the hero after joining)
```
┌───────────────────────────────┐
│           YOUR TOKEN          │  ← overline, slate-500
│             A027              │  ← display 40/700, teal-700
│          ● Waiting            │  ← status pill
│   ┌───────────────────────┐   │
│   │        [ QR ]         │   │  ← QR for check-in
│   └───────────────────────┘   │
│  Now serving        A018      │
│  Checked in ahead   3         │
│  Also booked ahead  5         │  ← honest two-number model
│  Seen by       ~11:10–11:30   │  ← ETA window
│  Arrive by          10:50     │
└───────────────────────────────┘
```

### 5.7 Doctor console — current patient (one dominant action)
```
┌───────────────────────────────────────────┐
│ Session 10:00–13:00        ● Active        │
│ ─────────────────────────────────────────  │
│ NOW WITH                                   │
│ A027 · Pankaj · 42M                        │  ← large
│                                            │
│        [   Complete consultation   ]       │  ← full-width primary
│                                            │
│ Next:  A028 Priya · A029 Rohit · A030 Amit │  ← muted row
│ [Call next]  [Skip]  [No-show]  [Pause]    │  ← secondary/ghost actions
└───────────────────────────────────────────┘
```

### 5.8 Staff check-in
Big **Scan QR** button (opens camera) as the primary action; a manual "Search token / name" field beneath as fallback. On success → a green confirmation with the patient's token + name.

**As built (Phase 6): three ways in, not two.** The camera is live on the page rather than behind a
button, then the typed token, then a searchable list of everyone still to arrive. The third one is
what saves a desk when the phone is flat or the booking is in a relative's name, and it costs nothing
because the roster has to be fetched anyway. **The camera is treated as optional throughout** — no
HTTPS, no device or a declined permission leaves a complete working screen with an explanation, never
an error. The green confirmation names the token *and* the patient, so a mis-scan is visible before
the wrong person is called in.

### 5.9 Navigation
- **Mobile:** bottom tab bar (Home/Discover · My Visits · Profile), active tint teal.
  - **As built (Phase 5):** three tabs — **Discover** (`compass`), **My Visits** (`clipboard`) and
    **Profile** (`user`). My Visits was deliberately absent until Phase 5, when there were finally
    tokens to list; a tab that leads nowhere is worse than an absent one. Its token screen is
    `visit/[id]` rather than a bare `[id]`, which would have been a root-level catch-all shadowing
    `/location` and `/doctors`. Each tab owns its own stack so the bar stays visible on detail screens — without that
    a patient four levels deep has no way back to the top but repeated back-taps.
  - Discover **is** home. There is no separate home screen: it opens on the hospitals in the
    remembered city (see §5.10).
- **Web console:** left sidebar (role-aware: doctor sees Session; staff sees Check-in/Queue; admin sees Config/Reports), top bar with hospital name + user.
  - **As built (Phase 6):** ONE shell and one `/queue`, role-aware, rather than separate doctor and
    staff consoles. A small hospital's admin genuinely does run reception, and the API has allowed
    ADMIN, RECEPTION and DOCTOR on every queue command since Phase 4 — so two separate consoles would
    have modelled a split the backend does not have. What differs by role is the CONTENT: a doctor's
    session list shows only their own sessions. Check-in and walk-in are their own pages off the
    board, because reception keeps them open through a whole clinic.

---

## 6. Iconography
- Line icons, ~1.75px stroke, rounded caps (e.g. Lucide). Size 20 default, 24 for primary actions.
- **As built:** **Feather**, via `@expo/vector-icons` on mobile. Lucide is a fork of Feather, so the
  stroke and cap treatment are the ones specified — and `@expo/vector-icons` ships with Expo, so there
  is no new dependency and no `react-native-svg`. Every screen imports `lib/icon.tsx`, never the
  package, so the set is swappable in one file.
- Consistent metaphors (see §2.4). Color inherits status/text color.
- **As built (console, 2026-09-05):** `apps/web/components/icon.tsx` — about thirty
  Feather paths inline, drawn to the same 24px box, 2px stroke and round caps, so a
  status looks the same to the patient and to the receptionist looking at them.
  Deliberately not a dependency: `lucide-react` is 1.4MB of named exports to obtain
  thirty glyphs that will never change. Everything imports `Icon`, never a path.
- **The status table in §2.4 has specified an icon per status since Phase 1 and no
  console screen ever rendered one.** Colour was carrying the meaning alone, which §8
  forbids, and "Called" and "Completed" were the same shape at a glance. They render
  now. If a row of that table names an icon, the code owes you the icon.

---

## 7. Motion
- Durations 150–250ms, ease-out. Purposeful, not decorative.
- Queue/ETA updates: gentle fade/slide, never a jarring jump; briefly highlight a changed value.
- Being **Called**: a calm but noticeable pulse on the token status (paired with push + haptic on mobile).
- Respect "reduce motion" settings.

---

## 8. Accessibility
- **Contrast:** meet WCAG AA (≥4.5:1 body text). Body text uses `slate-900`/`slate-700`; teal is for large text, fills, and accents — not small body copy on white.
- **Touch targets:** ≥44×44.
- **Never color-only:** status always has label + icon.
- **Tabular numerals** for all live-updating numbers.
- Full dynamic-type / font-scaling support; test at large sizes.
- Clear focus states (teal focus ring) for web keyboard use. **One definition, on
  `:focus-visible` only** (`app/globals.css`). Every console screen used to bring its
  own — `ring-teal-100` here, `ring-teal-200` there, `ring-accent` on the invite page —
  and all of them fired on mouse clicks too, so pressing a button left a halo behind on
  it. Keyboard users got an inconsistent ring and mouse users got one they never asked
  for. Nothing else in the app declares a focus style.
- **Reduced motion is honoured** (`prefers-reduced-motion`), including the pulse on the
  board's live indicator — the one animation in the console that runs forever.

---

## 9. Layout & Responsive
- **Mobile (patient):** single-column, 16px gutters, thumb-reachable primary actions at the bottom.
- **Web console:** max content width ~1200px; responsive down to tablet (staff/doctor may use tablets at reception). Queue lists are dense but readable.

---

## 10. Imagery & Empty States
- Minimal, friendly line illustrations in teal/slate for empty states ("No sessions today," "No one in the queue yet").
- Doctor/hospital avatars: initials on `teal-100` bg if no photo.
- No stock-photo clutter; keep it clean.

---

## 11. Voice & Tone (microcopy)
- Calm, plain, reassuring. Short sentences.
- ETA is always framed as an estimate: *"You'll likely be seen 11:10–11:30."*
- Changes are explained without alarm: *"The queue moved a bit — your new window is 11:25–11:45."*
- Priority/emergency stays private: *"The queue changed due to a priority case. Your time is updated."* — never reveal another patient's details.
- Actions are direct: "Join queue," "Check in," "Complete consultation."

---

## 12. Design Tokens (for implementation)
Expose the above as shared tokens (Tailwind theme on web; a matching RN theme object on mobile), sourced conceptually from one place so both apps stay consistent.

**React Native elevation needs both families set on every level.** iOS reads
`shadowColor/Offset/Opacity/Radius` and ignores `elevation`; Android reads only `elevation` and
ignores the rest. Setting one gives a card that is raised on one platform and flat on the other.
`apps/mobile/theme.ts` sets both on `elevation.sm/md/lg`.

**Press feedback is platform-specific.** Android expects a ripple, iOS a subtle opacity fade. Using
one model on both is a large part of why an app reads as not-quite-native; `lib/ui.tsx` exports a
`pressable()` helper that every tappable goes through.

```
color.primary      #0E7C7B      radius.sm  6    space.1 4    font.display 40/700
color.accent       #14B8A6      radius.md  10   space.2 8    font.h1 28/700
color.bg           #F7FAFC      radius.lg  16   space.3 12   font.body 14/400
color.surface      #FFFFFF      radius.xl  24   space.4 16   font.family Inter
color.text         #0F172A                      space.6 24
color.textMuted    #64748B
color.border       #E2E8F0
status.*           (per §2.4)
```

**Inter has to actually be loaded, and for a long time it was not.** Both mirrors
named Inter in their font stack from Phase 1, and neither client ever fetched it — the
console rendered in Segoe UI and the app in Roboto, which is a large part of why the
product read as unfinished while the token table looked correct. It is now loaded in
both: `next/font/google` in `apps/web/app/layout.tsx`, and `@expo-google-fonts/inter`
via `useFonts` in `apps/mobile/app/_layout.tsx`, gated on the splash that already
waits for the keychain read. A token nobody loads is a comment, not a token.
Dark mode is out of scope for MVP but the token structure leaves room to add a dark palette later.
