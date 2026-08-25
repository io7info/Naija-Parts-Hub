import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/env.dart';
import '../../core/errors.dart';
import '../../design/components.dart';
import '../../design/tokens.dart';
import '../../models/store.dart';
import '../../services/store_service.dart';
import '../registration/mechanic_identity_screen.dart';
import '../registration/mechanic_registration_screen.dart' show mechanicSpecialties;

/// The mechanic's own view of their workshop.
///
/// The counterpart of My Store for a dealer, and deliberately not a copy of it:
/// there is no listing quota, no subscription card and no upgrade prompt,
/// because a mechanic has none of those. What they can change is what they
/// offer and how they are described.
class MechanicProfileScreen extends ConsumerStatefulWidget {
  const MechanicProfileScreen({super.key, required this.store});

  final Store store;

  @override
  ConsumerState<MechanicProfileScreen> createState() => _MechanicProfileScreenState();
}

class _MechanicProfileScreenState extends ConsumerState<MechanicProfileScreen> {
  late final Set<String> _selected = {...?widget.store.mechanic?.specialties};
  bool _saving = false;
  String? _error;
  String? _saved;

  Future<void> _saveServices() async {
    if (_selected.isEmpty) {
      setState(() => _error = 'Keep at least one service — buyers filter by these.');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
      _saved = null;
    });
    try {
      // A plain client write. Rules cap the array and forbid every
      // backend-controlled field, so this needs no callable — unlike
      // publishing, there is no quota to enforce transactionally.
      await ref.read(storeServiceProvider).updateProfile(widget.store.storeId, {
        'mechanic': {
          'specialties': _selected.toList(),
          'photos': widget.store.mechanic?.photos ?? const <String>[],
        },
      });
      if (mounted) setState(() => _saved = 'Services updated');
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final store = widget.store;
    final publicUrl = '${Env.marketplaceOrigin}/mechanic/${store.slug}';

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            store.businessName,
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 4),
          Text(
            '${store.city}, ${store.state}',
            style: const TextStyle(color: NphColors.mutedForeground),
          ),
          const SizedBox(height: 16),

          _IdentityCard(store: store),
          const SizedBox(height: 20),

          const NphSectionHeader(title: 'Services you offer'),
          const SizedBox(height: 8),
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
                    _saved = null;
                    on ? _selected.add(s.id) : _selected.remove(s.id);
                  }),
                ),
            ],
          ),
          const SizedBox(height: 12),
          if (_error != null)
            Text(_error!, style: const TextStyle(color: NphColors.error, fontSize: 13)),
          if (_saved != null)
            Text(_saved!, style: const TextStyle(color: NphColors.success, fontSize: 13)),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: _saving ? null : _saveServices,
              child: _saving
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Save services'),
            ),
          ),

          const SizedBox(height: 28),
          const NphSectionHeader(title: 'Your public profile'),
          const SizedBox(height: 8),
          // Only meaningful once approved — before that the URL 404s, and
          // showing it would invite a mechanic to share a dead link.
          if (store.status == StoreStatus.approved)
            SelectableText(
              publicUrl,
              style: const TextStyle(fontSize: 13, color: NphColors.mutedForeground),
            )
          else
            const Text(
              'Your profile goes live once your application is approved.',
              style: TextStyle(fontSize: 13, color: NphColors.mutedForeground),
            ),
        ],
      ),
    );
  }
}

/// Identity state, shown to the mechanic themselves.
///
/// Worth its own card because it is the one thing that can block approval, and
/// a mechanic waiting on a decision deserves to know whether the hold-up is
/// them or us.
class _IdentityCard extends StatelessWidget {
  const _IdentityCard({required this.store});

  final Store store;

  @override
  Widget build(BuildContext context) {
    final identity = store.identity;
    final verified = identity?.isVerified ?? false;

    final (Color tone, IconData icon, String title, String body) = switch (identity?.status) {
      IdentityStatus.verified => (
          NphColors.success,
          Icons.verified_outlined,
          'Identity verified',
          identity?.bvnLast4 != null
              ? 'BVN ending ${identity!.bvnLast4}, NIN ending ${identity.ninLast4 ?? '––'}.'
              : 'Your identity has been confirmed.',
        ),
      IdentityStatus.manualReview => (
          NphColors.warning,
          Icons.hourglass_empty,
          'Under review',
          'Your numbers were found, but the name did not match exactly. Our team is '
              'checking it — you do not need to do anything.',
        ),
      IdentityStatus.failed => (
          NphColors.error,
          Icons.error_outline,
          'Verification failed',
          'We could not confirm those details. Open verification again to retry.',
        ),
      IdentityStatus.pending => (
          NphColors.mutedForeground,
          Icons.hourglass_empty,
          'Checking…',
          'Your identity check is in progress.',
        ),
      _ => (
          NphColors.mutedForeground,
          Icons.badge_outlined,
          identity?.reverificationRequired == true
              ? 'Please verify again'
              : 'Identity not verified',
          identity?.reverificationRequired == true
              // The distinction matters: this is our doing, not theirs.
              ? 'For security reasons we need you to confirm your identity once more. '
                  'This is not a problem with your account.'
              : 'Your profile cannot be approved until your identity is verified.',
        ),
    };

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.07),
        borderRadius: NphRadius.cardBorder,
        border: Border.all(color: tone.withValues(alpha: 0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: tone),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: TextStyle(fontWeight: FontWeight.bold, color: tone)),
                const SizedBox(height: 3),
                Text(body, style: const TextStyle(fontSize: 12.5, height: 1.4)),
                if (!verified) ...[
                  const SizedBox(height: 10),
                  FilledButton.tonal(
                    // A MaterialPageRoute rather than a named route: the app
                    // registers no route table — every screen is pushed
                    // directly — so pushNamed would throw here.
                    onPressed: () => Navigator.of(context).push<void>(
                      MaterialPageRoute(builder: (_) => const MechanicIdentityScreen()),
                    ),
                    child: const Text('Verify identity'),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
