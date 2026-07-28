# Card Entry & Autocomplete

**Status:** Implemented
**Date:** 2026-07-28 (retroactive)

## Summary
Speeds up manual card entry by suggesting matches from imported checklists as the user types, and adds a "value and list in one flow" panel right after saving a card.

## Scope / What it does
- Typing 2+ characters into card number, player name, or set name on Add Card queries imported checklists; selecting a suggestion fills every field at once
- If no checklist match exists, the user can import a set inline (`ImportSetPanel`, see [set-checklist-import.md](set-checklist-import.md)) or skip and save manually
- Unmatched cards (`checklist_matched = false`) are retroactively linked when a matching set is imported later (`set_import_service.reconcile_unmatched`, run after every import)
- After Save, the "Card saved!" panel auto-loads **Current eBay Listings** for that card (`GET /api/cards/{id}/active-listings`, same cache-aware helper as Card Detail) so the value is visible immediately
- A **List on eBay** button in the same panel opens `CreateEbayDraftModal` for the just-saved card; after scheduling, the button shows "Listed on eBay ✓"
- **Add Another** (keeps the current set fields) and **View Card** remain available after save
- The listings load is keyed by the saved card's id, so it only appears after Save, not during form entry

## Key files
- `frontend/src/pages/AddCard.jsx` — form, autocomplete wiring, post-save panel
- `frontend/src/components/AutocompleteInput.jsx` — live suggestion input
- `backend/routers/cards.py` — `create_card` (calls `match_card_to_checklists` synchronously, then backgrounds a sold-price fetch)
- `backend/services/set_import_service.py` — `match_card_to_checklists`, `reconcile_unmatched`, `_names_match` (exact or last-name fuzzy match)

## Non-goals
- No autocomplete across un-imported sets — suggestions only come from checklists already in the database
