# Price Tracking

**Status:** Implemented
**Date:** 2026-07-28 (retroactive)

## Summary
Tracks two distinct kinds of price data per card — historical sold prices (for the price chart / grading ROI math) and current active-listing asking prices (a live "what's it worth right now" proxy) — each with its own cache/TTL so the app doesn't hammer eBay or 130point.com on every page view.

## Scope / What it does

**Sold-price history** (`price_service.py`, `CardValue` table)
- On card creation, a background task (`fetch_sold_history_bg`) fetches recent sold comps
- Lookup priority: eBay Marketplace Insights API (pending approval, skipped with a warning until granted) → eBay Browse API (active BIN as proxy) → 130point.com scrape → legacy eBay Finding API
- Search narrows from most to least specific: year+player+card#+parallel/serial → year+player+card#+set hint → year+player+card# → player+card# (no year/# for inserts)
- Graded slabs (PSA/BGS/SGC/CGC/"graded"/"beckett" keywords) are filtered from all results
- Dedup logic distinguishes real "sold" comps from "listed" placeholders so a listed price never gets added on top of real sold data for the same card
- Displayed as a line chart on Card Detail (`PriceChart.jsx`, Recharts)
- **Refresh All Values** (Settings) triggers `POST /api/values/refresh-all`, a background job iterating the whole collection with a 0.3s pause between cards (politeness to the scrape source), polled via `GET /api/values/refresh-all/status`

**Active-listing cache** (`ActiveListingCache` table, `ACTIVE_LISTING_TTL_DAYS = 7`)
- Card Detail's "Current eBay Listings" carousel and the Collection price-pull button both read through one cache-aware helper, `_get_or_fetch_listings` — cache hit within 7 days returns instantly; a live eBay Browse API fetch happens only when missing/stale or `force=true`
- Empty/rate-limited results are **never persisted**, so they retry next time rather than getting stuck showing nothing for a week
- `GET /api/listing-summaries` is read-only (no eBay calls) and pre-populates the Collection price column from whatever's already cached
- `GET /api/cards/{id}/active-listings` and `POST /api/cards/{id}/listing-summary` are the read/force-refresh pair behind Card Detail and the Collection button respectively

## Key files
- `backend/services/price_service.py` — sold-history fetch, multi-source fallback, graded-slab filtering
- `backend/routers/values.py` — active-listing cache helper (`_get_or_fetch_listings`), summary endpoints, refresh-all job
- `backend/models.py` — `CardValue`, `ActiveListingCache`
- `frontend/src/components/PriceChart.jsx` — sold-price history chart
- `frontend/src/pages/CardDetail.jsx`, `Collection.jsx` — active-listing display/pull points

## Non-goals
- Marketplace Insights API isn't active yet (pending eBay approval) — Browse API + 130point.com are the practical sources today
