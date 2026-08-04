import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/env.dart';
import '../../design/components.dart';
import '../../design/tokens.dart';
import '../../models/store.dart';

/// Plan status and upgrade path (SOW §5, §8).
///
/// Deliberately has **no in-app checkout**. Selling a subscription inside the
/// app engages App Store Guideline 3.1.1, which would require Apple's in-app
/// purchase and its 15–30% cut on a ₦5,000 plan. ADR-001 open item #3 records
/// the decision to keep payment on the web; the dashboard's own wording —
/// "Manage Plan on Website" — is the design's version of the same conclusion.
///
/// The prototype's `limit` screen priced this at ₦7,500/month for unlimited
/// listings. SOW §8 says ₦5,000 monthly and ₦50,000 yearly, and the paid tier
/// carries a fair-use ceiling rather than being unlimited. The SOW is the
/// contract, so those are the figures shown.
class PlanStatusScreen extends StatelessWidget {
  const PlanStatusScreen({super.key, required this.store});

  final Store store;

  static final _date = DateFormat('d MMM yyyy');

  @override
  Widget build(BuildContext context) {
    final sub = store.subscription;
    final used = store.activeListingCount;
    final limit = store.activeListingLimit;

    return Scaffold(
      backgroundColor: NphColors.background,
      appBar: AppBar(
        title: const Text('Plan & Usage'),
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
            _hero(context, used: used, limit: limit),
            const SizedBox(height: NphSpacing.xl),

            NphSectionHeader(title: sub.isPaid ? 'Your subscription' : 'Available plans'),
            const SizedBox(height: NphSpacing.md),

            _PlanCard(
              name: 'Free',
              price: '₦0',
              cadence: 'forever',
              limit: '10 active listings',
              features: const [
                'Verified store page',
                'Unlimited draft listings',
                'WhatsApp and phone contact',
              ],
              current: !sub.isPaid,
            ),
            const SizedBox(height: NphSpacing.md),
            _PlanCard(
              name: 'Monthly',
              price: '₦5,000',
              cadence: 'per 30 days',
              limit: '200 active listings',
              features: const [
                'Everything in Free',
                'Priority placement in search',
                'Renew monthly',
              ],
              highlight: true,
              current: sub.isPaid && sub.plan == 'monthly',
            ),
            const SizedBox(height: NphSpacing.md),
            _PlanCard(
              name: 'Yearly',
              price: '₦50,000',
              cadence: 'per 365 days',
              limit: '200 active listings',
              features: const [
                'Everything in Monthly',
                'Two months free versus monthly',
                'Renew yearly',
              ],
              current: sub.isPaid && sub.plan == 'yearly',
            ),

            if (sub.expiresAt != null) ...[
              const SizedBox(height: NphSpacing.xl),
              NphBanner(
                message: sub.status == 'grace'
                    ? 'Your plan lapsed on ${_date.format(sub.expiresAt!)}. Renew to keep '
                        'your listings live.'
                    : 'Renews on ${_date.format(sub.expiresAt!)}.',
                tone: sub.status == 'grace' ? NphTone.warning : NphTone.neutral,
                icon: Icons.event_outlined,
              ),
            ],

            const SizedBox(height: NphSpacing.xl),
            FilledButton(
              onPressed: _openWeb,
              child: Text(sub.isPaid ? 'Manage plan on website' : 'Upgrade on website'),
            ),
            const SizedBox(height: NphSpacing.md),
            const Text(
              'Subscriptions are billed securely through Paystack on the Naija Parts Hub '
              'website. Payment is never handled inside this app.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontFamily: NphFonts.body,
                fontSize: 12,
                height: 1.5,
                color: NphColors.mutedForeground,
              ),
            ),
            const SizedBox(height: NphSpacing.xl),
          ],
        ),
      ),
    );
  }

  Widget _hero(BuildContext context, {required int used, required int limit}) {
    final atLimit = used >= limit;
    return Container(
      padding: const EdgeInsets.all(NphSpacing.xl),
      decoration: const BoxDecoration(
        color: NphColors.dark,
        borderRadius: NphRadius.cardBorder,
      ),
      child: Column(
        children: [
          Container(
            width: 48,
            height: 48,
            alignment: Alignment.center,
            decoration: const BoxDecoration(
              color: NphColors.orange20,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.workspace_premium_outlined,
              size: 24,
              color: NphColors.orange,
            ),
          ),
          const SizedBox(height: NphSpacing.md),
          Text(
            atLimit
                ? "You've reached your listing limit"
                : '$used of $limit active listings used',
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontFamily: NphFonts.heading,
              fontSize: 18,
              fontWeight: FontWeight.w700,
              height: 1.3,
              color: Colors.white,
            ),
          ),
          const SizedBox(height: NphSpacing.sm),
          Text(
            atLimit
                ? 'Upgrade to list more parts, or unpublish one to free a slot.'
                : 'Drafts and archived listings do not count toward your limit.',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontFamily: NphFonts.body,
              fontSize: 13,
              height: 1.5,
              color: Colors.white.withValues(alpha: 0.70),
            ),
          ),
          const SizedBox(height: NphSpacing.lg),
          NphProgressBar(value: limit == 0 ? 0 : used / limit, onDark: true),
        ],
      ),
    );
  }

  Future<void> _openWeb() async {
    final uri = Uri.parse('${Env.marketplaceOrigin}/plans');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }
}

class _PlanCard extends StatelessWidget {
  const _PlanCard({
    required this.name,
    required this.price,
    required this.cadence,
    required this.limit,
    required this.features,
    this.highlight = false,
    this.current = false,
  });

  final String name;
  final String price;
  final String cadence;
  final String limit;
  final List<String> features;
  final bool highlight;
  final bool current;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(NphSpacing.lg),
      decoration: BoxDecoration(
        color: NphColors.card,
        borderRadius: NphRadius.cardBorder,
        border: Border.all(
          color: current || highlight ? NphColors.orange : NphColors.border,
          width: current ? 2 : 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(name, style: Theme.of(context).textTheme.titleMedium),
              const Spacer(),
              if (current)
                const NphStatusBadge(label: 'Current plan', tone: NphTone.success)
              else if (highlight)
                const NphStatusBadge(label: 'Best value', tone: NphTone.brand),
            ],
          ),
          const SizedBox(height: NphSpacing.sm),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                price,
                style: const TextStyle(
                  fontFamily: NphFonts.heading,
                  fontSize: 26,
                  fontWeight: FontWeight.w700,
                  color: NphColors.foreground,
                ),
              ),
              const SizedBox(width: 6),
              Text(
                cadence,
                style: const TextStyle(
                  fontFamily: NphFonts.body,
                  fontSize: 13,
                  color: NphColors.mutedForeground,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            limit,
            style: const TextStyle(
              fontFamily: NphFonts.body,
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: NphColors.foreground,
            ),
          ),
          const SizedBox(height: NphSpacing.md),
          for (final f in features)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.check, size: 16, color: NphColors.success),
                  const SizedBox(width: NphSpacing.sm),
                  Expanded(
                    child: Text(
                      f,
                      style: const TextStyle(
                        fontFamily: NphFonts.body,
                        fontSize: 13,
                        height: 1.4,
                        color: NphColors.mutedForeground,
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
