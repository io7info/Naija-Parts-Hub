import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Navigation state for the dealer shell.
///
/// Held in providers rather than in MainShell's State so a screen can move the
/// shell without a callback threaded through every widget between them — the
/// Add Listing pane needs to land the dealer on Listings after publishing, and
/// Quick Actions on the dashboard need to reach Listings and My Store.
///
/// Tab indices are named rather than raw ints. `setState(() => _tab = 2)`
/// scattered across five files is exactly how a nav ends up highlighting the
/// wrong item after a reorder.

/// Panes in the bottom navigation, in display order.
///
/// Add Listing is a real pane, not a pushed route. That is what lets its tab
/// stay selected while the form is open and lets a half-filled form survive a
/// trip to Listings and back — a pushed route would cover the shell entirely,
/// making both impossible.
enum ShellTab { home, listings, addListing, myStore, account }

final shellTabProvider = StateProvider<ShellTab>((_) => ShellTab.home);

/// Which status tab the Listings pane shows.
///
/// Separate from [shellTabProvider] because the Add Listing pane needs to land
/// on a *specific* one: Active after publishing, Drafts after saving a draft.
/// Landing on whatever happened to be selected would leave a dealer looking at
/// an empty Archived tab wondering where their listing went.
enum ListingsTab { active, draft, archived }

final listingsTabProvider = StateProvider<ListingsTab>((_) => ListingsTab.active);

/// True while the Add Listing form holds work the dealer has not saved.
///
/// The shell reads this to decide whether leaving the pane needs confirming.
/// It cannot be inferred from a route, because switching tabs is not a pop —
/// PopScope never fires, which is the trap this provider exists to avoid.
final listingFormDirtyProvider = StateProvider<bool>((_) => false);

/// Bumped to force the Add Listing form to rebuild from scratch.
///
/// A persistent pane keeps its State forever, so after a successful publish the
/// form would otherwise still hold the part that was just published — and the
/// dealer's next listing would start pre-filled with the last one. Keying the
/// widget on this token discards the old State outright, which is more reliable
/// than clearing ten controllers by hand and forgetting the eleventh.
final listingFormResetProvider = StateProvider<int>((_) => 0);

/// Moves the shell, optionally selecting a Listings status tab.
///
/// Clears the dirty flag on the way: every caller reaches this *after* the work
/// is saved, and leaving it set would prompt "discard changes?" on the dealer's
/// next tab tap.
void goToShellTab(WidgetRef ref, ShellTab tab, {ListingsTab? listingsTab}) {
  if (listingsTab != null) {
    ref.read(listingsTabProvider.notifier).state = listingsTab;
  }
  ref.read(listingFormDirtyProvider.notifier).state = false;
  ref.read(shellTabProvider.notifier).state = tab;
}

/// Discards the Add Listing form and returns the shell to [tab].
void resetListingFormAndGo(WidgetRef ref, ShellTab tab, {ListingsTab? listingsTab}) {
  ref.read(listingFormResetProvider.notifier).state++;
  goToShellTab(ref, tab, listingsTab: listingsTab);
}
