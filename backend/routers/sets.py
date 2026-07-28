from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import SetChecklist, SetChecklistCard
from backend.schemas import (
    CardVariantOut,
    ImportUrlRequest,
    PreviewUrlRequest,
    SetChecklistDetail,
    SetChecklistOut,
    SetImportPreview,
    SetImportResult,
)
from backend.services import set_import_service

router = APIRouter(prefix="/api/sets", tags=["sets"])


@router.get("", response_model=list[SetChecklistOut])
def list_sets(db: Session = Depends(get_db)):
    sets = db.query(SetChecklist).order_by(SetChecklist.year.desc(), SetChecklist.set_name).all()
    return [
        SetChecklistOut(
            id=s.id,
            set_name=s.set_name,
            brand=s.brand,
            year=s.year,
            sport=s.sport,
            total_cards=s.total_cards,
            source_url=s.source_url,
            imported_at=s.imported_at,
            owned_count=sum(1 for c in s.cards if c.owned),
        )
        for s in sets
    ]


@router.get("/search", response_model=list[SetChecklistOut])
def search_sets(q: str = Query(""), db: Session = Depends(get_db)):
    """Return distinct sets matching the query string, for the Set autocomplete field."""
    sets_q = db.query(SetChecklist)
    if len(q) >= 2:
        sets_q = sets_q.filter(SetChecklist.set_name.ilike(f"%{q}%"))
    sets_list = sets_q.order_by(SetChecklist.year.desc(), SetChecklist.set_name).limit(20).all()
    return [
        SetChecklistOut(
            id=s.id,
            set_name=s.set_name,
            brand=s.brand,
            year=s.year,
            sport=s.sport,
            total_cards=s.total_cards,
            source_url=s.source_url,
            imported_at=s.imported_at,
            owned_count=0,
        )
        for s in sets_list
    ]


@router.get("/{set_id}", response_model=SetChecklistDetail)
def get_set(set_id: int, db: Session = Depends(get_db)):
    s = db.query(SetChecklist).filter(SetChecklist.id == set_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Set not found")
    return SetChecklistDetail(
        id=s.id,
        set_name=s.set_name,
        brand=s.brand,
        year=s.year,
        sport=s.sport,
        total_cards=s.total_cards,
        source_url=s.source_url,
        imported_at=s.imported_at,
        owned_count=sum(1 for c in s.cards if c.owned),
        cards=s.cards,
    )


@router.get("/{set_id}/card-variants", response_model=list[CardVariantOut])
def get_card_variants(
    set_id: int,
    card_number: str = Query(...),
    db: Session = Depends(get_db),
):
    """Return all variants (base, parallels, inserts) for an exact card number within a set."""
    s = db.query(SetChecklist).filter(SetChecklist.id == set_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Set not found")
    variants = (
        db.query(SetChecklistCard)
        .filter(
            SetChecklistCard.set_id == set_id,
            SetChecklistCard.card_number == card_number,
        )
        .all()
    )
    return variants


@router.get("/{set_id}/needed", response_model=list)
def get_needed(set_id: int, db: Session = Depends(get_db)):
    s = db.query(SetChecklist).filter(SetChecklist.id == set_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Set not found")
    return [c for c in s.cards if not c.owned]


_READ_ERROR = (
    "Could not read that URL. Use an Upper Deck checklist page "
    "or a direct link to an .xlsx checklist file."
)


@router.post("/preview-url", response_model=SetImportPreview)
async def preview_url(body: PreviewUrlRequest):
    result = await set_import_service.fetch_and_parse_url(body.url)
    if result is None:
        raise HTTPException(status_code=422, detail=_READ_ERROR)
    return SetImportPreview(
        set_name=result["set_name"],
        brand=result["brand"],
        year=result["year"],
        sport=result["sport"],
        card_count=len(result["cards"]),
        source_url=body.url,
    )


@router.post("/import-url", response_model=SetImportResult)
async def import_url(body: ImportUrlRequest, db: Session = Depends(get_db)):
    result = await set_import_service.fetch_and_parse_url(body.url)
    if result is None:
        raise HTTPException(status_code=422, detail=_READ_ERROR)
    # Corrections made on the preview screen win over what the parser guessed
    for field in ("set_name", "brand", "year", "sport"):
        value = getattr(body, field)
        if value:
            result[field] = value
    set_obj, reconciliation = set_import_service.save_set_and_reconcile(db, result, body.url)
    return SetImportResult(
        set_id=set_obj.id,
        set_name=set_obj.set_name,
        brand=set_obj.brand,
        year=set_obj.year,
        sport=set_obj.sport,
        card_count=set_obj.total_cards,
        reconciliation=reconciliation,
    )


@router.post("/reconcile")
def reconcile(db: Session = Depends(get_db)):
    result = set_import_service.reconcile_unmatched(db)
    return result


@router.delete("/{set_id}", status_code=204)
def delete_set(set_id: int, db: Session = Depends(get_db)):
    s = db.query(SetChecklist).filter(SetChecklist.id == set_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Set not found")
    db.delete(s)
    db.commit()
