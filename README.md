# Naija Parts Hub

**Operated by Lytod Motors Ltd | RC 1207675 | 50 Olumegbon St, Surulere, Lagos**

Phase 1 MVP — a marketplace for verified Nigerian automotive-parts businesses.
Dealers register and list stock from a mobile app; buyers browse a public web
marketplace and contact sellers directly over WhatsApp. Payment, negotiation,
and delivery happen off-platform.

Scope: [`docs/Naija_Hub_Parts_Phase_1_MVP_Scope_of_Work.docx`](docs/Naija_Hub_Parts_Phase_1_MVP_Scope_of_Work.docx)
Architecture: [`docs/adr/ADR-001-phase-1-architecture.md`](docs/adr/ADR-001-phase-1-architecture.md)

---

## Layout

```
apps/mobile          Flutter — dealer app (Android + iOS). Dealer-only.
apps/web             Next.js — public marketplace, storefronts, admin portal
functions            Cloud Functions (TypeScript) — Paystack, listing limits
packages/contracts   Shared data model + backend-controlled field contract
firebase             Firestore + Storage rules, composite indexes
scripts              Repo tooling
docs                 SOW, ADRs, reference material from the original code pack
```

Buyers never sign in. Dealers authenticate by phone OTP. Admins authenticate
by email/password plus a `role: super_admin` custom claim set via the Admin
SDK — never derived from a Firestore document.

## Architecture

```
Flutter (Android + iOS)                Next.js (Vercel)
  dealer: register, list, manage         /              marketplace + search
        |                                /store/[slug]  virtual storefronts
        |                                /admin/*       admin portal
        |                                     |
        +------------> Firebase <-------------+
                       Auth · Firestore · Storage · Functions
                                    |
                              Paystack (server-side only)
```

**The clients are not a security boundary.** Any dealer with a valid ID token
can call the Firestore REST API directly. Every tamper-sensitive transition —
publishing a listing, changing a subscription, approving a business — is a
callable Cloud Function, and the fields behind them are denied to clients in
`firebase/firestore.rules`. See ADR-001 §4.

## Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Node.js | 20–22 | web, functions, contracts |
| Flutter SDK | 3.24+ | `apps/mobile` |
| JDK | 17 | Android builds |
| Firebase CLI | latest | rules, functions, emulators |
| Xcode + macOS | latest | iOS builds only |

> iOS cannot be built on Windows. Use a Mac or a macOS CI runner
> (Codemagic / GitHub Actions).

```bash
npm install -g firebase-tools
dart pub global activate flutterfire_cli
```

## Setup

```bash
npm install              # installs all workspaces
npm run contracts:build  # other packages import the compiled output
npm run verify           # rules/contract drift check + typecheck
```

## Working on it

```bash
npm run verify            # run before every commit
npm run contracts:build   # after changing packages/contracts
npm run emulators         # Firebase emulator suite (UI on :4000)
```

### Changing a backend-controlled field

`firestore.rules` cannot import TypeScript, so the protected field lists exist
in two places. Both must change together:

1. `packages/contracts/src/security.ts` — the source of truth
2. `firebase/firestore.rules` — the mirror

`npm run check:rules-sync` fails if they drift, and it also asserts the
dealer-writable and backend-only lists never intersect. It runs in CI.

## Status

**Foundation in progress.** Complete:

- [x] Monorepo, git repository, `.gitignore` covering signing credentials
- [x] `@nph/contracts` — data model, callable signatures, field contract
- [x] Firestore + Storage security rules
- [x] Composite indexes
- [x] Rules/contract drift check
- [ ] Flutter project scaffolding (blocked: Flutter SDK not installed)
- [ ] Firebase project + `firebase_options.dart`
- [ ] Cloud Functions
- [ ] Next.js app

The inherited code pack is preserved at `docs/reference/legacy-app/` for
reference during the rewrite. It does not compile — missing
`firebase_options.dart`, ungenerated Hive adapters, absent assets — and is
deliberately outside the build path.

> **Do not extract the Flutter SDK inside this repository.** It shadows
> `apps/mobile` when Flutter scans for `pubspec.yaml`, and `git add -A` would
> commit it as an embedded repo. Keep it at `C:\flutter` or similar.

## Money

Amounts are stored as **integer kobo**, never floats. ₦5,000 is `500000`.
Helpers live in `packages/contracts/src/common.ts`. The inherited code used
`double` for prices and debt balances; that is a defect, not a precedent.
