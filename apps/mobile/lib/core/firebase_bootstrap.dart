import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/foundation.dart';

import '../firebase_options.dart';
import 'env.dart';

/// Firebase startup.
///
/// Reports its outcome rather than throwing, so a missing or misconfigured
/// backend degrades to a visible status instead of a crash on launch. The
/// inherited app imported `firebase_options.dart` at the top of main.dart,
/// which made an unconfigured checkout fail to compile at all.
enum FirebaseStatus { connected, notConfigured, failed }

class FirebaseBootstrapResult {
  const FirebaseBootstrapResult(this.status, {this.detail, this.environment});

  final FirebaseStatus status;
  final String? detail;
  final String? environment;

  bool get isReady => status == FirebaseStatus.connected;

  String get label => switch (status) {
        FirebaseStatus.connected => environment ?? 'Connected',
        FirebaseStatus.notConfigured => 'Not configured yet',
        FirebaseStatus.failed => 'Failed to initialise',
      };
}

/// Guards against re-pointing emulators on hot restart, which throws.
bool _emulatorsWired = false;

/// The one FirebaseFunctions instance the whole app uses.
///
/// Deliberately a single stored object rather than calling
/// `FirebaseFunctions.instanceFor(region: ...)` at each call site. Wiring the
/// emulator on one instance and invoking callables on another silently sends
/// requests to the real Google Cloud endpoint — which, for a demo-* project,
/// fails with an opaque "enable the API" error rather than anything pointing at
/// the actual cause.
FirebaseFunctions? _functions;

/// Throws if accessed before [initializeFirebase] completes.
FirebaseFunctions get appFunctions {
  final instance = _functions;
  if (instance == null) {
    throw StateError('appFunctions used before initializeFirebase() completed.');
  }
  return instance;
}

Future<FirebaseBootstrapResult> initializeFirebase() async {
  try {
    if (Env.useEmulator) {
      // A demo-* project id needs no real credentials — the Emulator Suite
      // accepts placeholder options and stays entirely offline.
      //
      // Android's FirebaseInitProvider is removed in AndroidManifest.xml, so
      // nothing has built [DEFAULT] from google-services.json before this
      // runs. That removal is load-bearing: without it these options lose to
      // the live project and initialisation fails with [duplicate-app].
      await Firebase.initializeApp(
        options: const FirebaseOptions(
          apiKey: Env.demoApiKey,
          appId: '1:000000000000:android:0000000000000000',
          messagingSenderId: '000000000000',
          projectId: Env.demoProjectId,
          storageBucket: '${Env.demoProjectId}.appspot.com',
        ),
      );
      // Resolved before wiring so the emulator is applied to the exact
      // instance the app will use.
      _functions = FirebaseFunctions.instanceFor(region: Env.functionsRegion);
      await _useEmulators();
    } else {
      // Live project, from the generated firebase_options.dart.
      //
      // Passing options explicitly rather than relying on the platform config
      // files: Android would resolve google-services.json on its own, but iOS
      // needs GoogleService-Info.plist, which `flutterfire configure` only
      // writes into the Xcode project when run on macOS. Explicit options make
      // both platforms initialise from one source that is checked at compile
      // time instead of at launch.
      await Firebase.initializeApp(
        options: DefaultFirebaseOptions.currentPlatform,
      );
      _functions = FirebaseFunctions.instanceFor(region: Env.functionsRegion);
    }

    await _enableOfflinePersistence();

    return FirebaseBootstrapResult(
      FirebaseStatus.connected,
      environment: Env.describe,
    );
  } on FirebaseException catch (e) {
    if (e.code == 'no-app' || e.code == 'not-initialized') {
      return const FirebaseBootstrapResult(FirebaseStatus.notConfigured);
    }
    // Logged as well as returned. This branch used to return silently, so a
    // real initialisation failure showed "Failed to initialise" on screen with
    // nothing whatsoever in logcat to say why.
    debugPrint('Firebase init failed [${e.code}]: ${e.message}');
    return FirebaseBootstrapResult(FirebaseStatus.failed, detail: '[${e.code}] ${e.message}');
  } catch (e) {
    debugPrint('Firebase init failed: $e');
    return FirebaseBootstrapResult(FirebaseStatus.failed, detail: '$e');
  }
}

Future<void> _useEmulators() async {
  if (_emulatorsWired) return;
  _emulatorsWired = true;

  final host = Env.emulatorHost;

  await FirebaseAuth.instance.useAuthEmulator(host, Env.authPort);
  FirebaseFirestore.instance.useFirestoreEmulator(host, Env.firestorePort);
  await FirebaseStorage.instance.useStorageEmulator(host, Env.storagePort);
  _functions!.useFunctionsEmulator(host, Env.functionsPort);

  debugPrint(
    'Firebase emulators wired to $host '
    '(auth ${Env.authPort}, firestore ${Env.firestorePort}, '
    'storage ${Env.storagePort}, functions ${Env.functionsPort} '
    'region ${Env.functionsRegion})',
  );
}

/// Firestore native offline persistence (ADR-001 #3).
///
/// This replaces the hand-rolled Hive sync layer entirely. It gives local
/// caching, write queuing while offline, and automatic replay on reconnect —
/// which is all of SOW section 10 except the visible status, and that comes
/// from snapshot metadata (`hasPendingWrites`), surfaced in SyncStatusBanner.
Future<void> _enableOfflinePersistence() async {
  FirebaseFirestore.instance.settings = const Settings(
    persistenceEnabled: true,
    // Unlimited local cache: a dealer in a low-connectivity market may go days
    // between syncs, and evicting their own listings would defeat the point.
    cacheSizeBytes: Settings.CACHE_SIZE_UNLIMITED,
  );
}
