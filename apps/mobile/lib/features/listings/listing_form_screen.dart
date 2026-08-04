import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/errors.dart';
import '../../design/widgets.dart';
import '../../models/listing.dart';
import '../../services/image_upload_service.dart';
import '../../services/listing_service.dart';
import '../../services/sync_status_service.dart';

/// Create a listing (SOW section 4).
///
/// FUNCTIONAL SCAFFOLD — no final styling.
///
/// Images upload to Firebase Storage at pick time, so the saved document holds
/// a real download URL rather than a device-local path.
class ListingFormScreen extends ConsumerStatefulWidget {
  const ListingFormScreen({super.key, required this.storeId});

  final String storeId;

  @override
  ConsumerState<ListingFormScreen> createState() => _ListingFormScreenState();
}

class _ListingFormScreenState extends ConsumerState<ListingFormScreen> {
  final _formKey = GlobalKey<FormState>();

  final _name = TextEditingController();
  final _description = TextEditingController();
  final _price = TextEditingController();
  final _quantity = TextEditingController(text: '1');
  final _brand = TextEditingController();
  final _partNumber = TextEditingController();
  final _make = TextEditingController();
  final _model = TextEditingController();

  String _category = 'engine';
  String _condition = 'new';
  final List<ListingImage> _images = [];
  final List<XFile> _localPreviews = [];

  bool _busy = false;
  double? _uploadProgress;
  String? _error;

  // Placeholder taxonomy. The real one is admin-managed (SOW §9) and read from
  // the `categories` collection once seeded.
  static const _categories = [
    'engine', 'brake', 'suspension', 'electrical', 'body', 'transmission', 'other',
  ];

  @override
  void dispose() {
    for (final c in [
      _name, _description, _price, _quantity, _brand, _partNumber, _make, _model,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _addImage({required bool fromCamera}) async {
    if (_images.length >= ImageUploadService.maxImages) return;

    final service = ref.read(imageUploadServiceProvider);
    final picked = await service.pick(fromCamera: fromCamera);
    if (picked == null) return;

    setState(() {
      _localPreviews.add(picked);
      _uploadProgress = 0;
    });

    try {
      // Uploaded under a provisional listing id, then the draft is created with
      // the resulting URLs. Slightly more orphan-prone than uploading after
      // save, but it keeps the dealer from waiting on the network at submit.
      final image = await service.upload(
        storeId: widget.storeId,
        listingId: 'drafts',
        source: picked,
        onProgress: (p) {
          if (mounted) setState(() => _uploadProgress = p);
        },
      );
      if (mounted) setState(() => _images.add(image));
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = 'Image upload failed. ${friendlyError(e)}';
          _localPreviews.remove(picked);
        });
      }
    } finally {
      if (mounted) setState(() => _uploadProgress = null);
    }
  }

  Future<void> _save({required bool publish}) async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      final service = ref.read(listingServiceProvider);

      // Naira in, kobo stored. Money is never a double.
      final naira = double.tryParse(_price.text.trim()) ?? 0;
      final priceKobo = (naira * 100).round();

      final listingId = await service.createDraft(
        storeId: widget.storeId,
        name: _name.text.trim(),
        categoryId: _category,
        condition: _condition,
        priceKobo: priceKobo,
        quantity: int.tryParse(_quantity.text.trim()) ?? 0,
        description: _description.text.trim(),
        brand: _brand.text.trim(),
        partNumber: _partNumber.text.trim(),
        compatibleMake: _make.text.trim(),
        compatibleModel: _model.text.trim(),
        images: _images,
      );

      if (publish) {
        await service.publish(listingId);
      }

      if (mounted) Navigator.of(context).pop();
    } on PublishRequiresConnection {
      // The draft is already saved locally, so nothing is lost — say so
      // explicitly rather than leaving the dealer wondering.
      if (mounted) setState(() => _error = PublishRequiresConnection.message);
    } on ListingLimitReached catch (e) {
      if (mounted) {
        setState(() => _error = e.isFairUse
            ? 'Fair-use limit reached (${e.limit} active listings).'
            : 'Free plan allows ${e.limit} active listings. '
                'Saved as a draft — upgrade at ${e.upgradeUrl} to publish more.');
      }
    } on StoreNotApproved catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// True when Firestore is serving from cache, i.e. we know we are offline.
  /// Deliberately conservative: an unknown state is treated as online, so the
  /// publish action is never blocked on a false negative.
  bool get _offline =>
      ref.watch(syncStatusProvider).valueOrNull?.state == SyncState.offline;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('New listing')),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              _ImageStrip(
                images: _images,
                previews: _localPreviews,
                progress: _uploadProgress,
                onCamera: () => _addImage(fromCamera: true),
                onGallery: () => _addImage(fromCamera: false),
              ),
              const SizedBox(height: 16),
              _field(_name, 'Product name',
                  validator: (v) =>
                      (v == null || v.trim().isEmpty) ? 'Name is required' : null),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: DropdownButtonFormField<String>(
                  initialValue: _category,
                  decoration: const InputDecoration(labelText: 'Category'),
                  items: _categories
                      .map((c) => DropdownMenuItem(value: c, child: Text(c)))
                      .toList(),
                  onChanged: (v) => setState(() => _category = v ?? 'other'),
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: SegmentedButton<String>(
                  segments: const [
                    ButtonSegment(value: 'new', label: Text('New')),
                    ButtonSegment(value: 'used', label: Text('Used')),
                  ],
                  selected: {_condition},
                  onSelectionChanged: (s) => setState(() => _condition = s.first),
                ),
              ),
              _field(_price, 'Price (₦)',
                  keyboard: const TextInputType.numberWithOptions(decimal: true),
                  validator: (v) {
                    final parsed = double.tryParse((v ?? '').trim());
                    if (parsed == null) return 'Enter a price';
                    if (parsed < 0) return 'Price cannot be negative';
                    return null;
                  }),
              _field(_quantity, 'Quantity', keyboard: TextInputType.number),
              _field(_brand, 'Brand / manufacturer'),
              _field(_partNumber, 'Part number / SKU'),
              _field(_make, 'Compatible make'),
              _field(_model, 'Compatible model'),
              _field(_description, 'Description', maxLines: 3),
              const SizedBox(height: 16),

              // Publishing is online-only: the active-listing limit can only be
              // enforced by the server-side transaction. Rather than let the
              // dealer tap and fail, the action is disabled while we know we
              // are offline and the reason is stated up front.
              if (_offline)
                const Padding(
                  padding: EdgeInsets.only(bottom: 8),
                  child: Text(
                    'Internet connection required to publish. '
                    'You can still save this as a draft.',
                    style: TextStyle(fontSize: 12, color: Colors.black54),
                  ),
                ),
              // Above the buttons: below them it scrolled off the bottom, which
              // hid the listing-limit message telling a dealer why their part
              // saved as a draft instead of publishing.
              if (_error != null) ...[
                NphNotice(message: _error!),
                const SizedBox(height: 12),
              ],
              FilledButton(
                onPressed: (_busy || _offline) ? null : () => _save(publish: true),
                child: const Text('Save & publish'),
              ),
              const SizedBox(height: 8),
              OutlinedButton(
                onPressed: _busy ? null : () => _save(publish: false),
                child: const Text('Save as draft'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _field(
    TextEditingController controller,
    String label, {
    String? Function(String?)? validator,
    TextInputType? keyboard,
    int maxLines = 1,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: TextFormField(
        controller: controller,
        validator: validator,
        keyboardType: keyboard,
        maxLines: maxLines,
        decoration: InputDecoration(labelText: label),
      ),
    );
  }
}

class _ImageStrip extends StatelessWidget {
  const _ImageStrip({
    required this.images,
    required this.previews,
    required this.progress,
    required this.onCamera,
    required this.onGallery,
  });

  final List<ListingImage> images;
  final List<XFile> previews;
  final double? progress;
  final VoidCallback onCamera;
  final VoidCallback onGallery;

  @override
  Widget build(BuildContext context) {
    final full = previews.length >= ImageUploadService.maxImages;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Photos (${images.length}/${ImageUploadService.maxImages})',
            style: const TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        SizedBox(
          height: 88,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: [
              for (final p in previews)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Image.file(File(p.path), width: 88, height: 88, fit: BoxFit.cover),
                  ),
                ),
              if (!full) ...[
                _AddButton(icon: Icons.camera_alt, label: 'Camera', onTap: onCamera),
                const SizedBox(width: 8),
                _AddButton(icon: Icons.photo_library, label: 'Gallery', onTap: onGallery),
              ],
            ],
          ),
        ),
        if (progress != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: LinearProgressIndicator(value: progress),
          ),
      ],
    );
  }
}

class _AddButton extends StatelessWidget {
  const _AddButton({required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        width: 88,
        height: 88,
        decoration: BoxDecoration(
          border: Border.all(color: Colors.black26),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 22),
            const SizedBox(height: 4),
            Text(label, style: const TextStyle(fontSize: 11)),
          ],
        ),
      ),
    );
  }
}
