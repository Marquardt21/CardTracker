from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Card
from backend.schemas import CardOut, SellingDashboardOut, SellingUpdate

router = APIRouter(prefix="/api/selling", tags=["selling"])


@router.get("/dashboard", response_model=SellingDashboardOut)
def get_selling_dashboard(db: Session = Depends(get_db)):
    listed = (
        db.query(Card)
        .filter(Card.is_selling == True, Card.is_sold == False)  # noqa: E712
        .order_by(Card.listing_date.desc().nullslast(), Card.date_added.desc())
        .all()
    )
    sold = (
        db.query(Card)
        .filter(Card.is_sold == True)  # noqa: E712
        .order_by(Card.sold_date.desc().nullslast(), Card.date_added.desc())
        .all()
    )
    return SellingDashboardOut(
        listed_count=len(listed),
        sold_count=len(sold),
        listed_value=sum(c.listed_price or 0.0 for c in listed),
        sold_value=sum(c.sold_price or 0.0 for c in sold),
        listed_cards=listed,
        sold_cards=sold,
    )


@router.patch("/{card_id}", response_model=CardOut)
def update_selling(card_id: int, updates: SellingUpdate, db: Session = Depends(get_db)):
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    card.is_selling   = updates.is_selling
    card.listed_price = updates.listed_price
    card.listing_date = updates.listing_date
    card.listing_url  = updates.listing_url
    card.is_sold      = updates.is_sold
    # Only update sold_price / sold_date when a value is provided so we don't
    # accidentally clear data recorded via the add-card "recently sold" form.
    if updates.sold_price is not None:
        card.sold_price = updates.sold_price
    if updates.sold_date is not None:
        card.sold_date = updates.sold_date

    db.commit()
    db.refresh(card)
    return card
