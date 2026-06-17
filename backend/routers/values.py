import asyncio
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import SessionLocal, get_db
from backend.models import Card, CardValue
from backend.schemas import ActiveListingOut, CardValueOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["values"])


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


@router.get("/cards/{card_id}/active-listings", response_model=list[ActiveListingOut])
async def get_active_listings(card_id: int, db: Session = Depends(get_db)):
    """Live eBay active listings for this card (not stored) — for click-through verification."""
    from backend.services.price_service import fetch_active_listings
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return await fetch_active_listings(card, limit=10)


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
