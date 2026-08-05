import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../design/components.dart';
import '../../design/tokens.dart';
import '../../models/store.dart';
import '../account/account_screen.dart';
import '../home/home_screen.dart';
import '../listings/listing_form_screen.dart';
import '../listings/listings_screen.dart';
import '../store/my_store_screen.dart';
import 'shell_providers.dart';

/// The approved dealer's shell: persistent header, five panes, bottom nav.
///
/// Phase 1 Flutter is dealer-only (ADR-001 #5). Buyers browse the Next.js site;
/// nothing here lets a dealer shop other stores. The buyer marketplace screens
/// that were briefly wired in live under features/buyer_marketplace_future/ and
/// are deliberately unreachable from this shell.
///
/// Panes live in an IndexedStack, not a Navigator per tab. Switching to
/// Listings and back must not discard a half-filled Add Listing form, reset a
/// scroll position, or re-run a Firestore query a dealer on metered data has
/// already paid for.
class MainShell extends ConsumerWidget {
  const MainShell({super.key, required this.store});

  final Store store;

  /// Confirms before abandoning unsaved listing work.
  ///
  /// Switching tabs is not a route pop, so PopScope never fires here — the
  /// guard has to sit on the tab change itself. This is the single reason the
  /// dirty flag is a provider rather than local State inside the form.
  Future<bool> _confirmLeavingForm(BuildContext context) async {
    final discard = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: NphColors.card,
        shape: const RoundedRectangleBorder(borderRadius: NphRadius.cardBorder),
        title: const Text('Discard this listing?'),
        content: const Text(
          'You have unsaved changes. Save it as a draft instead to keep your '
          'work — drafts are private and do not count toward your limit.',
          style: TextStyle(fontFamily: NphFonts.body, fontSize: 14, height: 1.45),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            style: TextButton.styleFrom(foregroundColor: NphColors.mutedForeground),
            child: const Text('Keep editing'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: TextButton.styleFrom(foregroundColor: NphColors.error),
            child: const Text('Discard'),
          ),
        ],
      ),
    );
    return discard ?? false;
  }

  Future<void> _select(BuildContext context, WidgetRef ref, ShellTab next) async {
    final current = ref.read(shellTabProvider);
    if (next == current) return;

    final leavingDirtyForm =
        current == ShellTab.addListing && ref.read(listingFormDirtyProvider);

    if (leavingDirtyForm) {
      final discard = await _confirmLeavingForm(context);
      if (!discard) return;
      // Discarding means the pane must come back empty, not still holding the
      // abandoned part.
      ref.read(listingFormResetProvider.notifier).state++;
      ref.read(listingFormDirtyProvider.notifier).state = false;
    }

    ref.read(shellTabProvider.notifier).state = next;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tab = ref.watch(shellTabProvider);
    final resetToken = ref.watch(listingFormResetProvider);

    final panes = <Widget>[
      HomeScreen(store: store),
      ListingsScreen(store: store),
      // Keyed on the reset token: bumping it discards this State entirely, so a
      // published listing cannot leave its values behind for the next one.
      ListingFormScreen(
        key: ValueKey('add-listing-$resetToken'),
        storeId: store.storeId,
        embedded: true,
      ),
      MyStoreScreen(store: store),
      AccountScreen(store: store),
    ];

    return Scaffold(
      backgroundColor: NphColors.background,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            NphAppHeader(
              store: store,
              onProfile: () => _select(context, ref, ShellTab.account),
            ),
            Expanded(child: IndexedStack(index: tab.index, children: panes)),
          ],
        ),
      ),
      bottomNavigationBar: NphBottomNav(
        current: tab,
        onSelect: (t) => _select(context, ref, t),
      ),
    );
  }
}

/// Persistent navbar: logo left, profile right.
///
/// The notification bell is absent, not hidden behind a flag. SOW "Not Included
/// in Phase 1" excludes push, SMS and WhatsApp automation, so no notification
/// is ever written — and an earlier version showed a hardcoded orange unread
/// dot, which told every dealer they had a message waiting when the feature did
/// not exist. A control that cannot do anything is worse than no control.
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

/// Five-slot bottom navigation with the raised Add Listing circle.
///
/// The circle overflows the bar upward, so the bar cannot clip its children —
/// hence a Stack with `clipBehavior: none`. It is a Positioned overlay rather
/// than a Row child because Transform.translate moves paint but not layout: a
/// translated 56 px circle plus its label still measured 70 px inside a 64 px
/// bar and overflowed by 7.
class NphBottomNav extends StatelessWidget {
  const NphBottomNav({super.key, required this.current, required this.onSelect});

  final ShellTab current;
  final ValueChanged<ShellTab> onSelect;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: NphColors.card,
        border: Border(top: BorderSide(color: NphColors.border)),
      ),
      child: SafeArea(
        top: false,
        // A navigation bar that grows without limit stops being a navigation
        // bar. At 2.0x the raised centre button's label grew wider than its
        // slot and — being painted above the Row — silently swallowed the taps
        // meant for Listings and My Store. Clamping keeps every tab reachable.
        // The panes themselves still scale to the full 2.0x; only these five
        // labels are held back, and each one sits under an icon that carries
        // the same meaning.
        child: MediaQuery.withClampedTextScaling(
          maxScaleFactor: 1.3,
          child: SizedBox(
            height: 64,
            child: LayoutBuilder(
              builder: (context, constraints) {
                // Five equal slots: four tabs and the reserved centre.
                final slot = constraints.maxWidth / 5;
                return Stack(
                  clipBehavior: Clip.none,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _NavItem(
                          icon: Icons.dashboard_outlined,
                          activeIcon: Icons.dashboard,
                          label: 'Home',
                          active: current == ShellTab.home,
                          onTap: () => onSelect(ShellTab.home),
                        ),
                        _NavItem(
                          icon: Icons.inventory_2_outlined,
                          activeIcon: Icons.inventory_2,
                          label: 'Listings',
                          active: current == ShellTab.listings,
                          onTap: () => onSelect(ShellTab.listings),
                        ),
                        // Reserves the centre slot so the four flat tabs keep
                        // even widths; the circle is painted over it below.
                        const Spacer(),
                        _NavItem(
                          icon: Icons.storefront_outlined,
                          activeIcon: Icons.storefront,
                          label: 'My Store',
                          active: current == ShellTab.myStore,
                          onTap: () => onSelect(ShellTab.myStore),
                        ),
                        _NavItem(
                          icon: Icons.person_outline,
                          activeIcon: Icons.person,
                          label: 'Account',
                          active: current == ShellTab.account,
                          onTap: () => onSelect(ShellTab.account),
                        ),
                      ],
                    ),
                    Positioned(
                      top: -22,
                      left: 0,
                      right: 0,
                      child: Center(
                        // Held to its own slot. The circle itself is narrower
                        // than this; the constraint is for the label under it,
                        // which must never reach into a neighbouring tab.
                        child: SizedBox(
                          width: slot,
                          child: _AddButton(
                            active: current == ShellTab.addListing,
                            onTap: () => onSelect(ShellTab.addListing),
                          ),
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.icon,
    required this.activeIcon,
    required this.label,
    required this.active,
    required this.onTap,
  });

  final IconData icon;
  final IconData activeIcon;
  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colour = active ? NphColors.orange : NphColors.mutedForeground;
    return Expanded(
      child: Semantics(
        // Colour alone must not carry "which tab am I on" — a dealer who cannot
        // distinguish orange from grey gets the same answer from the label.
        selected: active,
        button: true,
        label: label,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(active ? activeIcon : icon, size: NphSize.navIcon, color: colour),
                const SizedBox(height: 4),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontFamily: NphFonts.body,
                    fontSize: 10,
                    fontWeight: active ? FontWeight.w700 : FontWeight.w600,
                    color: colour,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AddButton extends StatelessWidget {
  const _AddButton({required this.active, required this.onTap});

  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      selected: active,
      button: true,
      label: 'Add Listing',
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: NphSize.fabDiameter,
              height: NphSize.fabDiameter,
              decoration: BoxDecoration(
                color: active ? NphColors.orangeHover : NphColors.orange,
                shape: BoxShape.circle,
                // `ring-4 ring-card` — separates the circle from whatever
                // scrolls beneath the bar.
                border: Border.all(color: NphColors.card, width: 4),
                boxShadow: [
                  BoxShadow(
                    color: NphColors.orange.withValues(alpha: active ? 0.45 : 0.30),
                    blurRadius: 12,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: const Icon(Icons.add, size: 28, color: Colors.white),
            ),
            const SizedBox(height: 4),
            Text(
              'Add Listing',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontFamily: NphFonts.body,
                fontSize: 10,
                fontWeight: active ? FontWeight.w700 : FontWeight.w600,
                color: active ? NphColors.orange : NphColors.foreground,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
