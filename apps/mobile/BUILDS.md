# Builds — getting off Expo Go

Expo Go is **not this app in an unfinished state**. It is Expo's own app
(`host.exp.exponent`) running our JavaScript. Android therefore never sees
`com.opdqueue.app`, which is why four things cannot work there and no amount of code
fixes them:

| | Expo Go | Our own build |
|---|---|---|
| Push notifications | ✕ impossible | ✓ |
| Permission prompt says | "Expo Go" | "OPD Queue" |
| Deep links (`opdqueue://`) | unreliable | ✓ |
| Give it to a receptionist | ✕ | ✓ |

Everything else — the queue, realtime, the ETA, payments, check-in — behaves
identically in both, because that is all our JavaScript talking to our API.

## The three profiles in `eas.json`

| Profile | What it is | Who runs it |
|---|---|---|
| `development` | Our app, still hot-reloading from Metro. `expo-dev-client` gives it the dev menu. | Us, daily |
| `preview` | Our app, standalone, JS bundled in. No laptop needed. | A pilot hospital's staff |
| `production` | Store release: an `.aab` for Play, versioned by EAS. | Phase 10 |

`development` and `preview` build an **APK** rather than an app bundle on purpose: an
APK can be sideloaded straight onto a phone, while an `.aab` has to go through Play.

## Android, first time — free, about 35 minutes

Run these from `apps/mobile`. Every one needs a browser login, which is why they are
listed here rather than scripted.

```bash
pnpm exec eas login          # 1. an Expo account (free)
pnpm exec eas init           # 2. writes extra.eas.projectId into app.json
pnpm exec eas credentials    # 3. Android -> Push Notifications -> set up FCM
pnpm exec eas build --profile development --platform android
```

**Step 2 is the one that was silently breaking push.** `getExpoPushTokenAsync` throws
`ERR_NOTIFICATIONS_NO_EXPERIENCE_ID` without a `projectId`, and until 2026-09-02 there
was none — so registration failed on every launch, on any device, and would have failed
in a development build too (docs/PROGRESS.md).

**Step 3 needs a free Firebase project.** Expo Push relays through FCM, so Google has to
know about the app. `eas credentials` walks through uploading the FCM V1 service-account
key. No cost.

Then install the APK the build produces, run `pnpm --filter @opd/mobile dev` exactly as
before, and push works. The dev loop does not change.

## iOS

Blocked on the **$99/year Apple Developer account** — APNs keys are not issued without
one, so no iOS build can be made at all. docs/Phases.md Phase 10 says to start that
enrolment during Phase 8 because it is calendar time, not work time.

## `EXPO_PUBLIC_API_URL` behaves differently per profile

- **development**: Metro bundles on your machine at run time, so `apps/mobile/.env` is
  read then. Change the IP, restart with `--clear`, force-close the app (trap 16).
- **preview / production**: the JS is bundled at BUILD time, so whatever `.env` says
  when the build runs is frozen into the binary. A LAN IP is useless in those - they
  need the deployed API's public URL, which arrives with Phase 10.
