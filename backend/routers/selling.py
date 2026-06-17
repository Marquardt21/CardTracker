from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Card, DraftListingCard, EbayDraftListing
from backend.schemas import (
    CardOut,
    ListingSoldUpdate,
    SellingDashboardOut,
    SellingGroupOut,
    SellingUpdate,
)

router = APIRouter(prefix="/api/selling", tags=["selling"])


def _latest_listing_by_card(db: Session) -> dict[int, EbayDraftListing]:
    """Map each card id to its most recent eBay listing."""
    rows = (
        db.query(DraftListingCard, EbayDraftListing)
        .join(EbayDraftListing, DraftListingCard.draft_id == EbayDraftListing.id)
        .order_by(EbayDraftListing.created_at.asc())
        .all()
    )
    by_card: dict[int, EbayDraftListing] = {}
    for dlc, listing in rows:
        by_card[dlc.card_id] = listing  # later (newer) listing wins
    return by_card


def _group_from_listing(listing: EbayDraftListing, cards: list[Card], sold: bool) -> SellingGroupOut:
    return SellingGroupOut(
        kind="listing",
        ref_id=listing.id,
        title=listing.title,
        is_lot=len(cards) > 1,
        price=listing.price,
        url=listing.ebay_draft_url,
        listing_date=min((c.listing_date for c in cards if c.listing_date), default=listing.created_at),
        sold_price=listing.sold_price if sold else None,
        sold_date=listing.sold_date if sold else None,
        cards=[CardOut.model_validate(c) for c in cards],
    )


def _group_from_card(card: Card, sold: bool) -> SellingGroupOut:
    return SellingGroupOut(
        kind="card",
        ref_id=card.id,
        title=f"{card.player_name} #{card.card_number} · {card.set_name}",
        is_lot=False,
        price=card.sold_price if sold else card.listed_price,
        url=card.sold_listing_url if sold else card.listing_url,
        listing_date=card.listing_date,
        sold_price=card.sold_price if sold else None,
        sold_date=card.sold_date if sold else None,
        cards=[CardOut.model_validate(card)],
    )


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
    by_card = _latest_listing_by_card(db)

    def build_groups(cards: list[Card], sold_state: bool) -> list[SellingGroupOut]:
        # Cards that share a listing are grouped under it (preserving card order);
        # cards with no listing become their own single-card group.
        listing_cards: dict[int, list[Card]] = {}
        listings: dict[int, EbayDraftListing] = {}
        order: list[int] = []
        groups: list[SellingGroupOut] = []
        for c in cards:
            listing = by_card.get(c.id)
            if listing:
                if listing.id not in listing_cards:
                    listing_cards[listing.id] = []
                    listings[listing.id] = listing
                    order.append(listing.id)
                listing_cards[listing.id].append(c)
            else:
                groups.append(_group_from_card(c, sold_state))
        for l_id in order:
            groups.append(_group_from_listing(listings[l_id], listing_cards[l_id], sold_state))
        return groups

    listed_groups = build_groups(listed, sold_state=False)
    sold_groups   = build_groups(sold,   sold_state=True)

    return SellingDashboardOut(
        listed_count=len(listed),
        sold_count=len(sold),
        listed_value=sum(g.price or 0.0 for g in listed_groups),
        sold_value=sum(g.sold_price or 0.0 for g in sold_groups),
        listed_groups=listed_groups,
        sold_groups=sold_groups,
    )


@router.patch("/listing/{listing_id}/sold", response_model=SellingGroupOut)
def mark_listing_sold(listing_id: int, updates: ListingSoldUpdate, db: Session = Depends(get_db)):
    """Mark an entire listing (lot or single) sold. Sale price/profit live on the
    listing; every card in it flips to sold."""
    listing = db.query(EbayDraftListing).filter(EbayDraftListing.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    listing.sold_price = updates.sold_price
    listing.sold_date  = updates.sold_date or datetime.utcnow()
    listing.status     = "sold"

    cards = [lc.card for lc in listing.cards if lc.card]
    for card in cards:
        card.is_selling = False
        card.is_sold    = True
        card.sold_date  = listing.sold_date
        card.sold_listing_url = listing.ebay_draft_url

    db.commit()
    db.refresh(listing)
    return _group_from_listing(listing, cards, sold=True)


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
