from datetime import datetime
from sqlalchemy.orm import Session

from backend.config import GRADING_COSTS, GRADING_MULTIPLIERS, GRADING_ROI_BORDERLINE, GRADING_ROI_WORTH_IT
from backend.models import Card, CardValue, GradingRecommendation


def compute_grading_roi(card_type: str, raw_value: float, grading_service: str) -> dict:
    """ROI math for a single card. Pure — no DB writes, no watchlist requirement,
    so it can also be run over a whole cohort (see strategy_service)."""
    multiplier = GRADING_MULTIPLIERS.get(card_type, 1.3)
    grading_cost = GRADING_COSTS.get(grading_service, 25)

    estimated_graded = round(raw_value * multiplier, 2)
    roi = round(estimated_graded - raw_value - grading_cost, 2)

    if roi > GRADING_ROI_WORTH_IT:
        verdict = "Worth It"
    elif roi >= GRADING_ROI_BORDERLINE:
        verdict = "Borderline"
    else:
        verdict = "Not Worth It"

    return {
        "multiplier": multiplier,
        "grading_cost": grading_cost,
        "estimated_graded": estimated_graded,
        "roi": roi,
        "verdict": verdict,
    }


def generate_grading_recommendation(
    card: Card, grading_service: str, db: Session
) -> GradingRecommendation | None:
    latest = (
        db.query(CardValue)
        .filter(CardValue.card_id == card.id)
        .order_by(CardValue.fetched_at.desc())
        .first()
    )
    if not latest:
        return None

    raw_value = latest.price
    roi_data = compute_grading_roi(card.card_type, raw_value, grading_service)
    multiplier = roi_data["multiplier"]
    grading_cost = roi_data["grading_cost"]
    estimated_graded = roi_data["estimated_graded"]
    roi = roi_data["roi"]
    verdict = roi_data["verdict"]

    recommendation = (
        f"Raw value: ${raw_value:.2f}. "
        f"Estimated graded ({grading_service}): ${estimated_graded:.2f} "
        f"(×{multiplier} for {card.card_type}). "
        f"Grading cost: ${grading_cost}. "
        f"Net ROI: ${roi:.2f}. Verdict: {verdict}."
    )

    # Replace previous recommendation for this card
    db.query(GradingRecommendation).filter(GradingRecommendation.card_id == card.id).delete()

    rec = GradingRecommendation(
        card_id=card.id,
        estimated_graded_value=estimated_graded,
        grading_cost_estimate=float(grading_cost),
        roi_estimate=roi,
        verdict=verdict,
        recommendation=recommendation,
        generated_at=datetime.utcnow(),
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec
