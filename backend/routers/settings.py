import csv
import io
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from backend.config import (
    EBAY_APP_ID, ANTHROPIC_API_KEY,
    GRADING_COSTS, GRADING_MULTIPLIERS, PRICE_SPIKE_THRESHOLD,
    GRADING_ROI_WORTH_IT, GRADING_ROI_BORDERLINE,
    EBAY_PLACEHOLDER_IMAGE_URL,
)
from backend.database import get_db
from backend.models import Card

router = APIRouter(prefix="/api", tags=["settings"])


@router.get("/settings")
def get_settings():
    return {
        "api_keys": {
            "ebay": bool(EBAY_APP_ID),
            "anthropic": bool(ANTHROPIC_API_KEY),
        },
        "thresholds": {
            "price_spike_pct": PRICE_SPIKE_THRESHOLD * 100,
            "grading_roi_worth_it": GRADING_ROI_WORTH_IT,
            "grading_roi_borderline": GRADING_ROI_BORDERLINE,
        },
        "grading_costs": GRADING_COSTS,
        "grading_multipliers": GRADING_MULTIPLIERS,
        "ebay_placeholder_image_url": EBAY_PLACEHOLDER_IMAGE_URL,
    }


@router.get("/export/csv")
def export_csv(db: Session = Depends(get_db)):
    cards = db.query(Card).order_by(Card.player_name).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "ID", "Player", "Brand", "Year", "Set", "Card #",
        "Type", "Parallel", "Print Run", "Condition",
        "Team", "Position", "Watchlist", "Matched", "Notes", "Date Added",
    ])
    for c in cards:
        writer.writerow([
            c.id, c.player_name, c.brand, c.year, c.set_name, c.card_number,
            c.card_type, c.parallel_color or "", c.print_run or "",
            c.condition, c.team or "", c.position or "",
            c.grading_watchlist, c.checklist_matched,
            c.notes or "", c.date_added.strftime("%Y-%m-%d"),
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=hockey_cards.csv"},
    )
