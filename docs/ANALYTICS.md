# Analytics

GA4 property `naijapartshub`, stream **NPH Web**, measurement ID `G-FY4MWY0Z0V`.

**Web only.** The Flutter dealer app has no analytics SDK — no `firebase_analytics`
dependency, no `logEvent` call. Only Crashlytics is wired there, and it reports
crashes rather than usage. The privacy policy says so explicitly, so adding
mobile analytics means changing that page as well as the Play and App Store
data-safety declarations.

## Events

| Event | Trigger | Parameters |
|---|---|---|
| `search` | hero + browse search submit | `search_term`\*, `search_words_dropped`, `state_filter`, `category_filter`, `surface` |
| `view_listing` | listing page mount | `listing_slug`, `category`, `condition`, `store_slug`, `price_naira` |
| `view_dealer_store` | store page mount | `store_slug`, `verified`, `listing_count` |
| `click_whatsapp_dealer` | WhatsApp anchor click | `store_slug`, `listing_slug`, `surface` |
| `click_call_dealer` | `tel:` anchor click | `store_slug`, `listing_slug`, `surface` |
| `dealer_subscription_view` | subscription page, once the store loads | `plan_state`, `plan` |
| `payment_started` | after `initializePayment` succeeds, before redirect | `plan`, `price_naira`, `from_state` |
| `payment_completed` | callback page, verified success, once per reference | — |

\* Allowlist-sanitised. See below.

`search` uses GA4's **recommended** event name, so `search_term` populates the
built-in *Search term* dimension. Only the NPH-specific parameters need
registering as custom definitions.

## Required GA4 dashboard settings

Three settings live outside this repository and silently change what is
collected. Code review cannot catch a change to any of them.

### 1. Enhanced measurement → Page views → history events: **ON**

The App Router never reloads the document, so without it only landing pages are
counted. No application code sends `page_view`; that is enforced by
`tests/analytics.test.ts`, because the alternative — sending our own alongside
this setting — double-counts every view.

### 2. Enhanced measurement → Site search: **OFF**

Site search fires `view_search_results` automatically whenever a page URL
carries a search parameter, and its default list includes `q` — which is
exactly what `/parts?q=…` uses. Leaving it on causes two problems at once:

- two events feed the same built-in *Search term* dimension, inflating counts;
- the automatic one reads the **raw** query string, bypassing the allowlist
  sanitiser completely. Every protection described below would be moot.

### 3. Data streams → Redact data → URL query parameters: **add `q`**

Even with Site search off, `page_location` on every page view carries the full
URL, query string included. A buyer who types a phone number into the search box
puts it in the URL, and GA4 stores it.

Redacting the `q` parameter strips it before storage. Without this the
sanitiser protects the event parameter while the URL leaks the same text — the
appearance of privacy rather than privacy.

Email redaction is already active on this stream. Query parameter redaction is
a separate switch and was inactive at last check.

## Search term sanitisation

`lib/search-vocabulary.ts` is an **allowlist** — the complete set of words a
search term may contribute. `sanitizeSearchTerm` tokenises the query and keeps
only tokens in that set.

This is deliberately not redaction. Redaction is a denylist: it catches things
with a shape, like phone numbers and email addresses, and cannot catch
`call chidi at ladipo market` or a street address. Inverting it makes the
guarantee provable — the only strings that can leave the application are the
ones shipped in that file.

`search_words_dropped` counts unmatched tokens. It carries no text and is the
feedback loop: a rising value means the vocabulary is missing real parts.

## Custom definitions to register

Registration is **not retroactive** — GA4 reports these only from the moment
they are created, so register before the first campaign.

**Dimensions** (event-scoped): `surface`, `state_filter`, `category_filter`,
`listing_slug`, `category`, `condition`, `store_slug`, `verified`, `plan`,
`plan_state`, `from_state`.

**Metrics** (event-scoped): `price_naira`, `listing_count`,
`search_words_dropped`.

`search_term` needs no registration — it is built in.

---

# Planned: server-side `purchase` attribution

**Not implemented. Not required for Phase 1.** This section is the design to
build against when ecommerce reporting is wanted.

## Why server-side

Client-side purchase events under-report permanently:

- roughly a quarter of visitors run content blockers, so `gtag` never loads;
- dealers close the tab on Paystack's success page, before the callback renders;
- the callback requires a working session, and a session that expired during
  checkout reports nothing.

`paystackWebhook` has none of those problems. It is the source of truth for
whether money moved, it fires regardless of the browser, and it already applies
the subscription transactionally.

## Why attribution context is mandatory

A Measurement Protocol event **must** carry a `client_id`. Sending one without
it — or with a synthetic value — does not produce an unattributed conversion;
it produces a **new user and a new session** in GA4. Every purchase would appear
as a direct-traffic first-time visitor, which:

- destroys channel attribution, so Google Ads can never claim the conversion;
- inflates user counts by one per payment;
- makes the `begin_checkout → purchase` funnel show near-zero completion,
  because the two events belong to different users.

That is worse than not sending the event at all. **Never send a standalone
server-side purchase without attribution context.**

## Design

### 1. Capture on the client, at `initializePayment`

The dealer's browser is the only place the GA4 identifiers exist. Read them
before redirecting to Paystack:

```ts
// Resolves from the gtag queue; returns undefined when analytics is blocked.
function gaContext(): Promise<{ clientId?: string; sessionId?: string }>
```

- **`client_id`** — `gtag('get', GA_MEASUREMENT_ID, 'client_id', cb)`. Also
  derivable from the `_ga` cookie (`GA1.1.<client_id>`), which is the fallback
  when the callback does not fire.
- **`session_id`** — `gtag('get', GA_MEASUREMENT_ID, 'session_id', cb)`, from
  the `_ga_<STREAM_ID>` cookie. Optional but strongly preferred: without it GA4
  starts a new session for the purchase, and the funnel breaks even though the
  user is correct.
- **`session_number`** — same mechanism, improves session stitching.

Both `gtag('get', …)` calls are asynchronous and never fire when gtag is
blocked, so they are raced against a timeout and checkout proceeds regardless.

**This adds a bounded delay of at most 400 ms before the redirect to
Paystack** — it is a real cost, not a free operation:

| Situation | Added delay |
|---|---|
| Analytics blocked (`gtag` undefined) | ~0 ms, returns immediately |
| `gtag.js` already loaded | ~0 ms, getter answers on the next tick |
| `gtag.js` still loading | up to 400 ms, then capture is skipped |

The worst case is reachable only in the narrow window where the script is
present but not yet initialised. Capture can never hang or fail a payment:
the helper always resolves and never rejects.

### 2. Persist with the payment

`initializePayment` already writes the payment document before calling
Paystack. Extend that write:

```ts
analytics: {
  clientId: string | null,
  sessionId: string | null,
  transactionId: string,   // see below
}
```

Client-supplied and therefore untrusted, but it is a reporting identifier with
no authority — it grants nothing and is never used in a security decision.

Validation bounds what reaches storage rather than re-deriving Google's format:
`/^[A-Za-z0-9._-]{1,64}$/`. Google documents `client_id` as an opaque string,
and stock `gtag.js` happens to produce two dotted integers — but a custom or
server-side tagging setup can legitimately produce a UUID or another form.
Matching only the dotted-integer shape would reject those **silently**,
stopping attribution with no error and no way to recover the gap, since these
values exist only in the browser at checkout.

Null when analytics is blocked. In that case **send no purchase event at all**,
rather than a mis-attributed one.

### 3. Stable opaque transaction ID

GA4 deduplicates `purchase` on `transaction_id`, so it must be stable across
webhook retries and the callback path.

Generate a UUID **once**, when the payment document is created, and persist it
as `analytics.transactionId`. Do not derive it from the Paystack reference:

- the reference is a live payment-provider identifier, and anyone with GA4
  report access could correlate analytics rows with Paystack records;
- a persisted UUID is stable by construction, whereas a hash needs a salt that
  then needs managing and rotating.

The mapping between the two stays in Firestore, where access is already
controlled.

### 4. Send from `paystackWebhook`

After the transaction that applies the subscription — never before, or a failed
write reports revenue that was not granted:

```
POST https://www.google-analytics.com/mp/collect
     ?measurement_id=G-FY4MWY0Z0V&api_secret=<secret>

{
  "client_id": "<persisted>",
  "timestamp_micros": <payment paidAt>,
  "non_personalized_ads": false,
  "events": [{
    "name": "purchase",
    "params": {
      "transaction_id": "<opaque uuid>",
      "currency": "NGN",
      "value": <naira>,
      "session_id": "<persisted>",
      "engagement_time_msec": 1,
      "items": [{
        "item_id": "plan_monthly" | "plan_yearly",
        "item_name": "Monthly plan" | "Yearly plan",
        "price": <naira>,
        "quantity": 1
      }]
    }
  }]
}
```

`session_id` and `engagement_time_msec` are both required for the event to join
the existing session rather than starting a new one — omitting them is the
usual reason a correctly-attributed event still appears as a separate session.

The API secret is created at **Admin → Data streams → NPH Web → Measurement
Protocol API secrets** and belongs in Secret Manager beside `PAYSTACK_SECRET_KEY`,
never in the repository.

Measurement Protocol accepts almost anything and returns `204` regardless, so
validate against the debug endpoint (`/debug/mp/collect`) during development.
It reports schema errors that the production endpoint silently swallows.

### 5. Retire the client-side event

When the server-side `purchase` ships, **remove `payment_completed`**. Both
would count the same money twice.

`payment_started` should become `begin_checkout` at the same time, so the
recommended-event funnel is complete on both ends.

## Timing risk

Attribution capture must ship **before the first live payment**. The `client_id`
only exists in the browser at checkout, so a payment taken before capture is
live can never be attributed — not by backfill, not by reprocessing. The
server-side event can follow later; the capture cannot.
