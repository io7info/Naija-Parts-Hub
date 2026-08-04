import 'dart:io';

import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart' show getTemporaryDirectory;
import 'package:uuid/uuid.dart';

import '../models/listing.dart';

/// Listing images (SOW section 4: "stored in Firebase Storage instead of local
/// device paths", up to three per product).
///
/// The inherited app kept `img.path` — a cache-directory path the OS can purge,
/// synced to Firestore as a device-local string that meant nothing on any other
/// device, and never actually displayed anywhere. Images now go to Storage at
/// upload time and the document holds a real download URL.
class ImageUploadService {
  ImageUploadService(this._storage, this._picker);

  final FirebaseStorage _storage;
  final ImagePicker _picker;

  static const int maxImages = 3;
  static const int maxDimension = 1200;
  static const int targetQuality = 78;

  Future<XFile?> pick({required bool fromCamera}) => _picker.pickImage(
        source: fromCamera ? ImageSource.camera : ImageSource.gallery,
        maxWidth: maxDimension.toDouble(),
        maxHeight: maxDimension.toDouble(),
        imageQuality: 90, // coarse pass; compress() does the real work
      );

  /// Compresses then uploads. Returns the stored image with its download URL.
  ///
  /// Compression happens before upload rather than in a Cloud Function: dealers
  /// are on metered mobile data, so the saving has to be on the way out of the
  /// device, not after it has already been paid for.
  Future<ListingImage> upload({
    required String storeId,
    required String listingId,
    required XFile source,
    void Function(double progress)? onProgress,
  }) async {
    final compressed = await _compress(source);

    final imageId = const Uuid().v4();
    final path = 'stores/$storeId/listings/$listingId/$imageId.jpg';
    final ref = _storage.ref(path);

    final task = ref.putFile(
      compressed,
      SettableMetadata(contentType: 'image/jpeg'),
    );

    if (onProgress != null) {
      task.snapshotEvents.listen((s) {
        if (s.totalBytes > 0) onProgress(s.bytesTransferred / s.totalBytes);
      });
    }

    final snapshot = await task;
    final url = await snapshot.ref.getDownloadURL();

    return ListingImage(
      path: path,
      url: url,
      sizeBytes: await compressed.length(),
    );
  }

  Future<File> _compress(XFile source) async {
    final dir = await getTemporaryDirectory();
    final target = '${dir.path}/${const Uuid().v4()}.jpg';

    final result = await FlutterImageCompress.compressAndGetFile(
      source.path,
      target,
      quality: targetQuality,
      minWidth: maxDimension,
      minHeight: maxDimension,
      format: CompressFormat.jpeg,
    );

    // Compression can fail on unusual formats; the original still uploads,
    // and the Storage rules enforce the size ceiling regardless.
    return result == null ? File(source.path) : File(result.path);
  }

  Future<void> deleteAt(String path) async {
    try {
      await _storage.ref(path).delete();
    } on FirebaseException {
      // Already gone, or never uploaded. Not worth failing the caller over.
    }
  }
}

final imageUploadServiceProvider = Provider<ImageUploadService>(
  (_) => ImageUploadService(FirebaseStorage.instance, ImagePicker()),
);
