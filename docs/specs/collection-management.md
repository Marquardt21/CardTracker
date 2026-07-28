# Collection Management

**Status:** Implemented
**Date:** 2026-07-28 (retroactive)

## Summary
Core CRUD and browsing for the card collection: add/edit/delete cards with full metadata, browse with search/filter/sort, and a bulk eBay price-check across the current filtered view.

## Scope / What it does
- Add, edit, delete cards with brand, year, set, player, condition, parallel, print run, notes, photo
- Photo upload directly from the app (`POST /api/cards/{id}/photo`), stored under `PHOTOS_DIR`, format restricted to jpg/jpeg/png/webp/heic
- Browse/search/filter (player, team, brand, year, card_type, condition, free-text `search` across player/set/brand/card_number) and sort (date added, player, year — asc/desc) via `GET /api/cards`
- "Unmatched" tab (`?unmatched=true`, or `GET /api/cards/unmatched`) shows cards not yet linked to an official checklist — only surfaced when relevant
- Cascading filters (client-side, `Collection.jsx`): pick a Set, then Type/Parallel/Player/Team narrow to what's actually in that set; changing the set resets the dependent dropdowns
- **Get eBay Prices**: for every card in the current filtered view, pulls a live low–high asking-price range + listing count via the cached active-listings summary (see [price-tracking.md](price-tracking.md)); fetch throttled to 3 concurrent; tapping a price expands the live BIN carousel inline
- Select mode → **List on eBay** creates one lot listing from multiple selected cards (see [ebay-listing.md](ebay-listing.md))
- Deleting a card un-marks any `SetChecklistCard.owned`/`collection_card_id` pointing at it, and removes its photo file from disk

## Key files
- `backend/routers/cards.py` — CRUD, photo upload, price recommendation trigger
- `backend/models.py` — `Card` model
- `frontend/src/pages/Collection.jsx` — browse/filter/sort UI, price-pull button, select mode
- `frontend/src/pages/AddCard.jsx` — add/edit form (see [card-entry-autocomplete.md](card-entry-autocomplete.md) for the autocomplete half of this page)

## Non-goals
- No bulk edit of multiple cards' metadata at once (only bulk *selling* actions)
- No multi-photo support per card (tracked as a future feature in the project's `CLAUDE.md`)
