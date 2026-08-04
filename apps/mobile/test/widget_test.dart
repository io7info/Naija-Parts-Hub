import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:naija_parts_hub/core/firebase_bootstrap.dart';
import 'package:naija_parts_hub/features/startup/startup_screen.dart';
import 'package:naija_parts_hub/main.dart';

/// Widget tests that need no Firebase instance.
///
/// The connected path deliberately is NOT exercised here: it routes to AppGate,
/// which subscribes to authStateChanges and therefore requires a real Firebase
/// app. That path is covered end-to-end against the Emulator Suite instead —
/// see firebase/tests.
void main() {
  group('startup diagnostics', () {
    testWidgets('reports status and shows setup guidance when unconfigured',
        (tester) async {
      await tester.pumpWidget(
        const NaijaPartsHubApp(
          firebase: FirebaseBootstrapResult(FirebaseStatus.notConfigured),
        ),
      );

      expect(find.text('Naija Parts Hub'), findsOneWidget);
      expect(find.text('Not configured yet'), findsOneWidget);
      expect(find.text('Toolchain verified.'), findsOneWidget);
    });

    testWidgets('surfaces the failure detail when initialisation fails',
        (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: StartupScreen(
            firebase: FirebaseBootstrapResult(
              FirebaseStatus.failed,
              detail: 'boom',
            ),
          ),
        ),
      );

      expect(find.text('Failed to initialise'), findsOneWidget);

      // The point of the test, and previously not asserted at all: the reason
      // must reach the screen. Without it a real failure showed only "Failed to
      // initialise", and the card told you to run flutterfire configure — which
      // had already been run and was not the problem.
      expect(
        find.textContaining('boom'),
        findsOneWidget,
        reason: 'the failure detail must be shown, not just the status',
      );

      // "Toolchain verified." belongs to the unconfigured path. A hard failure
      // is not a verified toolchain.
      expect(find.text('Toolchain verified.'), findsNothing);
      expect(find.text('Firebase did not start.'), findsOneWidget);
    });

    testWidgets('tells an unconfigured checkout to run flutterfire configure',
        (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: StartupScreen(
            firebase: FirebaseBootstrapResult(FirebaseStatus.notConfigured),
          ),
        ),
      );

      expect(find.text('Toolchain verified.'), findsOneWidget);
      expect(find.textContaining('flutterfire configure'), findsOneWidget);
    });

    testWidgets('shows the environment label once connected', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: StartupScreen(
            firebase: FirebaseBootstrapResult(
              FirebaseStatus.connected,
              environment: 'Emulator (10.0.2.2) · demo-naija-parts-hub',
            ),
          ),
        ),
      );

      expect(
        find.text('Emulator (10.0.2.2) · demo-naija-parts-hub'),
        findsOneWidget,
      );
      expect(find.text('Toolchain verified.'), findsNothing);
    });
  });
}
