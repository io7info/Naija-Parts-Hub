import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:naija_parts_hub/design/theme.dart';
import 'package:naija_parts_hub/features/listings/listing_form_screen.dart';
import 'package:naija_parts_hub/features/shell/main_shell.dart';
import 'package:naija_parts_hub/features/shell/shell_providers.dart';
import 'package:naija_parts_hub/models/listing.dart';
import 'package:naija_parts_hub/models/store.dart';
import 'package:naija_parts_hub/services/categories_service.dart';

import '../support/test_providers.dart';

/// Add / Edit Listing form behaviour.
///
/// Validation, the category requirement, the image cap and the unsaved-work
/// guard are asserted here. What is deliberately NOT asserted is anything about
/// *authorisation* — that a dealer cannot write another store's listing is a
/// property of firestore.rules, and a widget test with a mocked service would
/// pass no matter how open the rules were. Those live in firebase/tests.
const _categories = [
  Category(id: 'engine', name: 'Engine', order: 1),
  Category(id: 'brake', name: 'Brake', order: 2),
  Category(id: 'filters', name: 'Filters', order: 3),
];

Store _store() => const Store(
      storeId: 'dealer-1',
      businessName: 'Ladipo Auto Spares',
      ownerName: 'Tinuoye Adeyemi',
      phone: '+2349053114741',
      whatsapp: '',
      cacNumber: 'RC-1846352',
      address: '50 Ladipo Market Road',
      state: 'Lagos',
      city: 'Mushin',
      description: '',
      slug: 'ladipo-auto-spares',
      status: StoreStatus.approved,
      visible: true,
      activeListingCount: 0,
      subscription: Subscription(plan: 'free', status: 'none'),
    );

Listing _listing() => const Listing(
      listingId: 'listing-1',
      storeId: 'dealer-1',
      name: 'Toyota Corolla Front Brake Pad',
      description: 'Genuine part.',
      categoryId: 'brake',
      condition: 'used',
      priceKobo: 4500000,
      quantity: 3,
      brand: 'Bosch',
      partNumber: 'TCBP-2017-F',
      compatibleMake: 'Toyota',
      compatibleModel: 'Corolla',
      images: [],
      status: ListingStatus.draft,
      publiclyVisible: false,
    );

List<Override> _overrides() => commonOverrides(categories: _categories);

Widget _wrap(Widget child) => ProviderScope(
      overrides: _overrides(),
      child: MaterialApp(theme: buildNphTheme(), home: child),
    );

/// Targets a bottom-nav tab specifically.
///
/// `find.text('Add Listing')` is ambiguous: the nav label and the Listings
/// empty-state button carry the same words, and an IndexedStack builds every
/// pane — so both are in the tree at once. Scoping to the nav makes the tap
/// deterministic instead of dependent on which pane happens to be built.
Finder navTab(String label) => find.descendant(
      of: find.byType(NphBottomNav),
      matching: find.text(label),
    );

void main() {
  setUp(() {
    final view = TestWidgetsFlutterBinding.ensureInitialized().platformDispatcher.views.first;
    view.devicePixelRatio = 1.0;
    view.physicalSize = const Size(400, 1400); // tall, so the whole form builds
  });

  tearDown(() {
    final view = TestWidgetsFlutterBinding.ensureInitialized().platformDispatcher.views.first;
    view.resetPhysicalSize();
    view.resetDevicePixelRatio();
  });

  group('required fields', () {
    testWidgets('blank form does not submit and names what is missing', (tester) async {
      await tester.pumpWidget(_wrap(const ListingFormScreen(storeId: 'dealer-1')));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Save as draft'));
      await tester.pumpAndSettle();

      expect(find.text('Part name is required'), findsOneWidget);
      expect(find.text('Choose a category'), findsOneWidget);
      expect(find.text('Enter a price'), findsOneWidget);
    });

    testWidgets('category has no default, it must be chosen deliberately', (tester) async {
      await tester.pumpWidget(_wrap(const ListingFormScreen(storeId: 'dealer-1')));
      await tester.pumpAndSettle();

      // The old form defaulted to 'engine', which made mis-categorising a part
      // the path of least resistance.
      expect(find.text('Select category'), findsOneWidget);
      expect(find.text('Engine'), findsNothing);
    });

    testWidgets('categories come from Firestore, including filters', (tester) async {
      await tester.pumpWidget(_wrap(const ListingFormScreen(storeId: 'dealer-1')));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Select category'));
      await tester.pumpAndSettle();

      // 'filters' existed in Firestore but was missing from the old hardcoded
      // list, so no dealer could ever list a filter.
      expect(find.text('Filters').last, findsOneWidget);
    });
  });

  group('price and quantity', () {
    Future<void> fillName(WidgetTester tester) async {
      await tester.enterText(find.byType(TextFormField).first, 'Brake pad');
    }

    testWidgets('shows the naira prefix on the price field', (tester) async {
      await tester.pumpWidget(_wrap(const ListingFormScreen(storeId: 'dealer-1')));
      await tester.pumpAndSettle();

      expect(find.text('₦ '), findsOneWidget);
    });

    testWidgets('rejects a zero price', (tester) async {
      await tester.pumpWidget(_wrap(const ListingFormScreen(storeId: 'dealer-1')));
      await tester.pumpAndSettle();

      await fillName(tester);
      await tester.enterText(find.widgetWithText(TextFormField, '0'), '0');
      await tester.tap(find.text('Save as draft'));
      await tester.pumpAndSettle();

      expect(find.textContaining('Price must be more than'), findsOneWidget);
    });

    testWidgets('rejects a zero quantity', (tester) async {
      await tester.pumpWidget(_wrap(const ListingFormScreen(storeId: 'dealer-1')));
      await tester.pumpAndSettle();

      await fillName(tester);
      await tester.enterText(find.widgetWithText(TextFormField, '1'), '0');
      await tester.tap(find.text('Save as draft'));
      await tester.pumpAndSettle();

      expect(find.text('Must be at least 1'), findsOneWidget);
    });
  });

  group('photos', () {
    testWidgets('offers Camera and Gallery while under the cap', (tester) async {
      await tester.pumpWidget(_wrap(const ListingFormScreen(storeId: 'dealer-1')));
      await tester.pumpAndSettle();

      expect(find.text('Photos (0/3)'), findsOneWidget);
      expect(find.text('Camera'), findsOneWidget);
      expect(find.text('Gallery'), findsOneWidget);
    });

    testWidgets('the cap matches the rules, not the design mockup', (tester) async {
      await tester.pumpWidget(_wrap(const ListingFormScreen(storeId: 'dealer-1')));
      await tester.pumpAndSettle();

      // firestore.rules enforces `d.images.size() <= 3`. The mockup says six; a
      // six-slot form would be rejected by the server on save.
      expect(find.textContaining('/3'), findsOneWidget);
      expect(find.textContaining('/6'), findsNothing);
    });
  });

  group('edit mode', () {
    testWidgets('prefills every field from the existing listing', (tester) async {
      await tester.pumpWidget(
        _wrap(ListingFormScreen(storeId: 'dealer-1', existing: _listing())),
      );
      await tester.pumpAndSettle();

      expect(find.text('Toyota Corolla Front Brake Pad'), findsOneWidget);
      expect(find.text('45000'), findsOneWidget); // 4500000 kobo -> naira
      // findsWidgets, not findsOneWidget: several of these values happen to
      // match their own field's placeholder, so the value and the hint are both
      // in the tree.
      expect(find.text('Bosch'), findsWidgets);
      expect(find.text('TCBP-2017-F'), findsWidgets);
      expect(find.text('Corolla'), findsWidgets);
      expect(find.text('Brake'), findsWidgets); // category resolved to its name
    });

    testWidgets('shows Edit Listing, not Add New Listing', (tester) async {
      await tester.pumpWidget(
        _wrap(ListingFormScreen(storeId: 'dealer-1', existing: _listing())),
      );
      await tester.pumpAndSettle();

      expect(find.text('Edit Listing'), findsWidgets);
    });

    testWidgets('an already-active listing offers Save changes, not Publish', (tester) async {
      const active = Listing(
        listingId: 'listing-1',
        storeId: 'dealer-1',
        name: 'Live part',
        description: '',
        categoryId: 'brake',
        condition: 'new',
        priceKobo: 100000,
        quantity: 1,
        brand: '',
        partNumber: '',
        compatibleMake: '',
        compatibleModel: '',
        images: [],
        status: ListingStatus.active,
        publiclyVisible: true,
      );

      await tester.pumpWidget(
        _wrap(const ListingFormScreen(storeId: 'dealer-1', existing: active)),
      );
      await tester.pumpAndSettle();

      expect(find.text('Save changes'), findsOneWidget);
      expect(find.text('Publish listing'), findsNothing);
    });
  });

  group('unsaved-work guard', () {
    testWidgets('typing marks the embedded form dirty', (tester) async {
      late WidgetRef captured;

      await tester.pumpWidget(
        ProviderScope(
          overrides: _overrides(),
          child: MaterialApp(
            theme: buildNphTheme(),
            // Scaffold, because the embedded pane relies on the shell's
            // Material ancestor for its InkWells; it is never mounted bare.
            home: Scaffold(
              body: Consumer(
                builder: (context, ref, _) {
                  captured = ref;
                  return const ListingFormScreen(storeId: 'dealer-1', embedded: true);
                },
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(captured.read(listingFormDirtyProvider), isFalse);

      await tester.enterText(find.byType(TextFormField).first, 'Brake pad');
      await tester.pump();

      // The shell reads this to decide whether leaving needs confirming.
      // Switching tabs is not a route pop, so PopScope cannot cover it.
      expect(captured.read(listingFormDirtyProvider), isTrue);
    });

    testWidgets('leaving a dirty Add pane asks before discarding', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: _overrides(),
          child: MaterialApp(theme: buildNphTheme(), home: MainShell(store: _store())),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(navTab('Add Listing'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField).first, 'Half-typed part');
      await tester.pump();

      await tester.tap(navTab('Home'));
      await tester.pumpAndSettle();

      expect(find.text('Discard this listing?'), findsOneWidget);
      expect(find.text('Keep editing'), findsOneWidget);
    });

    testWidgets('Keep editing stays on the form with the text intact', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: _overrides(),
          child: MaterialApp(theme: buildNphTheme(), home: MainShell(store: _store())),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(navTab('Add Listing'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField).first, 'Half-typed part');
      await tester.pump();

      await tester.tap(navTab('Home'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Keep editing'));
      await tester.pumpAndSettle();

      expect(find.text('Half-typed part'), findsOneWidget,
          reason: 'cancelling the prompt must not throw the work away');
    });

    testWidgets('a clean form leaves without prompting', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: _overrides(),
          child: MaterialApp(theme: buildNphTheme(), home: MainShell(store: _store())),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(navTab('Add Listing'));
      await tester.pumpAndSettle();
      await tester.tap(navTab('Home'));
      await tester.pumpAndSettle();

      // Prompting on an untouched form would train dealers to dismiss the
      // warning without reading it.
      expect(find.text('Discard this listing?'), findsNothing);
    });
  });
}
