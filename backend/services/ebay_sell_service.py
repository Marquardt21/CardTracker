import base64
import logging
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from sqlalchemy.orm import Session

from backend.config import EBAY_APP_ID, EBAY_CERT_ID, EBAY_RU_NAME, EBAY_SHIP_PRICE, EBAY_ZIP
from backend.models import Card, DraftListingCard, EbayDraftListing, EbayToken

logger = logging.getLogger(__name__)

_AUTH_BASE       = "https://auth.ebay.com/oauth2/authorize"
_TOKEN_URL       = "https://api.ebay.com/identity/v1/oauth2/token"
_INVENTORY_BASE  = "https://api.ebay.com/sell/inventory/v1/inventory_item"
_OFFER_URL       = "https://api.ebay.com/sell/inventory/v1/offer"
_ACCOUNT_BASE    = "https://api.ebay.com/sell/account/v1"
_LOCATION_URL    = "https://api.ebay.com/sell/inventory/v1/location"

# Scopes must exactly match what is granted in the eBay developer dashboard
_SCOPES = " ".join([
    "https://api.ebay.com/oauth/api_scope",
    "https://api.ebay.com/oauth/api_scope/sell.inventory",
    "https://api.ebay.com/oauth/api_scope/sell.account",
])

_COND_RANK = {"mint": 0, "near_mint": 1, "excellent": 2, "very_good": 3, "good": 4, "poor": 5}
_EBAY_CONDITION = {
    "mint":       "LIKE_NEW",
    "near_mint":  "USED_EXCELLENT",
    "excellent":  "USED_EXCELLENT",
    "very_good":  "USED_VERY_GOOD",
    "good":       "USED_GOOD",
    "poor":       "USED_ACCEPTABLE",
}


def get_auth_url() -> str:
    params = {
        "client_id":     EBAY_APP_ID,
        "redirect_uri":  EBAY_RU_NAME,
        "response_type": "code",
        "scope":         _SCOPES,
    }
    return f"{_AUTH_BASE}?{urlencode(params)}"


def _credentials_header() -> str:
    return "Basic " + base64.b64encode(f"{EBAY_APP_ID}:{EBAY_CERT_ID}".encode()).decode()


def store_user_token(token_str: str, db: Session) -> EbayToken:
    """Store a User Token obtained from developer.ebay.com/my/auth."""
    now = datetime.utcnow()
    token = db.query(EbayToken).first() or EbayToken()
    token.access_token       = token_str
    token.refresh_token      = ""
    token.access_expires_at  = now + timedelta(hours=2)
    token.refresh_expires_at = now + timedelta(hours=2)
    token.created_at         = now
    db.add(token)
    db.commit()
    db.refresh(token)
    return token


def exchange_code(code: str, db: Session) -> EbayToken:
    with httpx.Client() as client:
        resp = client.post(
            _TOKEN_URL,
            headers={
                "Authorization":  _credentials_header(),
                "Content-Type":   "application/x-www-form-urlencoded",
            },
            data={
                "grant_type":   "authorization_code",
                "code":         code,
                "redirect_uri": EBAY_RU_NAME,
            },
        )
    resp.raise_for_status()
    data = resp.json()

    now = datetime.utcnow()
    token = db.query(EbayToken).first() or EbayToken()
    token.access_token       = data["access_token"]
    token.refresh_token      = data["refresh_token"]
    token.access_expires_at  = now + timedelta(seconds=data.get("expires_in", 7200) - 60)
    token.refresh_expires_at = now + timedelta(seconds=data.get("refresh_token_expires_in", 47304000) - 60)
    token.created_at         = now
    db.add(token)
    db.commit()
    db.refresh(token)
    return token


def get_user_token(db: Session) -> str | None:
    token = db.query(EbayToken).first()
    if not token:
        return None

    now = datetime.utcnow()
    if now < token.access_expires_at:
        return token.access_token

    if now >= token.refresh_expires_at or not token.refresh_token:
        db.delete(token)
        db.commit()
        return None

    with httpx.Client() as client:
        resp = client.post(
            _TOKEN_URL,
            headers={
                "Authorization": _credentials_header(),
                "Content-Type":  "application/x-www-form-urlencoded",
            },
            data={
                "grant_type":    "refresh_token",
                "refresh_token": token.refresh_token,
                "scope":         _SCOPES,
            },
        )

    if resp.status_code != 200:
        logger.warning("eBay token refresh failed: %s", resp.text[:200])
        return None

    data = resp.json()
    token.access_token      = data["access_token"]
    token.access_expires_at = datetime.utcnow() + timedelta(seconds=data.get("expires_in", 7200) - 60)
    db.commit()
    return token.access_token


def build_title(cards: list) -> str:
    if len(cards) == 1:
        c = cards[0]
        parts = [str(c.year), c.brand, f"#{c.card_number}", c.player_name]
        if c.parallel_color:
            parts.append(c.parallel_color)
        if c.card_type != "base":
            parts.append(c.card_type.replace("_", " ").title())
        return " ".join(parts)[:80]

    players = list(dict.fromkeys(c.player_name for c in cards))
    if len(players) == 1:
        return f"{len(cards)}x {players[0]} Hockey Cards Lot"[:80]
    return f"{len(cards)}x Hockey Cards Lot - Mixed Players"[:80]


def build_description(cards: list) -> str:
    if len(cards) == 1:
        c = cards[0]
        lines = [
            f"{c.year} {c.brand} {c.set_name}",
            f"Player: {c.player_name}",
            f"Card #: {c.card_number}",
            f"Condition: {c.condition.replace('_', ' ').title()}",
        ]
        if c.team:
            lines.append(f"Team: {c.team}")
        if c.parallel_color:
            lines.append(f"Parallel: {c.parallel_color}")
        if c.print_run:
            lines.append(f"Print Run: /{c.print_run}")
        if c.notes:
            lines.append(f"\nNotes: {c.notes}")
        lines.append("\nSee photos for condition details. Ships in a penny sleeve inside a top loader.")
        return "\n".join(lines)

    lines = [f"Lot of {len(cards)} hockey cards.\n"]
    for i, c in enumerate(cards, 1):
        cond = c.condition.replace("_", " ").title()
        entry = f"{i}. {c.year} {c.brand} #{c.card_number} {c.player_name} ({cond})"
        if c.parallel_color:
            entry += f" [{c.parallel_color}]"
        lines.append(entry)
    lines.append("\nSee photos for condition details. All cards ship in penny sleeves inside top loaders.")
    return "\n".join(lines)


def _api_headers(token: str) -> dict:
    return {
        "Authorization":           f"Bearer {token}",
        "Content-Type":            "application/json",
        "Content-Language":        "en-US",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    }


_DEFAULT_LOCATION_KEY = "CARDTRACKER_HOME"


def _ensure_merchant_location_key(token: str) -> str | None:
    """Return an existing merchant location key, creating one if the account has none."""
    headers = _api_headers(token)
    with httpx.Client(timeout=10) as client:
        r = client.get(f"{_LOCATION_URL}?limit=1", headers=headers)
    if r.status_code == 200 and r.json().get("locations"):
        return r.json()["locations"][0]["merchantLocationKey"]

    # No location — create a minimal US one
    if not EBAY_ZIP:
        logger.error(
            "No eBay merchant location and EBAY_ZIP not set in .env. "
            "Add your zip code as EBAY_ZIP=XXXXX and restart."
        )
        return None

    address = {"country": "US", "postalCode": EBAY_ZIP}
    body = {
        "location": {"address": address},
        "locationTypes": ["WAREHOUSE"],
        "merchantLocationStatus": "ENABLED",
        "name": "CardTracker",
    }
    with httpx.Client(timeout=10) as client:
        r = client.post(f"{_LOCATION_URL}/{_DEFAULT_LOCATION_KEY}", headers=headers, json=body)
    if r.status_code in (200, 201, 204):
        logger.info("Created eBay merchant location: %s", _DEFAULT_LOCATION_KEY)
        return _DEFAULT_LOCATION_KEY

    logger.error("Could not create merchant location: %s %s", r.status_code, r.text[:300])
    return None


def create_draft(
    db: Session,
    card_ids: list[int],
    price: float,
    title: str | None,
    description: str | None,
    image_urls: list[str] | None = None,
) -> dict:
    token = get_user_token(db)
    if not token:
        raise ValueError("eBay account not connected. Connect in Settings first.")

    cards = db.query(Card).filter(Card.id.in_(card_ids)).all()
    if not cards:
        raise ValueError("No cards found")

    final_title = (title or build_title(cards))[:80]
    final_desc  = description or build_description(cards)

    worst = max(cards, key=lambda c: _COND_RANK.get(c.condition, 5))
    ebay_condition = _EBAY_CONDITION.get(worst.condition, "USED_VERY_GOOD")

    sku = f"CT-{'-'.join(str(c.id) for c in cards)}-{uuid.uuid4().hex[:6]}"
    headers = _api_headers(token)

    clean_image_urls = [u.strip() for u in (image_urls or []) if u.strip()]

    # Step 1: create/update inventory item
    product: dict = {"title": final_title}
    if clean_image_urls:
        product["imageUrls"] = clean_image_urls

    with httpx.Client(timeout=20) as client:
        resp = client.put(
            f"{_INVENTORY_BASE}/{sku}",
            headers=headers,
            json={
                "product": product,
                "condition": ebay_condition,
                "conditionDescription": worst.condition.replace("_", " ").title(),
                "availability": {
                    "shipToLocationAvailability": {"quantity": 1}
                },
            },
        )
    if resp.status_code not in (200, 204):
        logger.error("eBay inventory item %s: %s", resp.status_code, resp.text)
        raise ValueError(f"eBay inventory item error {resp.status_code}: {resp.text[:400]}")

    # Step 2: schedule 2 hours from now so seller can review before it goes live
    go_live = datetime.now(timezone.utc) + timedelta(hours=2)
    listing_start_date = go_live.strftime("%Y-%m-%dT%H:%M:%S.000Z")

    location_key = _ensure_merchant_location_key(token)

    offer_payload: dict = {
        "sku":            sku,
        "marketplaceId":  "EBAY_US",
        "format":         "FIXED_PRICE",
        "categoryId":     "2536",  # Hockey Trading Cards
        "listingDescription": final_desc.replace("\n", "<br>"),
        "listingStartDate":   listing_start_date,
        "pricingSummary": {
            "price": {"currency": "USD", "value": f"{price:.2f}"}
        },
        "quantityLimitPerBuyer": 1,
        # Inline fulfillment — USPS First Class flat rate (set EBAY_SHIP_PRICE in .env to override)
        "shippingOptions": [{
            "optionType": "DOMESTIC",
            "costType":   "FLAT_RATE",
            "shippingServices": [{
                "shippingServiceCode":    "USPSFirstClass",
                "shippingCost":           {"currency": "USD", "value": f"{EBAY_SHIP_PRICE:.2f}"},
                "shippingAdditionalCost": {"currency": "USD", "value": "0.00"},
            }],
        }],
        # No returns accepted — simplest for a personal seller
        "returnTerms": {"returnsAccepted": False},
    }
    if location_key:
        offer_payload["merchantLocationKey"] = location_key

    # Step 3: create offer
    with httpx.Client(timeout=20) as client:
        resp = client.post(_OFFER_URL, headers=headers, json=offer_payload)
    if resp.status_code not in (200, 201):
        logger.error("eBay offer %s: %s", resp.status_code, resp.text)
        raise ValueError(f"eBay offer error {resp.status_code}: {resp.text[:400]}")

    offer_id = resp.json().get("offerId", "")

    # Step 4: publish — eBay schedules it for listingStartDate (2 h from now)
    with httpx.Client(timeout=20) as client:
        pub = client.post(f"{_OFFER_URL}/{offer_id}/publish", headers=headers)
    if pub.status_code not in (200, 201):
        logger.error("eBay publish %s: %s", pub.status_code, pub.text)
        raise ValueError(f"eBay publish error {pub.status_code}: {pub.text[:400]}")

    listing_id  = pub.json().get("listingId", "")
    listing_url = (
        f"https://www.ebay.com/itm/{listing_id}"
        if listing_id else
        "https://www.ebay.com/sh/lst/scheduled"
    )

    draft = EbayDraftListing(
        ebay_draft_id  = listing_id or offer_id,
        ebay_draft_url = listing_url,
        title          = final_title,
        description    = final_desc,
        price          = price,
        status         = "scheduled",
    )
    db.add(draft)
    db.flush()

    for card in cards:
        db.add(DraftListingCard(draft_id=draft.id, card_id=card.id))
        card.is_selling   = True
        card.listed_price = price if len(cards) == 1 else None
        card.listing_url  = listing_url if len(cards) == 1 else None

    db.commit()
    db.refresh(draft)

    return {
        "draft_id":        draft.id,
        "ebay_listing_id": listing_id,
        "ebay_listing_url": listing_url,
        "scheduled_for":   listing_start_date,
        "title":           final_title,
        "card_count":      len(cards),
    }
