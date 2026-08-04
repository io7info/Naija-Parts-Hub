import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../design/components.dart';
import '../../design/tokens.dart';
import '../../models/listing.dart';
import '../../services/listing_service.dart';
import '../../services/sync_status_service.dart';

/// Sync status (SOW §10, "visible sync status").
///
/// Everything here is read from Firestore snapshot metadata — `hasPendingWrites`
/// and `isFromCache` — rather than from a hand-maintained flag. The inherited
/// app carried a `synced` boolean on every model and surfaced it nowhere, so a
/// dealer had no way to know whether the day's work had reached the server.
///
/// There is no "sync now" button, and that is deliberate: Firestore replays
/// queued writes automatically on reconnect. A button would either do nothing
/// or imply the queue needs manual attention, and a dealer who taps it and sees
/// no change learns to distrust the whole indicator.
class SyncStatusScreen extends ConsumerWidget {
  const SyncStatusScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sync = ref.watch(syncStatusProvider);
    final listings = ref.watch(myListingsProvider);
    final pending = (listings.valueOrNull ?? const <Listing>[])
        .where((l) => l.hasPendingWrites)
        .toList();

    final state = sync.valueOrNull?.state ?? SyncState.synced;

    return Scaffold(
      backgroundColor: NphColors.background,
      appBar: AppBar(
        title: const Text('Sync Status'),
        leading: NphIconButton(
          icon: Icons.arrow_back,
          tooltip: 'Back',
          onPressed: () => Navigator.of(context).maybePop(),
        ),
        shape: const Border(bottom: BorderSide(color: NphColors.border)),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(NphSpacing.appPage),
          children: [
            _hero(context, state, sync.valueOrNull?.pendingCount ?? 0),
            const SizedBox(height: NphSpacing.xl),

            const NphSectionHeader(title: 'What this means'),
            const SizedBox(height: NphSpacing.md),
            const NphSettingsGroup(
              title: 'How syncing works',
              children: [
                NphSettingsRow(
                  icon: Icons.save_outlined,
                  label: 'Changes save on this phone first',
                  onTap: null,
                ),
                NphSettingsRow(
                  icon: Icons.sync,
                  label: 'They upload automatically when you reconnect',
                  onTap: null,
                ),
                NphSettingsRow(
                  icon: Icons.cloud_off_outlined,
                  label: 'Publishing needs a connection',
                  onTap: null,
                ),
              ],
            ),

            if (pending.isNotEmpty) ...[
              const SizedBox(height: NphSpacing.xl),
              NphSectionHeader(title: 'Waiting to upload (${pending.length})'),
              const SizedBox(height: NphSpacing.md),
              for (final l in pending)
                Padding(
                  padding: const EdgeInsets.only(bottom: NphSpacing.sm),
                  child: NphCard(
                    padding: const EdgeInsets.all(NphSpacing.md),
                    child: Row(
                      children: [
                        const Icon(
                          Icons.cloud_upload_outlined,
                          size: 18,
                          color: NphColors.warning,
                        ),
                        const SizedBox(width: NphSpacing.md),
                        Expanded(
                          child: Text(
                            l.name.isEmpty ? '(untitled listing)' : l.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontFamily: NphFonts.body,
                              fontSize: 14,
                              color: NphColors.foreground,
                            ),
                          ),
                        ),
                        NphStatusBadge.forListingStatus(l.status.name),
                      ],
                    ),
                  ),
                ),
            ],

            const SizedBox(height: NphSpacing.xl),
            const Text(
              'Your listings are cached on this phone, so you can keep working with no '
              'signal. Nothing is lost while you are offline.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontFamily: NphFonts.body,
                fontSize: 12,
                height: 1.5,
                color: NphColors.mutedForeground,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _hero(BuildContext context, SyncState state, int pendingCount) {
    final (icon, tone, title, body) = switch (state) {
      SyncState.synced => (
          Icons.cloud_done_outlined,
          NphTone.success,
          'Everything is synced',
          'All your changes have reached the server.',
        ),
      SyncState.pending => (
          Icons.cloud_upload_outlined,
          NphTone.warning,
          '$pendingCount change${pendingCount == 1 ? '' : 's'} waiting to sync',
          'These will upload on their own as soon as you have a connection.',
        ),
      SyncState.offline => (
          Icons.cloud_off_outlined,
          NphTone.neutral,
          'Offline',
          'You are working from this phone. Changes are saved locally and will '
              'upload when you reconnect.',
        ),
    };

    final colors = switch (tone) {
      NphTone.success => (NphColors.success, NphColors.success10),
      NphTone.warning => (NphColors.warning, NphColors.warning10),
      _ => (NphColors.mutedForeground, NphColors.muted),
    };

    return NphCard(
      padding: const EdgeInsets.all(NphSpacing.xl),
      child: Column(
        children: [
          NphIconTile(
            icon: icon,
            size: NphIconTileSize.success,
            background: colors.$2,
            foreground: colors.$1,
          ),
          const SizedBox(height: NphSpacing.lg),
          Text(
            title,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: NphSpacing.sm),
          Text(
            body,
            textAlign: TextAlign.center,
            style: Theme.of(context)
                .textTheme
                .bodyMedium
                ?.copyWith(color: NphColors.mutedForeground),
          ),
        ],
      ),
    );
  }
}
