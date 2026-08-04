"""Storage and retention for card photos.

Every card can carry a front and a back photo. Front is the primary image
everywhere — the collection thumbnail, the card detail hero, and the first
picture on the eBay listing.

Two rules shape this module:

**Filenames, not paths.** A row stores a bare filename relative to `PHOTOS_DIR`.
The same `cards.db` gets opened on the Ubuntu box and on the Windows desktop, and
an absolute path written on one machine is nonsense on the other. `resolve()` is
the only place a filename becomes a real path.

**Photos don't outlive the sale.** They exist to make a listing; once the card
has been sold for `CARD_PHOTO_RETENTION_DAYS` the files and rows are deleted.
eBay keeps its own copy of anything that reached a listing, so purging a sold
card never blanks a live listing.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy.orm import Session

from backend.config import (
    CARD_PHOTO_MAX_BYTES,
    CARD_PHOTO_RETENTION_DAYS,
    CARD_PHOTO_SIDES,
    CARD_PHOTO_SUFFIXES,
    PHOTOS_DIR,
)
from backend.models import Card, CardPhoto

logger = logging.getLogger(__name__)


class PhotoError(Exception):
    """A photo could not be stored — message is shown to the operator."""


def resolve(photo: CardPhoto | str) -> Path:
    """Absolute path of a stored photo. The only filename → path conversion."""
    name = photo if isinstance(photo, str) else photo.filename
    return PHOTOS_DIR / Path(name).name


def public_url(photo: CardPhoto | str) -> str:
    """URL the frontend uses. Served by the /photos static mount."""
    name = photo if isinstance(photo, str) else photo.filename
    return f"/photos/{Path(name).name}"


def normalise_side(side: str) -> str:
    side = (side or "").strip().lower()
    if side not in CARD_PHOTO_SIDES:
        raise PhotoError(f"Side must be one of {', '.join(CARD_PHOTO_SIDES)} — got {side!r}.")
    return side


def _suffix_for(filename: str | None, content_type: str | None) -> str:
    """Pick the stored extension. iPad Safari sometimes posts a blob with no
    filename, in which case the content type is all we have to go on."""
    suffix = Path(filename or "").suffix.lower()
    if suffix in CARD_PHOTO_SUFFIXES:
        return ".jpg" if suffix == ".jpeg" else suffix
    from_type = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/heic": ".heic",
        "image/heif": ".heif",
    }.get((content_type or "").split(";")[0].strip().lower())
    if from_type:
        return from_type
    raise PhotoError(
        f"Unsupported image format {suffix or content_type or 'unknown'!r}. "
        f"Accepted: {', '.join(sorted(CARD_PHOTO_SUFFIXES))}."
    )


def get_photos(db: Session, card_id: int) -> list[CardPhoto]:
    """A card's photos, front first — the order eBay receives them in."""
    rows = db.query(CardPhoto).filter(CardPhoto.card_id == card_id).all()
    order = {side: i for i, side in enumerate(CARD_PHOTO_SIDES)}
    return sorted(rows, key=lambda p: order.get(p.side, 99))


def save_photo(
    db: Session,
    card: Card,
    side: str,
    data: bytes,
    *,
    filename: str | None = None,
    content_type: str | None = None,
) -> CardPhoto:
    """Store (or replace) one side's photo. Retaking a side deletes the old file
    and drops any cached eBay URL, since that URL points at the old picture."""
    side = normalise_side(side)
    if not data:
        raise PhotoError("The uploaded photo was empty.")
    if len(data) > CARD_PHOTO_MAX_BYTES:
        raise PhotoError(
            f"Photo is {len(data) / 1_048_576:.1f} MB — eBay's limit is "
            f"{CARD_PHOTO_MAX_BYTES // 1_048_576} MB per image."
        )

    suffix = _suffix_for(filename, content_type)
    dest = PHOTOS_DIR / f"card_{card.id}_{side}_{uuid.uuid4().hex[:8]}{suffix}"
    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)

    existing = (
        db.query(CardPhoto)
        .filter(CardPhoto.card_id == card.id, CardPhoto.side == side)
        .first()
    )
    if existing:
        _unlink(resolve(existing))
        existing.filename = dest.name
        existing.captured_at = datetime.utcnow()
        # The old EPS upload is a picture of nothing now.
        existing.ebay_image_url = None
        existing.ebay_image_expires_at = None
        photo = existing
    else:
        photo = CardPhoto(card_id=card.id, side=side, filename=dest.name)
        db.add(photo)

    if side == "front":
        # Keeps the pre-existing single-photo UI (collection thumbnail, card
        # detail hero) pointing at the front without it having to know about
        # card_photos at all.
        card.photo_path = dest.name

    db.commit()
    db.refresh(photo)
    return photo


def delete_photo(db: Session, card: Card, side: str) -> bool:
    """Remove one side. Returns False if there was nothing to remove."""
    side = normalise_side(side)
    photo = (
        db.query(CardPhoto)
        .filter(CardPhoto.card_id == card.id, CardPhoto.side == side)
        .first()
    )
    if not photo:
        return False
    _unlink(resolve(photo))
    db.delete(photo)
    if side == "front":
        card.photo_path = None
    db.commit()
    return True


def delete_all_for_card(db: Session, card: Card) -> int:
    """Drop every photo for a card. Used when the card itself is deleted."""
    removed = 0
    for photo in db.query(CardPhoto).filter(CardPhoto.card_id == card.id).all():
        _unlink(resolve(photo))
        db.delete(photo)
        removed += 1
    if card.photo_path:
        _unlink(resolve(card.photo_path))
        card.photo_path = None
    return removed


def _unlink(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError as exc:  # a locked file on Windows, a permissions problem
        logger.warning("Could not delete photo %s: %s", path, exc)


# ── Retention ────────────────────────────────────────────────────────────────

def purge_cutoff(now: datetime | None = None) -> datetime | None:
    """Sold-on date at or before which a card's photos are due for deletion.
    None when retention is disabled."""
    if CARD_PHOTO_RETENTION_DAYS <= 0:
        return None
    return (now or datetime.utcnow()) - timedelta(days=CARD_PHOTO_RETENTION_DAYS)


def _expired_cards(db: Session, now: datetime | None = None) -> list[Card]:
    """Sold cards whose retention window has closed and that still have photos.

    A card with no `sold_date` is never purged even if flagged sold — without a
    date there is no way to know the window has passed, and keeping a photo too
    long is the recoverable mistake."""
    cutoff = purge_cutoff(now)
    if cutoff is None:
        return []
    return (
        db.query(Card)
        .join(CardPhoto, CardPhoto.card_id == Card.id)
        .filter(
            Card.is_sold == True,  # noqa: E712
            Card.sold_date.isnot(None),
            Card.sold_date <= cutoff,
        )
        .distinct()
        .all()
    )


def pending_purge_count(db: Session, now: datetime | None = None) -> int:
    """How many cards are currently due for purge. Surfaced in Settings."""
    return len(_expired_cards(db, now))


def purge_expired(db: Session, now: datetime | None = None, dry_run: bool = False) -> dict:
    """Delete photos for cards sold more than the retention window ago.

    Returns a summary rather than staying quiet, so the caller (startup, the
    scheduler, or the Settings button) can log or display what happened."""
    cards = _expired_cards(db, now)
    files = 0
    for card in cards:
        for photo in db.query(CardPhoto).filter(CardPhoto.card_id == card.id).all():
            if not dry_run:
                _unlink(resolve(photo))
                db.delete(photo)
            files += 1
        if not dry_run:
            card.photo_path = None
    if not dry_run and cards:
        db.commit()
        logger.info(
            "Purged %d photo(s) from %d card(s) sold more than %d days ago.",
            files, len(cards), CARD_PHOTO_RETENTION_DAYS,
        )
    return {
        "cards": len(cards),
        "photos": files,
        "retention_days": CARD_PHOTO_RETENTION_DAYS,
        "dry_run": dry_run,
    }
