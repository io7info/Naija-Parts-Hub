import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/sync_status_service.dart';

/// Visible sync status (SOW section 10).
///
/// Reads Firestore snapshot metadata rather than a hand-maintained flag. The
/// inherited app carried a `synced` boolean on every model and never showed it,
/// so a dealer had no way to know whether the day's sales had reached the
/// server.
class SyncStatusBanner extends ConsumerWidget {
  const SyncStatusBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(syncStatusProvider);

    return status.when(
      loading: SizedBox.shrink,
      error: (_, __) => const SizedBox.shrink(),
      data: (snapshot) {
        final (icon, colour) = switch (snapshot.state) {
          SyncState.synced => (Icons.cloud_done_outlined, Colors.green),
          SyncState.pending => (Icons.cloud_upload_outlined, Colors.orange),
          SyncState.offline => (Icons.cloud_off_outlined, Colors.blueGrey),
        };

        // Nothing to say when everything is saved and online.
        if (snapshot.state == SyncState.synced) return const SizedBox.shrink();

        return Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          color: colour.withValues(alpha: 0.10),
          child: Row(
            children: [
              Icon(icon, size: 16, color: colour),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  snapshot.label,
                  style: TextStyle(fontSize: 12, color: colour.shade900),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
