import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../design/tokens.dart';
import '../../design/widgets.dart';
import '../../models/store.dart';
import '../../services/auth_service.dart';
import '../../services/store_service.dart';
import '../auth/phone_login_screen.dart';
import '../splash/splash_screen.dart';
import '../listings/listings_screen.dart';
import '../registration/registration_screen.dart';

/// Routes on auth and store state.
///
/// Driven by streams (authStateChanges + the store document) rather than a
/// one-shot read in initState. The inherited app read currentUser once at
/// startup, so Android instant verification could sign a dealer in while the
/// UI sat on the login screen forever.
class AppGate extends ConsumerWidget {
  const AppGate({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authStateProvider);

    return auth.when(
      loading: () => const _Splash(),
      error: (e, _) => _Message(title: 'Sign-in problem', body: friendlyError(e)),
      data: (user) {
        if (user == null) return const PhoneLoginScreen();

        final store = ref.watch(myStoreProvider);
        return store.when(
          loading: () => const _Splash(),
          error: (e, _) =>
              _Message(title: 'Could not load your business', body: friendlyError(e)),
          data: (s) {
            if (s == null) return const RegistrationScreen();
            return switch (s.status) {
              StoreStatus.approved => ListingsScreen(store: s),
              StoreStatus.pending => const _AwaitingReview(),
              StoreStatus.rejected => _Rejected(reason: s.rejectionReason),
              StoreStatus.suspended => _Suspended(reason: s.rejectionReason),
            };
          },
        );
      },
    );
  }
}

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) => const SplashScreen();
}

/// SOW section 3: "New businesses will remain pending until approved."
class _AwaitingReview extends ConsumerWidget {
  const _AwaitingReview();

  @override
  Widget build(BuildContext context, WidgetRef ref) => _Message(
        status: 'pending',
        icon: Icons.hourglass_top,
        title: 'Awaiting approval',
        body: 'Your business has been submitted. An administrator will review '
            'your CAC details and approve your store.\n\n'
            'You can create draft listings now, but publishing unlocks once '
            'you are approved.',
        onSignOut: () => ref.read(authServiceProvider).signOut(),
      );
}

class _Rejected extends ConsumerWidget {
  const _Rejected({this.reason});
  final String? reason;

  @override
  Widget build(BuildContext context, WidgetRef ref) => _Message(
        status: 'rejected',
        icon: Icons.cancel_outlined,
        title: 'Registration rejected',
        body: reason?.isNotEmpty == true
            ? reason!
            : 'Your registration was not approved. Please contact support.',
        onSignOut: () => ref.read(authServiceProvider).signOut(),
      );
}

class _Suspended extends ConsumerWidget {
  const _Suspended({this.reason});
  final String? reason;

  @override
  Widget build(BuildContext context, WidgetRef ref) => _Message(
        status: 'suspended',
        icon: Icons.pause_circle_outline,
        title: 'Business suspended',
        body: reason?.isNotEmpty == true
            ? reason!
            : 'Your business is currently suspended. Please contact support.',
        onSignOut: () => ref.read(authServiceProvider).signOut(),
      );
}

/// Shared status screen for the pending, rejected and suspended states.
///
/// Styled to the NPH system. Each state carries its own badge and tone so a
/// dealer can tell at a glance whether they are waiting on us or need to act —
/// "Awaiting approval" and "Registration rejected" previously looked identical
/// apart from the wording.
class _Message extends StatelessWidget {
  const _Message({
    required this.title,
    required this.body,
    this.status,
    this.icon,
    this.onSignOut,
  });

  final String title;
  final String body;

  /// Store status, when there is one. Null for failures that are not a store
  /// state at all — a sign-in error should not be badged "Rejected".
  final String? status;
  final IconData? icon;
  final VoidCallback? onSignOut;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final tone = switch (status) {
      'rejected' || 'suspended' => NphColors.error,
      _ => NphColors.warning,
    };

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(NphSpacing.xxxl),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const NphLogo(size: 52),
                      const SizedBox(height: NphSpacing.xxxl),
                      if (icon != null) ...[
                        Container(
                          padding: const EdgeInsets.all(NphSpacing.xl),
                          decoration: BoxDecoration(
                            color: tone.withValues(alpha: 0.10),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(icon, size: 32, color: tone),
                        ),
                        const SizedBox(height: NphSpacing.xl),
                      ],
                      if (status != null) ...[
                        NphStatusBadge.forStoreStatus(status!),
                        const SizedBox(height: NphSpacing.md),
                      ],
                      Text(title, textAlign: TextAlign.center, style: text.headlineSmall),
                      const SizedBox(height: NphSpacing.md),
                      Text(
                        body,
                        textAlign: TextAlign.center,
                        style: text.bodyMedium?.copyWith(color: NphColors.mutedForeground),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            if (onSignOut != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  NphSpacing.page,
                  0,
                  NphSpacing.page,
                  NphSpacing.xl,
                ),
                child: OutlinedButton(onPressed: onSignOut, child: const Text('Sign out')),
              ),
          ],
        ),
      ),
    );
  }
}
