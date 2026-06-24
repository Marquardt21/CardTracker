import asyncio
import json
import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.config import ACTIVE_LISTING_TTL_DAYS
from backend.database import SessionLocal, get_db
from backend.models import ActiveListingCache, Card, CardValue
from backend.schemas import ActiveListingOut, CardValueOut, ListingSummaryOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["values"])


def _row_to_summary(row: ActiveListingCache, cutoff: datetime) -> ListingSummaryOut:
    return ListingSummaryOut(
        card_id=row.card_id,
        low=row.low,
        high=row.high,
        count=row.count,
        listings=_parse_listings(row.listings_json),
        fetched_at=row.fetched_at,
        stale=row.fetched_at < cutoff,
    )


@router.get("/cards/{card_id}/values", response_model=list[CardValueOut])
def get_values(card_id: int, db: Session = Depends(get_db)):
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return card.values


@router.post("/cards/{card_id}/values/refresh", response_model=CardValueOut | None)
async def refresh_value(card_id: int, db: Session = Depends(get_db)):
    from backend.services.price_service import fetch_price
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    value = await fetch_price(card, db)
    return value


async def _get_or_fetch_listings(db: Session, card: Card, force: bool = False):
    """Return (listings, fetched_at, stale) for a card's eBay active listings.

    Cache-aware: every successful lookup is cached and reused for
    ACTIVE_LISTING_TTL_DAYS, so we don't re-hit eBay within that window. A live
    fetch happens only when the cache is missing/stale or `force` is set; empty
    results (rate-limit / no matches) are never persisted so they retry next time."""
    from backend.services.price_service import fetch_active_listings

    cutoff = datetime.utcnow() - timedelta(days=ACTIVE_LISTING_TTL_DAYS)
    row = db.get(ActiveListingCache, card.id)
    if row and not force and row.fetched_at >= cutoff:
        return _parse_listings(row.listings_json), row.fetched_at, False

    listings = await fetch_active_listings(card, limit=10)
    if not listings:
        if row:
            return _parse_listings(row.listings_json), row.fetched_at, row.fetched_at < cutoff
        return [], datetime.utcnow(), True

    prices = [l["price"] for l in listings if l.get("price") is not None]
    if row is None:
        row = ActiveListingCache(card_id=card.id)
        db.add(row)
    row.low = min(prices) if prices else None
    row.high = max(prices) if prices else None
    row.count = len(listings)
    row.listings_json = json.dumps(listings)
    row.fetched_at = datetime.utcnow()
    db.commit()
    return listings, row.fetched_at, False


def _parse_listings(raw: str | None) -> list[dict]:
    try:
        return json.loads(raw or "[]")
    except (ValueError, TypeError):
        return []


@router.get("/cards/{card_id}/active-listings", response_model=list[ActiveListingOut])
async def get_active_listings(card_id: int, force: bool = Query(False), db: Session = Depends(get_db)):
    """Current eBay active listings for this card. Cached for ACTIVE_LISTING_TTL_DAYS;
    pass `force=true` (the Refresh button) to pull a fresh set from eBay."""
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    listings, _, _ = await _get_or_fetch_listings(db, card, force=force)
    return listings


@router.get("/listing-summaries", response_model=list[ListingSummaryOut])
def get_listing_summaries(db: Session = Depends(get_db)):
    """All cached active-listing summaries (read-only, no eBay calls).

    Used to pre-populate the Collection price column with what we already have."""
    cutoff = datetime.utcnow() - timedelta(days=ACTIVE_LISTING_TTL_DAYS)
    return [_row_to_summary(r, cutoff) for r in db.query(ActiveListingCache).all()]


@router.post("/cards/{card_id}/listing-summary", response_model=ListingSummaryOut)
async def refresh_listing_summary(
    card_id: int,
    force: bool = Query(False),
    db: Session = Depends(get_db),
):
    """Return a card's active-listing summary, fetching live from eBay only when
    the cache is missing/stale (older than ACTIVE_LISTING_TTL_DAYS) or `force`."""
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    listings, fetched_at, stale = await _get_or_fetch_listings(db, card, force=force)
    prices = [l["price"] for l in listings if l.get("price") is not None]
    return ListingSummaryOut(
        card_id=card_id,
        low=min(prices) if prices else None,
        high=max(prices) if prices else None,
        count=len(listings),
        listings=listings,
        fetched_at=fetched_at,
        stale=stale,
    )


# ── Refresh-all background job ──────────────────────────────────────────────
# Pulling sold data for the whole collection takes minutes (a network scrape per
# card), so it runs as a background task and the UI polls for progress.
_refresh_job: dict = {
    "running":     False,
    "total":       0,
    "done":        0,
    "refreshed":   0,
    "started_at":  None,
    "finished_at": None,
}


async def _run_refresh_all() -> None:
    from backend.services.price_service import fetch_price
    db = SessionLocal()
    try:
        cards = db.query(Card).all()
        _refresh_job["total"] = len(cards)
        for card in cards:
            try:
                if await fetch_price(card, db):
                    _refresh_job["refreshed"] += 1
            except Exception as exc:  # noqa: BLE001
                logger.warning("Refresh-all: card %s failed: %s", card.id, exc)
            _refresh_job["done"] += 1
            await asyncio.sleep(0.3)  # be polite to the sold-data source
    finally:
        db.close()
        _refresh_job["running"]     = False
        _refresh_job["finished_at"] = datetime.utcnow().isoformat()


@router.post("/values/refresh-all")
async def refresh_all():
    if _refresh_job["running"]:
        return {"started": False, **_refresh_job}
    _refresh_job.update(
        running=True, total=0, done=0, refreshed=0,
        started_at=datetime.utcnow().isoformat(), finished_at=None,
    )
    asyncio.create_task(_run_refresh_all())
    return {"started": True, **_refresh_job}


@router.get("/values/refresh-all/status")
async def refresh_all_status():
    return _refresh_job
