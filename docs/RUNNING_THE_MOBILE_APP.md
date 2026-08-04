# Running the dealer app on an emulator

Your machine already has Android Studio, the Android SDK (platform 37 + system
image), `adb`, the emulator, a `Pixel_10_Pro` AVD, and JDK 17.0.20 (Adoptium).
**Only the Flutter SDK is missing.**

Steps 1–4 get a real app onto the emulator. Firebase is step 5 and is not
needed to see it run.

---

## 1. Install Flutter

```powershell
winget install --id Google.Flutter --source winget
```

If winget doesn't offer it, download the ZIP from
<https://docs.flutter.dev/get-started/install/windows>, extract to `C:\flutter`
(**not** under `Program Files` — the space in the path breaks some Dart
tooling), and add `C:\flutter\bin` to your PATH.

Close and reopen the terminal, then:

```powershell
flutter --version
```

## 2. Point Flutter at the JDK and SDK you already have

Flutter otherwise picks Android Studio's bundled JBR — which is Java 25 here,
and the Android Gradle Plugin does not support it. Java 17 is the supported
version.

```powershell
flutter config --jdk-dir "C:\Program Files\Eclipse Adoptium\jdk-17.0.20.8-hotspot"
flutter config --android-sdk "C:\Users\Unicorn\AppData\Local\Android\Sdk"

flutter doctor --android-licenses    # accept all
flutter doctor -v
```

Everything under "Android toolchain" must be green before continuing. Ignore
any Xcode section — that's iOS, and it can't work on Windows.

## 3. Generate the Android and iOS platform folders

`apps/mobile` has `lib/` and `pubspec.yaml` but no platform folders yet. This
creates both without touching existing files:

```powershell
cd apps\mobile
flutter create --platforms=android,ios --org com.lytodmotors --project-name naija_parts_hub .
flutter pub get
```

> `--org com.lytodmotors` sets the application ID to
> `com.lytodmotors.naija_parts_hub`, matching the signing snippet in
> `docs/reference/android/`. Getting this right now matters — the application
> ID is permanent once an app is published to Google Play.

If `flutter pub get` reports version conflicts, run `flutter pub upgrade
--major-versions`. The pinned versions target Flutter 3.24-era Firebase
plugins and may need nudging on a newer SDK.

## 4. Run it

```powershell
flutter emulators --launch Pixel_10_Pro
flutter devices          # confirm the emulator is listed
flutter run
```

Expected: a diagnostics screen reading **Flutter: running**, **Platform:
Android**, **Firebase: Not configured yet**. That last one is correct at this
stage — it confirms the app boots and handles missing Firebase config rather
than crashing.

Hot reload with `r`, hot restart with `R`, quit with `q`.

A physical phone is faster than the emulator if you have one: enable USB
debugging, plug it in, and `flutter run` will pick it up.

---

## 5. Firebase (next session)

```powershell
npm install -g firebase-tools
dart pub global activate flutterfire_cli
firebase login
flutterfire configure          # select Android and iOS only, not web
```

Then follow the `TODO(setup)` in
[`apps/mobile/lib/core/firebase_bootstrap.dart`](../apps/mobile/lib/core/firebase_bootstrap.dart)
to swap in the generated options, and the Firebase row turns green.

**Phone OTP needs two more things** beyond `flutterfire configure`:

- **Android:** register the debug **and** release SHA-1/SHA-256 fingerprints in
  Firebase Console, and enable the Play Integrity API. Without them, phone auth
  silently falls back to a reCAPTCHA web view.
  ```powershell
  cd apps\mobile\android
  .\gradlew signingReport
  ```
- **iOS:** an APNs `.p8` auth key uploaded to Firebase, the Push Notifications
  capability, and a `REVERSED_CLIENT_ID` URL scheme in `Info.plist`. The `.p8`
  can only be generated inside a **paid Apple Developer account** — which is
  why enrolment is the long pole on the iOS track.

Add **fictional test phone numbers** in Firebase Console → Authentication →
Phone → "Phone numbers for testing" before doing any auth work. They return a
fixed OTP with no real SMS, so you don't burn quota or wait on carrier
delivery for every login test.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Unsupported class file major version 69` | Flutter is using Java 25. Redo step 2. |
| `cmdline-tools component is missing` | Android Studio → SDK Manager → SDK Tools → check "Android SDK Command-line Tools". |
| Emulator boots to a black screen | Cold boot it: Device Manager → ▾ → Cold Boot Now. |
| `flutter` not recognised after install | PATH change needs a fresh terminal. |
| Gradle download hangs on first run | Expected — the first Android build fetches several hundred MB. |
