from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import SetChecklist, SetChecklistCard
from backend.schemas import AutocompleteSuggestion

router = APIRouter(prefix="/api/autocomplete", tags=["autocomplete"])


@router.get("", response_model=list[AutocompleteSuggestion])
def autocomplete(
    q: str = Query(..., min_length=1),
    field: str = Query("player_name"),
    set_name: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    limit: int = Query(10),
    db: Session = Depends(get_db),
):
    """
    Query imported set checklists for autocomplete suggestions.
    field: 'player_name' | 'card_number' | 'set_name'
    card_number uses prefix match and supports optional set_name / year filters.
    """
    base = db.query(SetChecklistCard, SetChecklist).join(
        SetChecklist, SetChecklistCard.set_id == SetChecklist.id
    )

    if field == "player_name":
        rows = base.filter(SetChecklistCard.player_name.ilike(f"%{q}%")).limit(limit).all()

    elif field == "card_number":
        # Prefix match: "5" → #5, #50, #51… but NOT #15 or #105
        query = base.filter(SetChecklistCard.card_number.ilike(f"{q}%"))
        if set_name:
            query = query.filter(SetChecklist.set_name == set_name)
        if year:
            query = query.filter(SetChecklist.year == year)
        rows = query.limit(limit).all()

    elif field == "set_name":
        rows = base.filter(SetChecklist.set_name.ilike(f"%{q}%")).limit(limit).all()

    else:
        rows = base.filter(SetChecklistCard.player_name.ilike(f"%{q}%")).limit(limit).all()

    return [
        AutocompleteSuggestion(
            set_checklist_card_id=sc.id,
            card_number=sc.card_number,
            player_name=sc.player_name,
            set_name=cl.set_name,
            brand=cl.brand,
            year=cl.year,
            card_type=sc.card_type,
            parallel_color=sc.parallel_color,
            print_run=sc.print_run,
            team=sc.team,
        )
        for sc, cl in rows
    ]
