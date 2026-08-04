import 'dart:io';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../design/components.dart';
import '../../design/tokens.dart';
import '../../models/listing.dart';
import '../../services/image_upload_service.dart';
import '../../services/listing_service.dart';
import '../../services/sync_status_service.dart';

/// Add or edit a listing (SOW §4).
///
/// Edit was missing entirely before this: the form only ever created, and
/// `ListingService.updateDraft` had no caller — so a dealer who mistyped a
/// price had to delete and recreate, burning and re-consuming a quota slot.
/// Passing [existing] switches the screen into edit mode.
///
/// Photos are capped at three, not the six the design mockup shows. Three is
/// what SOW §4 specifies, what `MAX_IMAGES_PER_LISTING` declares, and what
/// `firestore.rules` enforces with `d.images.size() <= 3` — a four-image write
/// is rejected by the server, so offering six would build a form that fails on
/// submit.
class ListingFormScreen extends ConsumerStatefulWidget {
  const ListingFormScreen({super.key, required this.storeId, this.existing});

  final String storeId;
  final Listing? existing;

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

  /// Placeholder taxonomy until `categories` is admin-managed (SOW §9).
  static const _categories = [
    'engine',
    'brake',
    'suspension',
    'electrical',
    'body',
    'transmission',
    'other',
  ];

  String _category = 'engine';
  String _condition = 'new';
  final List<ListingImage> _images = [];

  bool _busy = false;
  double? _uploadProgress;
  String? _error;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    final existing = widget.existing;
    if (existing == null) return;

    _name.text = existing.name;
    _description.text = existing.description;
    // Kobo back to naira for display. Integer division keeps whole naira whole
    // rather than rendering "28500.0".
    _price.text = (existing.priceKobo / 100).toStringAsFixed(
      existing.priceKobo % 100 == 0 ? 0 : 2,
    );
    _quantity.text = '${existing.quantity}';
    _brand.text = existing.brand;
    _partNumber.text = existing.partNumber;
    _make.text = existing.compatibleMake;
    _model.text = existing.compatibleModel;
    _category = _categories.contains(existing.categoryId) ? existing.categoryId : 'other';
    _condition = existing.condition == 'used' ? 'used' : 'new';
    _images.addAll(existing.images);
  }

  @override
  void dispose() {
    for (final c in [
      _name, _description, _price, _quantity, _brand, _partNumber, _make, _model,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  /// True only when Firestore is serving from cache — i.e. we know we are
  /// offline. Deliberately conservative: an unknown state counts as online, so
  /// publishing is never blocked by a false negative.
  bool get _offline =>
      ref.watch(syncStatusProvider).valueOrNull?.state == SyncState.offline;

  Future<void> _addImage({required bool fromCamera}) async {
    if (_images.length >= ImageUploadService.maxImages) return;

    final service = ref.read(imageUploadServiceProvider);
    final picked = await service.pick(fromCamera: fromCamera);
    if (picked == null) return;

    setState(() {
      _uploadProgress = 0;
      _error = null;
    });

    try {
      final image = await service.upload(
        storeId: widget.storeId,
        // Uploads land under the listing's own id when editing, and under a
        // per-session drafts folder otherwise. The previous version passed the
        // literal string 'drafts' for every upload from every dealer, so every
        // abandoned form's photos piled into one directory with nothing to tie
        // them back to a listing.
        listingId: widget.existing?.listingId ?? 'drafts',
        source: picked,
        onProgress: (p) {
          if (mounted) setState(() => _uploadProgress = p);
        },
      );
      if (mounted) setState(() => _images.add(image));
    } catch (e) {
      if (mounted) {
        setState(() => _error = 'Image upload failed. ${friendlyError(e)}');
      }
    } finally {
      if (mounted) setState(() => _uploadProgress = null);
    }
  }

  Future<void> _removeImage(int index) async {
    final image = _images[index];
    setState(() => _images.removeAt(index));
    // Best-effort: an orphaned object costs storage, but blocking the dealer on
    // a delete that may fail offline costs them the edit.
    await ref.read(imageUploadServiceProvider).deleteAt(image.path);
  }

  Future<void> _save({required bool publish}) async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() {
      _busy = true;
      _error = null;
    });

    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    final service = ref.read(listingServiceProvider);

    try {
      // Naira in, kobo stored. Money is never a double.
      final naira = double.tryParse(_price.text.trim()) ?? 0;
      final priceKobo = (naira * 100).round();

      final fields = <String, dynamic>{
        'name': _name.text.trim(),
        'description': _description.text.trim(),
        'categoryId': _category,
        'condition': _condition,
        'priceKobo': priceKobo,
        'quantity': int.tryParse(_quantity.text.trim()) ?? 0,
        'brand': _brand.text.trim(),
        'partNumber': _partNumber.text.trim(),
        'compatibleMake': _make.text.trim(),
        'compatibleModel': _model.text.trim(),
        'images': _images.map((i) => i.toMap()).toList(),
      };

      final String listingId;
      if (_isEdit) {
        listingId = widget.existing!.listingId;
        await service.updateDraft(listingId, fields);
      } else {
        listingId = await service.createDraft(
          storeId: widget.storeId,
          name: fields['name'] as String,
          categoryId: _category,
          condition: _condition,
          priceKobo: priceKobo,
          quantity: fields['quantity'] as int,
          description: fields['description'] as String,
          brand: fields['brand'] as String,
          partNumber: fields['partNumber'] as String,
          compatibleMake: fields['compatibleMake'] as String,
          compatibleModel: fields['compatibleModel'] as String,
          images: _images,
        );
      }

      if (publish) await service.publish(listingId);

      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            publish
                ? 'Listing published.'
                : (_isEdit ? 'Changes saved.' : 'Saved as a draft.'),
          ),
        ),
      );
      navigator.pop();
    } on PublishRequiresConnection {
      // The write is already queued locally, so nothing is lost — say so
      // rather than leaving the dealer wondering.
      if (mounted) setState(() => _error = PublishRequiresConnection.message);
    } on ListingLimitReached catch (e) {
      if (mounted) {
        setState(() => _error = e.isFairUse
            ? 'Fair-use limit reached (${e.limit} active listings). '
                'Unpublish one to publish this.'
            : 'Your free plan allows ${e.limit} active listings. '
                'Saved as a draft — upgrade on the website to publish more.');
      }
    } on StoreNotApproved catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final alreadyActive = widget.existing?.status == ListingStatus.active;

    return Scaffold(
      backgroundColor: NphColors.background,
      appBar: AppBar(
        title: Text(_isEdit ? 'Edit Listing' : 'Add New Listing'),
        leading: NphIconButton(
          icon: Icons.arrow_back,
          tooltip: 'Back',
          onPressed: () => Navigator.of(context).maybePop(),
        ),
        shape: const Border(bottom: BorderSide(color: NphColors.border)),
      ),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.all(NphSpacing.appPage),
            children: [
              _photos(),
              const SizedBox(height: NphSpacing.xl),
              NphField(
                label: 'Part name',
                child: TextFormField(
                  controller: _name,
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(
                    hintText: 'e.g. Toyota Corolla Front Brake Pad',
                  ),
                  validator: (v) =>
                      (v == null || v.trim().isEmpty) ? 'Part name is required' : null,
                ),
              ),
              NphField(
                label: 'Category',
                child: DropdownButtonFormField<String>(
                  initialValue: _category,
                  isExpanded: true,
                  items: _categories
                      .map((c) => DropdownMenuItem(
                            value: c,
                            child: Text('${c[0].toUpperCase()}${c.substring(1)}'),
                          ))
                      .toList(),
                  onChanged: (v) => setState(() => _category = v ?? 'other'),
                ),
              ),
              NphField(
                label: 'Condition',
                child: NphSegmented(
                  options: const ['New', 'Used'],
                  value: _condition == 'used' ? 'Used' : 'New',
                  onChanged: (v) => setState(() => _condition = v.toLowerCase()),
                ),
              ),
              NphField(
                label: 'Price',
                child: TextFormField(
                  controller: _price,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(
                    hintText: '0',
                    prefixText: '₦ ',
                    prefixStyle: TextStyle(
                      fontFamily: NphFonts.body,
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: NphColors.mutedForeground,
                    ),
                  ),
                  validator: (v) {
                    final parsed = double.tryParse((v ?? '').trim());
                    if (parsed == null) return 'Enter a price';
                    if (parsed < 0) return 'Price cannot be negative';
                    return null;
                  },
                ),
              ),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: NphField(
                      label: 'Vehicle make',
                      child: TextFormField(
                        controller: _make,
                        textInputAction: TextInputAction.next,
                        decoration: const InputDecoration(hintText: 'Toyota'),
                      ),
                    ),
                  ),
                  const SizedBox(width: NphSpacing.md),
                  Expanded(
                    child: NphField(
                      label: 'Model / year',
                      child: TextFormField(
                        controller: _model,
                        textInputAction: TextInputAction.next,
                        decoration: const InputDecoration(hintText: 'Corolla 2017'),
                      ),
                    ),
                  ),
                ],
              ),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: NphField(
                      label: 'Brand',
                      optional: true,
                      child: TextFormField(
                        controller: _brand,
                        textInputAction: TextInputAction.next,
                        decoration: const InputDecoration(hintText: 'Bosch'),
                      ),
                    ),
                  ),
                  const SizedBox(width: NphSpacing.md),
                  Expanded(
                    child: NphField(
                      label: 'Quantity',
                      child: TextFormField(
                        controller: _quantity,
                        keyboardType: TextInputType.number,
                        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                        textInputAction: TextInputAction.next,
                        decoration: const InputDecoration(hintText: '1'),
                      ),
                    ),
                  ),
                ],
              ),
              NphField(
                label: 'Part number',
                optional: true,
                child: TextFormField(
                  controller: _partNumber,
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(hintText: 'TCBP-2017-F'),
                ),
              ),
              NphField(
                label: 'Description',
                optional: true,
                child: TextFormField(
                  controller: _description,
                  maxLines: 4,
                  maxLength: 2000,
                  decoration: const InputDecoration(
                    hintText: 'Describe the part, its fitment and condition.',
                    counterText: '',
                  ),
                ),
              ),

              if (_offline && !alreadyActive) ...[
                const NphBanner(
                  message: 'Publishing needs a connection — the listing limit can only be '
                      'checked by the server. You can still save a draft.',
                  tone: NphTone.neutral,
                  icon: Icons.cloud_off_outlined,
                ),
                const SizedBox(height: NphSpacing.md),
              ],

              // Above the buttons. Below, it scrolled off the bottom and hid
              // the message explaining why a part saved as a draft.
              if (_error != null) ...[
                NphNotice(message: _error!),
                const SizedBox(height: NphSpacing.md),
              ],

              if (alreadyActive)
                FilledButton(
                  onPressed: _busy ? null : () => _save(publish: false),
                  child: const Text('Save changes'),
                )
              else ...[
                FilledButton(
                  onPressed: (_busy || _offline) ? null : () => _save(publish: true),
                  child: Text(_isEdit ? 'Save & publish' : 'Publish listing'),
                ),
                const SizedBox(height: NphSpacing.sm),
                OutlinedButton(
                  onPressed: _busy ? null : () => _save(publish: false),
                  child: Text(_isEdit ? 'Save changes' : 'Save as draft'),
                ),
              ],
              const SizedBox(height: NphSpacing.xl),
            ],
          ),
        ),
      ),
    );
  }

  Widget _photos() {
    final canAdd = _images.length < ImageUploadService.maxImages;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        NphFieldLabel('Photos (${_images.length}/${ImageUploadService.maxImages})'),
        SizedBox(
          height: 104,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: [
              for (var i = 0; i < _images.length; i++)
                Padding(
                  padding: const EdgeInsets.only(right: NphSpacing.sm),
                  child: _thumb(i),
                ),
              if (canAdd) ...[
                _addTile(
                  icon: Icons.photo_camera_outlined,
                  label: 'Camera',
                  onTap: () => _addImage(fromCamera: true),
                ),
                const SizedBox(width: NphSpacing.sm),
                _addTile(
                  icon: Icons.add_photo_alternate_outlined,
                  label: 'Gallery',
                  onTap: () => _addImage(fromCamera: false),
                ),
              ],
            ],
          ),
        ),
        if (_uploadProgress != null)
          Padding(
            padding: const EdgeInsets.only(top: NphSpacing.sm),
            child: NphProgressBar(value: _uploadProgress!, height: 4),
          ),
      ],
    );
  }

  Widget _thumb(int index) {
    final image = _images[index];
    return SizedBox(
      width: 96,
      height: 96,
      child: Stack(
        children: [
          ClipRRect(
            borderRadius: NphRadius.fieldBorder,
            child: SizedBox(
              width: 96,
              height: 96,
              child: image.url.startsWith('http')
                  ? CachedNetworkImage(
                      imageUrl: image.url,
                      fit: BoxFit.cover,
                      placeholder: (_, __) => Container(color: NphColors.muted),
                      errorWidget: (_, __, ___) => Container(color: NphColors.muted),
                    )
                  : Image.file(File(image.url), fit: BoxFit.cover),
            ),
          ),
          Positioned(
            right: 4,
            top: 4,
            child: InkWell(
              onTap: () => _removeImage(index),
              borderRadius: NphRadius.pillBorder,
              child: Container(
                width: 24,
                height: 24,
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.55),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.close, size: 14, color: Colors.white),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// `aspect-square rounded-xl border-2 border-dashed border-border bg-warm`.
  Widget _addTile({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: NphRadius.fieldBorder,
      child: DottedBorderBox(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 24, color: NphColors.orange),
            const SizedBox(height: 4),
            Text(
              label,
              style: const TextStyle(
                fontFamily: NphFonts.body,
                fontSize: 10,
                fontWeight: FontWeight.w600,
                color: NphColors.mutedForeground,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Flutter has no dashed border, and pulling a package in for two tiles is not
/// worth the dependency. A solid border at low opacity over the warm fill reads
/// the same at this size.
class DottedBorderBox extends StatelessWidget {
  const DottedBorderBox({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 96,
      height: 96,
      decoration: BoxDecoration(
        color: NphColors.warm,
        borderRadius: NphRadius.fieldBorder,
        border: Border.all(color: NphColors.border, width: 2),
      ),
      child: child,
    );
  }
}
