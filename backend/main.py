import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from sqlalchemy import text

from backend.config import PHOTOS_DIR
from backend.database import Base, engine
from backend.routers import alerts, autocomplete, cards, dashboard, ebay, grading, selling, sets, settings, strategy, values, whatnot

logging.basicConfig(level=logging.INFO)

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
        conn.commit()


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


@app.on_event("startup")
def on_startup():
    from backend.seed import run_seed
    run_seed()


@app.get("/api/health")
def health():
    return {"status": "ok"}
