// Local production configuration. Gitignored; never commit.
//
// Normally written by `flutterfire configure`. This copy was assembled by hand
// from values read straight out of the live project with
//
//   firebase apps:sdkconfig IOS     1:813389632700:ios:7beb45e69e7929de146cb9
//   firebase apps:sdkconfig ANDROID 1:813389632700:android:245993857adde505146cb9
//
// so that the Mac can produce a working release build without running the
// generator. The generator would also write android/app/google-services.json,
// ios/Runner/GoogleService-Info.plist and a plist reference into the Xcode
// project; none of those were wanted here, and none of them are required —
// firebase_bootstrap.dart passes these options explicitly on both platforms and
// never reads a platform config file.
//
// Safe to overwrite with real `flutterfire configure` output later. Keep the
// two app ids below if you do: they are the apps whose bundle id and package
// name actually match what this project builds.
//
//   ios      com.lytodmotors.naijapartshub    1:813389632700:ios:7beb45e69e7929de146cb9
//   android  com.lytodmotors.naijapartshub    1:813389632700:android:245993857adde505146cb9
//
// A second registration exists on each platform — ios ...221c2b52 under the
// camelCase bundle id, android ...0014618d under the underscored package name.
// Neither matches a build this repository produces, and neither is referenced
// here on purpose.
//
// The API keys are not secrets. Firebase publishes them as client
// configuration; access is enforced by security rules and by the callables,
// not by hiding these strings. The same values are already public in the web
// app's NEXT_PUBLIC_* environment.

import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform, kIsWeb;

/// Live Firebase configuration, shaped exactly like `flutterfire configure`
/// output so the generator can replace this file with no code changes.
class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) {
      throw UnsupportedError(
        'The web target is deliberately dropped — see ADR-001 #1. The public '
        'marketplace is the Next.js app in apps/web.',
      );
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        return ios;
      default:
        throw UnsupportedError(
          'No Firebase configuration for $defaultTargetPlatform. This app '
          'ships to Android and iOS only.',
        );
    }
  }

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'AIzaSyBZoKxsLVB0qtQ0IkCNJ33STs6Aq9YIcKw',
    appId: '1:813389632700:ios:7beb45e69e7929de146cb9',
    messagingSenderId: '813389632700',
    projectId: 'naijapartshub',
    storageBucket: 'naijapartshub.firebasestorage.app',
    iosBundleId: 'com.lytodmotors.naijapartshub',
  );

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyBYqnhk4rSq7mnEqzNc-OOCQ06hQeGmLl8',
    appId: '1:813389632700:android:245993857adde505146cb9',
    messagingSenderId: '813389632700',
    projectId: 'naijapartshub',
    storageBucket: 'naijapartshub.firebasestorage.app',
  );
}
