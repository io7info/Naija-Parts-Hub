import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../design/components.dart';
import '../../design/tokens.dart';
import '../../models/store.dart';
import '../account/account_screen.dart';
import '../dashboard/dashboard_screen.dart';
import '../home/home_screen.dart';
import '../listings/listing_form_screen.dart';
import '../notifications/notifications_screen.dart';
import '../search/search_screen.dart';

/// The signed-in, approved dealer's shell: persistent header + bottom nav.
///
/// Tabs follow the approved design — Home · Search · Add Listing · My Store ·
/// Account — with Add Listing raised as an orange circle rather than a flat
/// tab, because it is the primary action of the whole app.
///
/// Note this makes the Flutter app buyer-facing as well as dealer-facing,
/// which is a deliberate departure from ADR-001 #5 ("the Flutter app is
/// dealer-only"). The client approved these screens; the ADR needs updating to
/// match rather than the other way round.
///
/// State lives in an IndexedStack, not a Navigator per tab: switching to
/// Search and back must not discard the Home scroll position or re-run its
/// Firestore query, and a dealer on a metered connection notices that.
class MainShell extends ConsumerStatefulWidget {
  const MainShell({super.key, required this.store, this.initialTab = 0});

  final Store store;
  final int initialTab;

  @override
  ConsumerState<MainShell> createState() => _MainShellState();
}

class _MainShellState extends ConsumerState<MainShell> {
  /// Index into the pane list. Add Listing is not a pane — it pushes a route —
  /// so the nav bar's five slots map onto four panes:
  ///   0 Home · 1 Search · (Add pushes) · 2 My Store · 3 Account
  late int _tab = widget.initialTab;

  void _openAddListing() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ListingFormScreen(storeId: widget.store.storeId),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final panes = [
      HomeScreen(store: widget.store),
      SearchScreen(store: widget.store),
      DashboardScreen(store: widget.store, onNavigate: (t) => setState(() => _tab = t)),
      AccountScreen(store: widget.store),
    ];

    return Scaffold(
      backgroundColor: NphColors.background,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            NphAppHeader(store: widget.store),
            Expanded(child: IndexedStack(index: _tab, children: panes)),
          ],
        ),
      ),
      bottomNavigationBar: NphBottomNav(
        current: _tab,
        onSelect: (t) => setState(() => _tab = t),
        onAdd: _openAddListing,
      ),
    );
  }
}

/// Persistent navbar: logo left, notifications and profile right.
///
/// `sticky top-0 bg-card/95 backdrop-blur` in the design. Here it is a fixed
/// row above the pane rather than a Material AppBar, so it survives tab
/// switches without each pane re-declaring it.
class NphAppHeader extends ConsumerWidget {
  const NphAppHeader({super.key, required this.store, this.onProfile});

  final Store store;
  final VoidCallback? onProfile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      height: 56,
      padding: const EdgeInsets.symmetric(horizontal: NphSpacing.appPage),
      decoration: const BoxDecoration(color: NphColors.card),
      child: Row(
        children: [
          const NphLogo(size: 34),
          const Spacer(),
          NphIconButton(
            icon: Icons.notifications_none,
            tooltip: 'Notifications',
            badge: true,
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => const NotificationsScreen()),
            ),
          ),
          const SizedBox(width: 2),
          NphIconButton(
            icon: Icons.person_outline,
            tooltip: 'Your profile',
            onPressed: onProfile ??
                () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => AccountScreen(store: store),
                      ),
                    ),
          ),
        ],
      ),
    );
  }
}

/// Five-slot bottom navigation with the raised Add Listing circle.
///
/// The circle is `size-14 rounded-full bg-orange -mt-6 ring-4 ring-card` with
/// `shadow-orange/30`. It overflows the bar upward, so the bar cannot clip its
/// children — hence a Stack with `clipBehavior: none` rather than a
/// BottomNavigationBar, which clips and would shave the top off the circle.
class NphBottomNav extends StatelessWidget {
  const NphBottomNav({
    super.key,
    required this.current,
    required this.onSelect,
    required this.onAdd,
  });

  final int current;
  final ValueChanged<int> onSelect;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: NphColors.card,
        border: Border(top: BorderSide(color: NphColors.border)),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 64,
          // Clip.none is load-bearing: the Add circle is drawn above the top
          // edge of the bar, and the default Clip.hardEdge would shear off its
          // upper half.
          //
          // The circle is a Positioned overlay rather than a Row child on
          // purpose. Transform.translate moves paint but not layout, so a
          // translated 56 px circle plus its 14 px label still measured 70 px
          // inside this 64 px bar and overflowed by 7 — visible as the yellow
          // and black stripes. Taking it out of the flex removes the constraint
          // conflict rather than hiding it.
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _NavItem(
                    icon: Icons.home_outlined,
                    activeIcon: Icons.home,
                    label: 'Home',
                    active: current == 0,
                    onTap: () => onSelect(0),
                  ),
                  _NavItem(
                    icon: Icons.search,
                    activeIcon: Icons.search,
                    label: 'Search',
                    active: current == 1,
                    onTap: () => onSelect(1),
                  ),
                  // Reserves the centre slot so the four real tabs keep even
                  // widths; the circle is painted over it below.
                  const Spacer(),
                  _NavItem(
                    icon: Icons.storefront_outlined,
                    activeIcon: Icons.storefront,
                    label: 'My Store',
                    active: current == 2,
                    onTap: () => onSelect(2),
                  ),
                  _NavItem(
                    icon: Icons.person_outline,
                    activeIcon: Icons.person,
                    label: 'Account',
                    active: current == 3,
                    onTap: () => onSelect(3),
                  ),
                ],
              ),
              Positioned(
                top: -22,
                left: 0,
                right: 0,
                child: Center(child: _AddButton(onTap: onAdd)),
              ),
            ],
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
                style: TextStyle(
                  fontFamily: NphFonts.body,
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  color: colour,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AddButton extends StatelessWidget {
  const _AddButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: NphSize.fabDiameter,
            height: NphSize.fabDiameter,
            decoration: BoxDecoration(
              color: NphColors.orange,
              shape: BoxShape.circle,
              // `ring-4 ring-card` — a white ring separating the circle from
              // whatever scrolls beneath the bar.
              border: Border.all(color: NphColors.card, width: 4),
              boxShadow: [
                BoxShadow(
                  color: NphColors.orange.withValues(alpha: 0.30),
                  blurRadius: 12,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: const Icon(Icons.add, size: 28, color: Colors.white),
          ),
          const SizedBox(height: 4),
          const Text(
            'Add Listing',
            style: TextStyle(
              fontFamily: NphFonts.body,
              fontSize: 10,
              fontWeight: FontWeight.w600,
              color: NphColors.foreground,
            ),
          ),
        ],
      ),
    );
  }
}
