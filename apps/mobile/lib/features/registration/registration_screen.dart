import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../design/tokens.dart';
import '../../design/widgets.dart';
import '../../services/auth_service.dart';
import '../../services/store_service.dart';

/// Dealer business registration (SOW section 2).
///
/// FUNCTIONAL SCAFFOLD — no final styling.
///
/// Collects exactly the fields the SOW lists. Submission goes through the
/// registerStore callable, which reserves the store slug atomically and forces
/// status to 'pending'; approval is a separate admin action (§3).
class RegistrationScreen extends ConsumerStatefulWidget {
  const RegistrationScreen({super.key});

  @override
  ConsumerState<RegistrationScreen> createState() => _RegistrationScreenState();
}

class _RegistrationScreenState extends ConsumerState<RegistrationScreen> {
  final _formKey = GlobalKey<FormState>();

  final _businessName = TextEditingController();
  final _ownerName = TextEditingController();
  final _whatsapp = TextEditingController();
  final _cac = TextEditingController();
  final _address = TextEditingController();
  final _city = TextEditingController();
  final _description = TextEditingController();

  String _state = 'Lagos';
  bool _acceptedTerms = false;
  bool _busy = false;
  String? _error;

  // Trimmed for the scaffold; the full 36 + FCT list lives in
  // packages/contracts/src/common.ts and will be wired with the real form.
  static const _states = [
    'Abia', 'Anambra', 'FCT - Abuja', 'Enugu', 'Imo', 'Kaduna',
    'Kano', 'Lagos', 'Ogun', 'Oyo', 'Rivers',
  ];

  @override
  void dispose() {
    for (final c in [
      _businessName, _ownerName, _whatsapp, _cac, _address, _city, _description,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    if (!_acceptedTerms) {
      setState(() => _error = 'You must accept the Terms and Privacy Policy.');
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
            phone: ref.read(authServiceProvider).currentUser?.phoneNumber ?? '',
            whatsapp: _whatsapp.text.trim(),
            cacNumber: _cac.text.trim(),
            address: _address.text.trim(),
            state: _state,
            city: _city.text.trim(),
            description: _description.text.trim(),
          );
      // myStoreProvider is a live stream — the gate re-routes on its own.
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
      appBar: AppBar(
        title: const Text('Register your business'),
        actions: [
          IconButton(
            tooltip: 'Sign out',
            icon: const Icon(Icons.logout),
            onPressed: () => ref.read(authServiceProvider).signOut(),
          ),
        ],
      ),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.symmetric(
              horizontal: NphSpacing.page,
              vertical: NphSpacing.lg,
            ),
            children: [
              _field(_businessName, 'Business / shop name',
                  validator: (v) => _required(v, 'Business name')),
              _field(_ownerName, 'Owner / contact name',
                  validator: (v) => _required(v, 'Owner name')),
              _field(_whatsapp, 'WhatsApp number', keyboard: TextInputType.phone),
              _field(_cac, 'CAC registration number',
                  validator: (v) => _required(v, 'CAC number'),
                  helper: 'Verified manually by an administrator'),
              _field(_address, 'Shop address', validator: (v) => _required(v, 'Address')),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: DropdownButtonFormField<String>(
                  initialValue: _state,
                  decoration: const InputDecoration(labelText: 'State'),
                  items: _states
                      .map((s) => DropdownMenuItem(value: s, child: Text(s)))
                      .toList(),
                  onChanged: (v) => setState(() => _state = v ?? 'Lagos'),
                ),
              ),
              _field(_city, 'City', validator: (v) => _required(v, 'City')),
              _field(_description, 'Business description', maxLines: 3),
              CheckboxListTile(
                value: _acceptedTerms,
                onChanged: (v) => setState(() => _acceptedTerms = v ?? false),
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                title: const Text(
                  'I accept the Terms and Privacy Policy',
                  style: TextStyle(fontSize: 13),
                ),
              ),
              // Above the button, not below it. Below, the notice fell past the
              // bottom of the scroll view: tapping Submit with the terms
              // unticked looked like nothing happened at all.
              if (_error != null) ...[
                const SizedBox(height: NphSpacing.sm),
                NphNotice(message: _error!),
              ],
              const SizedBox(height: NphSpacing.lg),
              FilledButton(
                onPressed: _busy ? null : _submit,
                child: _busy
                    ? const SizedBox(
                        height: 18,
                        width: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Submit for approval'),
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
    String? helper,
    int maxLines = 1,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: NphSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          NphFieldLabel(label),
          TextFormField(
            controller: controller,
            validator: validator,
            keyboardType: keyboard,
            maxLines: maxLines,
            textInputAction:
                maxLines > 1 ? TextInputAction.newline : TextInputAction.next,
            decoration: InputDecoration(hintText: helper),
          ),
        ],
      ),
    );
  }
}
