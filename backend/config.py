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

SCRAPER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}
