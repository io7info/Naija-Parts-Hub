# ADR-001 — Phase 1 architecture

- **Status:** Accepted
- **Date:** 2026-07-30
- **Context:** Naija Parts Hub Phase 1 MVP Scope of Work
- **Supersedes:** `docs/PHASE2_SPEC.superseded.md`

## Context

The Phase 1 SOW describes a public two-sided marketplace: dealer registration,
admin approval, public listings, virtual storefronts, public search, and
Paystack-gated listing quotas.

The inherited codebase is a *private shop-management tool* — the dealer's own
inventory, POS, and debt ledger, with no backend beyond direct Firestore
access. The SOW frames it as "a starting foundation," but the realistic code
reuse is roughly 15%. What genuinely carries over is the domain understanding:
the WhatsApp `wa.me` handoff, offline-first as a hard requirement, and the
per-shop tenancy shape.

Five decisions were needed before any file structure could be laid down.

## Decisions

### 1. Next.js for the public marketplace, storefronts, and admin portal

Flutter Web renders to canvas: weak SEO, a ~2 MB initial bundle, and slow
first paint on Nigerian mobile networks. SOW §6 and §7 make discovery and
shareable links the growth surface, so server-rendered HTML is not optional.

The Flutter web target is dropped entirely.

> **Correction (2026-07-30).** An earlier draft of this ADR claimed that
> dropping the web target also resolved a hard compile blocker, on the basis
> that `dart:io` — imported unconditionally by the inherited
> `receipt_service.dart` and `add_stock_screen.dart` — does not exist on web.
> That is not true on Flutter 3.44: a `dart:io` import compiles for web and
> fails at runtime instead. The decision stands on the rendering and SEO
> argument alone, which is the one that actually matters.

### 2. Monorepo

```
apps/mobile          Flutter — dealer app (Android + iOS)
apps/web             Next.js — public marketplace + admin portal
functions            Cloud Functions (TypeScript)
packages/contracts   Shared data model, callable signatures, field contract
firebase             Security rules + indexes
docs                 SOW, ADRs, reference material
```

One version, one CI pipeline, and — most importantly — Functions and the web
app import the *same* TypeScript types. Drift between a callable's signature
and its caller becomes a compile error rather than a runtime bug.

### 3. Drop Hive; use Firestore native offline persistence

Firestore's built-in persistence covers essentially all of SOW §10: local
caching, write queuing while offline, automatic replay on reconnect, and
`hasPendingWrites` metadata that drives the "visible sync status" requirement
directly.

The inherited Hive layer is a hand-rolled sync engine carrying several
confirmed defects — it only syncs on a connectivity *change* (so a dealer who
stays online all day never syncs at all), it has no `shopId` filter on the
sync queue, and a single failed write aborts the remaining record types.
Deleting it removes ~250 lines and a whole category of future bugs.

Sensitive local state uses `flutter_secure_storage`, not a plaintext box.

**Trade-off accepted:** less explicit control over sync timing and ordering.

### 4. Top-level `listings` collection with backend-controlled fields

Listings move from `shops/{shopId}/parts/{partId}` to `listings/{listingId}`,
so the marketplace can query across every dealer in one indexed read.

Store state (`storeApproved`, `storeVisible`, `storeSlug`, ...) is denormalized
onto each listing by a trigger. Rule-time `get()` on the parent store would
bill an extra document read for every document evaluated by every query.

**Approval, visibility, subscription, and moderation fields are
backend-controlled and read-only to dealers.** This is the decision that makes
SOW §5 — "the limit cannot be bypassed through the mobile app, web platform,
or direct API access" — actually true. A dealer holding a valid ID token can
call the Firestore REST API directly, so the clients are not a security
boundary; only rules and Cloud Functions are.

Enforcement has three layers:

1. `packages/contracts/src/security.ts` declares the protected field lists.
2. `firebase/firestore.rules` mirrors them (rules cannot import TypeScript).
3. `scripts/check-rules-sync.mjs` fails CI if the two drift.

The four-condition public predicate is collapsed into a single
backend-maintained `publiclyVisible` boolean. Firestore only permits a `list`
whose filters prove every result satisfies the security rule, so checking four
separate fields would force every public query to carry four `where` clauses
and a six-field composite index.

### 5. Flutter app is dealer-only

Buyers browse and contact sellers through the responsive Next.js site without
accounts — consistent with SOW §7 and the exclusion of buyer accounts. The
mobile app ships to the stores as a business tool, which also narrows the
App Store review surface.

## Consequences

**Positive**

- Public pages are server-rendered and indexable.
- One shared type definition across backend and web.
- The listing limit is enforceable against direct REST access.
- The buggiest inherited subsystem is deleted rather than repaired.
- Marketplace queries need 3-field indexes instead of 6.

**Negative**

- Two languages and two toolchains (Dart, TypeScript).
- Denormalized store fields require a fan-out write when a store's status
  changes — bounded by the fair-use listing ceiling.
- Firestore prefix-token search gives no typo tolerance or relevance ranking.
  Algolia or Typesense is the upgrade path; `slug.ts` is the seam.

## Open items

Tracked, not yet decided. None block the current work.

| # | Item | Default in use | Source |
|---|---|---|---|
| 1 | Subscription expiry behaviour | 7-day grace, then auto-unpublish to 10 | Undefined in SOW |
| 2 | Paid-tier fair-use ceiling | 200 active listings | SOW §8 says "reasonable", names no number |
| 3 | Paystack upgrade placement | Web-only (App Store Guideline 3.1.1 risk) | Deviates from SOW §5 wording |
| 4 | Category taxonomy owner | — | SOW §9 |
| 5 | Fate of inherited Sell / Debt Book screens | Still present, untouched | SOW excludes their *expansion* only |
| 6 | Designs / mockups | Dev-chosen layouts | Not in client responsibilities |

## Addendum — scope gap found during review

**In-app account deletion is required and is absent from the SOW.** Apple
Guideline 5.1.1(v) and Google Play both mandate it for any app with account
registration, and SOW §2 is a registration flow. It is a hard store rejection
if shipped without one. Added to Phase 1 scope as the `deleteAccount`
callable; roughly half a day of work.
