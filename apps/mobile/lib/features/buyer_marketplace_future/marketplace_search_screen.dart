import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/env.dart';
import '../../core/errors.dart';
import '../../design/components.dart';
import '../../design/tokens.dart';
import '../../models/store.dart';
import 'marketplace_service.dart';
import '../../widgets/listing_card.dart';

/// Marketplace search (SOW Â§7) — by product name or part number.
///
/// Backed by `searchTokens`, the prefix-token array a Firestore trigger
/// generates from name + brand + partNumber. That array is deliberately not
/// client-writable: a dealer who could set it would stuff tokens and surface
/// for every search term on the platform.
///
/// One token per query is a Firestore constraint (`array-contains` takes a
/// single value), so multi-word input matches on its longest word — the most
/// selective one — rather than silently returning nothing.
class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key, required this.store});

  final Store store;

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  final _controller = TextEditingController();
  Timer? _debounce;

  static const _filters = ['All', 'New', 'Used'];
  String _filter = 'All';

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  /// Debounced so a five-letter query costs one Firestore read, not five.
  void _onChanged(String raw) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      if (!mounted) return;
      final words = raw.trim().toLowerCase().split(RegExp(r'\s+'))
        ..sort((a, b) => b.length.compareTo(a.length));
      ref.read(searchTermProvider.notifier).state = words.isEmpty ? '' : words.first;
    });
  }

  @override
  Widget build(BuildContext context) {
    final results = ref.watch(searchResultsProvider);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            NphSpacing.appPage,
            NphSpacing.md,
            NphSpacing.appPage,
            NphSpacing.sm,
          ),
          child: TextField(
            controller: _controller,
            onChanged: _onChanged,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'Search part name, SKU, vehicle, or brand',
              prefixIcon: const Icon(
                Icons.search,
                size: 18,
                color: NphColors.mutedForeground,
              ),
              suffixIcon: _controller.text.isEmpty
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.close, size: 18),
                      color: NphColors.mutedForeground,
                      onPressed: () {
                        _controller.clear();
                        ref.read(searchTermProvider.notifier).state = '';
                        setState(() {});
                      },
                    ),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: NphSpacing.appPage),
          child: Row(
            children: [
              for (final f in _filters)
                Padding(
                  padding: const EdgeInsets.only(right: NphSpacing.sm),
                  child: NphFilterChip(
                    label: f,
                    active: _filter == f,
                    onTap: () => setState(() => _filter = f),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: NphSpacing.md),
        Expanded(
          child: results.when(
            loading: () => const NphLoading(),
            error: (e, _) => NphErrorState(
              title: 'Search failed',
              message: friendlyError(e),
            ),
            data: (items) {
              final filtered = _filter == 'All'
                  ? items
                  : items
                      .where((i) => i.listing.condition == _filter.toLowerCase())
                      .toList();

              if (filtered.isEmpty) {
                return NphEmptyState(
                  icon: Icons.search_off,
                  title: 'No matching parts found',
                  message: _controller.text.trim().isEmpty
                      ? 'Search by part name, SKU, vehicle or brand.'
                      : 'Try another part name, vehicle model, category, or location.',
                  action: _controller.text.trim().isEmpty
                      ? null
                      : OutlinedButton(
                          onPressed: () {
                            _controller.clear();
                            ref.read(searchTermProvider.notifier).state = '';
                            setState(() {});
                          },
                          style: OutlinedButton.styleFrom(
                            minimumSize: const Size(180, NphSize.buttonHeightSmall),
                          ),
                          child: const Text('Clear search'),
                        ),
                );
              }

              return ListView.separated(
                padding: const EdgeInsets.fromLTRB(
                  NphSpacing.appPage,
                  0,
                  NphSpacing.appPage,
                  NphSpacing.xxxl,
                ),
                itemCount: filtered.length,
                separatorBuilder: (_, __) => const SizedBox(height: NphSpacing.md),
                itemBuilder: (_, i) {
                  final item = filtered[i];
                  return NphListingListCard(
                    listing: item.listing,
                    storeName: item.store.businessName,
                    locationLabel: item.store.locationLabel,
                    onTap: () => _open(item),
                    onContact: () => _contact(item),
                  );
                },
              );
            },
          ),
        ),
      ],
    );
  }

  Future<void> _open(PublicListing item) async {
    final uri = Uri.parse('${Env.marketplaceOrigin}/parts/${item.listing.listingId}');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _contact(PublicListing item) async {
    final number = (item.store.whatsapp.isNotEmpty ? item.store.whatsapp : item.store.phone)
        .replaceAll(RegExp(r'[^0-9]'), '');
    if (number.isEmpty) return;
    final text = Uri.encodeComponent(
      'Hello ${item.store.businessName}, is "${item.listing.name}" still available?',
    );
    final uri = Uri.parse('https://wa.me/$number?text=$text');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }
}
