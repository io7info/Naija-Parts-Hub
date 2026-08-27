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
///
/// Presented as a gallery rather than as a file uploader: a square grid, one
/// consistent thumbnail treatment, a placeholder tile while an upload is in
/// flight, and a count that reads as an allowance rather than as a quota
/// warning.
class MechanicPhotosScreen extends ConsumerStatefulWidget {
  const MechanicPhotosScreen({super.key, required this.store});

  final Store store;

  @override
  ConsumerState<MechanicPhotosScreen> createState() => _MechanicPhotosScreenState();
}

class _MechanicPhotosScreenState extends ConsumerState<MechanicPhotosScreen> {
  late List<String> _photos = [...?widget.store.mechanic?.photos];
  bool _busy = false;

  /// True while a pick+upload is running, so the grid can show the new tile
  /// arriving rather than leaving the screen inert behind a bar at the bottom.
  bool _uploading = false;
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
      _uploading = true;
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
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _confirmRemove(String url) async {
    // A photograph is not trivially replaceable — it was taken in a workshop,
    // on a phone, probably of a job that has since been delivered. One
    // mis-tap on a small close button should not be enough to lose it.
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove this photo?'),
        content: const Text('It will no longer appear on your public profile.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Keep'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: TextButton.styleFrom(foregroundColor: NphColors.error),
            child: const Text('Remove'),
          ),
        ],
      ),
    );

    if (confirmed == true) await _persist([..._photos]..remove(url));
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final atLimit = _photos.length >= maxWorkshopPhotos;
    final working = _busy || _uploading;

    // SingleChildScrollView, not ListView: these panes are short, and a
    // lazy list would leave the lower cards unbuilt until scrolled to —
    // which costs nothing here and quietly changes what exists on screen.
    return SingleChildScrollView(
      padding: const EdgeInsets.all(NphSpacing.appPage),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const NphSectionHeader(title: 'Your work'),
          const SizedBox(height: NphSpacing.xs),
          Text(
            '${_photos.length} of $maxWorkshopPhotos photos. Buyers see these on your profile.',
            style: text.bodySmall,
          ),
          const SizedBox(height: NphSpacing.md),
          _AllowanceBar(used: _photos.length, total: maxWorkshopPhotos),
          const SizedBox(height: NphSpacing.lg),
          if (_photos.isEmpty && !_uploading)
            NphEmptyState(
              icon: Icons.photo_camera_outlined,
              title: 'No work photos yet',
              message: 'Photos of finished jobs are what convince a buyer to call. '
                  'Workshops with photos get far more calls than those without.',
              action: _AddActions(
                enabled: !working,
                onCamera: () => _add(fromCamera: true),
                onGallery: () => _add(fromCamera: false),
              ),
            )
          else
            GridView.count(
              crossAxisCount: 3,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: NphSpacing.sm,
              crossAxisSpacing: NphSpacing.sm,
              children: [
                for (final url in _photos)
                  _PhotoTile(
                    url: url,
                    onRemove: working ? null : () => _confirmRemove(url),
                  ),
                // The incoming photo, in place, so the grid grows as the upload
                // completes instead of a bar appearing somewhere else on screen.
                if (_uploading) const _UploadingTile(),
              ],
            ),
          if (_error != null) ...[
            const SizedBox(height: NphSpacing.md),
            NphNotice(message: _error!),
          ],
          if (_photos.isNotEmpty || _uploading) ...[
            const SizedBox(height: NphSpacing.lg),
            if (!atLimit)
              _AddActions(
                enabled: !working,
                onCamera: () => _add(fromCamera: true),
                onGallery: () => _add(fromCamera: false),
              )
            else
              NphCard(
                color: NphColors.warm,
                border: false,
                padding: const EdgeInsets.all(NphSpacing.md),
                child: Row(
                  children: [
                    const Icon(Icons.check_circle_outline, size: 18, color: NphColors.success),
                    const SizedBox(width: NphSpacing.sm),
                    Expanded(
                      child: Text(
                        'You have reached the maximum of 10 photos. Remove one to add another.',
                        style: text.bodySmall,
                      ),
                    ),
                  ],
                ),
              ),
          ],
          const SizedBox(height: NphSpacing.xl),
        ],
      ),
    );
  }
}

/// How much of the allowance is used, as a strip rather than a number alone.
class _AllowanceBar extends StatelessWidget {
  const _AllowanceBar({required this.used, required this.total});

  final int used;
  final int total;

  @override
  Widget build(BuildContext context) {
    return NphProgressBar(value: total == 0 ? 0 : used / total, height: 6);
  }
}

class _PhotoTile extends StatelessWidget {
  const _PhotoTile({required this.url, required this.onRemove});

  final String url;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: const BorderRadius.all(Radius.circular(NphRadius.md)),
      child: Stack(
        fit: StackFit.expand,
        children: [
          CachedNetworkImage(
            imageUrl: url,
            fit: BoxFit.cover,
            placeholder: (_, __) => const ColoredBox(color: NphColors.muted),
            errorWidget: (_, __, ___) => const ColoredBox(
              color: NphColors.muted,
              child: Icon(
                Icons.broken_image_outlined,
                size: 18,
                color: NphColors.mutedForeground,
              ),
            ),
          ),
          // A scrim behind the control, so the affordance stays visible on a
          // pale photograph — a white close glyph on a white bonnet is a
          // button nobody can find.
          Positioned(
            top: 0,
            right: 0,
            child: Material(
              color: Colors.black.withValues(alpha: 0.55),
              shape: const RoundedRectangleBorder(
                borderRadius: BorderRadius.only(bottomLeft: Radius.circular(NphRadius.md)),
              ),
              child: InkWell(
                onTap: onRemove,
                child: const Padding(
                  padding: EdgeInsets.all(6),
                  child: Icon(Icons.close, size: 15, color: Colors.white),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The placeholder that occupies the slot a photo is arriving into.
class _UploadingTile extends StatelessWidget {
  const _UploadingTile();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: NphColors.muted,
        borderRadius: BorderRadius.all(Radius.circular(NphRadius.md)),
      ),
      alignment: Alignment.center,
      child: const SizedBox(
        height: 22,
        width: 22,
        child: CircularProgressIndicator(strokeWidth: 2, color: NphColors.orange),
      ),
    );
  }
}

/// Camera and Gallery, one pair, used by both the empty state and the grid.
class _AddActions extends StatelessWidget {
  const _AddActions({
    required this.enabled,
    required this.onCamera,
    required this.onGallery,
  });

  final bool enabled;
  final VoidCallback onCamera;
  final VoidCallback onGallery;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: SizedBox(
            height: NphSize.buttonHeight,
            child: FilledButton.icon(
              onPressed: enabled ? onCamera : null,
              icon: const Icon(Icons.photo_camera_outlined, size: 18),
              label: const Text('Camera'),
            ),
          ),
        ),
        const SizedBox(width: NphSpacing.md),
        Expanded(
          child: SizedBox(
            height: NphSize.buttonHeight,
            child: OutlinedButton.icon(
              onPressed: enabled ? onGallery : null,
              icon: const Icon(Icons.photo_library_outlined, size: 18),
              label: const Text('Gallery'),
            ),
          ),
        ),
      ],
    );
  }
}
