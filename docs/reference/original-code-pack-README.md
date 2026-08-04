# Naija Hub Parts

**Operated by Lytod Motors Ltd | RC 1207675 | 50 Olumegbon St, Surulere, Lagos**

Offline-first inventory app for auto parts dealers. One Flutter codebase
runs on **Android, iOS, and Web** — all three platforms read and write the
**same Firestore database**, so a dealer's stock, sales, and debts stay in
sync no matter which device they use.

---

## Architecture at a glance

```
UI (screens/)
   |
   v
HiveService  <-- local, offline-first, works with zero internet
   |
   v  (whenever a connection is available)
FirebaseService --> Firestore  <-- the ONE shared database
                                    used by every dealer + Super Admin panel
```

Every write (add stock, make a sale, log a debt) goes to Hive first, so the
app never blocks on network. `FirebaseService.startAutoSync()` listens for
connectivity changes and pushes anything unsynced up to Firestore
automatically.

---

## 1. Prerequisites

- Flutter SDK 3.24+ (`flutter --version` to check)
- A Firebase project (create one at console.firebase.google.com)
- The Firebase CLI + FlutterFire CLI:
  ```bash
  npm install -g firebase-tools
  dart pub global activate flutterfire_cli
  ```

## 2. Install dependencies

```bash
flutter pub get
```

## 3. Connect Firebase

```bash
firebase login
flutterfire configure
```

This generates `lib/firebase_options.dart` — required by `main.dart` and
**not included in this repo** since it contains project-specific config.
Select Android, iOS, and Web when prompted so all three platforms share
the same project.

In Firebase Console, enable:
- **Authentication → Phone** sign-in provider
- **Firestore Database** (start in production mode, then apply `firestore.rules`)

Deploy the security rules:
```bash
firebase deploy --only firestore:rules
```

## 4. Generate Hive model adapters

The models in `lib/models/` use `@HiveType` annotations. Generate their
`.g.dart` files with:

```bash
dart run build_runner build --delete-conflicting-outputs
```

Re-run this any time a model file changes.

## 5. Run it

```bash
flutter run                 # picks a connected device/emulator
flutter run -d chrome       # run as a web app
```

## 6. Building for release

See the separate **APK build script pack** (`.github/workflows/release.yml`
and `scripts/build_release.sh`) already provided for Android release
builds. For iOS, use `flutter build ipa` and upload via Xcode/Transporter
once an Apple Developer account and provisioning profile are set up. For
web, `flutter build web` produces a static site deployable to Firebase
Hosting (`firebase deploy --only hosting`) or any static host.

---

## What's already built

- **4 screens:** Home (search + dashboard), Add Stock (camera + voice),
  Sell (cart + WhatsApp receipt), Debt Book
- **Offline-first:** every screen reads/writes Hive; Firestore sync is
  automatic and non-blocking
- **Phone OTP auth**
- **Fuzzy search** (tolerates typos like "break" → "brake")
- **WhatsApp receipts** via `wa.me` deep link — no WhatsApp Business API
  needed for MVP
- **PDF receipt generation** sized for 80mm thermal printers, for the
  Bluetooth printing / file-sharing path
- **Firestore security rules** scoping each dealer to their own shop, with
  a `super_admin` custom-claim role for the HQ admin panel

## What's intentionally NOT built (per the MVP spec)

- Payments / in-app checkout — sales are logged, not processed
- Full accounting / bookkeeping
- Barcode scanner (the Sell screen has a search field where one can be
  wired in later — see `sell_screen.dart`, the `_search` function)
- Marketplace / virtual store listings — see `PHASE2_SPEC.md` from the
  earlier build pack for that scope

## Known things the dev should double check before shipping

- `AddStockScreen._startVoiceInput` parses quantity with a naive regex
  ("...50 pieces" → qty 50). Good enough for MVP; consider a proper NLU
  pass if dealers' phrasing varies a lot.
- Android needs `CAMERA`, `RECORD_AUDIO`, and `INTERNET` permissions in
  `AndroidManifest.xml`; iOS needs matching `NSCameraUsageDescription` /
  `NSMicrophoneUsageDescription` / `NSSpeechRecognitionUsageDescription`
  entries in `Info.plist`.
- `assets/logo.png` is referenced but not included in this pack — drop in
  the actual logo file before building.
