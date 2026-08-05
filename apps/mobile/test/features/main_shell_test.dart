import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:naija_parts_hub/design/theme.dart';
import 'package:naija_parts_hub/features/shell/main_shell.dart';
import 'package:naija_parts_hub/models/listing.dart';
import 'package:naija_parts_hub/models/store.dart';
import 'package:naija_parts_hub/services/categories_service.dart';
import 'package:naija_parts_hub/services/listing_service.dart';
import 'package:naija_parts_hub/services/sync_status_service.dart';

/// Shell rendering and navigation.
///
/// Pumps the real MainShell with the Firebase-backed providers overridden, so
/// these assert what a dealer actually sees and touches. Every failure mode
/// covered here has happened at least once: a nav bar whose selection did not
/// follow the pane, a header that laid out at zero height, and a shell that
/// threw during hit testing — which drops the pointer event and makes the whole
/// screen unresponsive rather than failing visibly.
Store _store({
  StoreStatus status = StoreStatus.approved,
  int activeListingCount = 0,
}) =>
    Store(
      storeId: 'dealer-1',
      businessName: 'Ladipo Auto Spares',
      ownerName: 'Tinuoye Adeyemi',
      phone: '+2349053114741',
      whatsapp: '+2349053114741',
      cacNumber: 'RC-1846352',
      address: '50 Ladipo Market Road',
      state: 'Lagos',
      city: 'Mushin',
      description: 'Genuine parts.',
      slug: 'ladipo-auto-spares',
      status: status,
      visible: true,
      activeListingCount: activeListingCount,
      subscription: const Subscription(plan: 'free', status: 'none'),
    );

Widget _app(Store store, {List<Override> overrides = const []}) {
  return ProviderScope(
    overrides: [
      myListingsProvider.overrideWith((ref) => Stream.value(const <Listing>[])),
      categoriesProvider.overrideWith((ref) => Stream.value(const <Category>[])),
      syncStatusProvider.overrideWith(
        (ref) => Stream.value(
          const SyncSnapshot(state: SyncState.synced, pendingCount: 0),
        ),
      ),
      ...overrides,
    ],
    child: MaterialApp(
      theme: buildNphTheme(),
      home: MainShell(store: store),
    ),
  );
}

void main() {
  // The default test surface is 800x600 logical — wider and much shorter than
  // any phone. On it, ListView never builds the lower half of a screen, so
  // finders miss content that is present on a real device, and short viewports
  // produce overflows that do not occur in the field. 400x900 is a Medium Phone
  // in logical pixels.
  setUp(() {
    final view = TestWidgetsFlutterBinding.ensureInitialized().platformDispatcher.views.first;
    view.devicePixelRatio = 1.0;
    view.physicalSize = const Size(400, 900);
  });

  tearDown(() {
    final view = TestWidgetsFlutterBinding.ensureInitialized().platformDispatcher.views.first;
    view.resetPhysicalSize();
    view.resetDevicePixelRatio();
  });

  /// Scrolls a pane until [finder] is on screen.
  ///
  /// Dashboard and Account are taller than any phone, so asserting on their
  /// lower sections means scrolling — a plain find.text would report "missing"
  /// for content a dealer only has to scroll to reach.
  Future<void> scrollTo(WidgetTester tester, Finder finder) async {
    await tester.scrollUntilVisible(
      finder,
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
  }

  group('shell renders', () {
    testWidgets('lays out header, panes and nav without throwing', (tester) async {
      await tester.pumpWidget(_app(_store()));
      await tester.pump();

      expect(tester.takeException(), isNull);
      expect(find.byType(NphAppHeader), findsOneWidget);
      expect(find.byType(NphBottomNav), findsOneWidget);
    });

    testWidgets('the header has real height — a 0 px header hides the logo', (tester) async {
      await tester.pumpWidget(_app(_store()));
      await tester.pump();

      final size = tester.getSize(find.byType(NphAppHeader));
      expect(size.height, greaterThan(0),
          reason: 'a collapsed header renders nothing and swallows its taps');
      expect(size.width, greaterThan(0));
    });

    testWidgets('shows all five navigation labels', (tester) async {
      await tester.pumpWidget(_app(_store()));
      await tester.pump();

      for (final label in ['Home', 'Listings', 'Add Listing', 'My Store', 'Account']) {
        expect(find.text(label), findsWidgets, reason: '$label tab is missing');
      }
    });

    testWidgets('opens on Home, not on a buyer marketplace feed', (tester) async {
      await tester.pumpWidget(_app(_store()));
      await tester.pump();

      // Dashboard content, which only Home renders.
      expect(find.text('Active Listings'), findsOneWidget);
      expect(find.text('Free Plan'), findsOneWidget);
      await scrollTo(tester, find.text('Quick Actions'));
      expect(find.text('Quick Actions'), findsOneWidget);
      // Buyer-marketplace sections must not be reachable in Phase 1.
      expect(find.text('Popular Categories'), findsNothing);
      expect(find.text('Verified Stores Near You'), findsNothing);
    });
  });

  group('bottom navigation', () {
    testWidgets('every nav item is hit-testable', (tester) async {
      await tester.pumpWidget(_app(_store()));
      await tester.pump();

      // hitTestable() is the assertion that matters: a widget can be found and
      // still be untappable if it sits outside its parent's bounds, which is
      // exactly what a negatively-positioned Stack child does.
      for (final label in ['Home', 'Listings', 'My Store', 'Account']) {
        expect(
          find.text(label).hitTestable(),
          findsOneWidget,
          reason: '$label is rendered but cannot receive a tap',
        );
      }
    });

    testWidgets('the raised Add Listing button is hit-testable', (tester) async {
      await tester.pumpWidget(_app(_store()));
      await tester.pump();

      expect(
        find.text('Add Listing').hitTestable(),
        findsOneWidget,
        reason: 'the centre circle overflows the bar and is easy to make untappable',
      );
    });

    testWidgets('tapping Listings selects the Listings pane', (tester) async {
      await tester.pumpWidget(_app(_store()));
      await tester.pump();

      await tester.tap(find.text('Listings'));
      await tester.pumpAndSettle();

      expect(find.text('My Listings'), findsWidgets);
    });

    testWidgets('tapping My Store selects the My Store pane', (tester) async {
      await tester.pumpWidget(_app(_store()));
      await tester.pump();

      await tester.tap(find.text('My Store'));
      await tester.pumpAndSettle();

      // Top of the pane — no scrolling needed, and unique to My Store.
      expect(find.text('Edit Store Profile'), findsOneWidget);
      expect(find.text('Copy Link'), findsOneWidget);
    });

    testWidgets('tapping Account selects the Account pane', (tester) async {
      await tester.pumpWidget(_app(_store()));
      await tester.pump();

      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();

      expect(find.text('MY STORE'), findsOneWidget);
      await scrollTo(tester, find.text('Delete Account'));
      expect(find.text('Delete Account'), findsOneWidget);
    });

    testWidgets('tapping Add Listing selects the form pane', (tester) async {
      await tester.pumpWidget(_app(_store()));
      await tester.pump();

      await tester.tap(find.text('Add Listing'));
      await tester.pumpAndSettle();

      expect(find.text('Part name'), findsOneWidget);
    });
  });

  group('pane state is preserved', () {
    testWidgets('a half-filled Add Listing form survives a tab round trip', (tester) async {
      await tester.pumpWidget(_app(_store()));
      await tester.pump();

      await tester.tap(find.text('Add Listing'));
      await tester.pumpAndSettle();

      // The first field in the form is Part name. Found by position rather than
      // by label text, because NphField renders the label as a sibling widget,
      // not as content inside the field.
      await tester.enterText(find.byType(TextFormField).first, 'Toyota Corolla Brake Pad');
      await tester.pump();

      // Away and back. An IndexedStack keeps the State; a Navigator per tab
      // would not, which is the bug this guards.
      await tester.tap(find.text('Home'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Add Listing'));
      await tester.pumpAndSettle();

      expect(find.text('Toyota Corolla Brake Pad'), findsOneWidget,
          reason: 'switching tabs must not discard a dealer\'s work');
    });
  });

  group('store status', () {
    testWidgets('a suspended store still renders the shell without throwing', (tester) async {
      await tester.pumpWidget(_app(_store(status: StoreStatus.suspended)));
      await tester.pump();

      expect(tester.takeException(), isNull);
    });
  });
}
