import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../../design/components.dart';
import '../../design/tokens.dart';
import '../../models/store.dart';

/// The persistent top bar, shared by both shells.
///
/// Lifted out of main_shell.dart when the mechanic shell was given the same
/// treatment. MechanicShell had no header at all, so switching from the dealer
/// app to the mechanic app lost the logo, the account shortcut and the debug
/// environment chip — three tabs that looked like a different product rather
/// than a different workspace in the same one.
///
/// Kept in the shell layer rather than moved into design/components.dart: it
/// takes a Store, and the design system is deliberately free of model imports.
class NphAppHeader extends StatelessWidget {
  const NphAppHeader({super.key, required this.store, this.onProfile});

  final Store store;
  final VoidCallback? onProfile;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 56,
      padding: const EdgeInsets.symmetric(horizontal: NphSpacing.appPage),
      color: NphColors.card,
      child: Row(
        children: [
          const NphLogo(size: 34),
          const Spacer(),
          // Debug-only, so a release build never advertises which backend it is
          // pointed at. See Env.describe.
          if (kDebugMode) const _EnvironmentChip(),
          NphIconButton(
            icon: Icons.person_outline,
            tooltip: 'Your account',
            onPressed: onProfile,
          ),
        ],
      ),
    );
  }
}

class _EnvironmentChip extends StatelessWidget {
  const _EnvironmentChip();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: NphSpacing.sm),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: const BoxDecoration(
          color: NphColors.warning10,
          borderRadius: NphRadius.pillBorder,
        ),
        child: const Text(
          'DEBUG',
          style: TextStyle(
            fontFamily: NphFonts.body,
            fontSize: 9,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.5,
            color: NphColors.warning,
          ),
        ),
      ),
    );
  }
}
