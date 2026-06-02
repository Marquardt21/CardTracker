from datetime import datetime, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.config import PRICE_SPIKE_THRESHOLD
from backend.database import get_db
from backend.models import Card, CardValue, GradingRecommendation, SetChecklist

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("")
def get_dashboard(db: Session = Depends(get_db)):
    cards = db.query(Card).all()
    total_cards = len(cards)

    # Latest value per card
    def latest_value(card):
        if not card.values:
            return None
        return max(card.values, key=lambda v: v.fetched_at)

    valued = [(c, latest_value(c)) for c in cards]
    total_value = sum(v.price for _, v in valued if v)

    # Value change over 30 days
    cutoff = datetime.utcnow() - timedelta(days=30)
    old_values = []
    for card, _ in valued:
        old = [v for v in card.values if v.fetched_at < cutoff]
        if old:
            old_values.append(max(old, key=lambda v: v.fetched_at).price)
    old_total = sum(old_values)
    value_change_30d = total_value - old_total if old_values else 0.0

    # Top 5 by latest value
    sorted_by_value = sorted(
        [(c, v) for c, v in valued if v],
        key=lambda x: x[1].price,
        reverse=True,
    )[:5]

    # Watchlist cards with ROI > $20
    watchlist_cards = [c for c in cards if c.grading_watchlist]
    worth_it = []
    for card in watchlist_cards:
        rec = (
            db.query(GradingRecommendation)
            .filter(GradingRecommendation.card_id == card.id)
            .order_by(GradingRecommendation.generated_at.desc())
            .first()
        )
        if rec and rec.verdict == "Worth It":
            worth_it.append(card)

    # Set completion (sets where owned >= 10% of total)
    sets = db.query(SetChecklist).all()
    set_completion = []
    for s in sets:
        owned = sum(1 for c in s.cards if c.owned)
        if s.total_cards > 0 and owned / s.total_cards >= 0.10:
            set_completion.append({
                "set_id": s.id,
                "set_name": s.set_name,
                "year": s.year,
                "owned": owned,
                "total": s.total_cards,
                "pct": round(owned / s.total_cards * 100, 1),
            })

    # Price spikes
    spikes = []
    for card in cards:
        vals = sorted(card.values, key=lambda v: v.fetched_at)
        if len(vals) >= 2:
            prev, latest = vals[-2], vals[-1]
            if prev.price > 0:
                pct = (latest.price - prev.price) / prev.price
                if pct >= PRICE_SPIKE_THRESHOLD:
                    spikes.append({
                        "card_id": card.id,
                        "player_name": card.player_name,
                        "set_name": card.set_name,
                        "old_price": prev.price,
                        "new_price": latest.price,
                        "pct_change": round(pct * 100, 1),
                        "spike_date": latest.fetched_at.isoformat(),
                    })

    return {
        "total_cards": total_cards,
        "total_value": round(total_value, 2),
        "value_change_30d": round(value_change_30d, 2),
        "top_cards": [c for c, _ in sorted_by_value],
        "watchlist_worth_it": worth_it,
        "set_completion": set_completion,
        "price_spikes": spikes,
    }
