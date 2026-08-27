import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../design/components.dart';
import '../../design/tokens.dart';
import '../../models/store.dart';
import '../../services/auth_service.dart';
import '../../services/image_upload_service.dart';
import '../../services/store_service.dart';
import 'mechanic_identity_screen.dart';

/// The services a mechanic can advertise.
///
/// Mirrors MECHANIC_SPECIALTIES in packages/contracts/src/constants.ts. Dart
/// cannot import TypeScript, so this is copied by hand — ids are what is
/// stored and what the public filter queries, so an id that drifts makes a
/// mechanic unfindable rather than merely mislabelled.
const mechanicSpecialties = <({String id, String label})>[
  (id: 'engine', label: 'Engine repair'),
  (id: 'transmission', label: 'Transmission repair'),
  (id: 'brakes', label: 'Brake repair'),
  (id: 'suspension', label: 'Suspension'),
  (id: 'electrical', label: 'Auto electrical'),
  (id: 'ac', label: 'AC repair'),
  (id: 'exhaust', label: 'Muffler / exhaust'),
  (id: 'bodywork', label: 'Body work & panel beating'),
  (id: 'diagnostics', label: 'Computer diagnostics'),
  (id: 'general', label: 'General mechanic'),
];

/// MAX_WORKSHOP_PHOTOS in the contracts.
const maxWorkshopPhotos = 10;

/// Auto mechanic registration.
///
/// WHY IDENTITY COMES AFTER SUBMISSION
///
/// `verifyMechanicIdentity` operates on an existing store — it reads the
/// document to check the business type, the attempt count and the single-flight
/// lease, all of which need somewhere to live. So the record is created first,
/// as an unfinished draft: status `pending`, identity `unverified`.
///
/// Nothing is exposed by that. A pending mechanic appears nowhere public, and
/// `adminReviewStore` refuses to approve one whose identity is not verified —
/// so the draft can exist safely while the check is outstanding, which is
/// exactly the "unfinished registration draft internally, approval blocked"
/// shape the client asked for.
///
/// It also means a failed or unavailable check does not destroy a completed
/// form: the mechanic returns to the identity step and retries, rather than
/// filling everything in again.
class MechanicRegistrationScreen extends ConsumerStatefulWidget {
  const MechanicRegistrationScreen({super.key});

  @override
  ConsumerState<MechanicRegistrationScreen> createState() => _MechanicRegistrationScreenState();
}

class _MechanicRegistrationScreenState extends ConsumerState<MechanicRegistrationScreen> {
  static const _steps = ['Workshop', 'Services', 'Location', 'Photos'];

  /// One key per step — a shared key would validate hidden fields and refuse
  /// to advance for a reason nothing on screen explains.
  final _keys = List.generate(4, (_) => GlobalKey<FormState>());
  final _scroll = ScrollController();

  final _businessName = TextEditingController();
  final _ownerName = TextEditingController();
  final _description = TextEditingController();
  final _cac = TextEditingController();
  final _whatsapp = TextEditingController();
  final _email = TextEditingController();
  final _address = TextEditingController();
  final _city = TextEditingController();
  final _landmark = TextEditingController();

  String _state = '';
  final _selected = <String>{};
  final _photos = <String>[];

  int _step = 0;
  bool _busy = false;
  bool _uploading = false;
  bool _accepted = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [
      _businessName,
      _ownerName,
      _description,
      _cac,
      _whatsapp,
      _email,
      _address,
      _city,
      _landmark,
    ]) {
      c.dispose();
    }
    _scroll.dispose();
    super.dispose();
  }

  void _next() {
    if (!(_keys[_step].currentState?.validate() ?? false)) return;

    // Step-level rules the form validators cannot express: a set, and a count.
    if (_step == 1 && _selected.isEmpty) {
      setState(() => _error = 'Choose at least one service you offer.');
      return;
    }

    setState(() {
      _error = null;
      if (_step < _steps.length - 1) _step++;
    });
    _scroll.jumpTo(0);
  }

  void _back() {
    if (_step == 0) {
      Navigator.of(context).maybePop();
      return;
    }
    setState(() {
      _error = null;
      _step--;
    });
    _scroll.jumpTo(0);
  }

  Future<void> _addPhoto({required bool fromCamera}) async {
    if (_photos.length >= maxWorkshopPhotos) return;

    final uid = ref.read(authServiceProvider).currentUser?.uid;
    if (uid == null) return;

    setState(() {
      _uploading = true;
      _error = null;
    });
    try {
      final picked = await ref.read(imageUploadServiceProvider).pick(fromCamera: fromCamera);
      if (picked == null) return;

      // Uploaded against the auth uid, which exists before the store document
      // does — so photos can be gathered during registration.
      final url = await ref
          .read(imageUploadServiceProvider)
          .uploadWorkshopPhoto(storeId: uid, source: picked);

      if (mounted) setState(() => _photos.add(url));
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  /// Straight into verification.
  ///
  /// The record now exists but cannot be approved until the identity check
  /// passes, so leaving the mechanic to find the step on their own would
  /// strand the application. pushReplacement, so there is no route back into a
  /// form that has already been submitted.
  Future<void> _openIdentityStep() {
    return Navigator.of(context).pushReplacement<void, void>(
      MaterialPageRoute(builder: (_) => const MechanicIdentityScreen(afterRegistration: true)),
    );
  }

  Future<void> _submit() async {
    if (!_accepted) {
      setState(() => _error = 'Please accept the Terms and Privacy Policy.');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final phone = ref.read(authServiceProvider).currentUser?.phoneNumber ?? '';

      await ref.read(storeServiceProvider).register(
            businessType: BusinessType.mechanic,
            businessName: _businessName.text.trim(),
            ownerName: _ownerName.text.trim(),
            phone: phone,
            whatsapp: _whatsapp.text.trim(),
            // Optional for mechanics — most independent workshops are not
            // incorporated, and identity is proven by BVN and NIN instead.
            cacNumber: _cac.text.trim(),
            address: _address.text.trim(),
            state: _state,
            city: _city.text.trim(),
            description: _description.text.trim(),
            email: _email.text.trim(),
            landmark: _landmark.text.trim(),
            specialties: _selected.toList(),
            photos: _photos,
          );

      if (!mounted) return;
      await _openIdentityStep();
    } catch (e) {
      // The store already exists and belongs to this account. That is what a
      // registration which reached the server but whose reply was lost looks
      // like on the second press — a real possibility on a Nigerian mobile
      // network, and one this screen cannot otherwise recover from: unlike
      // the dealer wizard, which is returned inside app_gate and re-routes on
      // its own when the store document arrives, this screen is pushed above
      // the gate. Left alone it would answer "This account already has a
      // store" forever, with four completed steps behind it.
      if (isAlreadyRegistered(e)) {
        if (!mounted) return;
        await _openIdentityStep();
        return;
      }
      if (mounted) setState(() => _error = friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: NphColors.background,
      appBar: AppBar(
        title: Text('Mechanic sign-up · ${_steps[_step]}'),
        leading: BackButton(onPressed: _back),
      ),
      body: SafeArea(
        child: Column(
          children: [
            // NphStepper, not a private bar. It carries the step LABELS the
            // hand-rolled version dropped, so a mechanic can see that Photos
            // is coming rather than only that a bar has grown.
            Padding(
              padding: const EdgeInsets.fromLTRB(
                NphSpacing.xl,
                NphSpacing.md,
                NphSpacing.xl,
                NphSpacing.xs,
              ),
              child: NphStepper(steps: _steps, current: _step),
            ),
            Expanded(
              child: SingleChildScrollView(
                controller: _scroll,
                padding: const EdgeInsets.fromLTRB(
                    NphSpacing.xl, NphSpacing.lg, NphSpacing.xl, NphSpacing.xxl),
                child: Form(
                  key: _keys[_step],
                  child: switch (_step) {
                    0 => _workshopStep(),
                    1 => _servicesStep(),
                    2 => _locationStep(),
                    _ => _photosStep(),
                  },
                ),
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(NphSpacing.xl, 0, NphSpacing.xl, NphSpacing.sm),
                child: NphNotice(message: _error!),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  NphSpacing.xl, NphSpacing.sm, NphSpacing.xl, NphSpacing.xl),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _busy || _uploading
                      ? null
                      : _step == _steps.length - 1
                          ? _submit
                          : _next,
                  child: _busy
                      ? const SizedBox(
                          height: 18,
                          width: 18,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : Text(_step == _steps.length - 1 ? 'Submit for review' : 'Continue'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _workshopStep() => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          NphField(
            label: 'Workshop or Business Name',
            child: TextFormField(
              controller: _businessName,
              textCapitalization: TextCapitalization.words,
              validator: (v) => (v ?? '').trim().isEmpty ? 'Enter your workshop name' : null,
            ),
          ),
          NphField(
            label: 'Your Full Name',
            child: TextFormField(
              controller: _ownerName,
              textCapitalization: TextCapitalization.words,
              // Compared against the government record during verification, so
              // the wording asks for the legal name rather than a nickname.
              validator: (v) => (v ?? '').trim().isEmpty ? 'Enter your full name' : null,
            ),
          ),
          const Padding(
            padding: EdgeInsets.only(bottom: NphSpacing.lg),
            child: Text(
              'Use the name on your NIN — we check it against your BVN and NIN later.',
              style: TextStyle(fontSize: 12, color: NphColors.mutedForeground),
            ),
          ),
          NphField(
            label: 'About your workshop',
            child: TextFormField(
              controller: _description,
              maxLines: 4,
              maxLength: 2000,
              validator: (v) => (v ?? '').trim().isEmpty ? 'Tell buyers what you do' : null,
            ),
          ),
          NphField(
            label: 'CAC Registration Number',
            optional: true,
            child: TextFormField(controller: _cac),
          ),
          const Text(
            'Only if your workshop is registered with CAC. Most mechanics do not have one — '
            'it is not required.',
            style: TextStyle(fontSize: 12, color: NphColors.mutedForeground),
          ),
        ],
      );

  Widget _servicesStep() => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Which services do you offer?',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: NphSpacing.xs),
          const Text(
            'Buyers filter by these, so choose everything you genuinely do.',
            style: TextStyle(color: NphColors.mutedForeground),
          ),
          const SizedBox(height: NphSpacing.lg),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final s in mechanicSpecialties)
                FilterChip(
                  label: Text(s.label),
                  selected: _selected.contains(s.id),
                  onSelected: (on) => setState(() {
                    _error = null;
                    on ? _selected.add(s.id) : _selected.remove(s.id);
                  }),
                ),
            ],
          ),
        ],
      );

  Widget _locationStep() => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          NphField(
            label: 'WhatsApp Number',
            child: TextFormField(
              controller: _whatsapp,
              keyboardType: TextInputType.phone,
              validator: (v) => (v ?? '').trim().isEmpty ? 'Buyers contact you here' : null,
            ),
          ),
          NphField(
            label: 'Email Address',
            optional: true,
            child: TextFormField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
            ),
          ),
          NphField(
            label: 'State',
            child: DropdownButtonFormField<String>(
              initialValue: _state.isEmpty ? null : _state,
              items: [
                for (final s in nigerianStates) DropdownMenuItem(value: s, child: Text(s)),
              ],
              onChanged: (v) => setState(() => _state = v ?? ''),
              validator: (v) => (v ?? '').isEmpty ? 'Choose your state' : null,
            ),
          ),
          NphField(
            label: 'City / Town',
            child: TextFormField(
              controller: _city,
              textCapitalization: TextCapitalization.words,
              validator: (v) => (v ?? '').trim().isEmpty ? 'Enter your city' : null,
            ),
          ),
          NphField(
            label: 'Workshop Address',
            child: TextFormField(
              controller: _address,
              maxLines: 2,
              validator: (v) => (v ?? '').trim().isEmpty ? 'Enter your address' : null,
            ),
          ),
          NphField(
            label: 'Landmark',
            optional: true,
            child: TextFormField(controller: _landmark),
          ),
        ],
      );

  Widget _photosStep() => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Photos of your work',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: NphSpacing.xs),
          const Text(
            'Up to $maxWorkshopPhotos photos of your workshop or jobs you have completed. '
            'This is what convinces a buyer to call you.',
            style: TextStyle(color: NphColors.mutedForeground),
          ),
          const SizedBox(height: NphSpacing.lg),
          if (_photos.isNotEmpty)
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
                        borderRadius: BorderRadius.circular(NphRadius.md),
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
                          onTap: () => setState(() => _photos.remove(url)),
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
          const SizedBox(height: NphSpacing.md),
          if (_photos.length < maxWorkshopPhotos)
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _uploading ? null : () => _addPhoto(fromCamera: true),
                    icon: const Icon(Icons.photo_camera_outlined),
                    label: const Text('Camera'),
                  ),
                ),
                const SizedBox(width: NphSpacing.sm),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _uploading ? null : () => _addPhoto(fromCamera: false),
                    icon: const Icon(Icons.photo_library_outlined),
                    label: const Text('Gallery'),
                  ),
                ),
              ],
            )
          else
            const Text(
              'You have added the maximum number of photos.',
              style: TextStyle(fontSize: 12, color: NphColors.mutedForeground),
            ),
          if (_uploading)
            const Padding(
              padding: EdgeInsets.only(top: NphSpacing.md),
              child: LinearProgressIndicator(),
            ),
          const SizedBox(height: NphSpacing.xl),
          CheckboxListTile(
            value: _accepted,
            onChanged: (v) => setState(() => _accepted = v ?? false),
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            title: const Text(
              'I agree to the Terms and Privacy Policy, and confirm this workshop is mine.',
              style: TextStyle(fontSize: 13),
            ),
          ),
          const SizedBox(height: NphSpacing.sm),
          const Text(
            'Next you will verify your identity with your BVN and NIN. '
            'We never store those numbers.',
            style: TextStyle(fontSize: 12, color: NphColors.mutedForeground),
          ),
        ],
      );
}

/// The 36 states plus the FCT.
const nigerianStates = <String>[
  'Abia',
  'Adamawa',
  'Akwa Ibom',
  'Anambra',
  'Bauchi',
  'Bayelsa',
  'Benue',
  'Borno',
  'Cross River',
  'Delta',
  'Ebonyi',
  'Edo',
  'Ekiti',
  'Enugu',
  'FCT (Abuja)',
  'Gombe',
  'Imo',
  'Jigawa',
  'Kaduna',
  'Kano',
  'Katsina',
  'Kebbi',
  'Kogi',
  'Kwara',
  'Lagos',
  'Nasarawa',
  'Niger',
  'Ogun',
  'Ondo',
  'Osun',
  'Oyo',
  'Plateau',
  'Rivers',
  'Sokoto',
  'Taraba',
  'Yobe',
  'Zamfara',
];
