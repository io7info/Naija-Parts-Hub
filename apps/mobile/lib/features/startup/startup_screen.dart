import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../../core/env.dart';
import '../../core/firebase_bootstrap.dart';
import '../../design/tokens.dart';

/// First-run diagnostics.
///
/// Temporary: it exists so the toolchain (Flutter -> Gradle -> emulator) can be
/// verified before Firebase, auth, or any real screen exists. Replaced by the
/// auth gate once registration lands.
class StartupScreen extends StatelessWidget {
  const StartupScreen({super.key, required this.firebase});

  final FirebaseBootstrapResult firebase;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Icon(Icons.build_circle,
                    size: 64, color: NphColors.orange,),
                const SizedBox(height: 16),
                const Text(
                  'Naija Parts Hub',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 26, fontWeight: FontWeight.bold),
                ),
                const Text(
                  'Dealer app · Operated by Lytod Motors Ltd',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.black54, fontSize: 13),
                ),
                const SizedBox(height: 28),
                Card(
                  elevation: 0,
                  color: Colors.white,
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      children: [
                        _row('Flutter', 'running', ok: true),
                        const Divider(height: 20),
                        _row('Platform', _platformLabel(), ok: true),
                        const Divider(height: 20),
                        _row(
                          'Firebase',
                          // Diagnostics screen, shown only when Firebase failed to start.
              // The label names the backend, so it is debug-only.
              kDebugMode ? firebase.label : 'Configuration problem',
                          ok: firebase.isReady,
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                if (!firebase.isReady) _NextStepsCard(firebase),
              ],
            ),
          ),
        ),
      ),
    );
  }

  static String _platformLabel() {
    if (kIsWeb) return 'web (unsupported target)';
    if (Platform.isAndroid) return 'Android';
    if (Platform.isIOS) return 'iOS';
    return Platform.operatingSystem;
  }

  static Widget _row(String label, String value, {required bool ok}) {
    return Row(
      children: [
        Icon(
          ok ? Icons.check_circle : Icons.radio_button_unchecked,
          size: 18,
          color: ok ? Colors.green : Colors.orange,
        ),
        const SizedBox(width: 10),
        Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
        const Spacer(),
        Flexible(
          child: Text(
            value,
            textAlign: TextAlign.right,
            style: const TextStyle(color: Colors.black54),
          ),
        ),
      ],
    );
  }
}

class _NextStepsCard extends StatelessWidget {
  const _NextStepsCard(this.result);

  final FirebaseBootstrapResult result;

  /// Guidance that matches the actual failure.
  ///
  /// This card used to say "run flutterfire configure" for every non-ready
  /// state, including states configuration cannot fix. It kept saying it long
  /// after flutterfire configure had been run, which sends you to fix something
  /// that is not broken.
  String get _body {
    if (result.status == FirebaseStatus.notConfigured) {
      return 'Firebase is not configured for this checkout yet:\n\n'
          '  firebase login\n'
          '  flutterfire configure --project=naijapartshub';
    }

    final detail = result.detail?.trim();
    final buffer = StringBuffer();
    if (detail != null && detail.isNotEmpty) buffer.writeln('$detail\n');

    if (Env.useEmulator) {
      buffer.write(
        'Running against the Local Emulator Suite. Start it from the repo root:\n\n'
        '  npm run emulators\n\n'
        'Then hot restart. To run against the live project instead:\n\n'
        '  flutter run --dart-define=USE_FIREBASE_EMULATOR=false',
      );
    } else {
      buffer.write(
        'Running against the live Firebase project. Check that '
        'lib/firebase_options.dart is present and current:\n\n'
        '  flutterfire configure --project=naijapartshub',
      );
    }
    return buffer.toString();
  }

  @override
  Widget build(BuildContext context) {
    final configuring = result.status == FirebaseStatus.notConfigured;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: NphColors.orange.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: NphColors.orange.withValues(alpha: 0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            configuring ? 'Toolchain verified.' : 'Firebase did not start.',
            style: const TextStyle(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 6),
          Text(_body, style: const TextStyle(fontSize: 12, height: 1.5)),
        ],
      ),
    );
  }
}
