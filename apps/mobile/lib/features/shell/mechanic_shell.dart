import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../design/tokens.dart';
import '../../models/store.dart';
import '../account/account_screen.dart';
import '../mechanic/mechanic_profile_screen.dart';
import '../mechanic/mechanic_photos_screen.dart';

/// The approved mechanic's app.
///
/// A separate shell rather than MainShell with tabs hidden. MainShell is built
/// around inventory — Home surfaces listing counts, Listings and Add Listing
/// are two of its four tabs, and My Store leads with an active-listing quota.
/// Hiding three of those would leave a dealer's app with holes in it, and
/// every future change to MainShell would have to remember mechanics exist.
///
/// Three tabs, because a mechanic has three things to maintain: what they
/// offer, what their work looks like, and their account. There is no fourth.
class MechanicShell extends ConsumerStatefulWidget {
  const MechanicShell({super.key, required this.store});

  final Store store;

  @override
  ConsumerState<MechanicShell> createState() => _MechanicShellState();
}

class _MechanicShellState extends ConsumerState<MechanicShell> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    final store = widget.store;

    // IndexedStack, matching MainShell: switching tabs must not rebuild a pane
    // and lose a half-edited profile or an in-flight photo upload.
    final panes = [
      MechanicProfileScreen(store: store),
      MechanicPhotosScreen(store: store),
      AccountScreen(store: store),
    ];

    return Scaffold(
      backgroundColor: NphColors.background,
      body: SafeArea(
        bottom: false,
        child: IndexedStack(index: _tab, children: panes),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.build_outlined),
            selectedIcon: Icon(Icons.build),
            label: 'My Workshop',
          ),
          NavigationDestination(
            icon: Icon(Icons.photo_library_outlined),
            selectedIcon: Icon(Icons.photo_library),
            label: 'Photos',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: 'Account',
          ),
        ],
      ),
    );
  }
}
