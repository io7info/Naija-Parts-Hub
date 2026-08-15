# iOS build checklist

Written from Windows, where iOS cannot be built. Everything below is
preparation and expected-failure notes rather than verified output — the first
real macOS build is the first time any of it is exercised.

**Do not assume a clean first build.** CocoaPods resolution is where Flutter
iOS builds usually fail, and it cannot be run or verified from this machine.

## Already done

| | |
|---|---|
| `ios/` project generated | `flutter create --platforms=android,ios` |
| Bundle ID | `com.lytodmotors.naijapartshub` — all lowercase, and identical to the Android `applicationId`. Register the App ID from this line, never from memory: it cannot be changed after the first submission. |
| Display name | Naija Parts Hub |
| `NSCameraUsageDescription` | present — missing is a hard crash, not a prompt |
| `NSPhotoLibraryUsageDescription` | present |
| `NSAllowsLocalNetworking` | present — lets the app reach the local emulator |
| Deployment target | `IPHONEOS_DEPLOYMENT_TARGET = 13.0` |
| Emulator host resolution | `Env.emulatorHost` returns `localhost` on iOS, `10.0.2.2` only on Android |

## Still required

> **A fresh clone cannot build — for either platform — until `flutterfire
> configure` has run.** `firebase_options.dart`, `GoogleService-Info.plist` and
> `google-services.json` are all gitignored on purpose (see the FIREBASE block
> in `.gitignore`): they name the client's project, and they are generated, not
> authored. Their absence is expected and is **not** evidence that the tree is
> broken or that earlier Android testing happened somewhere else.
>
> ```bash
> flutterfire configure --project=naijapartshub \
>   --platforms=android,ios \
>   --ios-bundle-id=com.lytodmotors.naijapartshub \
>   --android-package-name=com.lytodmotors.naijapartshub
> ```
>
> Pass those flags rather than answering the prompts. Both apps are already
> registered in Firebase; the flags make the CLI reuse them instead of silently
> creating a second, differently-named app.

1. **A Mac or macOS CI runner.** No alternative exists.
2. **Apple Developer enrolment.** Needed for the APNs key. As an organisation
   this needs a D-U-N-S number first — 1–2 weeks.
3. **APNs `.p8` auth key** uploaded to Firebase, plus the Push Notifications
   capability. Phone OTP is the app's first screen; without this it silently
   degrades to a reCAPTCHA web view.
4. **`CFBundleURLTypes`** carrying `REVERSED_CLIENT_ID` from
   `GoogleService-Info.plist`, which only exists after `flutterfire configure`.
5. **CocoaPods** — `sudo gem install cocoapods`, then `pod install` in `ios/`.

## First build

```bash
cd apps/mobile
flutter clean
flutter pub get
cd ios && pod install && cd ..
flutter run -d "iPhone 16 Pro"     # flutter devices to list simulators
```

A **simulator** build needs no signing and no paid account. A **physical
device** needs both.

## Failures to expect, and what they mean

### `The plugin "firebase_xxx" requires a higher minimum iOS deployment target`

The most likely failure. Firebase periodically raises its floor and the Flutter
template lags behind.

Fix in two places, which must agree:

```ruby
# ios/Podfile — first line
platform :ios, '15.0'
```

```
# Xcode → Runner → Build Settings → iOS Deployment Target → 15.0
# or edit IPHONEOS_DEPLOYMENT_TARGET in project.pbxproj (3 occurrences)
```

> **Product decision, not just a build fix.** Raising the floor drops older
> iPhones. Second-hand iPhone 6s/7 units running iOS 13–14 are common in the
> Nigerian market, so raise it only as far as the error demands. It is left at
> 13.0 deliberately rather than pre-emptively bumped.

### `CocoaPods could not find compatible versions for pod "Firebase/..."`

Stale local spec repo:

```bash
cd ios
pod repo update
pod install --repo-update
```

### `Command PhaseScriptExecution failed` referencing `Flutter/Generated.xcconfig`

The checked-in xcconfig holds Windows absolute paths from this machine. It is
generated, so regenerate it:

```bash
flutter clean && flutter pub get
```

### Signing errors on a physical device

Xcode → Runner → Signing & Capabilities → select a Team. Requires enrolment.
Simulator builds do not.

### App launches then dies instantly on opening the camera

A missing `NS*UsageDescription`. Both are present now, but re-check if
`flutter create` is ever re-run — it can overwrite `Info.plist`.

### Phone OTP shows a reCAPTCHA web view instead of an SMS

Expected until the APNs key is uploaded. Not a bug.

## Emulator from an iOS simulator

The simulator shares the host's network, so `localhost` works directly — no
`10.0.2.2` alias, which is Android-only. `Env.emulatorHost` already branches on
`Platform.isAndroid`, so no change is needed.

`NSAllowsLocalNetworking` covers the cleartext restriction, the iOS counterpart
to `android/app/src/debug/res/xml/network_security_config.xml`.

## Honest status

The Dart is platform-agnostic and analyses clean, and every architectural
decision is platform-neutral. iOS is a build-and-configure exercise rather than
a porting one. But **no iOS build has ever run**, so treat the first one as
real work with a real chance of surprises — budget half a day, not ten minutes.
