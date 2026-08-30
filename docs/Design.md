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
Success  text #16A34A   bg #DCFCE7   (positive, in-consultation, paid)
Warning  text #D97706   bg #FEF3C7   (attention, called, delays)
Danger   text #DC2626   bg #FEE2E2   (no-show, cancelled, emergency, errors)
Info     text #2563EB   bg #DBEAFE   (neutral info, virtual-waiting)
```

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

---

## 3. Typography

**Family:** `Inter`, with system fallback (`-apple-system, Roboto, "Segoe UI", sans-serif`).

> **As built:** the web console uses Inter. **The mobile app deliberately ships the system font** —
> San Francisco on iOS, Roboto on Android — which is the fallback this line already sanctions. Loading
> Inter on mobile costs a new dependency (`@expo-google-fonts/inter`), ~400KB of font files and a
> splash-screen gate to stop text flashing unstyled, and the native faces read as *less* templated,
> not more. Do not "fix" this by adding Inter without a reason. The scale, weights and tabular
> numerals below apply unchanged either way.
**Numerals:** use **tabular figures** for token numbers, counts, and times so they don't jitter as they update.

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
sm 6    inputs, small chips
md 10   buttons, badges
lg 16   cards
xl 24   sheets, hero token card
full    pills, avatars, status dots
```

**Elevation (soft, low-opacity shadows — never harsh):**
```
sm  0 1 2  rgba(15,23,42,0.06)     subtle lift (list rows)
md  0 4 12 rgba(15,23,42,0.08)     cards
lg  0 12 28 rgba(15,23,42,0.12)    sheets, modals, token hero
```

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

### 5.9 Navigation
- **Mobile:** bottom tab bar (Home/Discover · My Visits · Profile), active tint teal.
  - **As built (Phase 3):** two tabs — **Discover** (`compass`) and **Profile** (`user`). **My Visits
    arrives with Phase 5**, when there are tokens to list; a tab that leads nowhere is worse than an
    absent one. Each tab owns its own stack so the bar stays visible on detail screens — without that
    a patient four levels deep has no way back to the top but repeated back-taps.
  - Discover **is** home. There is no separate home screen: it opens on the hospitals in the
    remembered city (see §5.10).
- **Web console:** left sidebar (role-aware: doctor sees Session; staff sees Check-in/Queue; admin sees Config/Reports), top bar with hospital name + user.

---

## 6. Iconography
- Line icons, ~1.75px stroke, rounded caps (e.g. Lucide). Size 20 default, 24 for primary actions.
- **As built:** **Feather**, via `@expo/vector-icons` on mobile. Lucide is a fork of Feather, so the
  stroke and cap treatment are the ones specified — and `@expo/vector-icons` ships with Expo, so there
  is no new dependency and no `react-native-svg`. Every screen imports `lib/icon.tsx`, never the
  package, so the set is swappable in one file.
- Consistent metaphors (see §2.4). Color inherits status/text color.

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
- Clear focus states (teal focus ring) for web keyboard use.

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
color.primary      #0E7C7B      radius.sm 6   space.1 4    font.display 40/700
color.accent       #14B8A6      radius.md 10  space.2 8    font.h1 28/700
color.bg           #F7FAFC      radius.lg 16  space.3 12   font.body 14/400
color.surface      #FFFFFF      radius.xl 24  space.4 16   font.family Inter
color.text         #0F172A                    space.6 24
color.textMuted    #64748B
color.border       #E2E8F0
status.* (per §2.4)
```
Dark mode is out of scope for MVP but the token structure leaves room to add a dark palette later.
