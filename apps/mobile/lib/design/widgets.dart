import 'package:flutter/material.dart';

import 'tokens.dart';

/// Shared presentation widgets.
///
/// Kept free of business logic so screens can be restyled without touching
/// behaviour, and so the states that actually matter to a dealer — loading,
/// error, empty — look the same everywhere rather than being reinvented per
/// screen.

/// The NPH mark. `light` is the black-gear-on-white variant for light
/// surfaces; `dark` is orange-on-black for splash and dark headers.
class NphLogo extends StatelessWidget {
  const NphLogo({super.key, this.size = 56, this.variant = NphLogoVariant.light});

  final double size;
  final NphLogoVariant variant;

  @override
  Widget build(BuildContext context) {
    final asset = variant == NphLogoVariant.dark
        ? 'assets/brand/nph-logo-dark.png'
        : 'assets/brand/nph-logo-light.png';

    // SizedBox wrapped in Align, not a bare Image with width/height.
    //
    // width/height on an Image are *preferred* sizes: a parent passing tight
    // constraints overrides them. As a direct child of a ListView — which
    // stretches children to the full cross-axis width — a 44x44 logo was being
    // drawn across the entire screen. Align refuses the tight constraint, and
    // SizedBox then imposes the real one.
    return Align(
      alignment: Alignment.centerLeft,
      widthFactor: 1,
      heightFactor: 1,
      child: SizedBox(
        width: size,
        height: size,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(size * 0.28),
          child: Image.asset(asset, fit: BoxFit.contain),
        ),
      ),
    );
  }
}

enum NphLogoVariant { light, dark }

/// Field label rendered above the input, as in the approved screens, rather
/// than as a floating Material label inside the box.
class NphFieldLabel extends StatelessWidget {
  const NphFieldLabel(this.text, {super.key, this.optional = false});

  final String text;
  final bool optional;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: NphSpacing.sm),
      child: Row(
        children: [
          Text(text, style: Theme.of(context).textTheme.labelLarge),
          if (optional)
            Text(
              ' (optional)',
              style: Theme.of(context).textTheme.bodySmall,
            ),
        ],
      ),
    );
  }
}

/// Status pill used for store and listing states.
class NphStatusBadge extends StatelessWidget {
  const NphStatusBadge({super.key, required this.label, required this.tone});

  final String label;
  final NphTone tone;

  factory NphStatusBadge.forStoreStatus(String status) => switch (status) {
        'approved' => const NphStatusBadge(label: 'Approved', tone: NphTone.success),
        'rejected' => const NphStatusBadge(label: 'Rejected', tone: NphTone.error),
        'suspended' => const NphStatusBadge(label: 'Suspended', tone: NphTone.error),
        _ => const NphStatusBadge(label: 'Pending', tone: NphTone.warning),
      };

  factory NphStatusBadge.forListingStatus(String status) => switch (status) {
        'active' => const NphStatusBadge(label: 'Published', tone: NphTone.success),
        'archived' => const NphStatusBadge(label: 'Unpublished', tone: NphTone.neutral),
        _ => const NphStatusBadge(label: 'Draft', tone: NphTone.warning),
      };

  @override
  Widget build(BuildContext context) {
    final (fg, bg) = switch (tone) {
      NphTone.success => (NphColors.success, NphColors.success.withValues(alpha: 0.12)),
      NphTone.warning => (NphColors.warning, NphColors.warning.withValues(alpha: 0.14)),
      NphTone.error => (NphColors.error, NphColors.error.withValues(alpha: 0.12)),
      NphTone.brand => (NphColors.orange, NphColors.orangeSubtle),
      NphTone.neutral => (NphColors.mutedForeground, NphColors.muted),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: NphSpacing.md, vertical: 5),
      decoration: BoxDecoration(color: bg, borderRadius: NphRadius.pillBorder),
      child: Text(
        label,
        style: TextStyle(
          fontFamily: NphFonts.body,
          fontSize: 12,
          fontWeight: FontWeight.w700,
          color: fg,
        ),
      ),
    );
  }
}

enum NphTone { success, warning, error, brand, neutral }

/// Full-screen loading state.
class NphLoading extends StatelessWidget {
  const NphLoading({super.key, this.message});

  final String? message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(
            width: 28,
            height: 28,
            child: CircularProgressIndicator(strokeWidth: 2.5, color: NphColors.orange),
          ),
          if (message != null) ...[
            const SizedBox(height: NphSpacing.lg),
            Text(message!, style: Theme.of(context).textTheme.bodySmall),
          ],
        ],
      ),
    );
  }
}

/// Error state with an optional retry.
///
/// Takes a plain message rather than an exception: a dealer should never be
/// shown a stack trace or a Firebase error code.
class NphErrorState extends StatelessWidget {
  const NphErrorState({
    super.key,
    required this.message,
    this.title = 'Something went wrong',
    this.onRetry,
  });

  final String title;
  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(NphSpacing.xxxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(NphSpacing.lg),
              decoration: BoxDecoration(
                color: NphColors.error.withValues(alpha: 0.10),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.error_outline, color: NphColors.error, size: 28),
            ),
            const SizedBox(height: NphSpacing.xl),
            Text(title, style: Theme.of(context).textTheme.titleLarge, textAlign: TextAlign.center),
            const SizedBox(height: NphSpacing.sm),
            Text(
              message,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: NphColors.mutedForeground,
                  ),
              textAlign: TextAlign.center,
            ),
            if (onRetry != null) ...[
              const SizedBox(height: NphSpacing.xxl),
              OutlinedButton(onPressed: onRetry, child: const Text('Try again')),
            ],
          ],
        ),
      ),
    );
  }
}

/// Empty state — distinct from an error, because "you have no listings yet" is
/// not a failure and should not look like one.
class NphEmptyState extends StatelessWidget {
  const NphEmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.action,
  });

  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(NphSpacing.xxxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(NphSpacing.xl),
              decoration: const BoxDecoration(color: NphColors.warm, shape: BoxShape.circle),
              child: Icon(icon, color: NphColors.orange, size: 30),
            ),
            const SizedBox(height: NphSpacing.xl),
            Text(title, style: Theme.of(context).textTheme.titleLarge, textAlign: TextAlign.center),
            const SizedBox(height: NphSpacing.sm),
            Text(
              message,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: NphColors.mutedForeground,
                  ),
              textAlign: TextAlign.center,
            ),
            if (action != null) ...[
              const SizedBox(height: NphSpacing.xxl),
              action!,
            ],
          ],
        ),
      ),
    );
  }
}

/// Inline notice used for form-level errors and informational messages.
class NphNotice extends StatelessWidget {
  const NphNotice({super.key, required this.message, this.tone = NphTone.error});

  final String message;
  final NphTone tone;

  @override
  Widget build(BuildContext context) {
    final (fg, bg) = switch (tone) {
      NphTone.success => (NphColors.success, NphColors.success.withValues(alpha: 0.08)),
      NphTone.warning => (NphColors.warning, NphColors.warning.withValues(alpha: 0.10)),
      NphTone.brand => (NphColors.orange, NphColors.orangeSubtle),
      NphTone.neutral => (NphColors.mutedForeground, NphColors.muted),
      NphTone.error => (NphColors.error, NphColors.error.withValues(alpha: 0.08)),
    };

    return Container(
      padding: const EdgeInsets.all(NphSpacing.md),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: NphRadius.fieldBorder,
        border: Border.all(color: fg.withValues(alpha: 0.30)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            tone == NphTone.error ? Icons.error_outline : Icons.info_outline,
            size: 18,
            color: fg,
          ),
          const SizedBox(width: NphSpacing.sm),
          Expanded(
            child: Text(
              message,
              style: TextStyle(fontFamily: NphFonts.body, fontSize: 13, height: 1.45, color: fg),
            ),
          ),
        ],
      ),
    );
  }
}
