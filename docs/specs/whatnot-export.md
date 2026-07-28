# Whatnot Export

**Status:** Implemented (not yet reflected in the project's top-level `CLAUDE.md` feature list)
**Date:** 2026-07-28 (retroactive)

## Summary
Whatnot has no public Seller API for this account (it's limited-release), so instead of listing directly, CardTracker exports a Whatnot bulk-upload CSV that the user imports manually in Seller Hub → Bulk Upload. Each selected card becomes one Auction row with a configurable opening bid (default $1, for a "$1 start" singles show).

## Scope / What it does
- `POST /api/whatnot/export` takes `card_ids` (+ optional `start_price`, defaults to `WHATNOT_START_PRICE`), builds one CSV row per card, and returns it as a file download with summary counts in response headers (`X-Whatnot-Exported`, `X-Whatnot-Missing-Images`)
- Row fields: Category/Sub Category/Shipping Profile/Condition come from fixed config values (`WHATNOT_CATEGORY`, `WHATNOT_SUB_CATEGORY`, `WHATNOT_SHIPPING_PROFILE`, `WHATNOT_CONDITION_MAP`); Title/Description are built the same way as the eBay lot builder (year/brand/card#/player/parallel/type); SKU is `CT-{card.id}`
- Image URL is included only if `card.photo_path` is already a public `https://` URL — local-upload photos are left blank (Whatnot can't reach `localhost`/local paths), and the user adds photos manually in the Whatnot app after import
- Blocks export if any selected card is already `is_sold` or `is_selling` (same guard eBay listing uses), raising a `ValueError` → `400` with the offending cards named
- On success, all exported cards are marked `is_selling = true`, `listing_url = WHATNOT_MARKER` ("whatnot" — tags which channel a card is on), `listed_price = start_price`
- **Whatnot rejects any row whose Category/Sub Category/Type/Condition/Shipping Profile doesn't exactly match the currently-downloaded bulk-upload template's "Values" tab**, and Whatnot changes that template periodically — all Whatnot-specific values are deliberately isolated in one `config.py` block so correcting them against a fresh template is a one-place edit

## Key files
- `backend/services/whatnot_service.py` — CSV row building, export logic
- `backend/routers/whatnot.py` — export endpoint
- `backend/config.py` — the `WHATNOT_*` block (category/sub-category/shipping profile/condition map/CSV columns)

## Non-goals
- No direct Whatnot API integration — CSV bulk-upload only, until/unless Whatnot's Seller API opens up for this account
- No multi-image export — one `Image URL 1` column populated at most today, though the CSV format supports up to 8

## Note
This feature exists in the codebase (as of this spec, still untracked in git — `backend/routers/whatnot.py` and `backend/services/whatnot_service.py`) but isn't yet listed in the project's `CLAUDE.md` "Core Capabilities & Workflows" section. Worth adding a short entry there pointing at this spec.
