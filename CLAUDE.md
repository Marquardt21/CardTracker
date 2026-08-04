# CLAUDE.md

Project-specific context for AI assistants working in this repo. General behavioral guidelines (think before coding, simplicity, surgical changes, goal-driven execution) live in `~/.claude/CLAUDE.md` and apply here automatically — this file only covers what's specific to CardTracker.

Building a new feature or fix here? Use `/feature` — it interviews you to nail down the spec (following the global guidelines above), then hands off to the `feature-builder` subagent (Opus by default) to implement it. Both are defined globally in `~/.claude/` so they work the same way in other projects too.

Detailed per-feature specs (what each area does, key files, non-goals, and why non-obvious decisions were made) live in [docs/specs/](docs/specs/) — this file stays a quick-reference summary; docs/specs/ has the depth.

---

## Project Context

### What This Is

A personal sports card collection manager for home use — hockey, baseball and football (every card and set carries a `sport`, defaulting to Hockey). Two users (father and son) share the collection. The app runs on an Ubuntu PC **or a Windows 11 desktop** and is accessed via iPad browsers on the home WiFi. **Raw (ungraded) cards only.**

### Cross-platform rules

The app must run unchanged on Linux and Windows. What that costs:

- **Never store an absolute path in the database.** `data/cards.db` and `photos/` are copied between the two machines; a path written on one is meaningless on the other. Store a bare filename and resolve it against a config directory (see `photo_service.resolve`).
- **Never split a stored path on `/` alone.** Use `photoSrc()` in `api/client.js` on the frontend.
- **Two launchers, kept parallel:** `start.sh` (Linux/macOS) and `start.ps1` (Windows). A change to one should be mirrored in the other. Neither may depend on `fuser`, `hostname -I`, or `source .venv/bin/activate` being available.
- **Virtualenvs are not portable.** Linux uses `.venv`, Windows uses `.venv-windows`; both are gitignored and each launcher rebuilds its own. A launcher finding a venv from the other OS replaces it rather than failing.
- **Python 3.11–3.13 only.** 3.14 has no `pydantic-core` wheel, so pip falls back to compiling Rust and fails without MSVC. Both launchers check and fail with that explanation.
- No `os.system`, no shell built-ins in `subprocess`, no POSIX-only stdlib (`fcntl`, `signal.SIGKILL`) in `backend/`.

Primary goals:
- Track what cards we own and what they're worth
- Identify which cards are worth sending to PSA/BGS for grading
- List cards for sale on eBay directly from the app
- Track set completion against official checklists

### Tech Stack

| Layer | Choice |
|---|---|
| Backend | Python 3 / FastAPI |
| Database | SQLite via SQLAlchemy ORM (`data/cards.db`) |
| Frontend | React (Vite) + Tailwind CSS |
| HTTP client (FE) | Axios |
| HTTP client (BE) | httpx |
| Scraping | BeautifulSoup4 |
| Checklist workbooks | openpyxl (`.xlsx` set imports) |
| Charts | Recharts |
| LLM | Anthropic (`claude-sonnet-4-6`) — optional AI card scan |

Backend runs on port 8000, frontend dev server on port 3000 (proxies `/api` → `localhost:8000`).

---

## Core Capabilities & Workflows

### 1. Collection Management
- Add, edit, delete cards with full metadata (brand, year, set, player, condition, parallel, print run, notes, photo)
- Upload a card photo directly from the app
- Browse the collection with search, filter (player/team/brand/year/type/condition), and sort
- "Unmatched" filter tab shows cards not yet linked to an official checklist — appears only when relevant
- **Cascading filters** (client-side, on `Collection.jsx`): pick a Sport, then a Set, then narrow by Type / Parallel / Player / Team. Each dropdown's options are derived from the cards still in scope; changing the sport resets the set and everything under it.
- **Get eBay Prices** button: pulls live eBay asking-price summaries for every card in the current filtered view and shows a **low–high range + listing count** to the right of each row, all on one screen. Tap a price to expand the live BIN carousel inline. Fetch is throttled (3 concurrent). Selecting multiple cards (Select mode) → **List on eBay** still creates one lot listing.
- Price summaries are **cached for 7 days** (`ACTIVE_LISTING_TTL_DAYS`, `active_listing_cache` table). Cached values pre-populate the column on load (`GET /api/listing-summaries`, read-only, no eBay calls); the button only re-fetches cards whose cache is missing or stale (`POST /api/cards/{id}/listing-summary`, `?force=true` to bypass TTL). Empty/rate-limited results are **not** persisted, so they retry next time.

### 1b. Value & List on Save (Add Card)
- After saving a card on the Add Card page, the "Card saved!" panel auto-loads **Current eBay Listings** for that card (same live BIN carousel as Card Detail, via `GET /api/cards/{id}/active-listings`) so you can value it at a glance
- A **List on eBay** button in the same panel opens `CreateEbayDraftModal` for the just-saved card — value and list in one flow without leaving the page
- After the listing is scheduled, the button shows "Listed on eBay ✓"; **Add Another** (keeps the current set) and **View Card** remain available
- Listings load is keyed by the saved card id, so it appears only after Save (not during form entry)

### 1c. Card Photos (front + back)
- Every card can carry **one front and one back photo**, captured in the app. **Front is always the primary image** — collection thumbnail, card detail hero, and the first picture on the eBay listing
- `CardPhotoCapture.jsx` renders two tiles, each an `<input type="file" accept="image/*" capture="environment">` — this opens the iPad's rear camera directly. Deliberately **not** `getUserMedia`, which needs a secure context and would not work over plain `http://` on the LAN. The component appears on Card Detail and in the Add Card "Card saved!" panel
- Stored in `card_photos` (one row per card per side). `filename` is a **bare name relative to `photos/`**, never an absolute path — see the cross-platform rules above. `photo_service.resolve()` is the only filename → path conversion. `cards.photo_path` still mirrors the front photo so pre-existing thumbnail code keeps working; the startup migration rewrites old absolute paths and adopts existing photos as fronts
- **Getting them to eBay:** the Sell Inventory API only accepts public HTTPS URLs, which a photo on a home-network machine does not have. `ebay_media_service` posts the bytes to the **Media API** (`create_image_from_file` → `getImage`) and gets back an eBay-hosted EPS URL. This replaces the Trading API's `UploadSiteHostedPictures`, **decommissioned 2026-09-30 — do not go back to it**. Requires only the `sell.inventory` scope the app already holds, so a connected account needs no re-consent. URLs are cached on the row until near expiry
- `_resolve_image_urls` picks a listing's pictures: an explicit URL from the modal wins, else the cards' own photos (all fronts, then all backs, capped at 24), else `EBAY_PLACEHOLDER_IMAGE_URL`. A card that **has** photos but fails to upload makes the listing fail rather than silently publishing under a placeholder
- **Retention:** photos are deleted once the card has been sold for `CARD_PHOTO_RETENTION_DAYS` (14). Purge runs at startup and every 12 hours (a plain asyncio task — no scheduler dependency). A card flagged sold with **no `sold_date` is never purged**. `GET /api/photos/status` and `POST /api/photos/purge?dry_run=true` expose it. `photos/` is gitignored
- See [docs/specs/card-photos.md](docs/specs/card-photos.md)

### 2. Autocomplete Card Entry
- Typing 2+ characters in any field (card number, player name, set name) on the Add Card page queries imported set checklists
- Selecting a suggestion fills all fields at once
- If no checklist match exists, user can import a set inline or skip and save manually
- Unmatched cards (`checklist_matched = false`) are retroactively linked when a matching set is imported later

### 3. Set Checklist Import & Tracking
- User pastes an Upper Deck checklist URL; the app scrapes the page and imports all cards
- **Or** pastes a link to an `.xlsx`/`.xls` checklist file (Beckett hosts these for most Topps/Panini releases) — detected by URL suffix, parsed from the workbook's "Team Sets" sheet (`openpyxl`). Card type / parallel / rookie come from the subset-name column; print run isn't on that sheet and stays null
- The preview step is **editable** (set name / brand / year / sport) before confirming, since the xlsx path guesses its metadata from the filename
- See [docs/specs/mlb-nfl-card-support.md](docs/specs/mlb-nfl-card-support.md)
- After import, runs reconciliation: auto-links any unmatched collection cards to the new checklist
- Set Detail view shows owned vs. needed cards; tapping an unowned card pre-fills the Add Card form
- Set completion progress shows on Dashboard for any set where ≥10% is owned

### 4. Price Tracking
- When a card is added, a background job fetches recent eBay sold prices
- Price lookup priority: eBay Marketplace Insights API → 130point.com scrape → eBay Finding API (legacy)
- Graded slabs (PSA/BGS/SGC/CGC) are filtered out of all results
- Results cached in `card_values` table; never re-fetches within 24 hours
- Price history displayed as a line chart on the Card Detail page
- Card Detail also shows **Current eBay Listings** — active BIN listings (Browse API, `GET /api/cards/{id}/active-listings`) with price, condition, image, and click-through link. Useful sold-data proxy while Marketplace Insights approval is pending.
- **Active-listing cache (7-day TTL)**: every successful active-listings lookup is cached in `active_listing_cache` (`ACTIVE_LISTING_TTL_DAYS`) and reused for 7 days, so the same card isn't re-fetched from eBay within that window. All read paths go through the same cache-aware helper (`_get_or_fetch_listings`): Card Detail / Add Card auto-loads use the cache; the Card Detail **Refresh** button and Collection price pull can force a live re-fetch (`?force=true`). Empty/rate-limited results are never persisted (they retry next time). The Collection price column pre-loads cached summaries via read-only `GET /api/listing-summaries`.
- "Refresh All Values" in Settings triggers a background job (`POST /api/values/refresh-all`, polled via `/status`) over the whole collection

### 5. Grading Recommendation Engine
- Cards can be added to a "Grading Watchlist" (toggle on Collection or Card Detail)
- For watchlisted cards, user can generate a recommendation: estimates graded value using card-type multipliers, subtracts grading cost, reports ROI and verdict ("Worth It" / "Borderline" / "Not Worth It")
- Multipliers and grading costs are configurable in `backend/config.py`
- Dashboard surfaces watchlist cards where verdict = "Worth It"

### 6. eBay Listing (Primary Active Development Area)
- From the Selling Dashboard or Card Detail, user selects one or more cards and opens the "List on eBay" modal
- User picks a **format — Buy It Now or Auction** — sets the price (for Auction this is the **starting bid**), edits the auto-generated title/description, provides a photo URL (Imgur or GitHub raw link), submits
- **Auction support** (`listing_format` on the request and `EbayDraftListing`): the offer uses `format: AUCTION` with `pricingSummary.auctionStartPrice` and a user-chosen `listingDuration` (`auction_duration`, picker in the modal — `DAYS_1/3/5/7/10`, default 7, validated server-side against `AUCTION_DURATIONS`, no per-buyer limit); Buy It Now uses `format: FIXED_PRICE` with `pricingSummary.price`. Everything else (inventory item, condition, policies, scheduling) is identical.
- **Shipping tier**: fixed-price branches on the entered price (≤$20 → Standard Envelope / 1 oz LETTER, else Ground / 3 oz thick envelope). **Auctions always use the heavier Ground tier** (`heavy_shipping = is_auction or price > 20`) since the final hammer price is unknown and may exceed the envelope limit.
- Backend flow:
  1. Creates an eBay inventory item (Sell Inventory API). **One card → category 261328 "Trading Card Singles"; multiple cards → one lot listing in category 261329 "Trading Card Lots"** (Singles rejects multi-card titles/keywords, errorId 25019). Item details:
     - Single: `condition = USED_VERY_GOOD` (conditionId 4000 = "Ungraded"; `LIKE_NEW` would map to 2750 = "Graded" and force grade descriptors) + a **Card Condition** descriptor (40001, NM/EX/VG/Poor) fetched from the Metadata API with a documented fallback
     - Lot: `condition = USED_EXCELLENT` (conditionId 3000 = "Used"); lots have **no** condition descriptors and no required aspects
     - item aspects validated against the category's allowed values (invalid dropped, required auto-filled): `Sport`, `Type: Sports Trading Card`, etc.
     - a `packageWeightAndSize` (required to publish)
  2. Looks up fulfillment policies **by name** ("CardTracker Standard Envelope" for ≤$20, "CardTracker Ground Shipping" for >$20) — these must be created manually once in Seller Hub → Policies; a no-returns policy is auto-created. IDs cached in-process.
  3. Resolves or creates a merchant location (requires `EBAY_ZIP` in `.env`)
  4. Creates an offer and publishes it, scheduled 2 hours from now so user can add photos or cancel in Seller Hub
  5. Marks card(s) as `is_selling = true` in the DB; records listing URL
- eBay auth: OAuth 2.0 flow via `/api/ebay/auth/start` → redirect → `/api/ebay/auth/callback`; tokens stored in `ebay_tokens` table; auto-refreshed when expired. A manual paste-a-token path also exists (`/api/ebay/auth/user-token`) but stores a **2-hour token with no refresh** — it will not overwrite a durable OAuth connection. Prefer the OAuth flow.
- Sport-aware: the `Sport`/`League` aspects, the singles category-suggestion query and the lot title/description all key off the card's `sport` (Hockey→NHL, Baseball→MLB, Football→NFL, mapped in `config.EBAY_LEAGUE_BY_SPORT`). A lot mixing sports is rejected — one listing carries one Sport/League pair
- Listing creation **blocks cards that are already listed or sold** (`is_selling`/`is_sold`); the Collection select UI also disables them. All cards in a listing are marked `is_selling` with the listing date/URL on publish.
- Selling Dashboard groups by listing: a multi-card lot shows as **one row** using the listing title and the listing's price (per-card `listed_price` stays null for lots). Marking a lot sold (`PATCH /api/selling/listing/{id}/sold`) records one sale price + date on the `EbayDraftListing` and flips all its cards to sold; net profit = sold price − eBay fee (13.25% + $0.30). Single manual cards (listed via Card Detail without an eBay listing) still appear as their own group and use the per-card `PATCH /api/selling/{card_id}`.

### 7. Dashboard
- Total cards, total estimated value, 30-day value change
- Top 5 most valuable cards
- Grading watchlist summary (Worth It cards highlighted)
- Set completion progress bars
- Price spike alerts (cards where newest price >25% above previous)

### 8. Alerts
- Dedicated Alerts page listing all price spikes above the configured threshold
- Threshold configurable in `backend/config.py` (default 25%)

### 9. Whatnot Export
- Whatnot's Seller API is limited-release and unavailable to this account, so instead of listing directly, the app exports a Whatnot bulk-upload CSV (`POST /api/whatnot/export`) that's imported manually in Seller Hub → Bulk Upload
- Each selected card becomes one Auction row with a configurable opening bid (default $1); title/description built the same way as the eBay lot builder
- Whatnot rejects rows whose Category/Sub Category/Type/Condition/Shipping Profile don't exactly match the current bulk-upload template — all Whatnot-specific values live in one `config.py` block (`WHATNOT_*`) so they're a one-place fix against a freshly downloaded template. Sub Category is chosen by the card's sport (`WHATNOT_SUB_CATEGORY_BY_SPORT`) — still a best guess to verify against the real template
- Same already-listed/sold guard as eBay listing; exported cards are marked `is_selling` with the channel tagged via `listing_url`
- See [docs/specs/whatnot-export.md](docs/specs/whatnot-export.md) for detail

---

## Key Files

```
backend/
  main.py                    # FastAPI app, router registration, SQLite migrations
  config.py                  # All tunable values: thresholds, multipliers, grading costs, eBay config
  models.py                  # SQLAlchemy ORM models
  schemas.py                 # Pydantic request/response schemas
  routers/
    cards.py                 # Card CRUD, front/back photo capture, price recommendation
    dashboard.py             # Dashboard summary endpoint
    selling.py               # Selling dashboard + manual selling status updates
    ebay.py                  # eBay OAuth flow + listing creation endpoint
    grading.py               # Grading watchlist + recommendation generation
    sets.py                  # Set checklist import (URL scraping) + reconciliation
    alerts.py                # Price spike alerts
    settings.py              # Config read/write + CSV export
    values.py                # Price fetch/history endpoints
  services/
    ebay_sell_service.py     # eBay Sell API integration (inventory, offers, policies, publish)
    price_service.py         # eBay price lookup (Insights → 130point → Finding API)
    grading_service.py       # ROI-based grading verdict engine
    set_import_service.py    # Upper Deck checklist scraper + card reconciliation
    photo_service.py         # Card photo storage, resolution, retention purge
    ebay_media_service.py    # Uploads card photos to eBay Picture Services (Media API)

frontend/src/
  pages/
    Dashboard.jsx
    Collection.jsx
    CardDetail.jsx
    AddCard.jsx
    SellingDashboard.jsx
    SetChecklists.jsx / SetDetail.jsx
    Alerts.jsx
    Settings.jsx
  components/
    CreateEbayDraftModal.jsx # eBay listing form (title, price, photos, description)
    CardPhotoCapture.jsx     # Front/back camera capture tiles
    AutocompleteInput.jsx    # Live checklist suggestion input
    ImportSetPanel.jsx       # URL paste + import flow
    UnmatchedReviewModal.jsx # Post-import reconciliation results
    NavBar.jsx               # Bottom nav (iPad-optimized)
    PriceChart.jsx           # Recharts price history chart
```

---

## Environment Variables (`.env`)

| Variable | Purpose |
|---|---|
| `EBAY_APP_ID` | eBay developer App ID (Client ID) |
| `EBAY_CERT_ID` | eBay developer Cert ID (Client Secret) |
| `EBAY_RU_NAME` | eBay RuName for OAuth redirect |
| `EBAY_SHIP_PRICE` | Flat shipping cost for Ground policy (default `4.00`) |
| `EBAY_ZIP` | Your zip code — required to create eBay merchant location |
| `EBAY_PLACEHOLDER_IMAGE_URL` | Default photo URL pre-filled in listing modal (Imgur/GitHub raw) |
| `ANTHROPIC_API_KEY` | For optional "Scan Card with AI" feature |
| `CARD_PHOTO_RETENTION_DAYS` | Days after a card sells before its photos are purged (default `14`; `0` disables) |

---

## eBay Integration Notes

- Requires eBay Business Policies to be enabled on the seller account (Seller Hub → Account → Business Policies → Opt In)
- Uses the **eBay Inventory API** (`/sell/inventory/v1`) — not the legacy Trading API
- **Fulfillment policies must be created manually once in Seller Hub** (the Account API rejected programmatic creation for this account). Required names: "CardTracker Standard Envelope" (≤$20) and "CardTracker Ground Shipping" (>$20). The code looks them up by name and raises a clear error if missing. The no-returns policy is still auto-created. IDs cached in-process.
- Shipping: Standard Envelope for cards ≤$20; USPS Ground Advantage for >$20
- **Condition model**: raw cards only. Item `condition = USED_VERY_GOOD` → conditionId 4000 = "Ungraded"; the Card Condition descriptor (40001) carries NM/EX/VG/Poor. Do **not** use `LIKE_NEW` (= conditionId 2750 = "Graded", which forces grade descriptors and blocks publish).
- Required item aspects/descriptors are discovered dynamically via the Taxonomy + Metadata APIs (`get_item_aspects_for_category`, `get_item_condition_policies`), so new eBay requirements are auto-filled rather than hard-coded.
- A `packageWeightAndSize` is required to publish (1 oz LETTER for ≤$20, 3 oz thick envelope otherwise).
- Photos must be public HTTPS URLs — eBay does not accept localhost or local file paths. Card photos captured in the app get one by being uploaded to eBay Picture Services via the Media API (see Card Photos above); only a manually pasted URL still has to be publicly hosted
- Listings are published with a 2-hour delay so the user can add real photos or cancel in Seller Hub

---

## Design System

- Background: `#0D1B2A` (deep navy), Surface: `#1A2E45`, Accent: `#A8DADC` (ice blue)
- Text primary: `#FFFFFF`, secondary: `#94A3B8`
- Success: `#22C55E`, Warning: `#EAB308`, Danger: `#EF4444`
- All tap targets min 44×44px (Apple HIG — optimized for iPad Safari)
- Bottom navigation bar, fixed; 6 tabs: Dashboard, Collection, Add Card, Sets, Alerts, Settings

---

## Known Issues / Active Work

- eBay listing publish is **working** — end-to-end verified on production (raw card scheduled successfully). The earlier 25007 / 25064 / 25002 publish failures are resolved; see the eBay Integration Notes above for the condition model and policy setup that made it work.

---

## Future Features (not yet built)

- PIN-based auth + remote access via Tailscale
- Push notifications (iOS Shortcuts + webhook) for price spike alerts
- PSA/BGS population report integration

- Barcode/QR scanning for sealed product
- Trade value comparison tool
- systemd auto-start service
