import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../design/components.dart';
import '../../design/tokens.dart';
import '../../services/auth_service.dart';
import '../../services/store_service.dart';

/// Dealer business registration (SOW §2), in the client-approved four-step
/// flow: Business · Contact · Location · Agreement.
///
/// Submission still goes through the `registerStore` callable, which reserves
/// the store slug atomically and forces `status: 'pending'` — approval is a
/// separate admin action (§3). The wizard only changes how the fields are
/// gathered; it does not touch that contract.
///
/// Validation is per step. Advancing runs only the current step's validators,
/// so a dealer is never told about a field three screens away, and the final
/// Submit cannot be reached with an earlier step incomplete.
class RegistrationScreen extends ConsumerStatefulWidget {
  const RegistrationScreen({super.key});

  @override
  ConsumerState<RegistrationScreen> createState() => _RegistrationScreenState();
}

class _RegistrationScreenState extends ConsumerState<RegistrationScreen> {
  static const _steps = ['Business', 'Contact', 'Location', 'Agreement'];

  /// One key per step. A single shared key would validate hidden fields too,
  /// which is what makes multi-step forms refuse to advance for no visible
  /// reason.
  final _keys = List.generate(4, (_) => GlobalKey<FormState>());
  final _scroll = ScrollController();

  final _businessName = TextEditingController();
  final _ownerName = TextEditingController();
  final _cac = TextEditingController();
  final _description = TextEditingController();
  final _phone = TextEditingController();
  final _whatsapp = TextEditingController();
  final _email = TextEditingController();
  final _city = TextEditingController();
  final _address = TextEditingController();
  final _landmark = TextEditingController();

  /// Mirrors AUTOMOTIVE_CATEGORIES in packages/contracts/src/constants.ts.
  /// The callable drops anything not on this list, so the two must agree.
  static const _automotiveCategories = [
    'Car Parts',
    'Motorcycle Parts',
    'Truck & Trailer',
    'Tractor & Farm',
    'Heavy Equipment',
    'Electrical Parts',
  ];

  /// Mirrors NIGERIAN_STATES in packages/contracts/src/common.ts — all 36 plus
  /// the FCT. The previous screen shipped an 11-entry subset, which silently
  /// excluded dealers in two thirds of the country.
  static const _states = [
    'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue',
    'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
    'FCT - Abuja', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina',
    'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo',
    'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
  ];

  int _step = 0;
  String _state = 'Lagos';
  String _automotiveCategory = _automotiveCategories.first;
  bool _confirmPhysical = false;
  bool _acceptedTerms = false;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    // The verified phone on the auth token is the one the backend trusts, so
    // it is prefilled rather than asked for again. Editable because the shop's
    // published contact line is often not the number that received the OTP.
    _phone.text = ref.read(authServiceProvider).currentUser?.phoneNumber ?? '';
  }

  @override
  void dispose() {
    _scroll.dispose();
    for (final c in [
      _businessName, _ownerName, _cac, _description, _phone,
      _whatsapp, _email, _city, _address, _landmark,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  void _back() {
    if (_step == 0) {
      Navigator.of(context).maybePop();
      return;
    }
    setState(() {
      _step--;
      _error = null;
    });
    _scroll.jumpTo(0);
  }

  Future<void> _next() async {
    if (!(_keys[_step].currentState?.validate() ?? false)) return;

    if (_step < _steps.length - 1) {
      setState(() {
        _step++;
        _error = null;
      });
      _scroll.jumpTo(0);
      return;
    }

    if (!_confirmPhysical || !_acceptedTerms) {
      setState(() => _error = 'Please confirm both statements before submitting.');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      await ref.read(storeServiceProvider).register(
            businessName: _businessName.text.trim(),
            ownerName: _ownerName.text.trim(),
            phone: _phone.text.trim(),
            whatsapp: _whatsapp.text.trim(),
            cacNumber: _cac.text.trim(),
            address: _address.text.trim(),
            state: _state,
            city: _city.text.trim(),
            description: _description.text.trim(),
            email: _email.text.trim(),
            landmark: _landmark.text.trim(),
            automotiveCategory: _automotiveCategory,
          );
      // myStoreProvider is a live stream — the gate re-routes to the pending
      // screen on its own. Nothing to navigate here.
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
      body: SafeArea(
        child: Column(
          children: [
            _header(),
            Expanded(
              child: SingleChildScrollView(
                controller: _scroll,
                padding: const EdgeInsets.fromLTRB(
                  NphSpacing.page,
                  NphSpacing.lg,
                  NphSpacing.page,
                  NphSpacing.lg,
                ),
                child: Form(
                  key: _keys[_step],
                  child: switch (_step) {
                    0 => _businessStep(),
                    1 => _contactStep(),
                    2 => _locationStep(),
                    _ => _agreementStep(),
                  },
                ),
              ),
            ),
            _footer(),
          ],
        ),
      ),
    );
  }

  Widget _header() {
    return Container(
      padding: const EdgeInsets.fromLTRB(
        NphSpacing.page,
        NphSpacing.md,
        NphSpacing.page,
        NphSpacing.lg,
      ),
      color: NphColors.card,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              NphIconButton(
                icon: Icons.arrow_back,
                tooltip: 'Back',
                onPressed: _busy ? null : _back,
              ),
              const NphLogo(size: 32),
            ],
          ),
          const SizedBox(height: NphSpacing.lg),
          Text('Register Your Store', style: Theme.of(context).textTheme.headlineMedium),
          const SizedBox(height: NphSpacing.lg),
          NphStepper(steps: _steps, current: _step),
        ],
      ),
    );
  }

  Widget _footer() {
    return Container(
      padding: const EdgeInsets.fromLTRB(
        NphSpacing.page,
        NphSpacing.md,
        NphSpacing.page,
        NphSpacing.xl,
      ),
      decoration: const BoxDecoration(
        color: NphColors.card,
        border: Border(top: BorderSide(color: NphColors.border)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Above the button, never below. Below, the notice fell past the
          // bottom of the scroll view and submitting looked like a no-op.
          if (_error != null) ...[
            NphNotice(message: _error!),
            const SizedBox(height: NphSpacing.md),
          ],
          FilledButton(
            onPressed: _busy ? null : _next,
            child: _busy
                ? const SizedBox(
                    height: 18,
                    width: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      if (_step == _steps.length - 1) ...[
                        const Icon(Icons.check, size: 16),
                        const SizedBox(width: 6),
                      ],
                      Text(_step == _steps.length - 1 ? 'Submit for Verification' : 'Continue'),
                    ],
                  ),
          ),
        ],
      ),
    );
  }

  // --- Steps ---------------------------------------------------------------

  Widget _businessStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        NphField(
          label: 'Business or Shop Name',
          child: TextFormField(
            controller: _businessName,
            textInputAction: TextInputAction.next,
            decoration: const InputDecoration(hintText: 'e.g. Ladipo Auto Spares'),
            validator: (v) => _required(v, 'Business name'),
          ),
        ),
        NphField(
          label: 'Owner or Contact Name',
          child: TextFormField(
            controller: _ownerName,
            textInputAction: TextInputAction.next,
            decoration: const InputDecoration(hintText: 'Full name'),
            validator: (v) => _required(v, 'Owner name'),
          ),
        ),
        NphField(
          label: 'CAC Registration Number',
          child: TextFormField(
            controller: _cac,
            textInputAction: TextInputAction.next,
            textCapitalization: TextCapitalization.characters,
            decoration: const InputDecoration(hintText: 'RC-000000'),
            validator: (v) => _required(v, 'CAC number'),
          ),
        ),
        NphField(
          label: 'Business Description',
          optional: true,
          child: TextFormField(
            controller: _description,
            maxLines: 3,
            maxLength: 2000,
            decoration: const InputDecoration(
              hintText: 'What does your store sell?',
              counterText: '',
            ),
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
            onChanged: (v) =>
                setState(() => _automotiveCategory = v ?? _automotiveCategories.first),
          ),
        ),
      ],
    );
  }

  Widget _contactStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        NphField(
          label: 'Phone Number',
          child: TextFormField(
            controller: _phone,
            keyboardType: TextInputType.phone,
            textInputAction: TextInputAction.next,
            decoration: const InputDecoration(hintText: '+234 903 672 6262'),
            validator: (v) => _required(v, 'Phone number'),
          ),
        ),
        NphField(
          label: 'WhatsApp Number',
          child: TextFormField(
            controller: _whatsapp,
            keyboardType: TextInputType.phone,
            textInputAction: TextInputAction.next,
            decoration: const InputDecoration(hintText: '+234 903 672 6262'),
            // Not required: SOW §2 lists it, but a dealer without WhatsApp
            // still has a phone number, and buyers fall back to calling.
          ),
        ),
        NphField(
          label: 'Email Address',
          optional: true,
          child: TextFormField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(hintText: 'you@business.ng'),
            validator: (v) {
              final value = (v ?? '').trim();
              if (value.isEmpty) return null;
              // Deliberately permissive. A strict RFC pattern rejects valid
              // addresses, and this field is contact information, not a login.
              return value.contains('@') && value.contains('.')
                  ? null
                  : 'Enter a valid email address';
            },
          ),
        ),
        const NphBanner(
          message: 'You sign in with your phone number. Email is for contact only.',
          tone: NphTone.neutral,
          icon: Icons.info_outline,
        ),
      ],
    );
  }

  Widget _locationStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        NphField(
          label: 'State',
          child: DropdownButtonFormField<String>(
            initialValue: _state,
            isExpanded: true,
            items: _states.map((s) => DropdownMenuItem(value: s, child: Text(s))).toList(),
            onChanged: (v) => setState(() => _state = v ?? 'Lagos'),
          ),
        ),
        NphField(
          label: 'City',
          child: TextFormField(
            controller: _city,
            textInputAction: TextInputAction.next,
            decoration: const InputDecoration(hintText: 'e.g. Mushin'),
            validator: (v) => _required(v, 'City'),
          ),
        ),
        NphField(
          label: 'Full Shop Address',
          child: TextFormField(
            controller: _address,
            textInputAction: TextInputAction.next,
            decoration: const InputDecoration(hintText: '50 Ladipo Market Road'),
            validator: (v) => _required(v, 'Address'),
          ),
        ),
        NphField(
          label: 'Landmark',
          optional: true,
          child: TextFormField(
            controller: _landmark,
            decoration: const InputDecoration(hintText: 'Opposite Ladipo Main Gate'),
          ),
        ),
      ],
    );
  }

  Widget _agreementStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        NphCard(
          color: NphColors.warm,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Review before submitting',
                style: TextStyle(
                  fontFamily: NphFonts.body,
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: NphColors.foreground,
                ),
              ),
              const SizedBox(height: NphSpacing.xs),
              Text(
                [
                  _businessName.text.trim(),
                  _city.text.trim(),
                  if (_cac.text.trim().isNotEmpty) 'CAC ${_cac.text.trim()}',
                ].where((s) => s.isNotEmpty).join(' · '),
                style: const TextStyle(
                  fontFamily: NphFonts.body,
                  fontSize: 12,
                  height: 1.5,
                  color: NphColors.mutedForeground,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: NphSpacing.lg),
        _checkbox(
          value: _confirmPhysical,
          onChanged: (v) => setState(() => _confirmPhysical = v),
          label: 'I confirm that this business has a physical store location in Nigeria.',
        ),
        const SizedBox(height: NphSpacing.md),
        _checkbox(
          value: _acceptedTerms,
          onChanged: (v) => setState(() => _acceptedTerms = v),
          label: 'I agree to the Terms and Privacy Policy.',
        ),
        const SizedBox(height: NphSpacing.lg),
        const NphBanner(
          message: 'An administrator reviews your CAC details before your store goes live.',
          tone: NphTone.warning,
          icon: Icons.schedule,
        ),
      ],
    );
  }

  Widget _checkbox({
    required bool value,
    required ValueChanged<bool> onChanged,
    required String label,
  }) {
    return InkWell(
      onTap: () => onChanged(!value),
      borderRadius: NphRadius.fieldBorder,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: NphColors.card,
          borderRadius: NphRadius.fieldBorder,
          border: Border.all(color: value ? NphColors.orange : NphColors.border),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 20,
              height: 20,
              child: Checkbox(
                value: value,
                onChanged: (v) => onChanged(v ?? false),
                activeColor: NphColors.orange,
                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                visualDensity: VisualDensity.compact,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
              ),
            ),
            const SizedBox(width: NphSpacing.md),
            Expanded(
              child: Text(
                label,
                style: const TextStyle(
                  fontFamily: NphFonts.body,
                  fontSize: 14,
                  height: 1.5,
                  color: NphColors.foreground,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
