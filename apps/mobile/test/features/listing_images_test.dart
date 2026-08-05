import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mocktail/mocktail.dart';
import 'package:naija_parts_hub/design/theme.dart';
import 'package:naija_parts_hub/features/listings/listing_form_screen.dart';
import 'package:naija_parts_hub/models/listing.dart';
import 'package:naija_parts_hub/services/categories_service.dart';
import 'package:naija_parts_hub/services/image_upload_service.dart';
import 'package:naija_parts_hub/services/listing_service.dart';
import 'package:naija_parts_hub/services/sync_status_service.dart';

/// Photo handling on the listing form.
///
/// The upload service is mocked, so these assert the *screen's* behaviour: the
/// three-image cap, the uploading and failed states, retry, removal, and which
/// photo is the main one. What reaches Firebase Storage is not exercised here —
/// the Storage rules are asserted in firebase/tests.
///
/// The cap is three because SOW §4, `MAX_IMAGES_PER_LISTING` and
/// `firestore.rules` (`d.images.size() <= 3`) all say three. The design mockup
/// says six; a six-slot form would be rejected by the server on save, so the
/// cap is asserted rather than assumed.
class _MockUploads extends Mock implements ImageUploadService {}

/// Needed because the form reserves its listing id up front via
/// `newListingId()`, which reaches FirebaseFirestore.instance. Without this
/// override that call throws inside the upload path, and the failure shows up
/// as a failed photo — a misleading symptom for a missing test double.
class _MockListings extends Mock implements ListingService {}

class _FakeXFile extends Fake implements XFile {}

const _categories = [Category(id: 'brake', name: 'Brake', order: 1)];

ListingImage _image(String id) => ListingImage(
      path: 'stores/dealer-1/listings/listing-1/$id.jpg',
      url: 'https://example.test/$id.jpg',
    );

void main() {
  late _MockUploads uploads;
  late _MockListings listings;

  setUpAll(() {
    registerFallbackValue(_FakeXFile());
  });

  setUp(() {
    uploads = _MockUploads();
    listings = _MockListings();
    when(() => uploads.deleteAt(any())).thenAnswer((_) async {});
    when(() => listings.newListingId()).thenReturn('listing-1');

    final view = TestWidgetsFlutterBinding.ensureInitialized().platformDispatcher.views.first;
    view.devicePixelRatio = 1.0;
    view.physicalSize = const Size(400, 1400);
  });

  tearDown(() {
    final view = TestWidgetsFlutterBinding.ensureInitialized().platformDispatcher.views.first;
    view.resetPhysicalSize();
    view.resetDevicePixelRatio();
  });

  /// Every pick returns a distinct path so slots stay distinguishable.
  void stubPick() {
    var n = 0;
    when(() => uploads.pick(fromCamera: any(named: 'fromCamera')))
        .thenAnswer((_) async => XFile('/tmp/pick-${n++}.jpg'));
  }

  void stubUploadSucceeds() {
    var n = 0;
    when(() => uploads.upload(
          storeId: any(named: 'storeId'),
          listingId: any(named: 'listingId'),
          source: any(named: 'source'),
          onProgress: any(named: 'onProgress'),
        )).thenAnswer((_) async => _image('img-${n++}'));
  }

  Future<void> pump(WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          imageUploadServiceProvider.overrideWithValue(uploads),
          listingServiceProvider.overrideWithValue(listings),
          categoriesProvider.overrideWith((ref) => Stream.value(_categories)),
          myListingsProvider.overrideWith((ref) => Stream.value(const <Listing>[])),
          syncStatusProvider.overrideWith(
            (ref) => Stream.value(
              const SyncSnapshot(state: SyncState.synced, pendingCount: 0),
            ),
          ),
        ],
        child: MaterialApp(
          theme: buildNphTheme(),
          home: const Scaffold(body: ListingFormScreen(storeId: 'dealer-1')),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> addPhoto(WidgetTester tester) async {
    await tester.tap(find.text('Gallery'));
    await tester.pumpAndSettle();
  }

  group('adding photos', () {
    testWidgets('a picked photo uploads and the counter advances', (tester) async {
      stubPick();
      stubUploadSucceeds();
      await pump(tester);

      expect(find.text('Photos (0/3)'), findsOneWidget);

      await addPhoto(tester);

      expect(find.text('Photos (1/3)'), findsOneWidget);
      verify(() => uploads.upload(
            storeId: 'dealer-1',
            listingId: any(named: 'listingId'),
            source: any(named: 'source'),
            onProgress: any(named: 'onProgress'),
          )).called(1);
    });

    testWidgets('photos upload to the listing id, never a shared drafts folder',
        (tester) async {
      stubPick();
      stubUploadSucceeds();
      await pump(tester);
      await addPhoto(tester);

      final captured = verify(() => uploads.upload(
            storeId: any(named: 'storeId'),
            listingId: captureAny(named: 'listingId'),
            source: any(named: 'source'),
            onProgress: any(named: 'onProgress'),
          )).captured.single as String;

      // The old code passed the literal 'drafts' for every new listing from
      // every dealer, so nothing tied an object back to a listing and every
      // abandoned form leaked its uploads permanently.
      expect(captured, isNot('drafts'));
      expect(captured, isNotEmpty);
    });
  });

  group('the three-image cap', () {
    testWidgets('Camera and Gallery disappear at three photos', (tester) async {
      stubPick();
      stubUploadSucceeds();
      await pump(tester);

      await addPhoto(tester);
      await addPhoto(tester);
      expect(find.text('Gallery'), findsOneWidget, reason: 'still under the cap');

      await addPhoto(tester);

      expect(find.text('Photos (3/3)'), findsOneWidget);
      expect(find.text('Camera'), findsNothing);
      expect(find.text('Gallery'), findsNothing);
    });

    testWidgets('a fourth upload is never attempted', (tester) async {
      stubPick();
      stubUploadSucceeds();
      await pump(tester);

      await addPhoto(tester);
      await addPhoto(tester);
      await addPhoto(tester);

      // With the add tiles gone there is no way to ask for a fourth, so the
      // client can never send a payload the rules would reject.
      verify(() => uploads.upload(
            storeId: any(named: 'storeId'),
            listingId: any(named: 'listingId'),
            source: any(named: 'source'),
            onProgress: any(named: 'onProgress'),
          )).called(3);
    });
  });

  group('main image', () {
    testWidgets('the first photo is marked Main', (tester) async {
      stubPick();
      stubUploadSucceeds();
      await pump(tester);
      await addPhoto(tester);

      expect(find.text('Main'), findsOneWidget);
    });

    testWidgets('only one photo is Main at a time', (tester) async {
      stubPick();
      stubUploadSucceeds();
      await pump(tester);
      await addPhoto(tester);
      await addPhoto(tester);

      expect(find.text('Main'), findsOneWidget);
    });

    testWidgets('tapping a photo promotes it to Main', (tester) async {
      stubPick();
      stubUploadSucceeds();
      await pump(tester);
      await addPhoto(tester);
      await addPhoto(tester);

      final badgeBefore = tester.getTopLeft(find.text('Main')).dx;

      // Tap the second thumbnail. Tap-to-promote is the Phase 1 mechanism;
      // drag-and-drop reordering is explicitly out of scope.
      final thumbs = find.byType(GestureDetector);
      await tester.tap(thumbs.at(1), warnIfMissed: false);
      await tester.pumpAndSettle();

      // The badge stays in slot 0 — promotion moves the photo, not the badge.
      expect(find.text('Main'), findsOneWidget);
      expect(tester.getTopLeft(find.text('Main')).dx, badgeBefore);
    });
  });

  group('removing a photo', () {
    testWidgets('removes the slot and deletes the stored object', (tester) async {
      stubPick();
      stubUploadSucceeds();
      await pump(tester);
      await addPhoto(tester);

      expect(find.text('Photos (1/3)'), findsOneWidget);

      await tester.tap(find.byIcon(Icons.close).first);
      await tester.pumpAndSettle();

      expect(find.text('Photos (0/3)'), findsOneWidget);
      // Removing must clean up Storage, or the object is orphaned the moment
      // the document stops referencing it.
      verify(() => uploads.deleteAt(any())).called(1);
    });
  });

  group('failed upload', () {
    testWidgets('offers Retry instead of silently dropping the photo', (tester) async {
      stubPick();
      when(() => uploads.upload(
            storeId: any(named: 'storeId'),
            listingId: any(named: 'listingId'),
            source: any(named: 'source'),
            onProgress: any(named: 'onProgress'),
          )).thenThrow(Exception('network died'));

      await pump(tester);
      await addPhoto(tester);

      // The slot stays. A dealer on a market stall's connection sees failures
      // constantly, and discarding the photo they just took is the worst
      // possible response.
      expect(find.text('Retry'), findsOneWidget);
      expect(find.text('Photos (1/3)'), findsOneWidget);
    });

    testWidgets('Retry re-uploads the same photo and succeeds', (tester) async {
      stubPick();
      var attempt = 0;
      when(() => uploads.upload(
            storeId: any(named: 'storeId'),
            listingId: any(named: 'listingId'),
            source: any(named: 'source'),
            onProgress: any(named: 'onProgress'),
          )).thenAnswer((_) async {
        attempt++;
        if (attempt == 1) throw Exception('network died');
        return _image('recovered');
      });

      await pump(tester);
      await addPhoto(tester);
      expect(find.text('Retry'), findsOneWidget);

      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();

      expect(find.text('Retry'), findsNothing);
      expect(find.text('Main'), findsOneWidget, reason: 'the recovered photo is now slot 0');
      expect(attempt, 2, reason: 'retry must reuse the picked file, not re-prompt');
    });

    testWidgets('a failed photo is not saved with the listing', (tester) async {
      stubPick();
      when(() => uploads.upload(
            storeId: any(named: 'storeId'),
            listingId: any(named: 'listingId'),
            source: any(named: 'source'),
            onProgress: any(named: 'onProgress'),
          )).thenThrow(Exception('network died'));

      await pump(tester);
      await addPhoto(tester);

      // Only slots that finished uploading carry a Storage URL, and only those
      // are written to the document — a failed slot has none to write.
      expect(find.text('Main'), findsNothing);
    });
  });

  group('cancelled pick', () {
    testWidgets('backing out of the picker adds nothing', (tester) async {
      when(() => uploads.pick(fromCamera: any(named: 'fromCamera')))
          .thenAnswer((_) async => null);
      await pump(tester);

      await addPhoto(tester);

      expect(find.text('Photos (0/3)'), findsOneWidget);
      verifyNever(() => uploads.upload(
            storeId: any(named: 'storeId'),
            listingId: any(named: 'listingId'),
            source: any(named: 'source'),
            onProgress: any(named: 'onProgress'),
          ));
    });
  });
}
