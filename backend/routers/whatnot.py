from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.services import whatnot_service

router = APIRouter(prefix="/api/whatnot", tags=["whatnot"])


class ExportRequest(BaseModel):
    card_ids:    list[int]
    start_price: float | None = None  # opening bid; defaults to WHATNOT_START_PRICE ($1)


@router.post("/export")
def export_listings(req: ExportRequest, db: Session = Depends(get_db)):
    """Build a Whatnot bulk-upload CSV for the selected cards and mark them selling.

    Returns the CSV as a file download. Summary counts (cards exported, cards
    missing a public image) are returned in response headers so the UI can warn
    without a second request.
    """
    if not req.card_ids:
        raise HTTPException(status_code=400, detail="No cards selected")
    try:
        result = whatnot_service.export_csv(db, req.card_ids, req.start_price)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    filename = f"whatnot-export-{datetime.utcnow():%Y%m%d-%H%M%S}.csv"
    return Response(
        content=result["csv"],
        media_type="text/csv",
        headers={
            "Content-Disposition":     f'attachment; filename="{filename}"',
            "X-Whatnot-Exported":       str(result["exported"]),
            "X-Whatnot-Missing-Images": str(result["missing_images"]),
            "Access-Control-Expose-Headers": "X-Whatnot-Exported, X-Whatnot-Missing-Images",
        },
    )
