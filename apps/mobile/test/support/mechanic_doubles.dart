import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mocktail/mocktail.dart';
import 'package:naija_parts_hub/models/store.dart';
import 'package:naija_parts_hub/services/auth_service.dart';
import 'package:naija_parts_hub/services/feature_flags_service.dart';
import 'package:naija_parts_hub/services/identity_service.dart';
import 'package:naija_parts_hub/services/image_upload_service.dart';
import 'package:naija_parts_hub/services/store_service.dart';

/// Doubles and fixtures for the mechanic flow.
///
/// Same principle as test_providers.dart: the seams are the hand-written
/// service classes behind Riverpod providers, so these tests replace those and
/// assert presentation and wiring. What they deliberately do NOT claim to
/// prove is anything about authorization — that a pending mechanic cannot be
/// approved, that `identity` is unwritable by a client, that the photo array is
/// capped server-side. Those are properties of firestore.rules and
/// adminReviewStore, asserted against the real Emulator Suite.
class MockStoreService extends Mock implements StoreService {}

class MockIdentityService extends Mock implements IdentityService {}

class MockAuthService extends Mock implements AuthService {}

class MockImageUploadService extends Mock implements ImageUploadService {}

class MockUser extends Mock implements User {}

/// A signed-in user with the fields the app actually reads.
///
/// `uid` must be stubbed even where a test does not care about it: the gate
/// passes it to CrashReporting on every build, and an unstubbed non-nullable
/// getter returns null and throws there rather than where the mistake was.
MockUser mockUser({String uid = 'uid-1', String phone = '+2349053114741'}) {
  final user = MockUser();
  when(() => user.uid).thenReturn(uid);
  when(() => user.phoneNumber).thenReturn(phone);
  return user;
}

/// Registers the fallbacks mocktail needs for `any(named:)` on non-primitives.
///
/// Call once from `setUpAll`. Without it, matching a `BusinessType` or a
/// `List<String>` argument throws at stub time rather than failing an
/// assertion, which reads as a broken test rather than a broken expectation.
void registerMechanicFallbacks() {
  registerFallbackValue(BusinessType.partsDealer);
  registerFallbackValue(<String>[]);
  registerFallbackValue(<String, dynamic>{});
  registerFallbackValue(XFile('fallback.jpg'));
}

/// Stubs every named parameter of `StoreService.register`.
///
/// All fifteen have to be matched or mocktail treats the call as unstubbed and
/// returns null from a non-nullable Future, which surfaces as an unrelated
/// type error three frames away from the cause.
void stubRegister(
  MockStoreService mock, {
  String storeId = 'mechanic-1',
  String slug = 'kunle-auto-works',
  Object? throws,
}) {
  final call = when(
    () => mock.register(
      businessName: any(named: 'businessName'),
      ownerName: any(named: 'ownerName'),
      phone: any(named: 'phone'),
      whatsapp: any(named: 'whatsapp'),
      cacNumber: any(named: 'cacNumber'),
      address: any(named: 'address'),
      state: any(named: 'state'),
      city: any(named: 'city'),
      description: any(named: 'description'),
      email: any(named: 'email'),
      landmark: any(named: 'landmark'),
      automotiveCategory: any(named: 'automotiveCategory'),
      businessType: any(named: 'businessType'),
      specialties: any(named: 'specialties'),
      photos: any(named: 'photos'),
    ),
  );

  if (throws != null) {
    call.thenThrow(throws);
  } else {
    call.thenAnswer((_) async => (storeId: storeId, slug: slug));
  }
}

/// Captures the `businessType` a completed form registered as.
///
/// The single most important regression assertion in this suite: a dealer must
/// keep sending no businessType at all.
BusinessType? capturedBusinessType(MockStoreService mock) {
  final captured = verify(
    () => mock.register(
      businessName: any(named: 'businessName'),
      ownerName: any(named: 'ownerName'),
      phone: any(named: 'phone'),
      whatsapp: any(named: 'whatsapp'),
      cacNumber: any(named: 'cacNumber'),
      address: any(named: 'address'),
      state: any(named: 'state'),
      city: any(named: 'city'),
      description: any(named: 'description'),
      email: any(named: 'email'),
      landmark: any(named: 'landmark'),
      automotiveCategory: any(named: 'automotiveCategory'),
      businessType: captureAny(named: 'businessType'),
      specialties: any(named: 'specialties'),
      photos: any(named: 'photos'),
    ),
  ).captured;
  return captured.isEmpty ? null : captured.single as BusinessType?;
}

/// An upload service that hands back a distinct URL per call, so a test can
/// count photos by their URLs rather than by identical placeholders.
MockImageUploadService workshopUploadDouble() {
  final mock = MockImageUploadService();
  var n = 0;
  when(() => mock.pick(fromCamera: any(named: 'fromCamera')))
      .thenAnswer((_) async => XFile('picked-${n++}.jpg'));
  when(
    () => mock.uploadWorkshopPhoto(
      storeId: any(named: 'storeId'),
      source: any(named: 'source'),
    ),
  ).thenAnswer((_) async => 'https://cdn.example/workshop-$n.jpg');
  when(() => mock.deleteAt(any())).thenAnswer((_) async {});
  return mock;
}

MockAuthService authDouble({String uid = 'uid-1', String phone = '+2349053114741'}) {
  final user = mockUser(uid: uid, phone: phone);

  final auth = MockAuthService();
  when(() => auth.currentUser).thenReturn(user);
  when(() => auth.uid).thenReturn(uid);
  when(() => auth.authStateChanges).thenAnswer((_) => Stream.value(user));
  when(() => auth.signOut()).thenAnswer((_) async {});
  return auth;
}

MockIdentityService identityDouble(IdentityResult result) {
  final mock = MockIdentityService();
  when(
    () => mock.verify(
      bvn: any(named: 'bvn'),
      nin: any(named: 'nin'),
      fullName: any(named: 'fullName'),
    ),
  ).thenAnswer((_) async => result);
  return mock;
}

/// Overrides for anything that touches the mechanic flow.
///
/// [mechanicSignupEnabled] drives `featureFlagsProvider` directly rather than
/// seeding a Firestore document — the provider is the seam, and overriding it
/// keeps these tests off Firebase entirely.
List<Override> mechanicOverrides({
  bool mechanicSignupEnabled = true,
  StoreService? storeService,
  IdentityService? identityService,
  AuthService? authService,
  ImageUploadService? uploadService,
}) {
  return [
    featureFlagsProvider.overrideWith(
      (ref) => Stream.value(FeatureFlags(mechanicSignupEnabled: mechanicSignupEnabled)),
    ),
    storeServiceProvider.overrideWithValue(storeService ?? MockStoreService()),
    identityServiceProvider.overrideWithValue(
      identityService ?? identityDouble(const IdentityResult(IdentityOutcome.verified)),
    ),
    authServiceProvider.overrideWithValue(authService ?? authDouble()),
    imageUploadServiceProvider.overrideWithValue(uploadService ?? workshopUploadDouble()),
  ];
}

/// An approved parts dealer — the shape production has today.
///
/// No `businessType`, no `mechanic` block, no `identity` block, exactly as
/// every store registered before mechanics existed.
Store dealerStore({
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

Store mechanicStore({
  StoreStatus status = StoreStatus.approved,
  IdentityStatus identity = IdentityStatus.verified,
  bool reverificationRequired = false,
  List<String> specialties = const ['engine', 'brakes'],
  List<String> photos = const [],
  String? bvnLast4 = '4821',
  String? ninLast4 = '9930',
}) =>
    Store(
      storeId: 'mechanic-1',
      businessName: 'Kunle Auto Works',
      ownerName: 'Kunle Bakare',
      phone: '+2348022334455',
      whatsapp: '+2348022334455',
      cacNumber: '',
      address: '14 Oshodi Expressway',
      state: 'Lagos',
      city: 'Oshodi',
      description: 'Engine and brake specialists.',
      slug: 'kunle-auto-works',
      status: status,
      visible: true,
      activeListingCount: 0,
      subscription: const Subscription(plan: 'free', status: 'none'),
      businessType: BusinessType.mechanic,
      mechanic: MechanicProfile(specialties: specialties, photos: photos),
      identity: IdentityVerification(
        status: identity,
        bvnLast4: bvnLast4,
        ninLast4: ninLast4,
        nameMatch: identity == IdentityStatus.verified,
        reverificationRequired: reverificationRequired,
      ),
    );
