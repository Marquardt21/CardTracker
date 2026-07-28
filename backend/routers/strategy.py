from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.config import STRATEGY_MAX_CARDS
from backend.database import get_db
from backend.models import Card

router = APIRouter(prefix="/api/strategy", tags=["strategy"])


class StrategyRequest(BaseModel):
    card_ids: list[int]


@router.post("/analyze")
async def analyze(body: StrategyRequest, db: Session = Depends(get_db)):
    from backend.services.strategy_service import generate_strategy
    if not body.card_ids:
        raise HTTPException(status_code=400, detail="Select at least one card to analyze")
    if len(body.card_ids) > STRATEGY_MAX_CARDS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Too many cards ({len(body.card_ids)}). Narrow your selection to "
                f"{STRATEGY_MAX_CARDS} or fewer cards."
            ),
        )

    found = {c.id for c in db.query(Card).filter(Card.id.in_(body.card_ids)).all()}
    missing = [i for i in body.card_ids if i not in found]
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Cards not found: {', '.join(str(i) for i in missing)}",
        )

    result = await generate_strategy(body.card_ids, db)
    if "error" in result:
        raise HTTPException(status_code=502, detail=result["error"])
    return result
