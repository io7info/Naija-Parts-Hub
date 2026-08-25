import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../design/components.dart';
import '../../design/tokens.dart';
import '../../models/store.dart';
import '../../services/image_upload_service.dart';
import '../../services/store_service.dart';
import '../registration/mechanic_registration_screen.dart' show maxWorkshopPhotos;

/// Managing the workshop gallery after approval.
///
/// The photographs are the whole of a mechanic's shopfront — there is no
/// inventory to browse, so this is what a buyer judges them on. Hence a tab of
/// its own rather than a section buried in the profile.
class MechanicPhotosScreen extends ConsumerStatefulWidget {
  const MechanicPhotosScreen({super.key, required this.store});

  final Store store;

  @override
  ConsumerState<MechanicPhotosScreen> createState() => _MechanicPhotosScreenState();
}

class _MechanicPhotosScreenState extends ConsumerState<MechanicPhotosScreen> {
  late List<String> _photos = [...?widget.store.mechanic?.photos];
  bool _busy = false;
  String? _error;

  /// Writes the whole array back.
  ///
  /// The rules cap it at MAX_WORKSHOP_PHOTOS, so a client that tried to send
  /// eleven is rejected rather than trusted — the check here is to give a
  /// reason before the write rather than a permission error after it.
  Future<void> _persist(List<String> next) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(storeServiceProvider).updateProfile(widget.store.storeId, {
        'mechanic': {
          'specialties': widget.store.mechanic?.specialties ?? const <String>[],
          'photos': next,
        },
      });
      if (mounted) setState(() => _photos = next);
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _add({required bool fromCamera}) async {
    if (_photos.length >= maxWorkshopPhotos) return;

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final picked = await ref.read(imageUploadServiceProvider).pick(fromCamera: fromCamera);
      if (picked == null) return;

      final url = await ref.read(imageUploadServiceProvider).uploadWorkshopPhoto(
            storeId: widget.store.storeId,
            source: picked,
          );
      await _persist([..._photos, url]);
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final atLimit = _photos.length >= maxWorkshopPhotos;

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const NphSectionHeader(title: 'Your work'),
          const SizedBox(height: 4),
          Text(
            '${_photos.length} of $maxWorkshopPhotos photos. Buyers see these on your profile.',
            style: const TextStyle(color: NphColors.mutedForeground),
          ),
          const SizedBox(height: 16),

          if (_photos.isEmpty)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(24),
              decoration: const BoxDecoration(
                color: NphColors.warm,
                borderRadius: NphRadius.cardBorder,
              ),
              child: const Column(
                children: [
                  Icon(Icons.photo_library_outlined, color: NphColors.mutedForeground),
                  SizedBox(height: 8),
                  Text(
                    'No photos yet. A workshop with photos gets far more calls than one without.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 13, color: NphColors.mutedForeground),
                  ),
                ],
              ),
            )
          else
            GridView.count(
              crossAxisCount: 3,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 8,
              crossAxisSpacing: 8,
              children: [
                for (final url in _photos)
                  Stack(
                    fit: StackFit.expand,
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: CachedNetworkImage(
                          imageUrl: url,
                          fit: BoxFit.cover,
                          placeholder: (_, __) => Container(color: NphColors.muted),
                          errorWidget: (_, __, ___) => Container(
                            color: NphColors.muted,
                            alignment: Alignment.center,
                            child: const Icon(
                              Icons.broken_image_outlined,
                              size: 18,
                              color: NphColors.mutedForeground,
                            ),
                          ),
                        ),
                      ),
                      Positioned(
                        top: 2,
                        right: 2,
                        child: InkWell(
                          onTap: _busy
                              ? null
                              : () => _persist([..._photos]..remove(url)),
                          child: const CircleAvatar(
                            radius: 12,
                            backgroundColor: Colors.black54,
                            child: Icon(Icons.close, size: 14, color: Colors.white),
                          ),
                        ),
                      ),
                    ],
                  ),
              ],
            ),

          const SizedBox(height: 16),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Text(_error!, style: const TextStyle(color: NphColors.error, fontSize: 13)),
            ),
          if (_busy)
            const Padding(
              padding: EdgeInsets.only(bottom: 10),
              child: LinearProgressIndicator(),
            ),

          if (!atLimit)
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _busy ? null : () => _add(fromCamera: true),
                    icon: const Icon(Icons.photo_camera_outlined),
                    label: const Text('Camera'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _busy ? null : () => _add(fromCamera: false),
                    icon: const Icon(Icons.photo_library_outlined),
                    label: const Text('Gallery'),
                  ),
                ),
              ],
            )
          else
            const Text(
              'You have reached the maximum of 10 photos. Remove one to add another.',
              style: TextStyle(fontSize: 12, color: NphColors.mutedForeground),
            ),
        ],
      ),
    );
  }
}
