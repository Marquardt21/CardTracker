# MLB / NFL Card & Set Support

**Status:** Implemented
**Date:** 2026-07-28

## Summary
CardTracker currently assumes every card is NHL hockey — there's no `sport` field anywhere, and hockey is hardcoded into the eBay listing builder, the Whatnot export, and the AI grading prompt. This adds baseball and football as first-class sports: a `Sport` field on cards/sets, a new checklist-import path for sets that aren't on Upper Deck (which the existing scraper is built for), and sport-aware behavior everywhere hockey was previously assumed.

## Scope / What changes

**Data model** (`backend/models.py`, migration in `backend/main.py`)
- Add `sport` column to `Card` and `SetChecklist` — fixed values `Hockey` / `Baseball` / `Football`
- `ALTER TABLE cards ADD COLUMN sport VARCHAR DEFAULT 'Hockey'`, same for `set_checklists` — all existing rows are Hockey today, so the default backfills correctly with no data migration needed

**Checklist import — two paths behind one UI**
1. Existing Upper Deck HTML-table scraper (`set_import_service.py`) — unchanged.
2. New: paste a link directly to an `.xlsx` checklist file (Beckett hosts these for most Topps releases, e.g. `img.beckett.com/news/news-content/uploads/.../2025-Topps-Chrome-Football-Checklist.xlsx`). Detected automatically by URL suffix (`.xlsx`/`.xls`) — no new UI toggle needed.
   - Parses the workbook's **"Team Sets"** sheet: `[Subset Name] | [Card #] | [Player] | [Team] | [RC flag]`
   - Card type/parallel/rookie derived from the subset name using the same keyword classifier the UD parser uses ("auto" → autograph, "relic"/"patch" → relic, "variation" → parallel, "RC"/"rookie" → rookie)
   - Print run is usually absent from this sheet — stays null, already a nullable field
   - New dependency: `openpyxl` (not currently installed)
   - Set name/brand/year/sport are guessed from the filename, then shown **editable** in the preview step (the existing preview screen is read-only today — this is the one behavior change to the shared import UI)

**Frontend**
- Add Card page: new Sport dropdown (Hockey/Baseball/Football)
- Collection page: new Sport filter, above the existing Set → Type/Parallel/Player/Team cascade — picking a sport narrows the Set dropdown
- Import panel: same URL input serves both paths; preview stage gains editable set name/brand/year/sport fields

**Selling pipeline (sport-aware, not just storage)**
- `ebay_sell_service.py`: `Sport`/`League` aspects driven by the card's sport (Hockey→NHL, Baseball→MLB, Football→NFL) instead of hardcoded `["Hockey"]`/`["NHL"]`; category-suggestion query becomes `f"{sport} trading card"`; lot title/description say `"{Sport} Cards Lot"` instead of always "Hockey Cards Lot"
- Mixed-sport lots are **blocked**: selecting cards from more than one sport into a single lot listing returns a clear error, same pattern as the existing already-listed/sold guard
- `whatnot_service.py` / `config.py`: `Sub Category` becomes sport-driven instead of always `"Hockey"` — flagged as a best-guess to verify against the real Whatnot template, same caution already documented for the current hockey value
- `recommendation_service.py`: prompt's "expert hockey card dealer" → "expert {sport} card dealer"

## Key files
- `backend/models.py` — `sport` column on `Card`, `SetChecklist`
- `backend/main.py` — migration entries
- `backend/services/set_import_service.py` — new xlsx branch, shared card-type classifier
- `backend/routers/sets.py` — preview/import endpoints accept editable overrides
- `frontend/src/components/ImportSetPanel.jsx` — editable preview fields
- `frontend/src/pages/AddCard.jsx` — Sport dropdown
- `frontend/src/pages/Collection.jsx` — Sport filter
- `backend/services/ebay_sell_service.py` — sport-driven aspects/category/title, mixed-sport lot guard
- `backend/services/whatnot_service.py`, `backend/config.py` — sport-driven Sub Category
- `backend/services/recommendation_service.py` — sport-driven prompt wording

## Non-goals
- No scraping of Topps.com or Panini.com directly — both actively block automated requests (confirmed via a direct 403 during spec'ing); Beckett `.xlsx` links are the only MLB/NFL checklist source
- No automatic discovery of Beckett links — user finds and pastes each one as they acquire new sets
- No changes to existing Upper Deck/hockey import behavior or data

## Decisions & rationale
- **Topps.com scraping was ruled out**: a direct fetch attempt during spec'ing returned HTTP 403 (Cloudflare-style bot protection), same for a webfetch tool attempt. The original fallback idea (paste raw HTML/text and regex it) was superseded once a real Beckett `.xlsx` checklist was found to download cleanly and parse into clean structured data — strictly better than scraping blocked HTML.
- **Sport is a fixed 3-value enum, not free text**, so the eBay League mapping, Whatnot sub-category, and Collection filter stay reliable — chosen over free text (which would need a fallback path for unrecognized values) since only 3 sports are in scope.
- **Mixed-sport lots are blocked outright** rather than allowed with generic aspects, to avoid guessing at eBay category/aspect behavior for a case that's easy to just prevent at entry (same reasoning as the existing already-listed/sold guard).
- **Preview step becomes editable**: filename-based guessing (for the new xlsx path) is inherently less reliable than scraping a real page's title (the existing UD path), so the user needs a correction point before commit — the UI already has a confirm step, this just makes its fields writable.
