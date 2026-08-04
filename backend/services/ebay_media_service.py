"""Getting a local photo onto an eBay listing.

The Sell Inventory API this app lists through only accepts `imageUrls` — public
HTTPS links. A photo sitting in `photos/` on a machine behind home WiFi has no
such URL, and exposing the backend to the internet to give it one would publish
an app with no authentication.

The Media API is the way out: POST the file bytes, get back an eBay-hosted URL.
It is the same thing the eBay mobile app does when you upload from your phone.

    photo file ──▶ POST /image/create_image_from_file ──▶ image_id
                                                          │
                              GET /image/{image_id} ──────┴──▶ https://i.ebayimg.com/…

`upload_photo` caches the resulting URL on the `CardPhoto` row so listing the
same card twice doesn't re-upload, and re-uploads once the EPS copy has expired.

This replaces the Trading API's `UploadSiteHostedPictures`, which eBay
decommissions on 2026-09-30.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from pathlib import Path

import httpx
from sqlalchemy.orm import Session

from backend.config import (
    EBAY_IMAGE_ASSUMED_TTL_DAYS,
    EBAY_MAX_IMAGES,
    EBAY_MEDIA_BASE,
)
from backend.models import Card, CardPhoto
from backend.services import photo_service

logger = logging.getLogger(__name__)

_CREATE_URL = f"{EBAY_MEDIA_BASE}/image/create_image_from_file"

# Media API POSTs are rate limited to 50 requests per 5 seconds per user. A
# listing is at most EBAY_MAX_IMAGES uploads, so we stay well inside that and
# don't need throttling — but the timeout has to allow for a phone-sized photo
# on a home upstream link.
_TIMEOUT = httpx.Timeout(60.0, connect=10.0)

_MIME_BY_SUFFIX = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif",
}


class MediaUploadError(Exception):
    """An image could not be handed to eBay."""


def _mime_for(filename: str) -> str:
    return _MIME_BY_SUFFIX.get(Path(filename).suffix.lower(), "image/jpeg")


def _is_fresh(photo: CardPhoto) -> bool:
    """True when the cached EPS URL can still be reused."""
    if not photo.ebay_image_url:
        return False
    if photo.ebay_image_expires_at is None:
        return False
    # Re-upload a day early rather than publish a listing against an image that
    # expires mid-flight.
    return photo.ebay_image_expires_at > datetime.utcnow() + timedelta(days=1)


def _image_url_from_id(image_id: str, token: str) -> str | None:
    """Ask getImage for the public URL behind an image id."""
    try:
        with httpx.Client(timeout=_TIMEOUT) as client:
            resp = client.get(
                f"{EBAY_MEDIA_BASE}/image/{image_id}",
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            )
    except httpx.HTTPError as exc:
        logger.warning("getImage failed for %s: %s", image_id, exc)
        return None
    if resp.status_code != 200:
        logger.warning("getImage %s returned %s: %s", image_id, resp.status_code, resp.text[:200])
        return None
    return (resp.json() or {}).get("imageUrl")


def _expiry_from(payload: dict) -> datetime:
    """eBay reports an expirationDate; fall back to a conservative window."""
    raw = (payload or {}).get("expirationDate")
    if raw:
        try:
            return datetime.fromisoformat(str(raw).replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            logger.debug("Unparseable EPS expirationDate %r", raw)
    return datetime.utcnow() + timedelta(days=EBAY_IMAGE_ASSUMED_TTL_DAYS)


def upload_photo(db: Session, photo: CardPhoto, token: str, *, force: bool = False) -> str:
    """Upload one stored photo to eBay and return its EPS URL.

    Reuses the cached URL when it's still good. Raises MediaUploadError with a
    message meant for the operator — a listing that silently loses its pictures
    is worse than one that refuses to publish."""
    if not force and _is_fresh(photo):
        return photo.ebay_image_url

    path = photo_service.resolve(photo)
    if not path.exists():
        raise MediaUploadError(
            f"The {photo.side} photo file is missing ({path.name}). "
            "Re-take it on the card's page and try listing again."
        )

    files = {"image": (path.name, path.read_bytes(), _mime_for(path.name))}
    try:
        with httpx.Client(timeout=_TIMEOUT) as client:
            resp = client.post(
                _CREATE_URL,
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                files=files,
            )
    except httpx.HTTPError as exc:
        raise MediaUploadError(f"Could not reach eBay to upload the {photo.side} photo: {exc}") from exc

    if resp.status_code not in (200, 201):
        raise MediaUploadError(
            f"eBay rejected the {photo.side} photo (HTTP {resp.status_code}): {resp.text[:300]}"
        )

    payload: dict = {}
    try:
        payload = resp.json() or {}
    except ValueError:
        pass  # 201 with an empty body is normal — the id is in the Location header

    image_url = payload.get("imageUrl")
    if not image_url:
        # createImageFromFile returns the image id URI in Location:
        #   https://apim.ebay.com/commerce/media/v1_beta/image/{image_id}
        location = resp.headers.get("Location") or payload.get("imageId") or ""
        image_id = location.rstrip("/").split("/")[-1]
        if not image_id:
            raise MediaUploadError(
                f"eBay accepted the {photo.side} photo but returned no image reference."
            )
        image_url = _image_url_from_id(image_id, token)
        if not image_url:
            raise MediaUploadError(
                f"eBay accepted the {photo.side} photo but its URL could not be read back."
            )

    photo.ebay_image_url = image_url
    photo.ebay_image_expires_at = _expiry_from(payload)
    db.commit()
    logger.info("Uploaded %s photo for card %s to EPS.", photo.side, photo.card_id)
    return image_url


def image_urls_for_cards(db: Session, cards: list[Card], token: str) -> list[str]:
    """EPS URLs for a listing's photos, front-first, card order preserved.

    A lot listing contributes each card's front before any of the backs, so the
    listing leads with a row of card fronts rather than burying them behind the
    first card's back."""
    ordered: list[CardPhoto] = []
    by_card = {c.id: photo_service.get_photos(db, c.id) for c in cards}
    for side in ("front", "back"):
        for card in cards:
            ordered += [p for p in by_card[card.id] if p.side == side]

    urls: list[str] = []
    for photo in ordered[:EBAY_MAX_IMAGES]:
        urls.append(upload_photo(db, photo, token))
    return urls
