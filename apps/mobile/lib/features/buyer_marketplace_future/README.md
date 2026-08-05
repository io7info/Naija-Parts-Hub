# Buyer marketplace — not in Phase 1 navigation

These screens are **deliberately unreachable** from the running app. Nothing in
`features/shell/main_shell.dart` imports them, and no route resolves to them.

## Why they are here rather than deleted

Phase 1 Flutter is dealer-only (ADR-001 #5). Buyers browse the responsive
Next.js site in `apps/web`, which owns the public marketplace, search, product
pages, storefronts and the WhatsApp/phone handoff.

These screens were built from the client-approved mobile design pack, which
predates that decision and shows a combined buyer + dealer app. The visual work
is sound and matches the approved system; only the *placement* is wrong for
Phase 1. Deleting it would mean rebuilding it if a buyer app is ever scoped.

## What is in here

| File | Was |
|---|---|
| `marketplace_home_screen.dart` | featured carousel, categories, recently added, verified stores |
| `marketplace_search_screen.dart` | public token search over `searchTokens` |
| `marketplace_service.dart` | public reads, all filtered on `publiclyVisible` |

## Rules for this folder

- **Nothing outside this folder may import from it.** The dependency arrow
  points inward only: these files may use `design/`, `models/`, `widgets/` and
  `services/store_service.dart`, never the reverse.
- If you wire one of these into navigation, you have changed Phase 1 scope.
  That needs a written change request, not a code review.
- `widgets/listing_card.dart` is **shared**, not parked — the dealer dashboard
  and My Listings both use it. Do not move it in here.

## If a buyer app is scoped later

`marketplace_service.dart` already carries the correct security posture: every
query filters on `publiclyVisible`, the single backend-maintained boolean that
stands in for `status == 'active' && storeApproved && storeVisible &&
!moderation.removed`. Firestore rejects a `list` whose filters do not prove the
rule, so that filter is load-bearing rather than cosmetic — keep it.
