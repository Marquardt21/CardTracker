"""Whatnot bulk-upload CSV export.

Whatnot's Seller API is limited-release and unavailable to this account, so we
generate the CSV that Whatnot's Seller Hub → Bulk Upload accepts. Each selected
card becomes one Auction row with a configurable opening bid (default $1) for a
"$1 start" singles show. All Whatnot-specific column/value details live in
``backend/config.py`` (the WHATNOT_* block) so they can be corrected against a
freshly downloaded template without touching this code.

Exporting a card marks it ``is_selling`` (channel tagged via ``listing_url``),
which reuses the same guard the eBay flow uses — so a card can't be live on both
eBay and Whatnot at once.
"""
import csv
import io
import logging
from datetime import datetime

from sqlalchemy.orm import Session

from backend import config
from backend.models import Card

logger = logging.getLogger(__name__)


def _title(c: Card) -> str:
    parts = [str(c.year), c.brand, f"#{c.card_number}", c.player_name]
    if c.parallel_color:
        parts.append(c.parallel_color)
    if c.card_type and c.card_type != "base":
        parts.append(c.card_type.replace("_", " ").title())
    return " ".join(p for p in parts if p).strip()


def _description(c: Card) -> str:
    lines = [f"{c.year} {c.brand} {c.set_name}",
             f"Player: {c.player_name}",
             f"Card #: {c.card_number}",
             f"Condition: {c.condition.replace('_', ' ').title()}"]
    if c.team:
        lines.append(f"Team: {c.team}")
    if c.parallel_color:
        lines.append(f"Parallel: {c.parallel_color}")
    if c.print_run:
        lines.append(f"Print Run: /{c.print_run}")
    if c.notes:
        lines.append(f"Notes: {c.notes}")
    return " · ".join(lines)


def _image_url(c: Card) -> str | None:
    """Return the card photo only if it's a public HTTPS URL.

    Whatnot requires publicly accessible image URLs; local uploads (a bare
    filename in ``photo_path``) can't be reached by Whatnot, so we leave the
    image blank and let the user add photos in the Whatnot app after import.
    """
    p = (c.photo_path or "").strip()
    return p if p.lower().startswith("https://") else None


def _row(c: Card, start_price: float) -> tuple[dict, bool]:
    """Build one CSV row (keyed by header name). Returns (row, has_image)."""
    condition = config.WHATNOT_CONDITION_MAP.get(c.condition, config.WHATNOT_CONDITION_DEFAULT)
    sub_category = config.WHATNOT_SUB_CATEGORY_BY_SPORT.get(
        c.sport or config.DEFAULT_SPORT, config.WHATNOT_SUB_CATEGORY_DEFAULT
    )
    row = {
        "Category":         config.WHATNOT_CATEGORY,
        "Sub Category":     sub_category,
        "Title":            _title(c)[:80],
        "Description":      _description(c),
        "Quantity":         config.WHATNOT_QUANTITY,
        "Type":             config.WHATNOT_LISTING_TYPE,
        "Price":            f"{start_price:.2f}",
        "Shipping Profile": config.WHATNOT_SHIPPING_PROFILE,
        "Condition":        condition,
        "SKU":              f"CT-{c.id}",
    }
    img = _image_url(c)
    if img:
        row["Image URL 1"] = img
    return row, bool(img)


def export_csv(db: Session, card_ids: list[int], start_price: float | None = None) -> dict:
    """Build a Whatnot bulk-upload CSV for the given cards and mark them selling.

    Returns {"csv": str, "exported": int, "missing_images": int}.
    Raises ValueError if any card is already sold or listed (on either channel).
    """
    if not card_ids:
        raise ValueError("No cards selected")

    price = config.WHATNOT_START_PRICE if start_price is None else start_price
    if price <= 0:
        raise ValueError("Start price must be greater than 0")

    cards = db.query(Card).filter(Card.id.in_(card_ids)).all()
    if not cards:
        raise ValueError("No cards found")

    blocked = [c for c in cards if c.is_sold or c.is_selling]
    if blocked:
        names = ", ".join(f"{c.player_name} #{c.card_number}" for c in blocked)
        state = "sold" if all(c.is_sold for c in blocked) else "already listed/sold"
        raise ValueError(f"These cards are {state} and can't be listed again: {names}")

    rows: list[dict] = []
    missing_images = 0
    for c in cards:
        row, has_image = _row(c, price)
        if not has_image:
            missing_images += 1
        rows.append(row)

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=config.WHATNOT_CSV_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)

    now = datetime.utcnow()
    for c in cards:
        c.is_selling   = True
        c.listing_date = now
        c.listing_url  = config.WHATNOT_MARKER
        c.listed_price = price
    db.commit()

    logger.info("Whatnot CSV export: %d cards, %d missing public image", len(cards), missing_images)
    return {"csv": buf.getvalue(), "exported": len(cards), "missing_images": missing_images}
