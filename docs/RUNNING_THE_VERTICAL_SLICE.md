# Running the dealer onboarding + listing slice

Everything runs locally against the **Firebase Local Emulator Suite** with a
`demo-` project. No Firebase account, no credentials, no network. The `demo-`
prefix is enforced by the emulator: attempts to reach a real project fail
rather than silently succeeding.

## Prerequisites

| | |
|---|---|
| Node 20–22 | already installed |
| JDK 17 | emulators are Java; `C:\Program Files\Eclipse Adoptium\jdk-17.0.20.8-hotspot` |
| Flutter 3.44 | `C:\flutter` |
| Firebase CLI | installed as a workspace dev dependency — no global install needed |

If the emulators complain about Java:

```powershell
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.20.8-hotspot"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
```

## One-time

```powershell
npm install
npm run contracts:build
npm run build --workspace @nph/functions
```

## Everyday: four terminals

**1 — Emulators** (Auth, Firestore, Storage, Functions; UI on :4000)

```powershell
npm run emulators
```

**2 — Seed** (admin account + category taxonomy). Run once after the emulators
are up; emulator state is in-memory and resets on restart.

```powershell
npm run seed
```

Creates `admin@lytodmotors.test` / `password123` with the `super_admin` custom
claim. That claim is set through the Admin SDK — never from a Firestore
document a dealer could reach.

**3 — Admin portal**

```powershell
npm run dev --workspace @nph/web
```

→ <http://localhost:3000/admin>

**4 — Dealer app**

```powershell
cd apps\mobile
flutter run -d emulator-5554
```

No flags needed: `Env.useEmulator` defaults to true. The Android emulator
reaches the host loopback at `10.0.2.2`, which `Env.emulatorHost` handles.

## The flow to exercise

1. **Sign in** — any phone number in international format, e.g. `+2348031234567`.
   The OTP is read straight from the Auth emulator's REST endpoint and filled in
   automatically, so no real SMS is involved.
2. **Register** — fill the business form. The store is created `pending` and the
   slug reserved atomically.
3. **Try to publish** — create a listing and hit publish. It is refused: the
   store is not approved yet.
4. **Approve** — in the admin portal, the pending business appears; approve it.
   The dealer app re-routes on its own, because the gate watches the store
   document rather than reading it once.
5. **Publish** — now it succeeds. Watch `activeListingCount` climb.
6. **Hit the limit** — publish ten. The eleventh is refused with the numbers the
   upgrade prompt needs.
7. **Go offline** — turn off the emulator's network (Extended controls → Cellular
   → Data status: denied). Create a listing: it saves locally and the sync banner
   shows the pending count. Re-enable and it replays automatically.
8. **Suspend** — suspend the store from the admin portal. The trigger fans the
   change out and the dealer's listings drop out of public visibility.

## Tests

```powershell
npm run test:rules      # 36 security rules assertions
npm run test:limit      # 9 listing-limit + concurrency assertions
npm run test:emulator   # everything, including end-to-end through the callables

cd apps\mobile ; flutter test    # widget tests
npm run verify                   # rules/contracts drift + typecheck
```

The limit tests include a 20-way simultaneous publish burst asserting that
exactly ten succeed. That is the SOW §5 guarantee — the active count lives on
the store document, so concurrent transactions contend on one document and
serialise. A `count(*)` query would let two callers both read 9 and both commit.

## Pointing at a real Firebase project

Nothing in feature code branches on environment, so this is configuration only.

**Mobile**

```powershell
flutter run --dart-define=USE_FIREBASE_EMULATOR=false
```

plus `flutterfire configure` and the `TODO(setup)` in
`apps/mobile/lib/core/firebase_bootstrap.dart`.

**Web** — `.env.local`:

```
NEXT_PUBLIC_USE_FIREBASE_EMULATOR=false
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_API_KEY=...
```

**Functions** — `firebase use --add` to alias the real project, then
`firebase deploy --only functions`. Requires the **Blaze** plan; Cloud
Functions do not exist on the free tier.

## Known gaps

- **Paystack is not started.** Deliberate — the slice lands first.
- **Public marketplace UI is not built.** Waiting on mockup approval.
- **All UI is functional scaffolding.** Business logic lives in
  `apps/mobile/lib/services/` and `functions/src/`, so the redesign will not
  touch behaviour.
- **Categories are hardcoded in the listing form.** The `categories` collection
  is seeded and admin-managed; the form should read from it.
- **Listing images upload under a `drafts/` path** before the listing id exists,
  so an abandoned form can orphan objects in Storage. A scheduled cleanup, or
  uploading after first save, resolves it.
