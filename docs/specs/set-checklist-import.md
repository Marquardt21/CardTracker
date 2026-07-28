# Set Checklist Import & Tracking

**Status:** Implemented
**Date:** 2026-07-28 (retroactive)

## Summary
Imports a full set checklist from an Upper Deck URL, then reconciles it against the existing collection so already-owned cards are marked owned automatically. Set Detail shows owned-vs-needed and lets tapping an unowned card pre-fill Add Card.

## Scope / What it does
- User pastes an Upper Deck checklist URL (`ImportSetPanel.jsx`) → `POST /api/sets/preview-url` scrapes and returns a read-only preview (set name, brand, year, card count) → confirm → `POST /api/sets/import-url` saves it
- Scraper (`set_import_service._parse_upper_deck_html`) finds the checklist `<table>` by header keywords ("card #", "description"), maps flexible column headers (`_column_index`) to card_number/team/player/rookie/auto/relic/print-run, and classifies `card_type` by priority: auto+relic → `patch_relic`, auto → `autograph`, any parallel name → `parallel`, rookie flag → `rookie`, else `base`
- After import, `reconcile_unmatched` runs automatically: every `Card` with `checklist_matched = false` is retried against all checklists (`match_card_to_checklists`, matching on card_number + brand + fuzzy player name)
- Set Detail (`SetDetail.jsx`) shows owned vs. needed cards (`GET /api/sets/{id}/needed`); tapping an unowned card pre-fills the Add Card form
- Set completion (owned ≥ 10% of total) surfaces on the Dashboard (see [dashboard.md](dashboard.md))
- `GET /api/sets/{id}/card-variants?card_number=X` returns all variants (base/parallels/inserts) sharing a card number, for the variant picker when adding a card
- Sets can be deleted (`DELETE /api/sets/{id}`), cascading to their checklist cards

## Key files
- `backend/services/set_import_service.py` — scraper + reconciliation
- `backend/routers/sets.py` — preview/import/list/search/detail/needed/card-variants/reconcile/delete
- `backend/models.py` — `SetChecklist`, `SetChecklistCard`
- `frontend/src/components/ImportSetPanel.jsx` — URL paste → preview → confirm
- `frontend/src/components/UnmatchedReviewModal.jsx` — post-import reconciliation results
- `frontend/src/pages/SetChecklists.jsx` / `SetDetail.jsx` — set browsing/detail

## Non-goals
- Only Upper Deck checklist pages are scraped today (single HTML-table parser). No MLB/NFL / non-Upper-Deck source support — see [mlb-nfl-card-support.md](mlb-nfl-card-support.md) (Planned) for that.
