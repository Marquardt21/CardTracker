# eBay Listing

**Status:** Implemented
**Date:** 2026-07-28 (retroactive)

## Summary
Lists one card (or a multi-card lot) for sale on eBay via the Sell Inventory API — Buy It Now or Auction — handling category/aspect selection, condition mapping, shipping tier, fulfillment policies, and merchant location, then publishes on a short delay so the seller can review in Seller Hub first.

## Scope / What it does
- From Selling Dashboard or Card Detail, user selects one or more cards, opens `CreateEbayDraftModal`: picks format (Buy It Now / Auction), price (or starting bid for Auction), auto-generated title/description (editable), a photo URL, submits
- **Auction**: `format: AUCTION`, `pricingSummary.auctionStartPrice`, `listingDuration` from a picker (`DAYS_1/3/5/7/10`, default `DAYS_7`), no per-buyer quantity limit. **Buy It Now**: `format: FIXED_PRICE`, `pricingSummary.price`, `quantityLimitPerBuyer: 1`.
- **Category**: single card → `261328` "Trading Card Singles"; multiple cards → one lot listing in `261329` "Trading Card Lots" (Singles rejects multi-card titles/keywords, errorId 25019). Category id for Singles is resolved dynamically via Taxonomy suggest (`_get_hockey_category_id`, query `"hockey trading card"`, cached in-process), falling back to the known id `261328` if the lookup fails.
- **Condition model** (raw/ungraded cards only): Singles use `condition = USED_VERY_GOOD` → eBay conditionId 4000 "Ungraded" (deliberately *not* `LIKE_NEW`, which maps to 2750 "Graded" and forces grade descriptors that would block publish); a **Card Condition** descriptor (40001, NM/EX/VG/Poor) is attached, resolved via the Metadata API with a documented fallback. Lots use `condition = USED_EXCELLENT` → 3000 "Used", no condition descriptors, no required aspects.
- **Aspects** (`_build_aspects`): base set is `Sport: ["Hockey"]`, `League: ["NHL"]`, `Type: ["Sports Trading Card"]`, `Graded: ["No"]`, plus `Autographed`/`Parallel/Variety` for single cards. Validated against the category's allowed values via the Taxonomy API (`_get_category_aspects`) — invalid `SELECTION_ONLY` values are dropped, any other required aspect is auto-filled.
- **Shipping tier**: fixed-price branches on price (≤$20 → Standard Envelope, 1 oz LETTER; else Ground, 3 oz thick envelope). **Auctions always use the heavier Ground tier** regardless of starting bid, since the final hammer price is unknown and may exceed the envelope limit (`heavy_shipping = is_auction or price > 20`).
- **Fulfillment policies** are looked up **by name** — `"CardTracker Standard Envelope"` (≤$20) and `"CardTracker Ground Shipping"` (>$20) — which must be created manually once in Seller Hub → Policies (the Account API rejects programmatic creation for this account); a `"CardTracker No Returns"` policy is auto-created if missing. IDs are cached in-process (`_ensure_policies`).
- **Merchant location**: reused if one exists, otherwise created from `EBAY_ZIP` (`_ensure_merchant_location_key`).
- Listings **publish on a 30-minute delay** (`listingStartDate = now + 30 min`, `create_draft` in `ebay_sell_service.py`) so the seller can review/cancel in Seller Hub or swap in real photos before it goes live.
- Blocks cards that are already `is_selling`/`is_sold`; the Collection select UI also disables them.
- On publish, all cards in the listing are marked `is_selling` with listing date/URL; a single-card listing also sets `listed_price`, a lot leaves per-card `listed_price` null (the lot's price lives on the `EbayDraftListing` row).
- Selling Dashboard groups by listing: a lot shows as one row (listing title + listing price); marking a lot sold (`PATCH /api/selling/listing/{id}/sold`) records one sale price/date and flips all its cards to sold; net profit = sold price − eBay fee (13.25% + $0.30). Single manual-listing cards use the per-card `PATCH /api/selling/{card_id}`.
- eBay auth: OAuth 2.0 (`/api/ebay/auth/start` → redirect → `/api/ebay/auth/callback`), tokens in `ebay_tokens`, auto-refreshed. A manual paste-a-token path (`/api/ebay/auth/user-token`) stores a 2-hour token with no refresh and refuses to overwrite a durable OAuth connection.

## Key files
- `backend/services/ebay_sell_service.py` — the whole listing pipeline (OAuth, category/aspects, condition, policies, location, offer + publish)
- `backend/routers/ebay.py` — OAuth endpoints, create-draft endpoint
- `backend/routers/selling.py` — Selling Dashboard grouping, manual sold updates
- `backend/models.py` — `EbayToken`, `EbayDraftListing`, `DraftListingCard`
- `frontend/src/components/CreateEbayDraftModal.jsx` — listing form
- `frontend/src/pages/SellingDashboard.jsx` — grouped listing view, mark-sold actions

## Non-goals
- No support for eBay's legacy Trading API — Inventory API only
- No multi-currency / non-US marketplace support (`EBAY_US` hardcoded)

## Known documentation drift (found 2026-07-28)
The project's `CLAUDE.md` states listings are "scheduled 2 hours from now" (three separate mentions). The actual code (`ebay_sell_service.py:617`) schedules **30 minutes** out. This spec reflects the code as of this writing; `CLAUDE.md` should be corrected to match (or the code changed to match `CLAUDE.md`'s stated 2-hour intent) — worth a deliberate decision rather than silently picking one.
