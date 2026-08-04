import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'hive_service.dart';
import '../models/part.dart';
import '../models/sale.dart';
import '../models/debt.dart';

/// Single shared database (Firestore) used by every shop, every platform
/// (Android / iOS / Web) and the Super Admin web panel.
///
/// Firestore structure:
///   shops/{shopId}                      -> shop profile, tier, verified
///   shops/{shopId}/parts/{partId}        -> Part
///   shops/{shopId}/sales/{saleId}        -> Sale
///   shops/{shopId}/debts/{debtId}        -> Debt
///
/// The Super Admin panel reads across all shops/{shopId} docs using a
/// collectionGroup query, e.g. FirebaseFirestore.instance
///   .collectionGroup('parts').where('shopId', isEqualTo: ...)
class FirebaseService {
  static final _db = FirebaseFirestore.instance;
  static final _auth = FirebaseAuth.instance;
  static StreamSubscription? _connectivitySub;

  static String? get currentShopId => _auth.currentUser?.uid;

  /// Call once at app startup, after HiveService.init() and Firebase.initializeApp().
  static void startAutoSync() {
    _connectivitySub?.cancel();
    _connectivitySub =
        Connectivity().onConnectivityChanged.listen((results) async {
      final isOnline = !results.contains(ConnectivityResult.none);
      if (isOnline) {
        await syncNow();
      }
    });
  }

  static void stopAutoSync() => _connectivitySub?.cancel();

  /// Pushes every unsynced local record up to Firestore.
  /// Safe to call repeatedly — it only touches records where synced == false.
  static Future<void> syncNow() async {
    final shopId = currentShopId;
    if (shopId == null) return;

    try {
      for (final part in HiveService.unsyncedParts()) {
        await _db
            .collection('shops')
            .doc(shopId)
            .collection('parts')
            .doc(part.id)
            .set(part.toFirestore());
        part.synced = true;
        await part.save();
      }

      for (final sale in HiveService.unsyncedSales()) {
        await _db
            .collection('shops')
            .doc(shopId)
            .collection('sales')
            .doc(sale.id)
            .set(sale.toFirestore());
        sale.synced = true;
        await sale.save();
      }

      for (final debt in HiveService.unsyncedDebts()) {
        await _db
            .collection('shops')
            .doc(shopId)
            .collection('debts')
            .doc(debt.id)
            .set(debt.toFirestore());
        debt.synced = true;
        await debt.save();
      }
    } catch (e) {
      // Sync failures are expected when offline — just retry on next
      // connectivity change or app open. Don't crash the app.
      // ignore: avoid_print
      print('Sync error (will retry): $e');
    }
  }

  /// Pulls the latest shop data down from Firestore into Hive.
  /// Useful on first login / new device setup, so a dealer's stock shows
  /// up even on a fresh phone before they've added anything locally.
  static Future<void> pullShopData(String shopId) async {
    final partsSnap =
        await _db.collection('shops').doc(shopId).collection('parts').get();
    for (final doc in partsSnap.docs) {
      if (HiveService.parts.get(doc.id) == null) {
        await HiveService.parts.put(doc.id, Part.fromFirestore(doc.data()));
      }
    }

    final salesSnap =
        await _db.collection('shops').doc(shopId).collection('sales').get();
    for (final doc in salesSnap.docs) {
      if (HiveService.sales.get(doc.id) == null) {
        await HiveService.sales.put(doc.id, Sale.fromFirestore(doc.data()));
      }
    }

    final debtsSnap =
        await _db.collection('shops').doc(shopId).collection('debts').get();
    for (final doc in debtsSnap.docs) {
      if (HiveService.debts.get(doc.id) == null) {
        await HiveService.debts.put(doc.id, Debt.fromFirestore(doc.data()));
      }
    }
  }

  /// Phone number OTP auth (matches the developer spec: "Auth: Phone number only")
  static Future<void> sendOtp(
    String phoneNumber, {
    required void Function(String verificationId) codeSent,
    required void Function(String error) onError,
  }) async {
    await _auth.verifyPhoneNumber(
      phoneNumber: phoneNumber,
      verificationCompleted: (credential) async {
        await _auth.signInWithCredential(credential);
      },
      verificationFailed: (e) => onError(e.message ?? 'Verification failed'),
      codeSent: (verificationId, resendToken) => codeSent(verificationId),
      codeAutoRetrievalTimeout: (_) {},
    );
  }

  static Future<UserCredential> confirmOtp(
      String verificationId, String smsCode) {
    final credential = PhoneAuthProvider.credential(
      verificationId: verificationId,
      smsCode: smsCode,
    );
    return _auth.signInWithCredential(credential);
  }
}
