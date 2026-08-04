# CardTracker — Hockey Card Collection Manager

A self-hosted web app for tracking your NHL hockey card collection. Runs on
**Linux or Windows** and is accessed from iPads on your home WiFi.

---

## Quick Start

**Linux / macOS**

```bash
cd ~/Desktop/CardTracker
./start.sh
```

**Windows (PowerShell)**

```powershell
cd $HOME\Desktop\CardTracker
.\start.ps1
```

If Windows blocks the script, run it as
`powershell -ExecutionPolicy Bypass -File .\start.ps1`.

Then open your iPad browser and navigate to `http://<this-machine's-ip>:3000` —
both launchers print the address to use.

---

## First-Time Setup

### 1. Install system dependencies

Either OS needs **Python 3.11, 3.12 or 3.13** and **Node 18+**.

> Python **3.14 will not work**: `pydantic-core` has no 3.14 wheel yet, so pip
> falls back to compiling Rust and fails without a C/C++ toolchain. Both
> launchers check for a supported version and say so rather than failing
> halfway through an install.

**Linux**

```bash
sudo apt update
sudo apt install -y python3 python3-pip python3-venv nodejs npm
```

**Windows**

Install [Python 3.13](https://www.python.org/downloads/) (tick *Add python.exe
to PATH*) and [Node LTS](https://nodejs.org/). Nothing else is needed — no
Visual Studio build tools.

### 2. Clone / copy the project

Place the `CardTracker` folder wherever you like — `~/Desktop/CardTracker` on
Linux, `%USERPROFILE%\Desktop\CardTracker` on Windows.

### Running on both machines

The database (`data/cards.db`) and photos (`photos/`) are portable and can be
copied between machines. **Virtual environments are not** — a venv contains
OS-specific binaries. Linux uses `.venv`, Windows uses `.venv-windows`, and the
two coexist without clobbering each other. Both are gitignored, and each
launcher rebuilds its own if it is missing.

### 3. Create your `.env` file

Copy `.env.example` to `.env` and fill in your API keys. They are optional — the
app runs without them, but price lookups and the AI features won't work.

```
EBAY_APP_ID=your_ebay_app_id_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

### 4. Run the app

**Linux**

```bash
chmod +x start.sh
./start.sh
```

**Windows (PowerShell)**

```powershell
.\start.ps1
```

Either launcher will:
- Create a Python virtual environment and install backend dependencies
- Install frontend npm packages
- Start FastAPI on port 8000 and Vite on port 3000
- Print your local network IP so you can open it from any device on the same WiFi

---

## Finding This Machine's IP Address

Both launchers print it, but to look it up yourself:

**Linux**

```bash
hostname -I | awk '{print $1}'
```

**Windows (PowerShell)**

```powershell
(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' }).IPAddress
```

Open `http://<that-ip>:3000` on your iPad.

---

## Firewall

**Linux (ufw)** — if the firewall is active, open the two ports:

```bash
sudo ufw allow 3000/tcp comment "CardTracker frontend"
sudo ufw allow 8000/tcp comment "CardTracker backend"
sudo ufw reload
sudo ufw status
```

**Windows** — allow the two ports on your private network (run as Administrator,
once):

```powershell
New-NetFirewallRule -DisplayName "CardTracker frontend" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "CardTracker backend"  -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow -Profile Private
```

---

## Auto-Start on Boot (systemd)

Create a service file so CardTracker starts automatically when Ubuntu boots.

```bash
sudo nano /etc/systemd/system/cardtracker.service
```

Paste (replace `mike` with your Ubuntu username):

```ini
[Unit]
Description=CardTracker Hockey Card App
After=network.target

[Service]
Type=forking
User=mike
WorkingDirectory=/home/mike/Desktop/CardTracker
ExecStart=/home/mike/Desktop/CardTracker/start.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable cardtracker
sudo systemctl start cardtracker
sudo systemctl status cardtracker
```

Stop it:

```bash
sudo systemctl stop cardtracker
```

---

## Project Structure

```
CardTracker/
├── backend/
│   ├── main.py              # FastAPI app, router registration, seed on startup
│   ├── models.py            # SQLAlchemy ORM models
│   ├── schemas.py           # Pydantic request/response schemas
│   ├── config.py            # Paths, thresholds, grading cost table
│   ├── database.py          # SQLite engine + session factory
│   ├── seed.py              # Seeds Flair 2025 checklist + 5 sample cards
│   ├── routers/             # One file per feature area
│   │   ├── cards.py         # CRUD, front/back photo capture, watchlist
│   │   ├── autocomplete.py  # Player/set autocomplete from local checklists
│   │   ├── sets.py          # Set checklist import, reconcile, manage
│   │   ├── values.py        # Price history, refresh
│   │   ├── grading.py       # Grading ROI recommendations
│   │   ├── dashboard.py     # Stats, top cards, set completion, spikes
│   │   ├── alerts.py        # Price spike alerts
│   │   └── settings.py      # API key status, CSV export
│   └── services/
│       ├── set_import_service.py  # Upper Deck scraper + reconciliation
│       ├── price_service.py       # eBay API + 130point.com fallback
│       ├── photo_service.py       # Photo storage + 14-day retention purge
│       ├── ebay_media_service.py  # Uploads photos to eBay Picture Services
│       └── grading_service.py     # ROI calculation engine
├── frontend/
│   └── src/
│       ├── pages/           # Dashboard, Collection, AddCard, SetChecklists,
│       │                    #   SetDetail, CardDetail, Alerts, Settings
│       ├── components/      # NavBar, AutocompleteInput, ChecklistRow,
│       │                    #   ImportSetPanel, UnmatchedReviewModal, etc.
│       └── api/client.js    # Axios wrappers for every backend endpoint
├── data/
│   └── cards.db             # SQLite database (auto-created on first run)
├── photos/                  # Card photos, front + back (auto-created, gitignored)
├── flair_2025_checklist.json # Pre-bundled 2025-26 Upper Deck Flair checklist
├── requirements.txt
├── .env.example
├── start.sh                 # Launcher — Linux / macOS
└── start.ps1                # Launcher — Windows
```

---

## Key Features

| Feature | How it works |
|---|---|
| **Card entry** | Autocomplete for player name, set, and card number — sourced from locally imported set checklists, so no internet required during entry |
| **Set checklists** | Paste an Upper Deck URL; the app scrapes the full checklist and stores it locally. Owned cards are tracked per set. |
| **Reconciliation** | When a new checklist is imported, unmatched collection cards are automatically linked to matching checklist entries |
| **Price lookups** | eBay Finding API (primary) with 130point.com scraper fallback; 24-hour cache |
| **Grading ROI** | Estimates value uplift from grading (PSA/BGS/SGC) minus grading cost, gives Worth It / Borderline / Not Worth It verdict |
| **Card photos** | Capture a front and back shot from the iPad camera. Front is the main image. They're uploaded to eBay when you list, and deleted 14 days after the card sells — see [docs/specs/card-photos.md](docs/specs/card-photos.md) |
| **Alerts** | Flags cards whose price rose more than 25% between consecutive fetches |
| **Dashboard** | Collection value, 30-day change, top 5 cards, set completion progress, price spikes |
| **Export** | Download full collection as CSV |

---

## Configuring Thresholds and Grading Costs

Edit `backend/config.py`:

```python
GRADING_COSTS = {
    "PSA Regular": 25,
    "PSA Express": 75,
    "BGS Regular": 30,
    "SGC Regular": 20,
}

GRADING_ROI_WORTH_IT    = 20   # net ROI above this = "Worth It"
GRADING_ROI_BORDERLINE  = 5    # between this and above = "Borderline"
PRICE_SPIKE_PCT         = 25   # % increase that triggers an alert
```

Restart the backend after changes.

---

## API Keys

| Key | Where to get it | What it unlocks |
|---|---|---|
| `EBAY_APP_ID` | [developer.ebay.com](https://developer.ebay.com) → Register app | Live eBay sold price lookups |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | AI card scan (future feature) |

The app is fully functional without either key — card entry and set tracking work offline. Price lookups will fail silently if the eBay key is missing.
