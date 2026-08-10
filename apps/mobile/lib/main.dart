// Naija Parts Hub — dealer app
// Operated by Lytod Motors Ltd | RC 1207675
//
// Android + iOS only. The public marketplace, storefronts and admin portal are
// the Next.js app in apps/web (ADR-001 #1, #5).

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/crash_reporting.dart';
import 'core/firebase_bootstrap.dart';
import 'design/theme.dart';
import 'features/gate/app_gate.dart';
import 'features/startup/startup_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Never throws — reports its outcome instead, so the app still boots when
  // the backend is unreachable or unconfigured.
  final firebase = await initializeFirebase();

  // After Firebase, because Crashlytics needs the default app; before runApp,
  // so an error thrown during the first frame is already being watched for.
  if (firebase.isReady) await CrashReporting.install();

  runApp(
    ProviderScope(
      child: NaijaPartsHubApp(firebase: firebase),
    ),
  );
}

class NaijaPartsHubApp extends StatelessWidget {
  const NaijaPartsHubApp({super.key, required this.firebase});

  final FirebaseBootstrapResult firebase;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Naija Parts Hub',
      debugShowCheckedModeBanner: false,
      theme: buildNphTheme(),
      // Without a working Firebase connection there is nothing meaningful to
      // route to, so the diagnostics screen stands in and states why.
      home: firebase.isReady ? const AppGate() : StartupScreen(firebase: firebase),
    );
  }
}
