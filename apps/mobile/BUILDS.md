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

## `google-services.json` is required for every Android build

The build **fails** without it. The Google Services Gradle plugin, which
`android.googleServicesFile` in `app.json` turns on, hard-fails when the file is
absent — and EAS builds from an archive that respects `.gitignore`, so ignoring
the file breaks cloud builds too.

It lives at `apps/mobile/google-services.json` and is **not ignored**, on purpose.
It looks like a credential and is not one: it carries the FCM sender id and an API
key that ship inside every copy of the APK, so anyone holding the app already has
them, and they are restricted by package name and signing certificate rather than
by secrecy.

**The real secret is the FCM V1 service-account key**, which lives in EAS
(`eas credentials` → Android → Google Service Account) and never touches the repo.

### If it is missing

Symptom depends on where it went missing:

| Where | What you see |
|---|---|
| Build time | Gradle fails: `File google-services.json is missing` |
| Run time (built without it) | app runs fine, but `PushToken` stays empty and the Metro terminal prints `[push] this device did not register` |

To get a fresh copy: [Firebase console](https://console.firebase.google.com) →
project **opd-queue-b047e** → ⚙ Project settings → Your apps → the Android app for
`com.opdqueue.app` → **google-services.json**. Save it to `apps/mobile/`.

The package name must match `com.opdqueue.app` exactly; a file generated for a
different package produces a build that installs and then silently never receives
a notification. The SHA-1 field Firebase asks for is **not** needed — that is for
Google Sign-In and Dynamic Links, not messaging.

## Do I need to rebuild?

Almost never. A development build is a shell that loads your JavaScript from Metro,
so anything written in JS/TS is a hot reload, not a build.

| Change | Rebuild? |
|---|---|
| Screens, components, styling, navigation, hooks | **No** |
| API calls, queue logic, ETA, realtime handling | **No** |
| Anything under `app/`, `lib/`, `components/` | **No** |
| Adding a package containing native code | **Yes** |
| Editing native config in `app.json` — plugins, permissions, package name, icons | **Yes** |
| Adding or replacing `google-services.json` | **Yes** |
| Expo SDK upgrade | **Yes** |

The rule of thumb: if the change is JavaScript, Metro delivers it. If it changes
what the APK itself contains, it needs a build.
