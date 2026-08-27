import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
///
/// Built from the shared components rather than hand-rolled containers. An
/// earlier version used literal font sizes and paddings, which put it a few
/// pixels off the dealer screens on every axis — close enough to look
/// intentional, wrong enough to read as unfinished.
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

  Future<void> _saveServices() async {
    if (_selected.isEmpty) {
      setState(() => _error = 'Keep at least one service — buyers filter by these.');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
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
      if (!mounted) return;
      // A snackbar rather than a line of green text under the button. The
      // confirmation is transient by nature, and inline text either lingers
      // after it stops being true or has to be cleared by hand on every edit.
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Services updated')),
      );
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final store = widget.store;
    final text = Theme.of(context).textTheme;
    final publicUrl = '${Env.marketplaceOrigin}/mechanic/${store.slug}';

    // SingleChildScrollView, not ListView: these panes are short, and a
    // lazy list would leave the lower cards unbuilt until scrolled to —
    // which costs nothing here and quietly changes what exists on screen.
    return SingleChildScrollView(
      padding: const EdgeInsets.all(NphSpacing.appPage),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // The same NphBusinessHeader the dealer's Account card uses.
          // Same layout, mechanic content: workshop name over location, with
          // standing and a service count instead of owner over business over
          // phone.
          NphBusinessHeader(
            avatarName: store.businessName,
            title: store.businessName,
            subtitle: '${store.city}, ${store.state}',
            subtitleIcon: Icons.location_on_outlined,
            badges: [
              if (store.status == StoreStatus.approved)
                const NphVerifiedBadge()
              else
                NphStatusBadge.forStoreStatus(store.status.name),
              NphMetaPill(
                icon: Icons.build_outlined,
                label: _selected.length == 1 ? '1 service' : '${_selected.length} services',
              ),
            ],
          ),
          const SizedBox(height: NphSpacing.lg),
          _IdentityCard(store: store),
          const SizedBox(height: NphSpacing.xxl),
          const NphSectionHeader(title: 'Services you offer'),
          const SizedBox(height: NphSpacing.xs),
          Text(
            'Buyers filter by these, so choose everything you genuinely do.',
            style: text.bodySmall,
          ),
          const SizedBox(height: NphSpacing.md),
          Wrap(
            spacing: NphSpacing.sm,
            runSpacing: NphSpacing.sm,
            children: [
              for (final s in mechanicSpecialties)
                FilterChip(
                  label: Text(s.label),
                  selected: _selected.contains(s.id),
                  showCheckmark: true,
                  onSelected: (on) => setState(() {
                    _error = null;
                    on ? _selected.add(s.id) : _selected.remove(s.id);
                  }),
                ),
            ],
          ),
          if (_error != null) ...[
            const SizedBox(height: NphSpacing.md),
            NphNotice(message: _error!),
          ],
          const SizedBox(height: NphSpacing.lg),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: _saving ? null : _saveServices,
              child: _saving ? const _ButtonSpinner() : const Text('Save services'),
            ),
          ),
          const SizedBox(height: NphSpacing.xxxl),
          const NphSectionHeader(title: 'Your public profile'),
          const SizedBox(height: NphSpacing.sm),
          _PublicProfileCard(
            store: store,
            url: publicUrl,
            photoCount: store.mechanic?.photos.length ?? 0,
          ),
          const SizedBox(height: NphSpacing.xl),
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
///
/// It carries no identifier fragments — no last-four, no name-match score, no
/// provider reference. Those are review evidence and belong to the
/// administrators who review; this screen is opened daily, in a workshop, with
/// customers nearby.
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
          Icons.verified_user_outlined,
          'Identity verified',
          'Your BVN and NIN have been confirmed. Buyers see a Verified badge '
              'on your profile.',
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

    return NphCard(
      color: tone.withValues(alpha: 0.06),
      padding: const EdgeInsets.all(NphSpacing.lg),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          NphIconTile(
            icon: icon,
            size: NphIconTileSize.stat,
            background: tone.withValues(alpha: 0.12),
            foreground: tone,
          ),
          const SizedBox(width: NphSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontFamily: NphFonts.heading,
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: tone,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  body,
                  style: const TextStyle(
                    fontFamily: NphFonts.body,
                    fontSize: 13,
                    height: 1.45,
                    color: NphColors.foreground,
                  ),
                ),
                if (!verified) ...[
                  const SizedBox(height: NphSpacing.md),
                  SizedBox(
                    height: NphSize.buttonHeightSmall,
                    child: FilledButton.tonal(
                      // A MaterialPageRoute rather than a named route: the app
                      // registers no route table — every screen is pushed
                      // directly — so pushNamed would throw here.
                      onPressed: () => Navigator.of(context).push<void>(
                        MaterialPageRoute(builder: (_) => const MechanicIdentityScreen()),
                      ),
                      child: const Text('Verify identity'),
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
}

/// The shareable link, and what a buyer will find behind it.
///
/// Before approval the URL 404s, so it is withheld rather than shown greyed —
/// handing someone a dead link to share is worse than not offering one.
class _PublicProfileCard extends StatelessWidget {
  const _PublicProfileCard({
    required this.store,
    required this.url,
    required this.photoCount,
  });

  final Store store;
  final String url;
  final int photoCount;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    if (store.status != StoreStatus.approved) {
      return NphCard(
        color: NphColors.warm,
        border: false,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.lock_outline, size: 18, color: NphColors.mutedForeground),
            const SizedBox(width: NphSpacing.sm),
            Expanded(
              child: Text(
                'Your profile goes live once your application is approved.',
                style: text.bodySmall,
              ),
            ),
          ],
        ),
      );
    }

    return NphCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.public, size: 16, color: NphColors.success),
              const SizedBox(width: NphSpacing.sm),
              Expanded(
                child: Text(
                  photoCount == 0
                      ? 'Live — add work photos to get more calls'
                      : '$photoCount work ${photoCount == 1 ? 'photo' : 'photos'} on your profile',
                  style: text.bodySmall?.copyWith(color: NphColors.foreground),
                ),
              ),
            ],
          ),
          const SizedBox(height: NphSpacing.md),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(NphSpacing.md),
            decoration: const BoxDecoration(
              color: NphColors.muted,
              borderRadius: BorderRadius.all(Radius.circular(NphRadius.md)),
            ),
            child: SelectableText(
              url,
              style: const TextStyle(
                fontFamily: NphFonts.body,
                fontSize: 12.5,
                color: NphColors.mutedForeground,
              ),
            ),
          ),
          const SizedBox(height: NphSpacing.sm),
          SizedBox(
            width: double.infinity,
            height: NphSize.buttonHeightCompact,
            child: OutlinedButton.icon(
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: url));
                if (!context.mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Link copied')),
                );
              },
              icon: const Icon(Icons.link, size: 18),
              label: const Text('Copy Link'),
            ),
          ),
        ],
      ),
    );
  }
}

/// The spinner every primary button uses while working.
class _ButtonSpinner extends StatelessWidget {
  const _ButtonSpinner();

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      height: 18,
      width: 18,
      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
    );
  }
}
