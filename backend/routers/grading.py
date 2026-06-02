from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Card, GradingRecommendation
from backend.schemas import GradingRecommendationOut, GradingRequest

router = APIRouter(prefix="/api/grading", tags=["grading"])


@router.get("", response_model=list[dict])
def list_watchlist(db: Session = Depends(get_db)):
    cards = db.query(Card).filter(Card.grading_watchlist == True).all()  # noqa: E712
    result = []
    for card in cards:
        rec = (
            db.query(GradingRecommendation)
            .filter(GradingRecommendation.card_id == card.id)
            .order_by(GradingRecommendation.generated_at.desc())
            .first()
        )
        result.append({
            "card": card,
            "recommendation": rec,
        })
    return result


@router.post("/{card_id}/generate", response_model=GradingRecommendationOut)
def generate_recommendation(card_id: int, body: GradingRequest, db: Session = Depends(get_db)):
    from backend.services.grading_service import generate_grading_recommendation
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    if not card.grading_watchlist:
        raise HTTPException(status_code=400, detail="Card is not on the grading watchlist")
    rec = generate_grading_recommendation(card, body.grading_service, db)
    if rec is None:
        raise HTTPException(status_code=400, detail="No price data available for this card")
    return rec
