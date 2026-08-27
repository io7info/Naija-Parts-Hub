import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/formatting.dart';
import '../../design/components.dart';
import '../../design/tokens.dart';
import '../../models/store.dart';
import '../../services/auth_service.dart';
import '../../services/feature_flags_service.dart';
import 'mechanic_registration_screen.dart';
import 'registration_screen.dart';

/// The first decision in registration: what kind of business is this?
///
/// The client's problem was that marketers and users could not tell who should
/// register or what each account was for — parts dealers and mechanics were
/// signing up through one flow designed for shops. Asking once, up front, in
/// plain words, is the fix; everything after this point is one path or the
/// other and they never mix again.
///
/// WHEN MECHANIC SIGNUP IS OFF
///
/// This screen does not appear at all. A dealer goes straight into the
/// existing wizard, exactly as today — no extra tap, no visible change, no
/// risk to the flow that is already in production. Showing a choice with one
/// option would be worse than showing no choice.
class BusinessTypeScreen extends ConsumerWidget {
  const BusinessTypeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mechanicsEnabled = ref.watch(mechanicSignupEnabledProvider);

    // Production, today: straight to the dealer wizard. The selector is not
    // rendered and then hidden — it is never built, so there is no path a
    // user can reach that ends at an unavailable identity check.
    if (!mechanicsEnabled) return const RegistrationScreen();

    return Scaffold(
      backgroundColor: NphColors.background,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(
              NphSpacing.page, NphSpacing.xxxl, NphSpacing.page, NphSpacing.xxl),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'What kind of business?',
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.bold,
                      color: NphColors.foreground,
                    ),
              ),
              const SizedBox(height: NphSpacing.sm),
              const Text(
                'This decides how buyers find you. You cannot change it later, '
                'so choose the one that describes your business.',
                style: TextStyle(color: NphColors.mutedForeground, height: 1.4),
              ),
              const SizedBox(height: NphSpacing.xxxl),
              _TypeCard(
                icon: Icons.inventory_2_outlined,
                title: 'Parts Dealer',
                subtitle: 'I sell auto parts',
                focus: 'Inventory',
                bullets: const [
                  'List parts with prices and photos',
                  'Buyers search and contact you to buy',
                  'Free plan covers 10 live listings',
                ],
                onTap: () => _go(context, const RegistrationScreen()),
              ),
              const SizedBox(height: NphSpacing.lg),
              _TypeCard(
                icon: Icons.build_outlined,
                title: 'Auto Mechanic',
                subtitle: 'I repair and service vehicles',
                focus: 'Services',
                bullets: const [
                  'Advertise the services you offer',
                  'Show up to 10 photos of your work',
                  'Free — you will verify your identity with BVN and NIN',
                ],
                onTap: () => _go(context, const MechanicRegistrationScreen()),
              ),
              const SizedBox(height: NphSpacing.xxl),
              const Text(
                'Not sure? If you fit and sell parts, register as a Parts Dealer — '
                'you can mention repairs in your description.',
                style: TextStyle(fontSize: 12, color: NphColors.mutedForeground, height: 1.4),
              ),

              // THE WAY OUT.
              //
              // This screen is the gate's root when a signed-in user has no
              // store: there is no back button because there is nothing behind
              // it. Without this, someone who signed in on the wrong number —
              // a typo, a second SIM, a phone borrowed to receive one OTP —
              // could neither register as themselves nor leave, short of
              // clearing the app's data.
              //
              // The number is shown alongside it because that is what makes
              // the mistake visible in the first place.
              const SizedBox(height: NphSpacing.xxxl),
              const Divider(color: NphColors.border, height: 1),
              const SizedBox(height: NphSpacing.lg),
              _SignedInAs(phone: ref.watch(authStateProvider).valueOrNull?.phoneNumber),
            ],
          ),
        ),
      ),
    );
  }

  void _go(BuildContext context, Widget screen) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
  }
}

/// Who the app currently believes you are, and how to stop being them.
///
/// A ConsumerWidget of its own so signing out rebuilds through the gate rather
/// than through this screen — the gate is watching authStateChanges and will
/// route to the phone login on its own.
class _SignedInAs extends ConsumerWidget {
  const _SignedInAs({required this.phone});

  final String? phone;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Row(
      children: [
        Expanded(
          child: Text(
            phone == null || phone!.isEmpty
                ? 'Signed in'
                : 'Signed in as ${formatNigerianPhone(phone!)}',
            style: const TextStyle(
              fontFamily: NphFonts.body,
              fontSize: 12,
              color: NphColors.mutedForeground,
            ),
          ),
        ),
        TextButton(
          onPressed: () => ref.read(authServiceProvider).signOut(),
          style: TextButton.styleFrom(foregroundColor: NphColors.mutedForeground),
          child: const Text('Sign Out'),
        ),
      ],
    );
  }
}

/// One of the two choices.
///
/// Built on NphCard so it sits on the same surface, radius and border as every
/// other card in the app. What distinguishes the two is not decoration but
/// content: the icon says what the business handles, and the bullets say what
/// the app will then be — an inventory to manage, or a profile to be found by.
class _TypeCard extends StatelessWidget {
  const _TypeCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.focus,
    required this.bullets,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  /// The one-word shape of the account — "Inventory" or "Services". Named
  /// rather than implied, because the difference decides which app someone
  /// gets and it cannot be changed afterwards.
  final String focus;

  final List<String> bullets;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return NphCard(
      onTap: onTap,
      padding: const EdgeInsets.all(NphSpacing.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              NphIconTile(icon: icon, size: NphIconTileSize.category),
              const SizedBox(width: NphSpacing.lg),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: text.titleMedium),
                    const SizedBox(height: 2),
                    Text(subtitle, style: text.bodySmall),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: NphColors.mutedForeground),
            ],
          ),
          const SizedBox(height: NphSpacing.md),
          NphMetaPill(icon: Icons.category_outlined, label: focus),
          const SizedBox(height: NphSpacing.md),
          for (final b in bullets)
            Padding(
              padding: const EdgeInsets.only(bottom: NphSpacing.xs),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 2),
                    child: Icon(Icons.check, size: 15, color: NphColors.success),
                  ),
                  const SizedBox(width: NphSpacing.sm),
                  Expanded(
                    child: Text(
                      b,
                      style: const TextStyle(
                        fontFamily: NphFonts.body,
                        fontSize: 13,
                        color: NphColors.mutedForeground,
                        height: 1.35,
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Which registration screen a signed-in user with no store should see.
///
/// Exists so `app_gate` does not have to know about the flag: the gate asks
/// for "the registration entry point" and this decides what that is.
Widget registrationEntryPoint() => const BusinessTypeScreen();

/// The business type a completed form should register as.
///
/// Trivial, but it keeps the wire value in one place rather than having each
/// screen construct its own — see BusinessType.wire.
BusinessType typeForMechanicForm() => BusinessType.mechanic;
