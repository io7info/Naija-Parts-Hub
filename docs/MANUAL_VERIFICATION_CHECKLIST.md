# Manual verification checklist

79 automated assertions cover the logic. What they **cannot** cover is anything
crossing a boundary a headless test can't drive: a real OTP round-trip, a
browser click, a binary upload from a camera, a device losing signal.

Those are exactly the paths a dealer touches every day, so this checklist is
not ceremony — it is the untested half of the slice.

Record a ✅ or a ❌ with what you saw. A ❌ with the error text is worth more
than a ✅.

---

## Setup — four terminals

```powershell
# 1  Emulators (leave running)
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.20.8-hotspot"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
npm run emulators

# 2  Seed admin + categories (emulator state is in-memory; re-run after every restart)
npm run seed

# 3  Admin portal
npm run dev --workspace @nph/web        # http://localhost:3000/admin

# 4  Dealer app
cd apps\mobile
flutter run -d emulator-5554
```

Emulator UI: <http://127.0.0.1:4000> — watch documents change live as you go.

> **If the emulators refuse to start with "port taken"**, an earlier run left
> orphans:
> ```powershell
> Get-NetTCPConnection -LocalPort 9099,8080,9199,5001 -State Listen |
>   Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique |
>   ForEach-Object { Stop-Process -Id $_ -Force }
> ```

---

## 1. Phone OTP request and verification

| # | Step | Expect |
|---|---|---|
| 1.1 | Enter `+2348031234567`, tap **Send code** | Screen switches to OTP entry with **no error** |
| 1.2 | Look at the OTP field | Code **pre-filled automatically** — read from the Auth emulator's REST endpoint, no SMS sent |
| 1.3 | Emulator UI → Authentication tab | The number appears as a user |
| 1.4 | Tap **Verify & continue** | Advances past sign-in |
| 1.5 | Tap **Use a different number**, then re-send | Returns to phone entry cleanly |
| 1.6 | Enter a deliberately wrong OTP | Error reads *"Could not verify that code"* — **not** a generic "invalid code" for every failure |

> ⚠️ **This is the highest-risk item.** No automated test covers the OTP path —
> `e2e.test.mjs` signs in with a custom token, which bypasses it entirely. Your
> last attempt failed on Android's cleartext block; that fix is in but
> unconfirmed. **A manifest change needs a full rebuild — hot reload will not
> pick it up.**

---

## 2. Auth gate navigation

| # | Step | Expect |
|---|---|---|
| 2.1 | First sign-in, no store yet | Lands on **Register your business** |
| 2.2 | Kill and relaunch the app | Returns to the same screen — session restored, no re-login |
| 2.3 | Tap **Sign out** | Back to sign-in |
| 2.4 | Sign in again | Straight back to the correct screen for your state |

The gate watches `authStateChanges` and the store document as live streams, so
it should re-route **without any manual navigation**. If you ever have to back
out or restart to reach the right screen, that's a bug.

---

## 3. Dealer registration

| # | Step | Expect |
|---|---|---|
| 3.1 | Submit with fields empty | Inline validation errors; nothing submitted |
| 3.2 | Fill everything, leave **Terms** unticked | Blocked with an explicit message |
| 3.3 | Tick Terms, submit | Advances to the pending screen |
| 3.4 | Emulator UI → Firestore → `stores` | Doc keyed by your **uid**, `status: "pending"`, `visible: false`, `activeListingCount: 0` |
| 3.5 | Same doc | `slug` auto-derived from the business name |
| 3.6 | `storeSlugs` collection | A doc named for that slug, pointing back at your uid |
| 3.7 | Register a second business with the **same name** on another number | Slug gets a `-2` suffix — no collision |

---

## 4. Pending-store screen

| # | Step | Expect |
|---|---|---|
| 4.1 | After registering | *"Awaiting approval"* with an explanation |
| 4.2 | Try to reach listings | Not reachable while pending |
| 4.3 | **Sign out** is available | Yes — a pending dealer must not be trapped |

---

## 5. Admin approve and reject

| # | Step | Expect |
|---|---|---|
| 5.1 | Open `/admin` | Sign-in form; credentials pre-filled in emulator mode |
| 5.2 | Sign in as `admin@lytodmotors.test` / `password123` | Reaches the queue — **not** the "no super_admin claim" screen |
| 5.3 | **Pending** tab | Your business, with CAC, address, phone, store URL |
| 5.4 | Tap **Approve** | Row leaves Pending, appears under Approved |
| 5.5 | **Watch the dealer app** | It re-routes to listings **on its own**, no restart |
| 5.6 | Firestore `stores` doc | `status: "approved"`, `visible: true`, `approvedAt` and `reviewedBy` set |
| 5.7 | Register a second dealer, **Reject** with a reason | Dealer app shows the rejection **and the reason text** |
| 5.8 | **Suspend** an approved store | Dealer sees the suspended screen |
| 5.9 | After suspending, check that store's listings in Firestore | `publiclyVisible: false` on all of them — the trigger fan-out |
| 5.10 | **Reactivate** | Listings return to `publiclyVisible: true` |

---

## 6. Real image upload to Storage

**No automated test uploads a real image.** The rules are covered by 22
assertions; the upload path itself has never run.

| # | Step | Expect |
|---|---|---|
| 6.1 | New listing → **Camera** | Emulator camera opens (it renders a synthetic scene) |
| 6.2 | Take a shot | Thumbnail appears; progress bar runs |
| 6.3 | Emulator UI → Storage | Object under `stores/{yourUid}/listings/...` |
| 6.4 | Check its size | **Well under 512 KB** — compression ran before upload |
| 6.5 | Add via **Gallery** too | Both work |
| 6.6 | Try to add a 4th image | Buttons disappear at 3 (SOW §4) |
| 6.7 | Save, then inspect the listing doc | `images[].url` is a real download URL, **not** a local file path |

---

## 7. Listing creation and publication

| # | Step | Expect |
|---|---|---|
| 7.1 | Save with an empty name | Validation blocks it |
| 7.2 | Enter price `abc` | Validation blocks it |
| 7.3 | Enter price `-5` | Rejected — negative prices are refused |
| 7.4 | Save a valid listing as **draft** | Appears in the list marked *Draft* |
| 7.5 | Firestore | `priceKobo` is an **integer** — ₦5,000 stores as `500000`, never `5000.0` |
| 7.6 | **Save & publish** | Status becomes *Published* |
| 7.7 | Store doc | `activeListingCount` incremented by exactly 1 |
| 7.8 | Listing doc | `searchTokens` populated server-side; `publiclyVisible: true` |
| 7.9 | **Publish 10 listings, then try an 11th** | Refused, with a message naming the limit and the upgrade URL |
| 7.10 | Unpublish one | `activeListingCount` drops; the 11th now publishes |
| 7.11 | Quota bar at the top | Reads *"10 of 10 active listings (free plan)"* |

---

## 8. Offline write and reconnection sync

Cut the network in the emulator: **⋯ (Extended controls) → Cellular → Data
status: Denied**, and switch Wi-Fi off in the emulator's own settings.

| # | Step | Expect |
|---|---|---|
| 8.1 | Go offline, create a listing | Saves **immediately** — no spinner, no error |
| 8.2 | Sync banner | *"1 change waiting to sync"* |
| 8.3 | Listing row | Small orange upload icon |
| 8.4 | Create two more offline | Banner counts up to 3 |
| 8.5 | Reopen the app while still offline | Listings still there — served from cache |
| 8.6 | Try to **publish** while offline | Fails or hangs — **correct**. The limit cannot be enforced offline, so allowing an optimistic publish would let a dealer exceed the free tier by turning off data |
| 8.7 | Restore the network | Banner clears to nothing within seconds |
| 8.8 | Firestore | All three listings present server-side |
| 8.9 | Emulator UI during 8.7 | Documents appear as the queue drains |

---

## Report back

For each section: ✅, or ❌ with the error text and which step.

The three I'd most expect to bite:

1. **1.1 phone OTP** — the cleartext fix is unconfirmed, and it needs a full rebuild
2. **5.2 admin sign-in** — client-side auth and the claim check have only been verified as an SSR shell
3. **6.2 camera upload** — the one path with zero coverage of any kind

Once these are ✅, the vertical slice is genuinely verified end to end and the
public marketplace becomes the next milestone. Paystack stays untouched until
then.
