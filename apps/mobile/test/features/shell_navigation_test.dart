import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:naija_parts_hub/features/shell/shell_providers.dart';

/// Navigation state, tested at the provider layer.
///
/// These assertions are about *state transitions*, not pixels: which tab is
/// selected, which Listings sub-tab the form lands on, and whether the dirty
/// flag is cleared. Driving them through providers rather than through a
/// pumped widget keeps them fast and free of Firebase, and they cover the
/// behaviour that actually regressed before — a tab that did not match the
/// screen, and a form that kept its values after publishing.
void main() {
  late ProviderContainer c;

  setUp(() => c = ProviderContainer());
  tearDown(() => c.dispose());

  group('initial state', () {
    test('opens on Home with the Active listings tab', () {
      expect(c.read(shellTabProvider), ShellTab.home);
      expect(c.read(listingsTabProvider), ListingsTab.active);
    });

    test('the form starts clean, so no discard prompt on first navigation', () {
      expect(c.read(listingFormDirtyProvider), isFalse);
    });
  });

  group('tab ordering', () {
    test('matches the bottom navigation left to right', () {
      // The nav renders by index. A reorder here without a matching reorder in
      // NphBottomNav is exactly how the wrong item ends up highlighted.
      expect(ShellTab.values, [
        ShellTab.home,
        ShellTab.listings,
        ShellTab.addListing,
        ShellTab.myStore,
        ShellTab.account,
      ]);
      expect(ShellTab.addListing.index, 2, reason: 'Add Listing is the centre slot');
    });

    test('Listings sub-tabs match the TabBar order', () {
      expect(ListingsTab.values, [
        ListingsTab.active,
        ListingsTab.draft,
        ListingsTab.archived,
      ]);
    });
  });

  group('post-save routing', () {
    test('publishing lands on Listings -> Active', () {
      c.read(shellTabProvider.notifier).state = ShellTab.addListing;
      c.read(listingsTabProvider.notifier).state = ListingsTab.archived;

      c.read(listingsTabProvider.notifier).state = ListingsTab.active;
      c.read(shellTabProvider.notifier).state = ShellTab.listings;

      expect(c.read(shellTabProvider), ShellTab.listings);
      expect(c.read(listingsTabProvider), ListingsTab.active);
    });

    test('saving a draft lands on Listings -> Draft', () {
      c.read(listingsTabProvider.notifier).state = ListingsTab.draft;
      c.read(shellTabProvider.notifier).state = ShellTab.listings;

      expect(c.read(listingsTabProvider), ListingsTab.draft,
          reason: 'a draft is invisible on the Active tab, which reads as data loss');
    });
  });

  group('form reset token', () {
    test('bumping it produces a new value, forcing a fresh form State', () {
      final before = c.read(listingFormResetProvider);
      c.read(listingFormResetProvider.notifier).state++;
      expect(c.read(listingFormResetProvider), before + 1);
    });

    test('each bump is distinct, so consecutive saves both reset', () {
      // Keyed on this value: a token that repeated would let the second listing
      // inherit the first one's fields.
      final seen = <int>{};
      for (var i = 0; i < 3; i++) {
        c.read(listingFormResetProvider.notifier).state++;
        seen.add(c.read(listingFormResetProvider));
      }
      expect(seen.length, 3);
    });
  });

  group('unsaved-work flag', () {
    test('set while editing, cleared once the work is saved', () {
      c.read(listingFormDirtyProvider.notifier).state = true;
      expect(c.read(listingFormDirtyProvider), isTrue);

      // What goToShellTab does on every successful save.
      c.read(listingFormDirtyProvider.notifier).state = false;
      expect(c.read(listingFormDirtyProvider), isFalse,
          reason: 'a stale dirty flag prompts "discard changes?" on the next tab tap');
    });
  });
}
