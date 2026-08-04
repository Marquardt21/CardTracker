from pathlib import Path
from dotenv import load_dotenv
import os

load_dotenv()

PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"
PHOTOS_DIR = PROJECT_ROOT / "photos"

DATA_DIR.mkdir(exist_ok=True)
PHOTOS_DIR.mkdir(exist_ok=True)

DATABASE_URL = f"sqlite:///{DATA_DIR / 'cards.db'}"

EBAY_APP_ID    = os.getenv("EBAY_APP_ID", "")
EBAY_CERT_ID   = os.getenv("EBAY_CERT_ID", "")
EBAY_RU_NAME   = os.getenv("EBAY_RU_NAME", "Michael_Marquar-MichaelM-CardTr-yyriu")
EBAY_SHIP_PRICE             = float(os.getenv("EBAY_SHIP_PRICE", "4.00"))
EBAY_ZIP                    = os.getenv("EBAY_ZIP", "85212").strip()
EBAY_PLACEHOLDER_IMAGE_URL  = os.getenv("EBAY_PLACEHOLDER_IMAGE_URL", "").strip()
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

# ── Card photos ──────────────────────────────────────────────────────────────
# Each card can carry a front and a back photo, captured in the app. Front is
# always the primary listing image.
CARD_PHOTO_SIDES = ["front", "back"]

# Photos are personal data with no reason to outlive the sale. Once a card has
# been sold this long, its photo files and rows are purged. eBay keeps its own
# copy of anything that reached a listing, so purging never blanks a live
# listing. Set to 0 to disable the purge entirely.
CARD_PHOTO_RETENTION_DAYS = int(os.getenv("CARD_PHOTO_RETENTION_DAYS", "14"))

# How often the background purge runs while the server is up. It also runs once
# at startup, which covers the machine being off for a stretch.
CARD_PHOTO_PURGE_INTERVAL_HOURS = 12

# Accepted upload formats. iPad Safari hands us JPEG for camera captures; HEIC
# shows up when picking an existing photo from the library.
CARD_PHOTO_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}
# eBay's own per-image ceiling is 12 MB; reject above that before we waste an
# upload round trip.
CARD_PHOTO_MAX_BYTES = 12 * 1024 * 1024

# ── eBay Media API (image hosting) ───────────────────────────────────────────
# The Sell Inventory API only accepts public HTTPS image URLs, so a photo sitting
# on this machine can't be listed directly. The Media API takes the file bytes
# and hands back an eBay-hosted (EPS) URL — the same thing the eBay app does when
# you upload from your phone.
#
# This replaces the Trading API's UploadSiteHostedPictures, which eBay
# decommissions on 2026-09-30.
EBAY_MEDIA_BASE = "https://apim.ebay.com/commerce/media/v1_beta"
# eBay allows up to 24 images per listing.
EBAY_MAX_IMAGES = 24
# EPS images expire if unused. eBay does return an expirationDate; this is the
# conservative assumption used when it doesn't.
EBAY_IMAGE_ASSUMED_TTL_DAYS = 30

# ── Sports ───────────────────────────────────────────────────────────────────
# Fixed set of sports a card / set can belong to. Kept small and closed so the
# eBay League aspect and Whatnot Sub Category mappings below always resolve.
SPORTS = ["Hockey", "Baseball", "Football"]
DEFAULT_SPORT = "Hockey"

# eBay "League" item aspect per sport.
EBAY_LEAGUE_BY_SPORT = {
    "Hockey":   "NHL",
    "Baseball": "MLB",
    "Football": "NFL",
}

GRADING_COSTS = {
    "PSA Standard": 25,
    "PSA Express": 75,
    "BGS Standard": 30,
}

GRADING_MULTIPLIERS = {
    "rookie": 2.5,
    "autograph": 1.8,
    "patch_relic": 2.0,
    "parallel": 1.5,
    "base": 1.3,
}

PRICE_SPIKE_THRESHOLD = 0.25
GRADING_ROI_WORTH_IT = 20.0
GRADING_ROI_BORDERLINE = 5.0

# Max cards per AI selling-strategy run — bounds the prompt size / cost.
STRATEGY_MAX_CARDS = 50

# Max tool calls Claude may make during one strategy run — bounds eBay load,
# latency and cost for the agentic loop in strategy_service.
STRATEGY_MAX_TOOL_CALLS = 15

# How long a cached active-listing summary (low/high/count) stays fresh before
# the Collection price button will re-fetch it live from eBay.
ACTIVE_LISTING_TTL_DAYS = 7

# ── Whatnot CSV bulk-upload export ──────────────────────────────────────────
# Whatnot has no public API for this account (Seller API is limited-release), so
# we export a bulk-upload CSV that the user imports in Seller Hub → Bulk Upload.
# Whatnot REJECTS any row whose Category / Sub Category / Type / Condition /
# Shipping Profile doesn't exactly match the current template's "Values" tab, and
# they change the template periodically. Everything Whatnot-specific lives in this
# block so correcting it against a freshly downloaded template is a one-place edit.

WHATNOT_START_PRICE = 1.00           # default opening bid for "$1 start" singles
WHATNOT_LISTING_TYPE = "Auction"     # "Type" column value (Auction | Buy it Now)
WHATNOT_QUANTITY = 1                  # one physical card per listing
WHATNOT_MARKER = "whatnot"           # stored in card.listing_url to tag the channel

# Category / Sub Category / Shipping Profile must match the template's Values tab.
WHATNOT_CATEGORY = "Sports Cards"
# Sub Category per sport. Best guess — verify each value against a freshly
# downloaded template's Values tab (same caution as every other Whatnot value here).
WHATNOT_SUB_CATEGORY_BY_SPORT = {
    "Hockey":   "Hockey",
    "Baseball": "Baseball",
    "Football": "Football",
}
WHATNOT_SUB_CATEGORY_DEFAULT = "Hockey"
WHATNOT_SHIPPING_PROFILE = "0-1 oz"  # weight-based profile, or a custom profile name

# Our internal condition -> Whatnot's allowed Condition value (raw/ungraded cards).
WHATNOT_CONDITION_MAP = {
    "mint":       "Near Mint",
    "near_mint":  "Near Mint",
    "excellent":  "Excellent",
    "very_good":  "Very Good",
    "good":       "Good",
    "poor":       "Poor",
}
WHATNOT_CONDITION_DEFAULT = "Near Mint"

# Exact header row / column order for the bulk-upload CSV. Adjust to match the
# header row of your downloaded Whatnot template. Up to 8 image URL columns.
WHATNOT_CSV_COLUMNS = [
    "Category", "Sub Category", "Title", "Description", "Quantity",
    "Type", "Price", "Shipping Profile", "Condition", "SKU",
    "Image URL 1", "Image URL 2", "Image URL 3", "Image URL 4",
    "Image URL 5", "Image URL 6", "Image URL 7", "Image URL 8",
]
WHATNOT_MAX_IMAGES = 8

SCRAPER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}
