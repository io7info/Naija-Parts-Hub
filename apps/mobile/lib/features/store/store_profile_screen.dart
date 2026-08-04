import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../design/components.dart';
import '../../design/tokens.dart';
import '../../models/store.dart';
import '../../services/store_service.dart';

/// Store profile — view and edit the dealer-owned fields (SOW §2).
///
/// Writes go straight to Firestore rather than through a callable: every field
/// here is on STORE_DEALER_FIELDS, and `firestore.rules` enforces that a dealer
/// update touches *only* those. Approval, visibility, slug and subscription are
/// backend-controlled and simply not present on this form — not hidden, absent.
///
/// A suspended dealer cannot edit at all; the rule refuses the write
/// (`resource.data.status != 'suspended'`), so the form is read-only for them
/// rather than failing at save time.
class StoreProfileScreen extends ConsumerStatefulWidget {
  const StoreProfileScreen({super.key, required this.store, this.readOnly = false});

  final Store store;

  /// Set while the business is under review — the reviewed details must not
  /// change under the reviewer.
  final bool readOnly;

  @override
  ConsumerState<StoreProfileScreen> createState() => _StoreProfileScreenState();
}

class _StoreProfileScreenState extends ConsumerState<StoreProfileScreen> {
  final _formKey = GlobalKey<FormState>();

  late final _businessName = TextEditingController(text: widget.store.businessName);
  late final _ownerName = TextEditingController(text: widget.store.ownerName);
  late final _phone = TextEditingController(text: widget.store.phone);
  late final _whatsapp = TextEditingController(text: widget.store.whatsapp);
  late final _email = TextEditingController(text: widget.store.email);
  late final _cac = TextEditingController(text: widget.store.cacNumber);
  late final _address = TextEditingController(text: widget.store.address);
  late final _landmark = TextEditingController(text: widget.store.landmark);
  late final _city = TextEditingController(text: widget.store.city);
  late final _description = TextEditingController(text: widget.store.description);

  static const _automotiveCategories = [
    'Car Parts',
    'Motorcycle Parts',
    'Truck & Trailer',
    'Tractor & Farm',
    'Heavy Equipment',
    'Electrical Parts',
  ];

  static const _states = [
    'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue',
    'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
    'FCT - Abuja', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina',
    'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo',
    'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
  ];

  late String _state = _states.contains(widget.store.state) ? widget.store.state : 'Lagos';
  late String _automotiveCategory = _automotiveCategories.contains(widget.store.automotiveCategory)
      ? widget.store.automotiveCategory
      : _automotiveCategories.first;

  bool _busy = false;
  String? _error;

  bool get _locked => widget.readOnly || widget.store.status == StoreStatus.suspended;

  @override
  void dispose() {
    for (final c in [
      _businessName, _ownerName, _phone, _whatsapp, _email,
      _cac, _address, _landmark, _city, _description,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() {
      _busy = true;
      _error = null;
    });

    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);

    try {
      await ref.read(storeServiceProvider).updateProfile(widget.store.storeId, {
        'businessName': _businessName.text.trim(),
        'ownerName': _ownerName.text.trim(),
        'phone': _phone.text.trim(),
        'whatsapp': _whatsapp.text.trim(),
        'email': _email.text.trim(),
        'cacNumber': _cac.text.trim(),
        'address': _address.text.trim(),
        'landmark': _landmark.text.trim(),
        'state': _state,
        'city': _city.text.trim(),
        'description': _description.text.trim(),
        'automotiveCategory': _automotiveCategory,
      });
      if (!mounted) return;
      messenger.showSnackBar(const SnackBar(content: Text('Store profile updated.')));
      navigator.pop();
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String? _required(String? v, String label) =>
      (v == null || v.trim().isEmpty) ? '$label is required' : null;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: NphColors.background,
      appBar: AppBar(
        title: Text(_locked ? 'Store Details' : 'Edit Store Profile'),
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
              _identityCard(),
              const SizedBox(height: NphSpacing.xl),

              if (_locked) ...[
                NphBanner(
                  message: widget.store.status == StoreStatus.suspended
                      ? 'Your business is suspended, so these details cannot be edited. '
                          'Contact support.'
                      : 'These are the details under review. They can be edited once your '
                          'store is approved.',
                  tone: NphTone.warning,
                  icon: Icons.lock_outline,
                ),
                const SizedBox(height: NphSpacing.xl),
              ],

              _section('Business'),
              NphField(
                label: 'Business or Shop Name',
                child: TextFormField(
                  controller: _businessName,
                  enabled: !_locked,
                  validator: (v) => _required(v, 'Business name'),
                ),
              ),
              NphField(
                label: 'Owner or Contact Name',
                child: TextFormField(
                  controller: _ownerName,
                  enabled: !_locked,
                  validator: (v) => _required(v, 'Owner name'),
                ),
              ),
              NphField(
                label: 'CAC Registration Number',
                child: TextFormField(
                  controller: _cac,
                  enabled: !_locked,
                  textCapitalization: TextCapitalization.characters,
                  validator: (v) => _required(v, 'CAC number'),
                ),
              ),
              NphField(
                label: 'Automotive Category',
                child: DropdownButtonFormField<String>(
                  initialValue: _automotiveCategory,
                  isExpanded: true,
                  items: _automotiveCategories
                      .map((c) => DropdownMenuItem(value: c, child: Text(c)))
                      .toList(),
                  onChanged: _locked
                      ? null
                      : (v) => setState(
                            () => _automotiveCategory = v ?? _automotiveCategories.first,
                          ),
                ),
              ),
              NphField(
                label: 'Business Description',
                optional: true,
                child: TextFormField(
                  controller: _description,
                  enabled: !_locked,
                  maxLines: 3,
                  maxLength: 2000,
                  decoration: const InputDecoration(counterText: ''),
                ),
              ),

              _section('Contact'),
              NphField(
                label: 'Phone Number',
                child: TextFormField(
                  controller: _phone,
                  enabled: !_locked,
                  keyboardType: TextInputType.phone,
                  validator: (v) => _required(v, 'Phone number'),
                ),
              ),
              NphField(
                label: 'WhatsApp Number',
                optional: true,
                child: TextFormField(
                  controller: _whatsapp,
                  enabled: !_locked,
                  keyboardType: TextInputType.phone,
                ),
              ),
              NphField(
                label: 'Email Address',
                optional: true,
                child: TextFormField(
                  controller: _email,
                  enabled: !_locked,
                  keyboardType: TextInputType.emailAddress,
                  validator: (v) {
                    final value = (v ?? '').trim();
                    if (value.isEmpty) return null;
                    return value.contains('@') && value.contains('.')
                        ? null
                        : 'Enter a valid email address';
                  },
                ),
              ),

              _section('Location'),
              NphField(
                label: 'State',
                child: DropdownButtonFormField<String>(
                  initialValue: _state,
                  isExpanded: true,
                  items: _states
                      .map((s) => DropdownMenuItem(value: s, child: Text(s)))
                      .toList(),
                  onChanged: _locked ? null : (v) => setState(() => _state = v ?? 'Lagos'),
                ),
              ),
              NphField(
                label: 'City',
                child: TextFormField(
                  controller: _city,
                  enabled: !_locked,
                  validator: (v) => _required(v, 'City'),
                ),
              ),
              NphField(
                label: 'Full Shop Address',
                child: TextFormField(
                  controller: _address,
                  enabled: !_locked,
                  validator: (v) => _required(v, 'Address'),
                ),
              ),
              NphField(
                label: 'Landmark',
                optional: true,
                child: TextFormField(controller: _landmark, enabled: !_locked),
              ),

              if (_error != null) ...[
                NphNotice(message: _error!),
                const SizedBox(height: NphSpacing.md),
              ],

              if (!_locked)
                FilledButton(
                  onPressed: _busy ? null : _save,
                  child: _busy
                      ? const SizedBox(
                          height: 18,
                          width: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Text('Save changes'),
                ),
              const SizedBox(height: NphSpacing.xl),
            ],
          ),
        ),
      ),
    );
  }

  /// Store identity, including the public URL. The slug is backend-assigned and
  /// shown read-only — a dealer changing it would break every shared link.
  Widget _identityCard() {
    return NphCard(
      child: Row(
        children: [
          NphInitialsAvatar(name: widget.store.businessName, size: 56),
          const SizedBox(width: NphSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  widget.store.businessName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 4),
                NphStatusBadge.forStoreStatus(widget.store.status.name),
                if (widget.store.slug.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(
                    '/store/${widget.store.slug}',
                    style: const TextStyle(
                      fontFamily: NphFonts.body,
                      fontSize: 12,
                      color: NphColors.mutedForeground,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _section(String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: NphSpacing.md),
      child: Text(
        title.toUpperCase(),
        style: const TextStyle(
          fontFamily: NphFonts.body,
          fontSize: 11,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.5,
          color: NphColors.mutedForeground,
        ),
      ),
    );
  }
}
