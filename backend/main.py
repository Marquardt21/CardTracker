import asyncio
import logging
from datetime import datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from sqlalchemy import text

from backend.config import CARD_PHOTO_PURGE_INTERVAL_HOURS, CARD_PHOTO_RETENTION_DAYS, PHOTOS_DIR
from backend.database import Base, engine
from backend.routers import alerts, autocomplete, cards, dashboard, ebay, grading, selling, sets, settings, strategy, values, whatnot

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

Base.metadata.create_all(bind=engine)


def _run_migrations():
    with engine.connect() as conn:
        existing = {row[1] for row in conn.execute(text("PRAGMA table_info(cards)"))}
        new_cols = [
            ("sold_date",        "ALTER TABLE cards ADD COLUMN sold_date DATETIME"),
            ("sold_price",       "ALTER TABLE cards ADD COLUMN sold_price FLOAT"),
            ("sold_listing_url", "ALTER TABLE cards ADD COLUMN sold_listing_url VARCHAR"),
            ("is_selling",       "ALTER TABLE cards ADD COLUMN is_selling BOOLEAN DEFAULT 0"),
            ("listed_price",     "ALTER TABLE cards ADD COLUMN listed_price FLOAT"),
            ("listing_date",     "ALTER TABLE cards ADD COLUMN listing_date DATETIME"),
            ("listing_url",      "ALTER TABLE cards ADD COLUMN listing_url VARCHAR"),
            ("is_sold",          "ALTER TABLE cards ADD COLUMN is_sold BOOLEAN DEFAULT 0"),
            ("sport",            "ALTER TABLE cards ADD COLUMN sport VARCHAR DEFAULT 'Hockey'"),
            ("pack_label",       "ALTER TABLE cards ADD COLUMN pack_label VARCHAR"),
        ]
        for col, sql in new_cols:
            if col not in existing:
                conn.execute(text(sql))

        set_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(set_checklists)"))}
        if set_cols and "sport" not in set_cols:
            conn.execute(text("ALTER TABLE set_checklists ADD COLUMN sport VARCHAR DEFAULT 'Hockey'"))

        listing_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(ebay_draft_listings)"))}
        for col, sql in [
            ("sold_price", "ALTER TABLE ebay_draft_listings ADD COLUMN sold_price FLOAT"),
            ("sold_date",  "ALTER TABLE ebay_draft_listings ADD COLUMN sold_date DATETIME"),
            ("listing_format", "ALTER TABLE ebay_draft_listings ADD COLUMN listing_format VARCHAR DEFAULT 'FIXED_PRICE'"),
        ]:
            if listing_cols and col not in listing_cols:
                conn.execute(text(sql))

        _migrate_photos(conn)
        conn.commit()


def _migrate_photos(conn):
    """Move pre-existing single photos into card_photos as the card's front.

    `cards.photo_path` used to hold an absolute path, which breaks the moment the
    same database is opened on the other operating system. It now holds a bare
    filename relative to PHOTOS_DIR, so this rewrites the old rows in place."""
    rows = list(conn.execute(text(
        "SELECT id, photo_path FROM cards WHERE photo_path IS NOT NULL AND photo_path != ''"
    )))
    if not rows:
        return

    already = {
        r[0] for r in conn.execute(text("SELECT card_id FROM card_photos WHERE side = 'front'"))
    }
    for card_id, stored in rows:
        # Old absolute paths used whichever separator the writing OS favoured.
        filename = stored.replace("\\", "/").rstrip("/").split("/")[-1]
        if filename != stored:
            conn.execute(
                text("UPDATE cards SET photo_path = :f WHERE id = :i"),
                {"f": filename, "i": card_id},
            )
        if card_id in already:
            continue
        if not (PHOTOS_DIR / filename).exists():
            continue  # the row outlived its file; nothing to carry forward
        conn.execute(
            text(
                "INSERT INTO card_photos (card_id, side, filename, captured_at) "
                "VALUES (:i, 'front', :f, :t)"
            ),
            {"i": card_id, "f": filename, "t": datetime.utcnow()},
        )
        logger.info("Adopted existing photo for card %s as its front image.", card_id)


_run_migrations()

app = FastAPI(title="Hockey Card Tracker", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/photos", StaticFiles(directory=str(PHOTOS_DIR)), name="photos")

app.include_router(cards.router)
app.include_router(autocomplete.router)
app.include_router(sets.router)
app.include_router(values.router)
app.include_router(grading.router)
app.include_router(dashboard.router)
app.include_router(selling.router)
app.include_router(alerts.router)
app.include_router(settings.router)
app.include_router(ebay.router)
app.include_router(whatnot.router)
app.include_router(strategy.router)


_background_tasks: set[asyncio.Task] = set()


def _purge_card_photos_once():
    """Delete photos of cards sold longer ago than the retention window."""
    from backend.database import SessionLocal
    from backend.services import photo_service

    db = SessionLocal()
    try:
        return photo_service.purge_expired(db)
    except Exception:  # a failed purge must never stop the app from serving
        logger.exception("Card photo purge failed; will retry on the next pass.")
        return None
    finally:
        db.close()


async def _photo_purge_loop():
    """Run the retention purge on a timer for as long as the server is up.

    Deliberately a plain asyncio task rather than a scheduler dependency — the
    app already runs as one process on one machine, and this is the only
    recurring job it has."""
    interval = CARD_PHOTO_PURGE_INTERVAL_HOURS * 3600
    while True:
        await asyncio.sleep(interval)
        await asyncio.to_thread(_purge_card_photos_once)


@app.on_event("startup")
async def on_startup():
    from backend.seed import run_seed
    run_seed()

    if CARD_PHOTO_RETENTION_DAYS > 0:
        # Once now — the machine is often off for days, so a purge that only
        # fired on a timer would keep missing its window.
        await asyncio.to_thread(_purge_card_photos_once)
        # Held in a module-level set: asyncio keeps only a weak reference to a
        # running task, so a local would let it be garbage-collected mid-sleep.
        task = asyncio.create_task(_photo_purge_loop())
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)
    else:
        logger.info("Card photo retention is disabled (CARD_PHOTO_RETENTION_DAYS=0).")


@app.get("/api/health")
def health():
    return {"status": "ok"}
