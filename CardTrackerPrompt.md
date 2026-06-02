# Hockey Card Tracker — Claude Code Prompt

## Project Overview

Build a full-stack NHL hockey card collection tracking system for personal home use. It runs on a Ubuntu PC (natively, dual-boot) and is accessed from iPads on the same home WiFi network via a web browser. The collection is shared between two people (father and son), tracking raw NHL cards only. The UI should be clean, simple, and functional — optimized for iPad Safari.

This will be built using Claude Code inside VS Code on Ubuntu. All instructions, commands, and paths must be Linux/Ubuntu compatible.

---

## Tech Stack

- **Backend:** Python 3 with FastAPI
- **Database:** SQLite via SQLAlchemy ORM
- **Frontend:** React (Vite) with React Router for navigation
- **Styling:** Tailwind CSS
- **HTTP Client (frontend):** Axios
- **Charts:** Recharts
- **Backend HTTP client:** httpx
- **HTML parsing (scraping fallback):** BeautifulSoup4
- **Environment variables:** python-dotenv
- **Dev environment:** VS Code on Ubuntu, Claude Code in terminal
- **Network:** Local LAN only — server binds to `0.0.0.0:8000` so iPads on the same WiFi can connect via the PC's local IP

---

## Beginner-Friendly Ubuntu Setup (include in README)

Write a clear, numbered README guide assuming the user is not a Linux expert. Include:

1. Install Python 3 and pip (`sudo apt install python3 python3-pip python3-venv`)
2. Install Node.js and npm via nvm (recommended over apt for version control)
3. Clone or create the project folder
4. Backend setup:
   - Create a virtual environment (`python3 -m venv venv`)
   - Activate it (`source venv/bin/activate`)
   - Install dependencies (`pip install -r requirements.txt`)
   - Copy `.env.example` to `.env` and fill in API keys
5. Frontend setup:
   - `cd frontend && npm install`
6. How to find the PC's local IP address (`ip addr` or `hostname -I`) so iPads can connect
7. How to run both backend and frontend together using the included `start.sh` script
8. How to back up the SQLite database file

### Manual Start Script
Include a `start.sh` in the project root that starts both servers:
```bash
#!/bin/bash
# Start Hockey Card Tracker
echo "Starting Hockey Card Tracker..."

# Start backend
source venv/bin/activate
uvicorn backend.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
echo "Backend running (PID $BACKEND_PID)"

# Start frontend dev server
cd frontend
npm run dev -- --host 0.0.0.0 --port 3000 &
FRONTEND_PID=$!
echo "Frontend running (PID $FRONTEND_PID)"

echo ""
echo "App available at: http://$(hostname -I | awk '{print $1}'):3000"
echo "Press Ctrl+C to stop both servers"

wait
```

Make it executable: `chmod +x start.sh`

### Auto-Start on Boot (Optional — document but don't configure by default)
Include a README section titled "Optional: Auto-Start on Boot" showing how to use a systemd service to run the app automatically when Ubuntu boots. Provide the full `.service` file and instructions. Off by default — user enables it when ready.

---

## Database Schema (SQLite via SQLAlchemy)

### `cards` table
- `id` (primary key, integer)
- `brand` (string — e.g. "Upper Deck", "Topps", "Parkhurst")
- `year` (integer — e.g. 2023)
- `set_name` (string — e.g. "O-Pee-Chee Platinum")
- `card_number` (string — e.g. "42")
- `player_name` (string)
- `team` (string)
- `position` (string)
- `card_type` (enum: base, rookie, parallel, autograph, patch_relic)
- `parallel_color` (nullable string — e.g. "Blue", "Gold /99")
- `print_run` (nullable integer — e.g. 99 for /99 cards)
- `condition` (enum: poor, good, very_good, excellent, near_mint, mint)
- `date_added` (datetime, auto)
- `notes` (nullable text)
- `photo_path` (nullable string — relative path to uploaded card image)
- `grading_watchlist` (boolean, default false — user opts specific cards in for grading analysis)
- `checklist_matched` (boolean, default false — true once this card has been matched to an imported set checklist)

### `card_values` table
- `id` (primary key)
- `card_id` (foreign key → cards)
- `source` (string — e.g. "eBay sold", "130point")
- `price` (decimal)
- `fetched_at` (datetime)

### `set_checklists` table
- `id` (primary key)
- `set_name` (string — e.g. "O-Pee-Chee Platinum")
- `brand` (string)
- `year` (integer)
- `total_cards` (integer — total cards in the set as imported)
- `source_url` (string — the Upper Deck checklist URL this set was imported from)
- `imported_at` (datetime)

### `set_checklist_cards` table
- `id` (primary key)
- `set_id` (foreign key → set_checklists)
- `card_number` (string)
- `player_name` (string)
- `card_type` (string — base, rookie, parallel, autograph, patch_relic)
- `parallel_color` (nullable string)
- `print_run` (nullable integer)
- `owned` (boolean, default false — flips to true automatically when a matching card is added to the collection via Add Card)
- `collection_card_id` (nullable foreign key → cards — links to the actual owned card once acquired)

### `grading_recommendations` table
- `id` (primary key)
- `card_id` (foreign key → cards)
- `estimated_graded_value` (decimal)
- `grading_cost_estimate` (decimal)
- `roi_estimate` (decimal)
- `verdict` (string — "Worth It", "Borderline", or "Not Worth It")
- `recommendation` (text — human-readable explanation)
- `generated_at` (datetime)

---

## Card Entry — Primary Workflow

The Add Card form uses imported set checklists as the primary source of truth for auto-fill and validation.

### Step-by-step flow:
1. User begins typing in **any** of these fields: card number, player name, or set name
2. As the user types, the app queries imported checklists and shows **inline autocomplete suggestions** matching what's been typed so far — works from any field
3. Selecting an autocomplete suggestion **fills all fields at once**: brand, year, set name, card number, player name, card type, parallel color, print run
4. User reviews pre-filled fields (all still editable), adds condition and any notes
5. Optional: upload a photo after saving

### Autocomplete behavior:
- Typing in **card number** → suggests matching cards across all imported sets, shows player name + set name next to each suggestion
- Typing in **player name** → suggests matching players across all sets, shows card number + set name
- Typing in **set name** → filters to that set, then lets user pick card number
- Suggestions appear after 2+ characters are typed
- Suggestions are sourced entirely from `set_checklist_cards` — no external API call needed for autocomplete
- All suggestions show: player name, card number, set name, card type, print run (if numbered)

### If no checklist match found:
- After typing and finding no autocomplete match, show a prompt: **"No match found in your imported sets. Do you have a checklist URL to add this set?"**
- If user taps "Add Set URL": open the Import Set panel inline so they can paste a URL immediately, import the set, and then return to the Add Card form with autocomplete now working
- If user taps "Skip for now": allow saving the card with all fields manually entered. Set `checklist_matched = false` on this card. It will be auto-matched retroactively when a matching set is imported later.

**Optional AI scan:** A clearly labeled "Scan Card with AI" button allows photo upload → Claude Vision API (`claude-sonnet-4-20250514`) extracts card details from the image. Label the button to make clear it uses AI/costs money. User must explicitly tap it — never auto-trigger.

---

## External APIs & Data Sources

### 1. Card Identification / Lookup
Build a `card_lookup_service.py` abstraction layer. Query in this order:
- **Sportlots** (free, NHL card data by brand/number)
- **Trading Card Database (TCDB)** — scrape if no public API key available
- **CollectAPI** hockey card endpoint if available
- **Manual fallback** — show full editable form if all APIs fail

The abstraction layer must make it easy to add new APIs later without touching other code.

### 4. Set Checklist Import
Build a `set_import_service.py`. The primary import method is **URL-based** — user pastes a URL from upperdeck.com.

#### URL-based import (primary method):
- User pastes a URL in the format: `https://upperdeck.com/checklist/[set-name]/`
- Detect that it is an Upper Deck checklist URL and route to the UD scraper
- Fetch the page using `httpx`, parse the checklist table using `BeautifulSoup4`
- The Upper Deck checklist table columns are: Set Name, Card #, Description (player name), Team City, Team Name, Rookie, Auto, Tech, #'d (print run), SPs, Stated Odds, Point
- Extract per card: card number, player name, team, card type (base/rookie/parallel/autograph), parallel color (from Set Name column variant names), print run (from #'d column)
- Store the source URL in `set_checklists.source_url`
- On success: return a preview object `{ set_name, brand, year, card_count }` to the frontend before confirming save — user sees "Found 239 cards in 2025-26 Flair Hockey. Import?" and taps Confirm
- On failure: return a clear error with the URL that failed

#### After any import — reconciliation:
- After saving the new set to DB, immediately run the **unmatched card reconciliation** process:
  1. Query all cards in the `cards` table where `checklist_matched = false`
  2. For each unmatched card, try to find a matching row in `set_checklist_cards` by card_number + player_name (fuzzy match on name — handle minor spelling differences)
  3. For any match found: set `checklist_matched = true` on the card, set `owned = true` and `collection_card_id` on the checklist row
  4. Return a reconciliation summary: `{ newly_matched: N, still_unmatched: M }` to the frontend
- Display this summary in a **"Unmatched Cards Review" modal** after import completes:
  - Shows how many cards were auto-matched
  - Lists any cards still unmatched with their manually-entered details
  - User can tap any unmatched card to edit it or leave it for later
  - "Done" closes the modal

#### Ongoing matching:
- When a new card is added via Add Card flow, silently check all checklists for a match and flip `owned = true` on any matching checklist row — no extra steps for user
Build a `price_service.py`. Query in this order:
- **eBay Finding API** — `findCompletedItems` filtered to sold listings only, searched by player name + brand + year + card number. Requires free eBay developer API key.
- **130point.com scraper** — fallback using `httpx` + `BeautifulSoup4` if eBay API is unavailable
- Cache every result in `card_values` table with timestamp and source
- Never re-fetch a card's price more than once per 24 hours (check DB before calling API)

### 3. Grading Recommendation Engine
Build a `grading_service.py`. Rules:
- **Only runs on cards where `grading_watchlist = true`** — never analyzes the full collection automatically
- Pulls the most recent market value for the card from `card_values`
- Estimates graded value using card type multipliers (configurable in `config.py`):
  - Rookie: × 2.5
  - Autograph: × 1.8
  - Patch/Relic: × 2.0
  - Parallel: × 1.5
  - Base: × 1.3
- Uses configurable grading cost table (in `config.py`):
  - PSA Standard: $25
  - PSA Express: $75
  - BGS Standard: $30
- ROI = estimated_graded_value − current_raw_value − grading_cost
- Verdict logic:
  - ROI > $20 → "Worth It"
  - ROI $5–$20 → "Borderline"
  - ROI < $5 → "Not Worth It"
- Saves result to `grading_recommendations` table

---

## Features & Pages

### 1. Dashboard (home screen)
- Total cards in collection
- Total estimated collection value (sum of most recent price per card)
- Value change over last 30 days
- Top 5 most valuable cards (mini card list with values)
- Grading Watchlist summary — cards on watchlist with ROI > $20 flagged as "Worth It"
- Set completion widget — for any set where you own ≥10% of cards, show a progress bar "X of Y"
- Price Spikes section — cards where newest price is >25% higher than previous fetch

### 2. Collection Browser
- Searchable, filterable, sortable card list
- Filters: player, team, brand, year, card type, condition
- Sort: value high/low, date added, player name
- Each row shows: player name, brand, year, card number, type, condition, current value
- Each row has a **🎯 Grade? toggle** — taps add/remove card from grading watchlist instantly without opening the card
- Tapping the card name/row opens Card Detail
- Filter tab **"Unmatched"** — shows only cards where `checklist_matched = false`, so user can review and resolve them. Does NOT show this tab by default — only visible when unmatched cards exist.

### 3. Card Detail View
- All card fields displayed cleanly
- Card photo (if uploaded)
- Price history line chart (Recharts)
- "Refresh Value" button — triggers fresh eBay lookup for this card
- **"🎯 Add to Grading Watchlist" toggle** — prominent, clearly labeled
- Grading recommendation panel (only visible when card is on watchlist):
  - Current raw value
  - Estimated graded value
  - Grading cost
  - Net ROI
  - Verdict badge: "Worth It" (green) / "Borderline" (yellow) / "Not Worth It" (red)
- Edit button (opens edit form with all fields)
- Delete button (with confirmation dialog)

### 4. Add Card Page
- Single form — no separate steps. All fields visible at once.
- **Autocomplete on all key fields:** card number, player name, and set name all trigger live suggestions from imported checklists as the user types (2+ characters)
- Selecting a suggestion fills all fields: brand, year, set name, card number, player name, card type, parallel color, print run
- Remaining fields user fills manually: condition (required), notes (optional)
- If no match found after typing: prompt appears — "No match in your sets. Add a set URL?" with inline import option or "Skip" to save unmatched
- Optional photo upload after save
- "Scan Card with AI" button clearly labeled as optional/costs money
- Form must work smoothly on iPad — large tap targets, no hover-dependent interactions, autocomplete dropdown styled for touch

### 5. Alerts Page
- Lists all cards where newest price fetch is >25% higher than previous fetch
- Shows: card name, old price, new price, % change, date of spike
- Alert threshold configurable in `config.py`

### 6. Settings Page
- "Refresh All Values" button — re-fetches eBay prices for entire collection (rate-limited, runs in background)
- Export collection to CSV download
- Display current API key status (present/missing) — never show key values
- Configurable thresholds: price spike %, grading ROI cutoffs, grading cost table
- "Remote Access / PIN Protection — Coming Soon" placeholder section

### 7. Set Checklists Page

#### Set List view (default):
- Simple list of all imported sets, sorted newest year first
- Each row shows: set name, year, "X of Y cards owned", completion progress bar
- **"+ Add Set" button** at top — opens the URL import panel (see below)
- Tapping a set row opens Set Detail view

#### Add Set panel (URL import):
- A text input field with placeholder: "Paste Upper Deck checklist URL…"
- Example shown below input: `https://upperdeck.com/checklist/2025-26-flair-hockey-checklist/`
- "Import" button fires the scrape
- Loading spinner while fetching
- On success: show confirmation card — "Found **239 cards** in **2025-26 Upper Deck Flair Hockey**. Import this set?" with Confirm / Cancel buttons
- On confirm: save to DB, run reconciliation, show Unmatched Cards Review modal (see above)
- On failure: show "Could not read that URL. Make sure it's an Upper Deck checklist page." with a link to `upperdeck.com/checklists/` to browse

#### Set Detail view:
- Header: set name, year, brand, source URL (tappable), progress bar "X of Y owned"
- Full card-by-card checklist table
- Columns: card number, player name, card type, parallel/variant, print run, owned status
- Owned cards: highlighted row, green ✅ checkmark
- Unowned cards: muted/dim row, empty checkbox
- Filter tabs at top: **All** / **Owned** / **Still Needed**
- Tapping an **unowned** card row → opens Add Card form pre-filled with all that card's data
- Tapping an **owned** card row → navigates to that card's Card Detail view
- Delete Set button (with confirmation) — removes checklist but does NOT delete owned cards from collection

---

## React Frontend Architecture

### Structure
```
frontend/
├── src/
│   ├── main.jsx
│   ├── App.jsx                  # Router setup
│   ├── api/
│   │   └── client.js            # Axios instance pointed at backend
│   ├── components/
│   │   ├── NavBar.jsx           # Bottom nav bar (iPad-friendly) — 6 icons: Dashboard, Collection, Add Card, Sets, Alerts, Settings
│   │   ├── CardRow.jsx          # Card list row with grading toggle
│   │   ├── GradingBadge.jsx     # Worth It / Borderline / Not Worth It
│   │   ├── PriceChart.jsx       # Recharts price history
│   │   ├── SetProgressBar.jsx   # Set completion progress bar
│   │   ├── ChecklistRow.jsx          # Single row in a set checklist (owned/unowned state)
│   │   ├── AutocompleteInput.jsx     # Reusable input with live checklist suggestions dropdown
│   │   ├── ImportSetPanel.jsx        # URL paste + import flow (used on Sets page and inline on Add Card)
│   │   ├── UnmatchedReviewModal.jsx  # Post-import modal showing reconciliation results
│   │   └── ConfirmDialog.jsx         # Reusable confirmation modal
│   └── pages/
│       ├── Dashboard.jsx
│       ├── Collection.jsx
│       ├── CardDetail.jsx
│       ├── AddCard.jsx
│       ├── SetChecklists.jsx    # List of all imported sets
│       ├── SetDetail.jsx        # Full checklist for one set
│       ├── Alerts.jsx
│       └── Settings.jsx
├── index.html
├── vite.config.js               # Proxy /api → localhost:8000
└── tailwind.config.js
```

### Vite Proxy Config
In `vite.config.js`, proxy all `/api` requests to the FastAPI backend:
```js
server: {
  proxy: {
    '/api': 'http://localhost:8000'
  }
}
```

### Design System (Tailwind)
- Color palette:
  - Background: `#0D1B2A` (deep navy)
  - Surface/cards: `#1A2E45`
  - Accent: `#A8DADC` (ice blue)
  - Text primary: `#FFFFFF`
  - Text secondary: `#94A3B8`
  - Success/Worth It: `#22C55E`
  - Warning/Borderline: `#EAB308`
  - Danger/Not Worth It: `#EF4444`
- All tap targets minimum 44×44px (Apple HIG)
- Bottom navigation bar — fixed at bottom, 6 icons: Dashboard, Collection, Add Card, Sets, Alerts, Settings
- Rounded cards, generous padding, clean typography
- No external fonts — use system font stack

---

## Backend Structure

```
backend/
├── main.py                  # FastAPI app entry point, all routers registered
├── database.py              # SQLAlchemy engine, session, Base
├── models.py                # ORM models
├── schemas.py               # Pydantic request/response schemas
├── routers/
│   ├── cards.py             # Card CRUD endpoints
│   │   ├── values.py            # Price fetch and history endpoints
│   ├── grading.py           # Grading watchlist and recommendation endpoints
│   ├── dashboard.py         # Dashboard summary endpoint
│   ├── alerts.py            # Price spike alerts endpoint
│   ├── sets.py              # Set checklist import and management endpoints
│   └── settings.py          # Settings and export endpoints
├── services/
│   ├── card_lookup_service.py   # Card ID API abstraction
│   ├── price_service.py         # eBay + fallback price fetching
│   ├── grading_service.py       # ROI-based grading recommendation engine
│   └── set_import_service.py    # Set checklist import (Sportlots + TCDB scrape)
├── config.py                # All configurable values (thresholds, multipliers, costs)
└── .env                     # API keys (gitignored)
```

---

## API Endpoints (FastAPI)

```
# Cards
GET    /api/cards                                        # List with search/filter/sort
POST   /api/cards                                        # Create card
GET    /api/cards/{id}                                   # Card detail
PUT    /api/cards/{id}                                   # Update card
DELETE /api/cards/{id}                                   # Delete card
POST   /api/cards/lookup                                 # Auto-fill from brand+number+year
POST   /api/cards/{id}/photo                             # Upload card photo
POST   /api/cards/scan                                   # Claude Vision scan (optional)
PATCH  /api/cards/{id}/watchlist                         # Toggle grading watchlist
GET    /api/cards/unmatched                              # All cards where checklist_matched=false

# Values
GET    /api/cards/{id}/values                            # Price history for a card
POST   /api/cards/{id}/values/refresh                    # Force fresh price fetch
POST   /api/values/refresh-all                           # Refresh all cards (rate-limited)

# Grading
GET    /api/grading                                      # All watchlist cards + recommendations
POST   /api/grading/{card_id}/generate                   # Generate/refresh recommendation

# Dashboard
GET    /api/dashboard                                    # Full dashboard summary

# Alerts
GET    /api/alerts                                       # Price spike alerts

# Sets & Checklists
GET    /api/sets                                         # List all imported set checklists
POST   /api/sets/search                                  # Search for a set by name OR brand+year
POST   /api/sets/import-url                              # Import set by pasting Upper Deck URL
GET    /api/sets/{id}                                    # Full checklist for one set
DELETE /api/sets/{id}                                    # Remove a set checklist (cards kept)
GET    /api/sets/{id}/needed                             # Cards in set not yet owned
GET    /api/autocomplete                                 # Autocomplete suggestions from checklists (?q=&field=card_number|player_name|set_name)
POST   /api/sets/reconcile                              # Manually trigger unmatched card reconciliation

# Settings & Export
GET    /api/export/csv                                   # Download collection as CSV
GET    /api/settings                                     # Get current config values
PUT    /api/settings                                     # Update config values
```

---

## Error Handling

- eBay API down/rate-limited → log error, show last known value with a "stale" label and timestamp
- Card lookup returns no results → show "No match found — fill in manually" and open full form
- Card has no price data → show "No value yet — tap to fetch"
- Missing API keys → validate on startup, show a banner in the UI with instructions
- SQLite DB → auto-create on first run if `data/cards.db` doesn't exist
- All async service calls wrapped in try/except with meaningful error messages returned to frontend

---

## Project Root Structure

```
hockey-card-tracker/
├── backend/                 # FastAPI backend (see above)
├── frontend/                # React + Vite frontend (see above)
├── data/
│   └── cards.db             # SQLite database (auto-created)
├── photos/                  # Uploaded card images
├── start.sh                 # One-command startup script
├── requirements.txt         # Python dependencies
├── .env.example             # API key template
└── README.md                # Full Ubuntu + VS Code setup guide
```

---

## Ubuntu-Specific Notes for Claude Code

- All file paths must use POSIX-style forward slashes — use `pathlib.Path` throughout
- The `start.sh` script uses `&` to background processes and `wait` to keep the terminal open
- SQLite file path should be resolved at runtime relative to the project root using `pathlib.Path(__file__).parent`
- `requirements.txt` should pin major versions for reproducibility
- README should include `sudo ufw allow 8000` and `sudo ufw allow 3000` instructions so iPads on the LAN can connect through Ubuntu's firewall
- Node version: recommend Node 20 LTS via nvm
- Python version: Python 3.11+

---

## Future Features (do NOT build now — architect for them)

- PIN-based auth + remote access via Tailscale VPN
- Push notifications via iOS Shortcuts + webhook for price spike alerts
- PSA/BGS population report integration
- Multi-photo support per card
- Barcode/QR scanning for sealed product
- Trade value comparison tool
- systemd auto-start service (README section included as optional)

---

## Deliverables

1. Full working codebase matching the project structure above
2. `README.md` — beginner-friendly Ubuntu + VS Code setup guide with numbered steps
3. `start.sh` — one-command startup for both backend and frontend
4. Optional systemd auto-start service file + instructions in README
5. `.env.example` with all required API keys documented
6. `requirements.txt` with pinned versions
7. At least 5 sample NHL cards pre-seeded in the SQLite database for testing
8. Seed the **2025-26 Upper Deck Flair Hockey** checklist from `flair_2025_checklist.json` (included in project root) so autocomplete works immediately on first run
9. Ubuntu firewall (`ufw`) instructions so iPads can reach the app on the LAN

---

## How to Build This

Start by confirming the full plan back to me. Then build the project in this order, pausing for confirmation between each phase:

1. **Phase 1 — Project scaffold:** folder structure, `requirements.txt`, `package.json`, Vite + Tailwind config, FastAPI skeleton, SQLite DB setup, `.env.example`
2. **Phase 2 — Backend core:** models, schemas, all routers, CRUD for cards
3. **Phase 3 — Services:** card lookup, price fetching, grading engine, URL-based set import service (Upper Deck scraper + reconciliation engine)
4. **Phase 4 — React frontend:** component library including AutocompleteInput + ImportSetPanel + UnmatchedReviewModal, all pages, routing, Axios client
5. **Phase 5 — Polish:** autocomplete tuning, unmatched reconciliation testing, error handling, seed Flair 2025 checklist, `start.sh`, README

Explain what each file does in plain English as you create it. If you hit a decision point, ask before proceeding.