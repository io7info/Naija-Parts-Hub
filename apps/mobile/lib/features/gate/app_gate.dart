import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/crash_reporting.dart';
import '../../core/errors.dart';
import '../../design/components.dart';
import '../../models/store.dart';
import '../../services/auth_service.dart';
import '../../services/store_service.dart';
import '../auth/phone_login_screen.dart';
import '../pending/pending_screen.dart';
import '../registration/business_type_screen.dart';
import '../shell/mechanic_shell.dart';
import '../shell/main_shell.dart';
import '../splash/splash_screen.dart';

/// Routes on auth and store state.
///
/// Driven by streams — `authStateChanges` plus the store document — rather than
/// a one-shot read in initState. The inherited app read `currentUser` once at
/// startup, so Android instant verification could sign a dealer in while the UI
/// sat on the login screen forever.
///
/// The same property is what makes admin approval feel live: when an
/// administrator flips `status` to `approved`, the store snapshot arrives and
/// the dealer moves from the pending screen to Home without restarting.
///
/// Routing:
///   no user            -> phone sign-in
///   user, no store     -> registration wizard (straight in, no interstitial)
///   pending/rejected/suspended -> status screen with the review timeline
///   approved           -> MainShell, landing on the Home tab
class AppGate extends ConsumerWidget {
  const AppGate({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authStateProvider);

    return auth.when(
      loading: () => const SplashScreen(),
      error: (e, _) => _Failure(
        title: 'Sign-in problem',
        message: friendlyError(e),
        onSignOut: () => ref.read(authServiceProvider).signOut(),
      ),
      data: (user) {
        // Tags subsequent crash reports with the dealer's uid, and clears it on
        // sign-out. Unawaited: a reporting call must never delay the gate, and
        // a failure to tag is not worth blocking sign-in over.
        unawaited(CrashReporting.setDealer(user?.uid));

        if (user == null) return const PhoneLoginScreen();

        final store = ref.watch(myStoreProvider);
        return store.when(
          loading: () => const SplashScreen(),
          error: (e, _) => _Failure(
            title: 'Could not load your business',
            message: friendlyError(e),
            onSignOut: () => ref.read(authServiceProvider).signOut(),
          ),
          data: (s) {
            // No store document yet — the dealer has authenticated but never
            // registered. Straight into the wizard: an interstitial "you need
            // to register" screen would be a tap between them and the only
            // action available.
            // No store document yet. The entry point decides whether a
            // business-type choice is offered at all — when mechanic signup is
            // off, it is the dealer wizard directly, exactly as before.
            if (s == null) return registrationEntryPoint();

            return switch (s.status) {
              // Approved businesses land in the shell for their type. A
              // mechanic has no listings, no quota and no Add Listing tab, so
              // MainShell with three tabs hidden would be a dealer's app with
              // holes in it — see MechanicShell.
              StoreStatus.approved =>
                s.isMechanic ? MechanicShell(store: s) : MainShell(store: s),
              StoreStatus.pending ||
              StoreStatus.rejected ||
              StoreStatus.suspended =>
                PendingScreen(store: s),
            };
          },
        );
      },
    );
  }
}

/// Terminal failure state. Distinct from the store-status screens: this is the
/// app failing, not the business being in a particular state, so it must not
/// borrow their badges.
class _Failure extends StatelessWidget {
  const _Failure({
    required this.title,
    required this.message,
    required this.onSignOut,
  });

  final String title;
  final String message;
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Expanded(child: NphErrorState(title: title, message: message)),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
              child: OutlinedButton(onPressed: onSignOut, child: const Text('Sign out')),
            ),
          ],
        ),
      ),
    );
  }
}
