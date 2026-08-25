import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../design/tokens.dart';
import '../../models/store.dart';
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
          padding: const EdgeInsets.fromLTRB(20, 32, 20, 24),
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
              const SizedBox(height: 8),
              const Text(
                'This decides how buyers find you. You cannot change it later, '
                'so choose the one that describes your business.',
                style: TextStyle(color: NphColors.mutedForeground, height: 1.4),
              ),
              const SizedBox(height: 28),

              _TypeCard(
                icon: Icons.inventory_2_outlined,
                title: 'Parts Dealer',
                subtitle: 'I sell auto parts',
                bullets: const [
                  'List parts with prices and photos',
                  'Buyers search and contact you to buy',
                  'Free plan covers 10 live listings',
                ],
                onTap: () => _go(context, const RegistrationScreen()),
              ),
              const SizedBox(height: 16),
              _TypeCard(
                icon: Icons.build_outlined,
                title: 'Auto Mechanic',
                subtitle: 'I repair and service vehicles',
                bullets: const [
                  'Advertise the services you offer',
                  'Show up to 10 photos of your work',
                  'Free — you will verify your identity with BVN and NIN',
                ],
                onTap: () => _go(context, const MechanicRegistrationScreen()),
              ),

              const SizedBox(height: 24),
              const Text(
                'Not sure? If you fit and sell parts, register as a Parts Dealer — '
                'you can mention repairs in your description.',
                style: TextStyle(fontSize: 12, color: NphColors.mutedForeground, height: 1.4),
              ),
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

class _TypeCard extends StatelessWidget {
  const _TypeCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.bullets,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final List<String> bullets;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: NphColors.card,
      borderRadius: NphRadius.cardBorder,
      child: InkWell(
        onTap: onTap,
        borderRadius: NphRadius.cardBorder,
        child: Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            borderRadius: NphRadius.cardBorder,
            border: Border.all(color: NphColors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: NphColors.orange.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(icon, color: NphColors.orange),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          style: const TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.bold,
                            color: NphColors.foreground,
                          ),
                        ),
                        Text(
                          subtitle,
                          style: const TextStyle(color: NphColors.mutedForeground),
                        ),
                      ],
                    ),
                  ),
                  const Icon(Icons.chevron_right, color: NphColors.mutedForeground),
                ],
              ),
              const SizedBox(height: 14),
              for (final b in bullets)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Padding(
                        padding: EdgeInsets.only(top: 2),
                        child: Icon(Icons.check, size: 15, color: NphColors.success),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          b,
                          style: const TextStyle(
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
        ),
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
