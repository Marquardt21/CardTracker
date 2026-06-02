from pathlib import Path
from typing import Optional
import aiofiles
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import or_
from sqlalchemy.orm import Session

from backend.config import PHOTOS_DIR
from backend.database import get_db
from backend.models import Card, SetChecklistCard
from backend.schemas import AutocompleteSuggestion, CardCreate, CardOut, CardUpdate

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
def create_card(card: CardCreate, db: Session = Depends(get_db)):
    from backend.services.set_import_service import match_card_to_checklists
    db_card = Card(**card.model_dump())
    db.add(db_card)
    db.commit()
    db.refresh(db_card)
    match_card_to_checklists(db, db_card)
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
    if card.photo_path:
        p = Path(card.photo_path)
        if p.exists():
            p.unlink()
    db.delete(card)
    db.commit()


@router.post("/{card_id}/photo", response_model=CardOut)
async def upload_photo(card_id: int, photo: UploadFile = File(...), db: Session = Depends(get_db)):
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    suffix = Path(photo.filename).suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".heic"}:
        raise HTTPException(status_code=400, detail="Unsupported image format")
    dest = PHOTOS_DIR / f"card_{card_id}{suffix}"
    async with aiofiles.open(dest, "wb") as f:
        await f.write(await photo.read())
    card.photo_path = str(dest)
    db.commit()
    db.refresh(card)
    return card


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
