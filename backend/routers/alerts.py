from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.config import PRICE_SPIKE_THRESHOLD
from backend.database import get_db
from backend.models import Card

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("")
def get_alerts(db: Session = Depends(get_db)):
    cards = db.query(Card).all()
    alerts = []
    for card in cards:
        vals = sorted(card.values, key=lambda v: v.fetched_at)
        if len(vals) >= 2:
            prev, latest = vals[-2], vals[-1]
            if prev.price > 0:
                pct = (latest.price - prev.price) / prev.price
                if pct >= PRICE_SPIKE_THRESHOLD:
                    alerts.append({
                        "card_id": card.id,
                        "player_name": card.player_name,
                        "brand": card.brand,
                        "year": card.year,
                        "set_name": card.set_name,
                        "card_number": card.card_number,
                        "old_price": round(prev.price, 2),
                        "new_price": round(latest.price, 2),
                        "pct_change": round(pct * 100, 1),
                        "spike_date": latest.fetched_at.isoformat(),
                    })
    alerts.sort(key=lambda a: a["pct_change"], reverse=True)
    return alerts
