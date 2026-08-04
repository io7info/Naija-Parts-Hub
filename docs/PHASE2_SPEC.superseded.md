# Naija Hub Parts — Phase 2 Spec
**Operated by Lytod Motors Ltd | RC 1207675 | 50 Olumegbon St, Surulere, Lagos**

This spec covers three things: (1) branding corrections across the existing
app, (2) a new Super Admin Panel, and (3) a marketplace / virtual store
feature so individual dealers can list parts publicly.

---

## 1. Branding Corrections

Apply everywhere the app currently shows text — splash screen, About
screen, WhatsApp receipts, Play Store listing, footers:

- **App name:** Naija Hub Parts
- **Operated by:** Lytod Motors Ltd
- **RC:** 1207675
- **Address:** 50 Olumegbon St, Surulere, Lagos
- Remove any leftover "724 Systems" or unlabeled "2WM DealerOS" branding
  from Nigeria-facing screens. If the US-facing 2wheelmotions.com side
  needs its own brand name, that's fine — keep it on a separate
  storefront, sharing only the backend/data layer, not the Nigeria UI.

---

## 2. Super Admin Panel (Web)

**Purpose:** Lytod Motors HQ oversight of every dealer/shop on the platform.
**Access:** Role-gated — super admin login only (Firebase Auth custom claims).
**Stack:** React/Next.js frontend, same Firestore backend as the mobile app.

### Screens

| Screen | Purpose |
|---|---|
| Dashboard | Total dealers, total parts listed, today's sales across all shops, MRR from subscriptions |
| Dealer / Shop Management | List all shops, verification status, subscription tier (Free / Pro / Boss), suspend or reactivate a shop |
| Marketplace Moderation | Queue of new public listings pending review before they go live — catches duplicates, obvious fraud, mismatched photos |
| Listings Search | Search/filter every part listed platform-wide, by category, make/model, region |
| Analytics | Top-selling categories, low-stock trends, regional breakdown (Ladipo, Nnewi, Kano, Ariaria, Owode Onirin) |
| Revenue | Subscription revenue by tier, commission revenue from 2WM cross-border listings |
| Support | Dealer complaints / tickets |

---

## 3. Marketplace / Virtual Store Feature

Each **Pro** or **Boss** tier dealer gets a public storefront page.

### Virtual Store (per dealer)
- Store name, logo, location, phone/WhatsApp, rating (from buyer feedback)

### Listing fields (per part)
- Part name, category (engine / brake / suspension / electrical / body / other)
- Condition: New / Used / Refurbished
- Compatible vehicle: **Make, Model, Year range** (this is the key search filter buyers will use)
- Photos (multiple)
- Price, quantity available
- Internal shelf location (not shown to public — pulled from existing Add Stock screen)
- Public description

### Buyer-facing marketplace (web + app)
- Browse/search/filter by make, model, year, category, condition, region
- View a dealer's storefront and other listings
- **Contact dealer via WhatsApp click-to-chat** — this is the transaction handoff point. Naija Hub Parts never touches the money.

### On payments — recommendation
Keep it this way for now: buyer and seller agree price and handle payment
directly (cash, transfer, WhatsApp), same as the existing Sell screen.
Adding in-app checkout or escrow for buyer-seller marketplace transactions
would put the Nigeria side of the platform back under CBN payment-service
licensing requirements — the exact exposure you already decided to avoid
by dropping the Cooperative and Estate ideas. The only place actual
payment processing belongs is the **2wheelmotions.com** cross-border flow,
since that's a separate US-based storefront with its own payment stack —
Naija Hub Parts just feeds it inventory and takes a referral commission.

If you want in-app "Request to Buy" later without full payment: build a
simple request/accept flow where the dealer confirms manually and the
buyer still pays offline. No funds ever touch the platform.

---

## 4. Data Model Additions

```
Store {
  storeId, dealerId, storeName, location, phone,
  verified: bool, tier: "free" | "pro" | "boss"
}

Listing {
  listingId, storeId, partName, category,
  condition: "new" | "used" | "refurbished",
  make, model, yearFrom, yearTo,
  photos: [string], price, qty,
  status: "pending" | "approved" | "rejected",
  createdAt
}

AdminActionLog {
  adminId, action, targetId, timestamp
}
```

---

## 5. Rollout Note

This is a real scope jump beyond the original 4-screen, 3–4 week MVP.
Recommend treating it as **Phase 2**, shipped after the core inventory app
+ admin panel is live — otherwise it risks blowing past the original
₦1.5M–₦2.5M / 3–4 week budget already agreed with the dev.
