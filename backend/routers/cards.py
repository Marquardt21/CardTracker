from typing import Optional
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import or_
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Card, SetChecklistCard
from backend.schemas import AutocompleteSuggestion, CardCreate, CardOut, CardPhotoOut, CardUpdate
from backend.services import photo_service

router = APIRouter(prefix="/api/cards", tags=["cards"])


@router.get("", response_model=list[CardOut])
def list_cards(
    search: str | None = Query(None),
    player: str | None = Query(None),
    team: str | None = Query(None),
    brand: str | None = Query(None),
    year: int | None = Query(None),
    card_type: str | None = Query(None),
    condition: str | None = Query(None),
    pack_label: str | None = Query(None),
    unmatched: bool = Query(False),
    sort: str = Query("date_added_desc"),
    db: Session = Depends(get_db),
):
    q = db.query(Card)

    if unmatched:
        q = q.filter(Card.checklist_matched == False)  # noqa: E712
    if search:
        term = f"%{search}%"
        q = q.filter(or_(
            Card.player_name.ilike(term),
            Card.set_name.ilike(term),
            Card.brand.ilike(term),
            Card.card_number.ilike(term),
        ))
    if player:
        q = q.filter(Card.player_name.ilike(f"%{player}%"))
    if team:
        q = q.filter(Card.team.ilike(f"%{team}%"))
    if brand:
        q = q.filter(Card.brand.ilike(f"%{brand}%"))
    if year:
        q = q.filter(Card.year == year)
    if card_type:
        q = q.filter(Card.card_type == card_type)
    if condition:
        q = q.filter(Card.condition == condition)
    if pack_label:
        q = q.filter(Card.pack_label.ilike(f"%{pack_label}%"))

    sort_map = {
        "date_added_desc": Card.date_added.desc(),
        "date_added_asc": Card.date_added.asc(),
        "player_asc": Card.player_name.asc(),
        "player_desc": Card.player_name.desc(),
        "year_desc": Card.year.desc(),
        "year_asc": Card.year.asc(),
    }
    q = q.order_by(sort_map.get(sort, Card.date_added.desc()))
    return q.all()


@router.post("", response_model=CardOut, status_code=201)
def create_card(card: CardCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    from backend.services.set_import_service import match_card_to_checklists
    from backend.services.price_service import fetch_sold_history_bg
    db_card = Card(**card.model_dump())
    db.add(db_card)
    db.commit()
    db.refresh(db_card)
    match_card_to_checklists(db, db_card)
    background_tasks.add_task(fetch_sold_history_bg, db_card.id)
    return db_card


@router.get("/exists", response_model=list[CardOut])
def check_exists(
    set_name: str = Query(...),
    card_number: str = Query(...),
    parallel_color: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Return any collection cards that match set + card number + parallel."""
    q = db.query(Card).filter(
        Card.set_name.ilike(set_name),
        Card.card_number == card_number,
    )
    if parallel_color:
        q = q.filter(Card.parallel_color.ilike(parallel_color))
    else:
        q = q.filter(Card.parallel_color.is_(None))
    return q.all()


@router.get("/unmatched", response_model=list[CardOut])
def get_unmatched(db: Session = Depends(get_db)):
    return db.query(Card).filter(Card.checklist_matched == False).all()  # noqa: E712


@router.get("/{card_id}", response_model=CardOut)
def get_card(card_id: int, db: Session = Depends(get_db)):
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return card


@router.put("/{card_id}", response_model=CardOut)
def update_card(card_id: int, updates: CardUpdate, db: Session = Depends(get_db)):
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    for field, value in updates.model_dump(exclude_none=True).items():
        setattr(card, field, value)
    db.commit()
    db.refresh(card)
    return card


@router.delete("/{card_id}", status_code=204)
def delete_card(card_id: int, db: Session = Depends(get_db)):
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    # Un-mark any checklist entry that pointed to this card
    db.query(SetChecklistCard).filter(
        SetChecklistCard.collection_card_id == card_id
    ).update({"owned": False, "collection_card_id": None})
    photo_service.delete_all_for_card(db, card)
    db.delete(card)
    db.commit()


def _card_or_404(card_id: int, db: Session) -> Card:
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return card


def _photo_out(photo) -> CardPhotoOut:
    return CardPhotoOut(
        side=photo.side,
        url=photo_service.public_url(photo),
        captured_at=photo.captured_at,
        uploaded_to_ebay=bool(photo.ebay_image_url),
    )


@router.get("/{card_id}/photos", response_model=list[CardPhotoOut])
def list_photos(card_id: int, db: Session = Depends(get_db)):
    """A card's photos, front first."""
    _card_or_404(card_id, db)
    return [_photo_out(p) for p in photo_service.get_photos(db, card_id)]


@router.post("/{card_id}/photos/{side}", response_model=CardPhotoOut)
async def upload_card_photo(
    card_id: int,
    side: str,
    photo: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Capture or retake one side of a card. `side` is "front" or "back"."""
    card = _card_or_404(card_id, db)
    try:
        saved = photo_service.save_photo(
            db, card, side,
            await photo.read(),
            filename=photo.filename,
            content_type=photo.content_type,
        )
    except photo_service.PhotoError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _photo_out(saved)


@router.delete("/{card_id}/photos/{side}", status_code=204)
def delete_card_photo(card_id: int, side: str, db: Session = Depends(get_db)):
    card = _card_or_404(card_id, db)
    try:
        removed = photo_service.delete_photo(db, card, side)
    except photo_service.PhotoError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not removed:
        raise HTTPException(status_code=404, detail=f"No {side} photo on this card")


@router.post("/{card_id}/photo", response_model=CardOut)
async def upload_photo(card_id: int, photo: UploadFile = File(...), db: Session = Depends(get_db)):
    """Legacy single-photo upload — kept so older clients keep working. Stores
    the image as the card's front photo."""
    card = _card_or_404(card_id, db)
    try:
        photo_service.save_photo(
            db, card, "front",
            await photo.read(),
            filename=photo.filename,
            content_type=photo.content_type,
        )
    except photo_service.PhotoError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.refresh(card)
    return card


@router.post("/{card_id}/price-recommendation")
async def get_price_recommendation(card_id: int, db: Session = Depends(get_db)):
    from backend.models import CardValue
    from backend.services.recommendation_service import generate_price_recommendation
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    sold_values = (
        db.query(CardValue)
        .filter(CardValue.card_id == card_id)
        .order_by(CardValue.fetched_at.desc())
        .limit(10)
        .all()
    )
    return await generate_price_recommendation(card, sold_values)


@router.patch("/{card_id}/watchlist", response_model=CardOut)
def toggle_watchlist(card_id: int, db: Session = Depends(get_db)):
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    card.grading_watchlist = not card.grading_watchlist
    db.commit()
    db.refresh(card)
    return card


@router.get("", response_model=list[AutocompleteSuggestion], tags=["autocomplete"])
def autocomplete(
    q: str = Query(..., min_length=2),
    field: str = Query("player_name"),
    db: Session = Depends(get_db),
):
    # This route is handled by /api/autocomplete below — kept for completeness
    pass
