import 'dart:async';
import 'dart:io';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/errors.dart';
import '../../design/components.dart';
import '../../design/tokens.dart';
import '../../models/listing.dart';
import '../../services/categories_service.dart';
import '../../services/image_upload_service.dart';
import '../../services/listing_service.dart';
import '../../services/store_service.dart';
import '../../services/sync_status_service.dart';
import '../shell/shell_providers.dart';
import 'listings_screen.dart';

/// Add or edit a listing (SOW §4).
///
/// Two presentations, one screen:
///
///   embedded: true   the Add Listing shell pane. Keeps its State across tab
///                    switches, so a half-filled form survives a trip to the
///                    dashboard. Reset by bumping listingFormResetProvider.
///   embedded: false  a pushed route for editing one existing listing, which
///                    must not displace the in-progress Add pane.
///
/// Photos are capped at three — SOW §4, `MAX_IMAGES_PER_LISTING`, and
/// `firestore.rules` (`d.images.size() <= 3`) all agree. The design mockup says
/// six; a six-slot form would be rejected by the server on save.
class ListingFormScreen extends ConsumerStatefulWidget {
  const ListingFormScreen({
    super.key,
    required this.storeId,
    this.existing,
    this.embedded = false,
  });

  final String storeId;
  final Listing? existing;
  final bool embedded;

  @override
  ConsumerState<ListingFormScreen> createState() => _ListingFormScreenState();
}

/// One image slot, which may be uploading, uploaded, or failed.
///
/// Modelled explicitly rather than as a bare list of URLs so a failed upload
/// can stay on screen with a Retry instead of vanishing — a dealer on a market
/// stall's connection sees failures constantly, and silently dropping the photo
/// they just took is the worst possible response.
class _Slot {
  _Slot({this.local, this.uploaded, this.progress, this.error});

  /// The picked file, kept for the preview while uploading and — crucially —
  /// so a failed upload can be retried without asking the dealer to take the
  /// photo again.
  final XFile? local;
  final ListingImage? uploaded;
  final double? progress;
  final String? error;

  bool get isUploading => progress != null && error == null && uploaded == null;
  bool get isFailed => error != null;
  bool get isDone => uploaded != null;
}

class _ListingFormScreenState extends ConsumerState<ListingFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _scroll = ScrollController();

  final _name = TextEditingController();
  final _description = TextEditingController();
  final _price = TextEditingController();
  final _quantity = TextEditingController(text: '1');
  final _brand = TextEditingController();
  final _partNumber = TextEditingController();
  final _make = TextEditingController();
  final _model = TextEditingController();

  /// Null means "not chosen yet". The form refuses to submit until the dealer
  /// picks one — the previous default of 'engine' meant a mis-categorised part
  /// was the path of least resistance.
  String? _category;
  String _condition = 'new';
  final List<_Slot> _slots = [];

  bool _busy = false;
  String? _error;

  bool get _isEdit => widget.existing != null;
  bool get _uploading => _slots.any((s) => s.isUploading);

  @override
  void initState() {
    super.initState();

    final existing = widget.existing;
    if (existing != null) {
      _name.text = existing.name;
      _description.text = existing.description;
      // Kobo back to naira. Integer division keeps whole naira whole rather
      // than rendering "28500.0".
      _price.text = (existing.priceKobo / 100).toStringAsFixed(
        existing.priceKobo % 100 == 0 ? 0 : 2,
      );
      _quantity.text = '${existing.quantity}';
      _brand.text = existing.brand;
      _partNumber.text = existing.partNumber;
      _make.text = existing.compatibleMake;
      _model.text = existing.compatibleModel;
      _category = existing.categoryId.isEmpty ? null : existing.categoryId;
      _condition = existing.condition == 'used' ? 'used' : 'new';
      _slots.addAll(existing.images.map((i) => _Slot(uploaded: i)));
    }

    for (final c in _controllers) {
      c.addListener(_markDirty);
    }
  }

  List<TextEditingController> get _controllers => [
        _name, _description, _price, _quantity, _brand, _partNumber, _make, _model,
      ];

  /// Publishes "there is unsaved work here" to the shell.
  ///
  /// Only meaningful for the embedded pane — the pushed edit route is guarded
  /// by PopScope instead, because leaving it *is* a pop.
  void _markDirty() {
    if (!widget.embedded || _busy) return;
    if (!ref.read(listingFormDirtyProvider)) {
      ref.read(listingFormDirtyProvider.notifier).state = true;
    }
  }

  bool get _hasContent =>
      _controllers.any((c) => c.text.trim().isNotEmpty) ||
      _slots.isNotEmpty ||
      _category != null;

  @override
  void dispose() {
    for (final c in _controllers) {
      c.removeListener(_markDirty);
      c.dispose();
    }
    _scroll.dispose();
    super.dispose();
  }

  /// True only when Firestore is serving from cache — i.e. we know we are
  /// offline. Deliberately conservative: an unknown state counts as online, so
  /// publishing is never blocked by a false negative.
  bool get _offline =>
      ref.watch(syncStatusProvider).valueOrNull?.state == SyncState.offline;

  // --- Images --------------------------------------------------------------

  Future<void> _addImage({required bool fromCamera}) async {
    if (_slots.length >= ImageUploadService.maxImages) return;

    final picked = await ref.read(imageUploadServiceProvider).pick(fromCamera: fromCamera);
    if (picked == null) return;

    final slot = _Slot(local: picked, progress: 0);
    setState(() {
      _slots.add(slot);
      _error = null;
    });
    _markDirty();
    await _upload(slot);
  }

  Future<void> _upload(_Slot slot) async {
    final index = _slots.indexOf(slot);
    if (index < 0 || slot.local == null) return;

    setState(() => _slots[index] = _Slot(local: slot.local, progress: 0));

    try {
      final image = await ref.read(imageUploadServiceProvider).upload(
            storeId: widget.storeId,
            listingId: widget.existing?.listingId ?? 'drafts',
            source: slot.local!,
            onProgress: (p) {
              if (!mounted) return;
              final i = _slots.indexWhere((s) => s.local == slot.local);
              if (i >= 0) setState(() => _slots[i] = _Slot(local: slot.local, progress: p));
            },
          );
      if (!mounted) return;
      final i = _slots.indexWhere((s) => s.local == slot.local);
      if (i >= 0) setState(() => _slots[i] = _Slot(local: slot.local, uploaded: image));
    } catch (e) {
      if (!mounted) return;
      final i = _slots.indexWhere((s) => s.local == slot.local);
      if (i >= 0) {
        setState(() => _slots[i] = _Slot(local: slot.local, error: friendlyError(e)));
      }
    }
  }

  Future<void> _removeSlot(int index) async {
    final slot = _slots[index];
    setState(() => _slots.removeAt(index));
    _markDirty();
    // Best-effort: an orphaned object costs storage, but blocking the dealer on
    // a delete that may fail offline costs them the edit.
    if (slot.uploaded != null) {
      await ref.read(imageUploadServiceProvider).deleteAt(slot.uploaded!.path);
    }
  }

  /// Promotes a photo to first position — first image is the one the
  /// marketplace shows as the thumbnail, so "main image" is just order.
  void _makeMain(int index) {
    if (index == 0) return;
    setState(() {
      final slot = _slots.removeAt(index);
      _slots.insert(0, slot);
    });
    _markDirty();
  }

  // --- Save ----------------------------------------------------------------

  Future<void> _save({required bool publish}) async {
    // Guards against a double tap landing two writes: _busy is set before any
    // await, and every exit path resets it.
    if (_busy) return;
    if (!(_formKey.currentState?.validate() ?? false)) {
      // Scroll back to the first field so the dealer can see what failed —
      // otherwise a validation error 400 px above the button is invisible.
      // Fire-and-forget: nothing depends on the animation finishing.
      unawaited(
        _scroll.animateTo(0, duration: const Duration(milliseconds: 250), curve: Curves.easeOut),
      );
      return;
    }
    if (publish && _uploading) return;

    setState(() {
      _busy = true;
      _error = null;
    });

    final messenger = ScaffoldMessenger.of(context);
    final service = ref.read(listingServiceProvider);
    final images = _slots.where((s) => s.isDone).map((s) => s.uploaded!).toList();

    try {
      final naira = double.tryParse(_price.text.trim()) ?? 0;
      final priceKobo = (naira * 100).round();

      final String listingId;
      if (_isEdit) {
        listingId = widget.existing!.listingId;
        await service.updateDraft(listingId, {
          'name': _name.text.trim(),
          'description': _description.text.trim(),
          'categoryId': _category!,
          'condition': _condition,
          'priceKobo': priceKobo,
          'quantity': int.tryParse(_quantity.text.trim()) ?? 0,
          'brand': _brand.text.trim(),
          'partNumber': _partNumber.text.trim(),
          'compatibleMake': _make.text.trim(),
          'compatibleModel': _model.text.trim(),
          'images': images.map((i) => i.toMap()).toList(),
        });
      } else {
        listingId = await service.createDraft(
          storeId: widget.storeId,
          name: _name.text.trim(),
          categoryId: _category!,
          condition: _condition,
          priceKobo: priceKobo,
          quantity: int.tryParse(_quantity.text.trim()) ?? 0,
          description: _description.text.trim(),
          brand: _brand.text.trim(),
          partNumber: _partNumber.text.trim(),
          compatibleMake: _make.text.trim(),
          compatibleModel: _model.text.trim(),
          images: images,
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

      if (widget.embedded) {
        // Land on the tab that now holds the listing, with a fresh form behind.
        resetListingFormAndGo(
          ref,
          ShellTab.listings,
          listingsTab: publish ? ListingsTab.active : ListingsTab.draft,
        );
      } else {
        Navigator.of(context).pop();
      }
      return;
    } on PublishRequiresConnection {
      // The write is already queued locally, so nothing is lost — say so rather
      // than leaving the dealer wondering.
      if (mounted) setState(() => _error = PublishRequiresConnection.message);
    } on ListingLimitReached catch (e) {
      if (mounted) {
        final store = ref.read(myStoreProvider).valueOrNull;
        if (store != null) {
          showListingLimitSheet(context, ref, store, e);
        }
        setState(() => _error = 'Saved as a draft — your plan allows ${e.limit} '
            'active listings.');
      }
    } on StoreNotApproved catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // --- Build ---------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final alreadyActive = widget.existing?.status == ListingStatus.active;
    final body = _form(context, alreadyActive);

    if (widget.embedded) return body;

    // Pushed edit route: leaving IS a pop, so PopScope is the right guard here.
    return PopScope(
      canPop: !_hasContent || _busy,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final navigator = Navigator.of(context);
        // Captured before the await: using `context` afterwards is guarded by
        // the State's `mounted`, which says nothing about whether this
        // particular BuildContext is still in the tree.
        if (await _confirmDiscard()) navigator.pop();
      },
      child: Scaffold(
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
        body: SafeArea(child: body),
      ),
    );
  }

  Future<bool> _confirmDiscard() async {
    if (!_hasContent) return true;
    final discard = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: NphColors.card,
        shape: const RoundedRectangleBorder(borderRadius: NphRadius.cardBorder),
        title: const Text('Discard changes?'),
        content: const Text(
          'You have unsaved changes. Save as a draft instead to keep your work.',
          style: TextStyle(fontFamily: NphFonts.body, fontSize: 14, height: 1.45),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            style: TextButton.styleFrom(foregroundColor: NphColors.mutedForeground),
            child: const Text('Keep editing'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: TextButton.styleFrom(foregroundColor: NphColors.error),
            child: const Text('Discard'),
          ),
        ],
      ),
    );
    return discard ?? false;
  }

  Widget _form(BuildContext context, bool alreadyActive) {
    final categories = ref.watch(categoriesProvider);

    return Form(
      key: _formKey,
      child: ListView(
        controller: _scroll,
        padding: const EdgeInsets.all(NphSpacing.appPage),
        children: [
          if (widget.embedded) ...[
            Text(
              _isEdit ? 'Edit Listing' : 'Add New Listing',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: NphSpacing.lg),
          ],

          _photos(),
          const SizedBox(height: NphSpacing.xl),

          NphField(
            label: 'Part name',
            child: TextFormField(
              controller: _name,
              textInputAction: TextInputAction.next,
              textCapitalization: TextCapitalization.words,
              maxLength: 140,
              decoration: const InputDecoration(
                hintText: 'e.g. Toyota Corolla Front Brake Pad',
                counterText: '',
              ),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Part name is required' : null,
            ),
          ),

          NphField(
            label: 'Category',
            child: categories.when(
              loading: () => const _FieldPlaceholder(text: 'Loading categories…'),
              error: (e, _) => _FieldPlaceholder(text: friendlyError(e), isError: true),
              data: (list) => DropdownButtonFormField<String>(
                initialValue: _category,
                isExpanded: true,
                hint: const Text('Select category'),
                items: [
                  for (final c in list) DropdownMenuItem(value: c.id, child: Text(c.name)),
                ],
                onChanged: (v) {
                  setState(() => _category = v);
                  _markDirty();
                },
                // Required, and deliberately not defaulted. The old default of
                // 'engine' made mis-categorising the path of least resistance.
                validator: (v) => v == null ? 'Choose a category' : null,
              ),
            ),
          ),

          NphField(
            label: 'Condition',
            child: NphSegmented(
              options: const ['New', 'Used'],
              value: _condition == 'used' ? 'Used' : 'New',
              onChanged: (v) {
                setState(() => _condition = v.toLowerCase());
                _markDirty();
              },
            ),
          ),

          NphField(
            label: 'Price',
            child: TextFormField(
              controller: _price,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              textInputAction: TextInputAction.next,
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
              decoration: const InputDecoration(
                hintText: '0',
                prefixText: '₦ ',
                prefixStyle: TextStyle(
                  fontFamily: NphFonts.body,
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: NphColors.foreground,
                ),
              ),
              validator: (v) {
                final parsed = double.tryParse((v ?? '').trim());
                if (parsed == null) return 'Enter a price';
                if (parsed <= 0) return 'Price must be more than ₦0';
                if (parsed > 10000000) return 'Price looks too high — check the amount';
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
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(hintText: 'Toyota'),
                  ),
                ),
              ),
              const SizedBox(width: NphSpacing.md),
              Expanded(
                child: NphField(
                  label: 'Vehicle model',
                  child: TextFormField(
                    controller: _model,
                    textInputAction: TextInputAction.next,
                    textCapitalization: TextCapitalization.words,
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
                    textCapitalization: TextCapitalization.words,
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
                    validator: (v) {
                      final n = int.tryParse((v ?? '').trim());
                      if (n == null) return 'Enter a quantity';
                      if (n <= 0) return 'Must be at least 1';
                      return null;
                    },
                  ),
                ),
              ),
            ],
          ),

          NphField(
            label: 'Part number / SKU',
            optional: true,
            child: TextFormField(
              controller: _partNumber,
              textInputAction: TextInputAction.next,
              textCapitalization: TextCapitalization.characters,
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
              buildCounter: (_, {required currentLength, required isFocused, maxLength}) =>
                  Text(
                '$currentLength / $maxLength',
                style: const TextStyle(
                  fontFamily: NphFonts.body,
                  fontSize: 11,
                  color: NphColors.mutedForeground,
                ),
              ),
              decoration: const InputDecoration(
                hintText: 'Describe the part, its fitment and condition.',
              ),
            ),
          ),

          const NphBanner(
            message: 'Buyers see your store address as the pickup location.',
            tone: NphTone.neutral,
            icon: Icons.location_on_outlined,
          ),
          const SizedBox(height: NphSpacing.lg),

          if (_uploading) ...[
            const NphBanner(
              message: 'Photos are still uploading. Publishing unlocks when they finish.',
              tone: NphTone.warning,
              icon: Icons.cloud_upload_outlined,
            ),
            const SizedBox(height: NphSpacing.md),
          ] else if (_offline && !alreadyActive) ...[
            const NphBanner(
              message: 'Publishing needs a connection — the listing limit can only be '
                  'checked by the server. You can still save a draft.',
              tone: NphTone.neutral,
              icon: Icons.cloud_off_outlined,
            ),
            const SizedBox(height: NphSpacing.md),
          ],

          // Above the buttons. Below, it scrolled off the bottom and hid the
          // message explaining why a part saved as a draft.
          if (_error != null) ...[
            NphNotice(message: _error!),
            const SizedBox(height: NphSpacing.md),
          ],

          if (alreadyActive)
            FilledButton(
              onPressed: _busy ? null : () => _save(publish: false),
              child: _busy ? const _ButtonSpinner() : const Text('Save changes'),
            )
          else ...[
            FilledButton(
              onPressed: (_busy || _offline || _uploading) ? null : () => _save(publish: true),
              child: _busy ? const _ButtonSpinner() : const Text('Publish listing'),
            ),
            const SizedBox(height: NphSpacing.sm),
            OutlinedButton(
              onPressed: _busy ? null : () => _save(publish: false),
              child: Text(_isEdit ? 'Save changes' : 'Save as draft'),
            ),
          ],
          const SizedBox(height: NphSpacing.xxxl),
        ],
      ),
    );
  }

  Widget _photos() {
    final canAdd = _slots.length < ImageUploadService.maxImages;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        NphFieldLabel('Photos (${_slots.length}/${ImageUploadService.maxImages})'),
        SizedBox(
          height: 108,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: [
              for (var i = 0; i < _slots.length; i++)
                Padding(
                  padding: const EdgeInsets.only(right: NphSpacing.sm),
                  child: _slotTile(i),
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
        if (_slots.length > 1)
          const Padding(
            padding: EdgeInsets.only(top: 6),
            child: Text(
              'Tap a photo to make it the main image buyers see first.',
              style: TextStyle(
                fontFamily: NphFonts.body,
                fontSize: 11,
                color: NphColors.mutedForeground,
              ),
            ),
          ),
      ],
    );
  }

  Widget _slotTile(int index) {
    final slot = _slots[index];
    final isMain = index == 0;

    return SizedBox(
      width: 96,
      height: 96,
      child: Stack(
        children: [
          GestureDetector(
            onTap: slot.isDone ? () => _makeMain(index) : null,
            child: ClipRRect(
              borderRadius: NphRadius.fieldBorder,
              child: SizedBox(
                width: 96,
                height: 96,
                child: _slotImage(slot),
              ),
            ),
          ),
          if (slot.isUploading)
            Positioned.fill(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.45),
                  borderRadius: NphRadius.fieldBorder,
                ),
                child: Center(
                  child: SizedBox(
                    width: 28,
                    height: 28,
                    child: CircularProgressIndicator(
                      value: slot.progress,
                      strokeWidth: 2.5,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
            ),
          if (slot.isFailed)
            Positioned.fill(
              child: GestureDetector(
                // Fire-and-forget: _upload owns its own error handling and
                // setState, so awaiting here would only widen the callback's
                // signature for no benefit.
                onTap: () => unawaited(_upload(slot)),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: NphColors.error.withValues(alpha: 0.80),
                    borderRadius: NphRadius.fieldBorder,
                  ),
                  child: const Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.refresh, size: 20, color: Colors.white),
                      SizedBox(height: 2),
                      Text(
                        'Retry',
                        style: TextStyle(
                          fontFamily: NphFonts.body,
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: Colors.white,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          if (isMain && slot.isDone)
            Positioned(
              left: 4,
              bottom: 4,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: const BoxDecoration(
                  color: NphColors.orange,
                  borderRadius: NphRadius.pillBorder,
                ),
                child: const Text(
                  'Main',
                  style: TextStyle(
                    fontFamily: NphFonts.body,
                    fontSize: 9,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                  ),
                ),
              ),
            ),
          Positioned(
            right: 4,
            top: 4,
            child: InkWell(
              onTap: () => _removeSlot(index),
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

  Widget _slotImage(_Slot slot) {
    final url = slot.uploaded?.displayUrl;
    if (url != null && url.startsWith('http')) {
      return CachedNetworkImage(
        imageUrl: url,
        fit: BoxFit.cover,
        placeholder: (_, __) => Container(color: NphColors.muted),
        errorWidget: (_, __, ___) => Container(color: NphColors.muted),
      );
    }
    if (slot.local != null) {
      return Image.file(File(slot.local!.path), fit: BoxFit.cover);
    }
    return Container(color: NphColors.muted);
  }

  /// `aspect-square rounded-xl border-2 border-dashed bg-warm`. Flutter has no
  /// dashed border and a package for two tiles is not worth the dependency; a
  /// solid 2 px border over the warm fill reads the same at this size.
  Widget _addTile({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    return Semantics(
      button: true,
      label: 'Add photo from $label',
      child: InkWell(
        onTap: onTap,
        borderRadius: NphRadius.fieldBorder,
        child: Container(
          width: 96,
          height: 96,
          decoration: BoxDecoration(
            color: NphColors.warm,
            borderRadius: NphRadius.fieldBorder,
            border: Border.all(color: NphColors.border, width: 2),
          ),
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
      ),
    );
  }
}

class _ButtonSpinner extends StatelessWidget {
  const _ButtonSpinner();

  @override
  Widget build(BuildContext context) => const SizedBox(
        height: 18,
        width: 18,
        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
      );
}

class _FieldPlaceholder extends StatelessWidget {
  const _FieldPlaceholder({required this.text, this.isError = false});

  final String text;
  final bool isError;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: NphSize.fieldHeight,
      alignment: Alignment.centerLeft,
      padding: const EdgeInsets.symmetric(horizontal: NphSpacing.md),
      decoration: BoxDecoration(
        color: NphColors.card,
        borderRadius: NphRadius.fieldBorder,
        border: Border.all(color: isError ? NphColors.error : NphColors.border),
      ),
      child: Text(
        text,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          fontFamily: NphFonts.body,
          fontSize: 14,
          color: isError ? NphColors.error : NphColors.mutedForeground,
        ),
      ),
    );
  }
}
