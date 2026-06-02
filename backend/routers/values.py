from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Card, CardValue
from backend.schemas import CardValueOut

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


@router.post("/values/refresh-all")
async def refresh_all(db: Session = Depends(get_db)):
    from backend.services.price_service import fetch_price
    cards = db.query(Card).all()
    refreshed = 0
    for card in cards:
        result = await fetch_price(card, db)
        if result:
            refreshed += 1
    return {"refreshed": refreshed, "total": len(cards)}
