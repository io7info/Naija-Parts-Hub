import 'package:flutter/material.dart';

import 'tokens.dart';

/// Components transcribed from the client-approved mobile design.
///
/// Each one names the Tailwind classes it implements, because that is the only
/// way a reviewer can check the translation without opening the design pack.
/// The screens compose these; they do not re-derive padding or radii inline.

// ---------------------------------------------------------------------------
// Icon tile — `bg-orange/10 text-orange` rounded square, four sizes.
// ---------------------------------------------------------------------------

enum NphIconTileSize {
  /// `size-9 rounded-xl` + `size-4` icon — dashboard stat cards.
  stat,

  /// `size-11 rounded-xl` + `size-5` icon — category cards.
  category,

  /// `size-16 rounded-full` + `size-8` icon — success confirmations.
  success,

  /// `size-24 rounded-3xl` + `size-11` icon — hero, empty and pending states.
  hero,
}

class NphIconTile extends StatelessWidget {
  const NphIconTile({
    super.key,
    required this.icon,
    this.size = NphIconTileSize.stat,
    this.background,
    this.foreground,
  });

  final IconData icon;
  final NphIconTileSize size;
  final Color? background;
  final Color? foreground;

  @override
  Widget build(BuildContext context) {
    final (box, glyph, radius) = switch (size) {
      NphIconTileSize.stat => (36.0, 16.0, NphRadius.xl),
      NphIconTileSize.category => (44.0, 20.0, NphRadius.xl),
      NphIconTileSize.success => (64.0, 32.0, NphRadius.pill),
      NphIconTileSize.hero => (96.0, 44.0, 35.0),
    };

    return Container(
      width: box,
      height: box,
      decoration: BoxDecoration(
        color: background ?? NphColors.orange10,
        borderRadius: BorderRadius.circular(radius),
      ),
      child: Icon(icon, size: glyph, color: foreground ?? NphColors.orange),
    );
  }
}

// ---------------------------------------------------------------------------
// Card — `rounded-2xl border border-border bg-card`.
// ---------------------------------------------------------------------------

class NphCard extends StatelessWidget {
  const NphCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(NphSpacing.lg),
    this.onTap,
    this.color,
    this.border = true,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final Color? color;
  final bool border;

  @override
  Widget build(BuildContext context) {
    final content = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: color ?? NphColors.card,
        borderRadius: NphRadius.cardBorder,
        border: border ? Border.all(color: NphColors.border) : null,
      ),
      child: child,
    );

    if (onTap == null) return content;
    return InkWell(
      onTap: onTap,
      borderRadius: NphRadius.cardBorder,
      child: content,
    );
  }
}

// ---------------------------------------------------------------------------
// Badges — `rounded-full px-2 py-0.5 text-[11px] font-semibold`.
// ---------------------------------------------------------------------------

enum NphTone { success, warning, error, brand, neutral }

({Color fg, Color bg}) _toneColors(NphTone tone) => switch (tone) {
      NphTone.success => (fg: NphColors.success, bg: NphColors.success10),
      NphTone.warning => (fg: NphColors.warning, bg: NphColors.warning10),
      NphTone.error => (fg: NphColors.error, bg: NphColors.error10),
      NphTone.brand => (fg: NphColors.orange, bg: NphColors.orange10),
      NphTone.neutral => (fg: NphColors.mutedForeground, bg: NphColors.muted),
    };

class NphStatusBadge extends StatelessWidget {
  const NphStatusBadge({super.key, required this.label, required this.tone, this.icon});

  final String label;
  final NphTone tone;
  final IconData? icon;

  /// Maps store status onto the design's badge vocabulary.
  factory NphStatusBadge.forStoreStatus(String status) => switch (status) {
        'approved' => const NphStatusBadge(label: 'Approved', tone: NphTone.success),
        'rejected' => const NphStatusBadge(label: 'Rejected', tone: NphTone.error),
        'suspended' => const NphStatusBadge(label: 'Suspended', tone: NphTone.error),
        _ => const NphStatusBadge(label: 'Pending', tone: NphTone.warning),
      };

  /// Listing status. The design labels these Active / Draft / Archived rather
  /// than Published / Draft / Unpublished — matched here so the app and the
  /// admin portal use one vocabulary.
  factory NphStatusBadge.forListingStatus(String status) => switch (status) {
        'active' => const NphStatusBadge(label: 'Active', tone: NphTone.success),
        'archived' => const NphStatusBadge(label: 'Archived', tone: NphTone.neutral),
        _ => const NphStatusBadge(label: 'Draft', tone: NphTone.neutral),
      };

  @override
  Widget build(BuildContext context) {
    final c = _toneColors(tone);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: NphSpacing.sm, vertical: 2),
      decoration: BoxDecoration(color: c.bg, borderRadius: NphRadius.pillBorder),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 12, color: c.fg),
            const SizedBox(width: 3),
          ],
          Text(
            label,
            style: TextStyle(
              fontFamily: NphFonts.body,
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: c.fg,
            ),
          ),
        ],
      ),
    );
  }
}

/// `bg-success/10 text-success` + BadgeCheck. Compact drops to 11 px.
class NphVerifiedBadge extends StatelessWidget {
  const NphVerifiedBadge({super.key, this.compact = false});

  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: compact ? 6 : NphSpacing.sm,
        vertical: compact ? 2 : 4,
      ),
      decoration: const BoxDecoration(
        color: NphColors.success10,
        borderRadius: NphRadius.pillBorder,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.verified_outlined, size: compact ? 12 : 14, color: NphColors.success),
          const SizedBox(width: 3),
          Text(
            'Verified',
            style: TextStyle(
              fontFamily: NphFonts.body,
              fontSize: compact ? 11 : 12,
              fontWeight: FontWeight.w600,
              color: NphColors.success,
            ),
          ),
        ],
      ),
    );
  }
}

/// New -> `bg-orange/10 text-orange`; Used -> `bg-muted text-muted-foreground`.
class NphConditionBadge extends StatelessWidget {
  const NphConditionBadge({super.key, required this.condition});

  final String condition;

  @override
  Widget build(BuildContext context) {
    final isNew = condition.toLowerCase() == 'new';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: NphSpacing.sm, vertical: 2),
      decoration: BoxDecoration(
        color: isNew ? NphColors.orange10 : NphColors.muted,
        borderRadius: NphRadius.pillBorder,
      ),
      child: Text(
        isNew ? 'New' : 'Used',
        style: TextStyle(
          fontFamily: NphFonts.body,
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: isNew ? NphColors.orange : NphColors.mutedForeground,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Filter chip — `rounded-full border px-3 py-1.5 text-xs font-semibold`.
// ---------------------------------------------------------------------------

class NphFilterChip extends StatelessWidget {
  const NphFilterChip({
    super.key,
    required this.label,
    this.active = false,
    this.onTap,
  });

  final String label;
  final bool active;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: NphRadius.pillBorder,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: NphSpacing.md, vertical: 6),
        decoration: BoxDecoration(
          color: active ? NphColors.orange : NphColors.card,
          borderRadius: NphRadius.pillBorder,
          border: Border.all(color: active ? NphColors.orange : NphColors.border),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontFamily: NphFonts.body,
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: active ? Colors.white : NphColors.foreground,
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Section header — heading + optional trailing action.
// ---------------------------------------------------------------------------

class NphSectionHeader extends StatelessWidget {
  const NphSectionHeader({
    super.key,
    required this.title,
    this.actionLabel,
    this.onAction,
    this.showChevron = false,
  });

  final String title;
  final String? actionLabel;
  final VoidCallback? onAction;
  final bool showChevron;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleLarge),
        if (actionLabel != null)
          InkWell(
            onTap: onAction,
            borderRadius: NphRadius.fieldBorder,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    actionLabel!,
                    style: const TextStyle(
                      fontFamily: NphFonts.body,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: NphColors.orange,
                    ),
                  ),
                  if (showChevron)
                    const Icon(Icons.chevron_right, size: 16, color: NphColors.orange),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Field label — sits ABOVE the input, `text-sm font-semibold text-foreground`.
// ---------------------------------------------------------------------------

class NphFieldLabel extends StatelessWidget {
  const NphFieldLabel(this.text, {super.key, this.optional = false});

  final String text;
  final bool optional;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: [
          Text(
            text,
            style: const TextStyle(
              fontFamily: NphFonts.body,
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: NphColors.foreground,
            ),
          ),
          if (optional)
            const Text(
              ' (optional)',
              style: TextStyle(
                fontFamily: NphFonts.body,
                fontSize: 13,
                color: NphColors.mutedForeground,
              ),
            ),
        ],
      ),
    );
  }
}

/// Label + field, the pairing every form screen repeats.
class NphField extends StatelessWidget {
  const NphField({
    super.key,
    required this.label,
    required this.child,
    this.optional = false,
  });

  final String label;
  final Widget child;
  final bool optional;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: NphSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [NphFieldLabel(label, optional: optional), child],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Segmented pair — the New / Used control on Add Listing.
// `border-orange bg-orange text-white` when selected.
// ---------------------------------------------------------------------------

class NphSegmented extends StatelessWidget {
  const NphSegmented({
    super.key,
    required this.options,
    required this.value,
    required this.onChanged,
  });

  final List<String> options;
  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (final option in options) ...[
          Expanded(
            child: InkWell(
              onTap: () => onChanged(option),
              borderRadius: NphRadius.buttonBorder,
              child: Container(
                height: NphSize.buttonHeightCompact,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: option == value ? NphColors.orange : NphColors.card,
                  borderRadius: NphRadius.buttonBorder,
                  border: Border.all(
                    color: option == value ? NphColors.orange : NphColors.border,
                  ),
                ),
                child: Text(
                  option,
                  style: TextStyle(
                    fontFamily: NphFonts.body,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: option == value ? Colors.white : NphColors.foreground,
                  ),
                ),
              ),
            ),
          ),
          if (option != options.last) const SizedBox(width: NphSpacing.sm),
        ],
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Stepper — the four-step register progress bar.
// Reached segments `bg-orange`, the rest `bg-border`; current label in orange.
// ---------------------------------------------------------------------------

class NphStepper extends StatelessWidget {
  const NphStepper({super.key, required this.steps, required this.current});

  final List<String> steps;
  final int current;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (var i = 0; i < steps.length; i++) ...[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  height: 6,
                  decoration: BoxDecoration(
                    color: i <= current ? NphColors.orange : NphColors.border,
                    borderRadius: NphRadius.pillBorder,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  steps[i],
                  style: TextStyle(
                    fontFamily: NphFonts.body,
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                    color: i == current ? NphColors.orange : NphColors.mutedForeground,
                  ),
                ),
              ],
            ),
          ),
          if (i != steps.length - 1) const SizedBox(width: 6),
        ],
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Timeline — the pending-approval status list.
// done `bg-success` + check · active `bg-orange` + spinner · todo `bg-muted`.
// ---------------------------------------------------------------------------

enum NphTimelineState { done, active, todo }

class NphTimelineStep {
  const NphTimelineStep({required this.label, required this.state, this.caption});

  final String label;
  final NphTimelineState state;
  final String? caption;
}

class NphTimeline extends StatelessWidget {
  const NphTimeline({super.key, required this.steps});

  final List<NphTimelineStep> steps;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < steps.length; i++)
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Column(
                  children: [
                    _node(steps[i].state),
                    if (i != steps.length - 1)
                      Expanded(
                        child: Container(width: 2, color: NphColors.border),
                      ),
                  ],
                ),
                const SizedBox(width: NphSpacing.md),
                Expanded(
                  child: Padding(
                    padding: EdgeInsets.only(
                      bottom: i == steps.length - 1 ? 0 : NphSpacing.xxl,
                      top: 4,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          steps[i].label,
                          style: const TextStyle(
                            fontFamily: NphFonts.body,
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: NphColors.foreground,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          steps[i].caption ??
                              switch (steps[i].state) {
                                NphTimelineState.done => 'Done',
                                NphTimelineState.active => 'In progress',
                                NphTimelineState.todo => 'Pending',
                              },
                          style: const TextStyle(
                            fontFamily: NphFonts.body,
                            fontSize: 12,
                            color: NphColors.mutedForeground,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _node(NphTimelineState state) {
    final (bg, child) = switch (state) {
      NphTimelineState.done => (
          NphColors.success,
          const Icon(Icons.check, size: 16, color: Colors.white),
        ),
      NphTimelineState.active => (
          NphColors.orange,
          const SizedBox(
            width: 14,
            height: 14,
            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
          ),
        ),
      NphTimelineState.todo => (
          NphColors.muted,
          const Icon(Icons.schedule, size: 16, color: NphColors.mutedForeground),
        ),
    };

    return Container(
      width: 32,
      height: 32,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
      child: child,
    );
  }
}

// ---------------------------------------------------------------------------
// Progress bar — quota fill. Track colour differs on dark vs light surfaces.
// ---------------------------------------------------------------------------

class NphProgressBar extends StatelessWidget {
  const NphProgressBar({
    super.key,
    required this.value,
    this.height = 8,
    this.onDark = false,
  });

  /// 0.0 – 1.0. Clamped, because a drifted counter must not overflow the track.
  final double value;
  final double height;
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: NphRadius.pillBorder,
      child: LinearProgressIndicator(
        value: value.clamp(0.0, 1.0),
        minHeight: height,
        backgroundColor: onDark ? Colors.white.withValues(alpha: 0.10) : NphColors.muted,
        valueColor: const AlwaysStoppedAnimation(NphColors.orange),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Inline banner — sync status, quota strips, form-level notices.
// `rounded-xl bg-<tone>/10 px-3.5 py-2.5 text-sm font-semibold`.
// ---------------------------------------------------------------------------

class NphBanner extends StatelessWidget {
  const NphBanner({
    super.key,
    required this.message,
    this.tone = NphTone.brand,
    this.icon,
    this.trailing,
    this.onTap,
  });

  final String message;
  final NphTone tone;
  final IconData? icon;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final c = _toneColors(tone);
    final content = Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(color: c.bg, borderRadius: NphRadius.fieldBorder),
      child: Row(
        children: [
          if (icon != null) ...[
            Icon(icon, size: 16, color: c.fg),
            const SizedBox(width: NphSpacing.sm),
          ],
          Expanded(
            child: Text(
              message,
              style: TextStyle(
                fontFamily: NphFonts.body,
                fontSize: 13,
                fontWeight: FontWeight.w600,
                height: 1.35,
                color: c.fg,
              ),
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );

    if (onTap == null) return content;
    return InkWell(onTap: onTap, borderRadius: NphRadius.fieldBorder, child: content);
  }
}

/// Form-level error notice. Distinct from [NphBanner] only in that it always
/// carries a border, which is what separates it from the page behind it when
/// it appears directly above a button.
class NphNotice extends StatelessWidget {
  const NphNotice({super.key, required this.message, this.tone = NphTone.error});

  final String message;
  final NphTone tone;

  @override
  Widget build(BuildContext context) {
    final c = _toneColors(tone);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(NphSpacing.md),
      decoration: BoxDecoration(
        color: c.bg,
        borderRadius: NphRadius.fieldBorder,
        border: Border.all(color: c.fg.withValues(alpha: 0.30)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            tone == NphTone.error ? Icons.error_outline : Icons.info_outline,
            size: 18,
            color: c.fg,
          ),
          const SizedBox(width: NphSpacing.sm),
          Expanded(
            child: Text(
              message,
              style: TextStyle(
                fontFamily: NphFonts.body,
                fontSize: 13,
                height: 1.45,
                color: c.fg,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Settings row — the Account screen's grouped list.
// ---------------------------------------------------------------------------

class NphSettingsGroup extends StatelessWidget {
  const NphSettingsGroup({super.key, required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: NphSpacing.sm),
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
        ),
        Container(
          decoration: BoxDecoration(
            color: NphColors.card,
            borderRadius: NphRadius.cardBorder,
            border: Border.all(color: NphColors.border),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              for (var i = 0; i < children.length; i++) ...[
                if (i > 0) const Divider(height: 1, thickness: 1, color: NphColors.border),
                children[i],
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class NphSettingsRow extends StatelessWidget {
  const NphSettingsRow({
    super.key,
    required this.icon,
    required this.label,
    this.value,
    this.onTap,
    this.tone,
  });

  final IconData icon;
  final String label;
  final String? value;
  final VoidCallback? onTap;
  final Color? tone;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: NphSpacing.lg, vertical: 14),
        child: Row(
          children: [
            Icon(icon, size: 20, color: tone ?? NphColors.mutedForeground),
            const SizedBox(width: NphSpacing.md),
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  fontFamily: NphFonts.body,
                  fontSize: 14,
                  fontWeight: FontWeight.w500,
                  color: tone ?? NphColors.foreground,
                ),
              ),
            ),
            if (value != null)
              Padding(
                padding: const EdgeInsets.only(right: NphSpacing.sm),
                child: Text(
                  value!,
                  style: const TextStyle(
                    fontFamily: NphFonts.body,
                    fontSize: 13,
                    color: NphColors.mutedForeground,
                  ),
                ),
              ),
            if (onTap != null)
              const Icon(Icons.chevron_right, size: 18, color: NphColors.mutedForeground),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// States: loading, error, empty.
// ---------------------------------------------------------------------------

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

/// Empty state — `size-14 rounded-2xl bg-muted` tile, title, message, action.
///
/// Deliberately distinct from [NphErrorState]: "you have no listings yet" is
/// not a failure and must not be dressed as one.
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
        padding: const EdgeInsets.symmetric(
          horizontal: NphSpacing.xxl,
          vertical: 48,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 56,
              height: 56,
              alignment: Alignment.center,
              decoration: const BoxDecoration(
                color: NphColors.muted,
                borderRadius: NphRadius.cardBorder,
              ),
              child: Icon(icon, size: 28, color: NphColors.mutedForeground),
            ),
            const SizedBox(height: NphSpacing.lg),
            Text(title, style: Theme.of(context).textTheme.titleLarge, textAlign: TextAlign.center),
            const SizedBox(height: NphSpacing.xs),
            Text(
              message,
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: NphColors.mutedForeground),
            ),
            if (action != null) ...[
              const SizedBox(height: NphSpacing.lg),
              action!,
            ],
          ],
        ),
      ),
    );
  }
}

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
            const NphIconTile(
              icon: Icons.error_outline,
              size: NphIconTileSize.success,
              background: NphColors.error10,
              foreground: NphColors.error,
            ),
            const SizedBox(height: NphSpacing.xl),
            Text(title, style: Theme.of(context).textTheme.titleLarge, textAlign: TextAlign.center),
            const SizedBox(height: NphSpacing.sm),
            Text(
              message,
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: NphColors.mutedForeground),
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

// ---------------------------------------------------------------------------
// Logo.
// ---------------------------------------------------------------------------

enum NphLogoVariant { light, dark }

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

/// Round icon button used for back, bell and avatar — `size-9 rounded-full`.
class NphIconButton extends StatelessWidget {
  const NphIconButton({
    super.key,
    required this.icon,
    required this.onPressed,
    this.tooltip,
    this.badge = false,
  });

  final IconData icon;
  final VoidCallback? onPressed;
  final String? tooltip;

  /// Small orange dot, as on the notifications bell.
  final bool badge;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip ?? '',
      child: InkWell(
        onTap: onPressed,
        borderRadius: NphRadius.pillBorder,
        child: SizedBox(
          width: 36,
          height: 36,
          child: Stack(
            alignment: Alignment.center,
            children: [
              Icon(icon, size: 20, color: NphColors.foreground),
              if (badge)
                const Positioned(
                  right: 6,
                  top: 6,
                  child: CircleAvatar(radius: 4, backgroundColor: NphColors.orange),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Circular initials avatar — `bg-orange/10 text-orange font-heading`.
class NphInitialsAvatar extends StatelessWidget {
  const NphInitialsAvatar({super.key, required this.name, this.size = 56});

  final String name;
  final double size;

  @override
  Widget build(BuildContext context) {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    final initials = parts.isEmpty
        ? '?'
        : parts.length == 1
            ? parts.first.substring(0, 1).toUpperCase()
            : (parts[0].substring(0, 1) + parts[1].substring(0, 1)).toUpperCase();

    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: const BoxDecoration(color: NphColors.orange10, shape: BoxShape.circle),
      child: Text(
        initials,
        style: TextStyle(
          fontFamily: NphFonts.heading,
          fontSize: size * 0.32,
          fontWeight: FontWeight.w700,
          color: NphColors.orange,
        ),
      ),
    );
  }
}
