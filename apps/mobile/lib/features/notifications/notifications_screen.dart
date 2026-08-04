import 'package:flutter/material.dart';

import '../../design/components.dart';
import '../../design/tokens.dart';

/// Notifications.
///
/// Empty by design, not by omission. SOW "Not Included in Phase 1" excludes
/// "Push, SMS, or WhatsApp automation", so there is no notification pipeline to
/// read from and nothing has been written to display.
///
/// The design mockup showed a populated list. Rendering invented entries here
/// would be worse than an empty state: a dealer would believe they had been
/// told something. The screen states plainly what it will carry once the
/// pipeline exists.
class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: NphColors.background,
      appBar: AppBar(
        title: const Text('Notifications'),
        leading: NphIconButton(
          icon: Icons.arrow_back,
          tooltip: 'Back',
          onPressed: () => Navigator.of(context).maybePop(),
        ),
        shape: const Border(bottom: BorderSide(color: NphColors.border)),
      ),
      body: const SafeArea(
        child: NphEmptyState(
          icon: Icons.notifications_none,
          title: 'No notifications yet',
          message: 'Approval updates and listing activity will appear here.',
        ),
      ),
    );
  }
}
