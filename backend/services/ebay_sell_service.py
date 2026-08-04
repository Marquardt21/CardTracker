import base64
import logging
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from sqlalchemy.orm import Session

from backend.config import (
    DEFAULT_SPORT,
    EBAY_APP_ID,
    EBAY_CERT_ID,
    EBAY_LEAGUE_BY_SPORT,
    EBAY_PLACEHOLDER_IMAGE_URL,
    EBAY_RU_NAME,
    EBAY_SHIP_PRICE,
    EBAY_ZIP,
)
from backend.models import Card, DraftListingCard, EbayDraftListing, EbayToken
from backend.services import ebay_media_service, photo_service

logger = logging.getLogger(__name__)

_AUTH_BASE       = "https://auth.ebay.com/oauth2/authorize"
_TOKEN_URL       = "https://api.ebay.com/identity/v1/oauth2/token"
_INVENTORY_BASE  = "https://api.ebay.com/sell/inventory/v1/inventory_item"
_OFFER_URL       = "https://api.ebay.com/sell/inventory/v1/offer"
_ACCOUNT_BASE    = "https://api.ebay.com/sell/account/v1"
_LOCATION_URL    = "https://api.ebay.com/sell/inventory/v1/location"
_TAXONOMY_BASE   = "https://api.ebay.com/commerce/taxonomy/v1"
_METADATA_BASE   = "https://api.ebay.com/sell/metadata/v1"

_category_id_cache:  dict[str, str] = {}   # sport -> singles category id
_pwe_policy_id:      str | None = None
_ground_policy_id:   str | None = None
_return_policy_id:   str | None = None

_PWE_POLICY_NAME    = "CardTracker Standard Envelope"
_GROUND_POLICY_NAME = "CardTracker Ground Shipping"
_RETURN_POLICY_NAME = "CardTracker No Returns"

# Scopes must exactly match what is granted in the eBay developer dashboard
# sell.inventory also covers the Media API's createImageFromFile, so uploading
# card photos needs no extra consent from an already-connected account.
_SCOPES = " ".join([
    "https://api.ebay.com/oauth/api_scope",
    "https://api.ebay.com/oauth/api_scope/sell.inventory",
    "https://api.ebay.com/oauth/api_scope/sell.account",
])

_COND_RANK = {"mint": 0, "near_mint": 1, "excellent": 2, "very_good": 3, "good": 4, "poor": 5}
_EBAY_CONDITION = {
    "mint":       "LIKE_NEW",
    "near_mint":  "LIKE_NEW",
    "excellent":  "USED_VERY_GOOD",
    "very_good":  "USED_VERY_GOOD",
    "good":       "USED_GOOD",
    "poor":       "USED_ACCEPTABLE",
}

# eBay condition descriptor for ungraded trading cards: descriptor 40001 ("Card
# Condition"). Publishing a raw card in the Trading Card Singles category requires
# this descriptor. IDs below are the documented US values, used as a fallback when
# the live Metadata API lookup is unavailable.
_CARD_CONDITION_DESCRIPTOR_ID = "40001"
_CARD_CONDITION_VALUE_IDS = {
    "Near Mint or Better": "400010",
    "Excellent":           "400011",
    "Very Good":           "400012",
    "Poor":                "400013",
}
_OUR_COND_TO_CARD_CONDITION = {
    "mint":       "Near Mint or Better",
    "near_mint":  "Near Mint or Better",
    "excellent":  "Excellent",
    "very_good":  "Very Good",
    "good":       "Very Good",
    "poor":       "Poor",
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
    """Store a short-lived User Token pasted from developer.ebay.com/my/auth.

    This token lasts only ~2 hours and has no refresh token. Refuse to overwrite a
    durable OAuth connection (one with a still-valid refresh token), so pasting a
    manual token can't silently downgrade an account that's already connected.
    """
    now = datetime.utcnow()
    token = db.query(EbayToken).first()
    if token and token.refresh_token and now < token.refresh_expires_at:
        raise ValueError(
            "This eBay account is already connected via OAuth (durable). "
            "Disconnect first if you really want to use a manual 2-hour token."
        )
    token = token or EbayToken()
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


def _sport_of(cards: list) -> str:
    """The sport shared by every card in a listing (mixed lots are blocked upstream)."""
    return cards[0].sport or DEFAULT_SPORT


def build_title(cards: list) -> str:
    if len(cards) == 1:
        c = cards[0]
        parts = [str(c.year), c.brand, f"#{c.card_number}", c.player_name]
        if c.parallel_color:
            parts.append(c.parallel_color)
        if c.card_type != "base":
            parts.append(c.card_type.replace("_", " ").title())
        return " ".join(parts)[:80]

    sport = _sport_of(cards)
    players = list(dict.fromkeys(c.player_name for c in cards))
    if len(players) == 1:
        return f"{len(cards)}x {players[0]} {sport} Cards Lot"[:80]
    return f"{len(cards)}x {sport} Cards Lot - Mixed Players"[:80]


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

    lines = [f"Lot of {len(cards)} {_sport_of(cards).lower()} cards.\n"]
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


_DEFAULT_LOCATION_KEY  = "CARDTRACKER_HOME"
_FALLBACK_CATEGORY_ID  = "261328"  # Sports Trading Cards > Trading Card Singles (known leaf)
_LOT_CATEGORY_ID       = "261329"  # Sports Trading Cards > Trading Card Lots (multi-card listings)


def _get_singles_category_id(token: str, sport: str) -> str:
    if sport in _category_id_cache:
        return _category_id_cache[sport]

    with httpx.Client(timeout=10) as client:
        r = client.get(
            f"{_TAXONOMY_BASE}/category_tree/0/get_category_suggestions",
            headers={"Authorization": f"Bearer {token}"},
            params={"q": f"{sport.lower()} trading card"},
        )

    if r.status_code == 200:
        suggestions = r.json().get("categorySuggestions", [])
        if suggestions:
            cat_id = suggestions[0]["category"]["categoryId"]
            logger.info("eBay category resolved for %s: %s (%s)", sport,
                        suggestions[0]["category"]["categoryName"], cat_id)
            _category_id_cache[sport] = cat_id
            return cat_id

    logger.warning("Category lookup failed (%s) — using fallback %s", r.status_code, _FALLBACK_CATEGORY_ID)
    return _FALLBACK_CATEGORY_ID


_aspect_meta_cache: dict[str, dict] = {}  # category_id -> aspect metadata


def _get_category_aspects(token: str, category_id: str) -> dict:
    """Fetch and cache (per category) aspect metadata for a category.

    Returns {aspect_name: {"required": bool, "mode": str, "values": set[str]}}.
    """
    if category_id in _aspect_meta_cache:
        return _aspect_meta_cache[category_id]

    with httpx.Client(timeout=15) as client:
        r = client.get(
            f"{_TAXONOMY_BASE}/category_tree/0/get_item_aspects_for_category",
            headers={"Authorization": f"Bearer {token}"},
            params={"category_id": category_id},
        )
    meta: dict = {}
    if r.status_code == 200:
        for a in r.json().get("aspects", []):
            con = a.get("aspectConstraint", {})
            meta[a["localizedAspectName"]] = {
                "required": con.get("aspectRequired", False),
                "mode":     con.get("aspectMode", "FREE_TEXT"),
                "values":   {v["localizedValue"] for v in a.get("aspectValues", [])},
            }
    else:
        logger.warning("Could not fetch category aspects: %s %s", r.status_code, r.text[:200])
    _aspect_meta_cache[category_id] = meta
    return meta


def _build_aspects(cards: list, token: str, category_id: str) -> dict:
    """Build eBay item aspects, validating against the category's allowed values
    and auto-filling any required aspect we haven't set."""
    sport = _sport_of(cards)
    aspects: dict[str, list[str]] = {
        "Sport":  [sport],
        "League": [EBAY_LEAGUE_BY_SPORT.get(sport, EBAY_LEAGUE_BY_SPORT[DEFAULT_SPORT])],
        "Type":   ["Sports Trading Card"],
        "Graded": ["No"],
    }
    if len(cards) == 1:
        c = cards[0]
        aspects["Autographed"]    = ["Yes"] if c.card_type == "autograph" else ["No"]
        aspects["Player/Athlete"] = [c.player_name]
        aspects["Season"]         = [str(c.year)]
        if c.brand:
            aspects["Manufacturer"]     = [c.brand]
        if c.set_name:
            aspects["Set"]              = [c.set_name]
        if c.card_number:
            aspects["Card Number"]      = [str(c.card_number)]
        if c.team:
            aspects["Team"]             = [c.team]
        if c.parallel_color:
            aspects["Parallel/Variety"] = [c.parallel_color]
    else:
        aspects["Autographed"] = ["No"]

    meta = _get_category_aspects(token, category_id)
    if not meta:
        return aspects  # taxonomy unavailable — send best-effort aspects

    # Drop SELECTION_ONLY values that aren't in eBay's allowed list (avoids
    # invalid-value rejections and the cascading "required field" errors).
    for name in list(aspects):
        info = meta.get(name)
        if info and info["mode"] == "SELECTION_ONLY" and info["values"]:
            valid = [v for v in aspects[name] if v in info["values"]]
            if valid:
                aspects[name] = valid
            else:
                del aspects[name]

    # Auto-fill any required aspect we haven't provided.
    for name, info in meta.items():
        if info["required"] and name not in aspects:
            if info["mode"] == "SELECTION_ONLY" and info["values"]:
                aspects[name] = [sorted(info["values"])[0]]
            else:
                aspects[name] = ["Unspecified"]

    return aspects


_cond_descriptor_cache: dict | None = None


def _card_condition_descriptors(token: str, category_id: str, condition: str) -> list:
    """Build the eBay conditionDescriptors block for an ungraded card.

    Looks up the authoritative descriptor/value IDs from the Metadata API and
    caches them; falls back to the documented US IDs if the lookup is unavailable.
    """
    global _cond_descriptor_cache
    text = _OUR_COND_TO_CARD_CONDITION.get(condition, "Near Mint or Better")

    if _cond_descriptor_cache is None:
        mapping: dict[str, str] = {}  # value name (lowercased) -> value id
        desc_id = _CARD_CONDITION_DESCRIPTOR_ID
        try:
            with httpx.Client(timeout=15) as client:
                r = client.get(
                    f"{_METADATA_BASE}/marketplace/EBAY_US/get_item_condition_policies",
                    headers={"Authorization": f"Bearer {token}"},
                    params={"filter": f"categoryIds:{{{category_id}}}"},
                )
            if r.status_code == 200:
                for p in r.json().get("itemConditionPolicies", []):
                    for ic in p.get("itemConditions", []):
                        for d in ic.get("conditionDescriptors", []):
                            did = str(d.get("conditionDescriptorId") or "")
                            name = (d.get("conditionDescriptorName") or "").lower()
                            if did == _CARD_CONDITION_DESCRIPTOR_ID or "card condition" in name:
                                desc_id = did or desc_id
                                for v in d.get("conditionDescriptorValues", []):
                                    vname = (v.get("conditionDescriptorValueName") or "").strip()
                                    vid = str(v.get("conditionDescriptorValueId") or "")
                                    if vname and vid:
                                        mapping[vname.lower()] = vid
                logger.info("Card condition descriptor %s resolved values: %s", desc_id, mapping or "(none)")
            else:
                logger.warning("Condition policy lookup %s: %s", r.status_code, r.text[:200])
        except Exception as exc:  # noqa: BLE001
            logger.warning("Condition policy lookup error: %s", exc)

        if not mapping:
            mapping = {k.lower(): v for k, v in _CARD_CONDITION_VALUE_IDS.items()}
            logger.info("Using fallback Card Condition value IDs")
        _cond_descriptor_cache = {"desc_id": desc_id, "values": mapping}

    desc_id = _cond_descriptor_cache["desc_id"]
    value_id = (_cond_descriptor_cache["values"].get(text.lower())
                or _CARD_CONDITION_VALUE_IDS.get(text))
    if not value_id:
        logger.warning("No Card Condition value id for '%s' — skipping descriptor", text)
        return []
    return [{"name": desc_id, "values": [value_id]}]


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


def _ensure_policies(token: str) -> dict:
    """Look up fulfillment and return policies by name. Raises if required ones are missing."""
    global _pwe_policy_id, _ground_policy_id, _return_policy_id

    if _pwe_policy_id and _ground_policy_id and _return_policy_id:
        return {"pwe": _pwe_policy_id, "ground": _ground_policy_id, "return": _return_policy_id}

    headers = _api_headers(token)

    # ── Fulfillment policies ────────────────────────────────────────────────
    with httpx.Client(timeout=10) as client:
        r = client.get(f"{_ACCOUNT_BASE}/fulfillment_policy?marketplace_id=EBAY_US", headers=headers)

    if r.status_code != 200:
        body = r.text
        if "not opted in to business policies" in body.lower() or "20403" in body:
            raise ValueError(
                "Your eBay account needs Business Policies enabled. "
                "Go to Seller Hub → Account → Business Policies and click Opt In."
            )
        raise ValueError(f"Could not fetch fulfillment policies: {r.status_code} {body[:200]}")

    existing = {p["name"]: p["fulfillmentPolicyId"] for p in r.json().get("fulfillmentPolicies", [])}

    if _PWE_POLICY_NAME not in existing:
        raise ValueError(
            f"Fulfillment policy '{_PWE_POLICY_NAME}' not found on your eBay account. "
            "Create it in Seller Hub → Policies → Create policy → Shipping. "
            "Set service to eBay Standard Envelope (or USPS Ground Advantage), flat rate $0.99, handling 1 business day."
        )
    if _GROUND_POLICY_NAME not in existing:
        raise ValueError(
            f"Fulfillment policy '{_GROUND_POLICY_NAME}' not found on your eBay account. "
            "Create it in Seller Hub → Policies → Create policy → Shipping. "
            f"Set service to USPS Ground Advantage, flat rate ${EBAY_SHIP_PRICE:.2f}, handling 1 business day."
        )

    _pwe_policy_id    = existing[_PWE_POLICY_NAME]
    _ground_policy_id = existing[_GROUND_POLICY_NAME]
    logger.info("Fulfillment policies loaded: PWE=%s Ground=%s", _pwe_policy_id, _ground_policy_id)

    # ── Return policy ───────────────────────────────────────────────────────
    with httpx.Client(timeout=10) as client:
        r = client.get(f"{_ACCOUNT_BASE}/return_policy?marketplace_id=EBAY_US", headers=headers)

    if r.status_code == 200:
        existing_returns = {p["name"]: p["returnPolicyId"] for p in r.json().get("returnPolicies", [])}
        if _RETURN_POLICY_NAME in existing_returns:
            _return_policy_id = existing_returns[_RETURN_POLICY_NAME]
            logger.info("Return policy loaded: %s", _return_policy_id)
        else:
            # Create no-returns policy — simpler structure, less API surface area
            with httpx.Client(timeout=10) as client:
                rc = client.post(
                    f"{_ACCOUNT_BASE}/return_policy",
                    headers=headers,
                    json={
                        "name":           _RETURN_POLICY_NAME,
                        "marketplaceId":  "EBAY_US",
                        "categoryTypes":  [{"name": "ALL_EXCLUDING_MOTORS_VEHICLES"}],
                        "returnsAccepted": False,
                    },
                )
            if rc.status_code in (200, 201):
                _return_policy_id = rc.json()["returnPolicyId"]
                logger.info("Created return policy: %s", _return_policy_id)
            else:
                logger.warning("Could not create return policy: %s %s", rc.status_code, rc.text[:200])

    return {"pwe": _pwe_policy_id, "ground": _ground_policy_id, "return": _return_policy_id}


_AUCTION_DURATION = "DAYS_7"  # eBay auctions default to a 7-day run


def _resolve_image_urls(
    db: Session,
    cards: list[Card],
    token: str,
    explicit: list[str] | None,
) -> list[str]:
    """Decide what pictures this listing publishes with.

    Priority, highest first:

    1. URLs the operator typed into the modal — an explicit override always wins.
    2. The cards' own captured photos, uploaded to eBay Picture Services. Front
       photos lead, then backs.
    3. `EBAY_PLACEHOLDER_IMAGE_URL`, the pre-photos behaviour, for cards that
       were never photographed.

    A card with photos but a failed upload raises rather than quietly falling
    through to the placeholder — publishing a real card under a placeholder
    picture is a bad listing, not a degraded one."""
    explicit_urls = [u.strip() for u in (explicit or []) if u.strip()]
    if explicit_urls:
        return explicit_urls

    if any(photo_service.get_photos(db, c.id) for c in cards):
        try:
            urls = ebay_media_service.image_urls_for_cards(db, cards, token)
        except ebay_media_service.MediaUploadError as exc:
            raise ValueError(str(exc)) from exc
        if urls:
            return urls

    if EBAY_PLACEHOLDER_IMAGE_URL:
        return [EBAY_PLACEHOLDER_IMAGE_URL]

    raise ValueError(
        "This listing has no photos. Capture a front (and ideally a back) photo "
        "on the card's page, or set EBAY_PLACEHOLDER_IMAGE_URL in .env, "
        "or paste a URL in the photo field."
    )


def create_draft(
    db: Session,
    card_ids: list[int],
    price: float,
    title: str | None,
    description: str | None,
    image_urls: list[str] | None = None,
    listing_format: str = "FIXED_PRICE",
    auction_duration: str = _AUCTION_DURATION,
) -> dict:
    cards = db.query(Card).filter(Card.id.in_(card_ids)).all()
    if not cards:
        raise ValueError("No cards found")

    blocked = [c for c in cards if c.is_sold or c.is_selling]
    if blocked:
        names = ", ".join(f"{c.player_name} #{c.card_number}" for c in blocked)
        state = "sold" if all(c.is_sold for c in blocked) else "already listed/sold"
        raise ValueError(f"These cards are {state} and can't be listed again: {names}")

    # One listing carries one Sport/League aspect pair and one category, so a lot
    # has to be single-sport.
    sports = sorted({c.sport or DEFAULT_SPORT for c in cards})
    if len(sports) > 1:
        raise ValueError(
            f"A lot can only contain cards from one sport. Selected: {', '.join(sports)}. "
            "List each sport as its own lot."
        )

    token = get_user_token(db)
    if not token:
        raise ValueError("eBay account not connected. Connect in Settings first.")

    final_title = (title or build_title(cards))[:80]
    final_desc  = description or build_description(cards)

    worst = max(cards, key=lambda c: _COND_RANK.get(c.condition, 5))
    is_lot = len(cards) > 1
    is_auction = listing_format == "AUCTION"
    # Shipping tier: auctions use the heavier Ground policy regardless of the
    # starting bid, since the final hammer price (and value) is unknown and may
    # exceed the Standard Envelope limit. Fixed-price uses the ≤$20 threshold.
    heavy_shipping = is_auction or price > 20
    # A multi-card selection is published as a single lot listing in the Trading
    # Card Lots category (261329); a single card goes to Trading Card Singles.
    # Condition enum maps to a category-specific conditionId:
    #   Singles: USED_VERY_GOOD -> 4000 "Ungraded" (LIKE_NEW would be 2750 "Graded").
    #            Per-card NM/EX/VG/Poor is carried by the Card Condition descriptor (40001).
    #   Lots:    USED_EXCELLENT -> 3000 "Used" (lots have no condition descriptors).
    ebay_condition = "USED_EXCELLENT" if is_lot else "USED_VERY_GOOD"

    sku = f"CT-{'-'.join(str(c.id) for c in cards)}-{uuid.uuid4().hex[:6]}"
    headers = _api_headers(token)

    clean_image_urls = _resolve_image_urls(db, cards, token, image_urls)
    non_https = [u for u in clean_image_urls if not u.lower().startswith("https://")]
    if non_https:
        raise ValueError(f"eBay requires HTTPS image URLs. Non-HTTPS URL: {non_https[0][:80]}")

    # Step 1: create/update inventory item
    category_id = _LOT_CATEGORY_ID if is_lot else _get_singles_category_id(token, _sport_of(cards))
    aspects     = _build_aspects(cards, token, category_id)

    product: dict = {"title": final_title, "aspects": aspects}
    if clean_image_urls:
        product["imageUrls"] = clean_image_urls

    item_body: dict = {
        "product": product,
        "condition": ebay_condition,
        "availability": {
            "shipToLocationAvailability": {"quantity": 1}
        },
    }

    # Ungraded single cards require a Card Condition descriptor to publish.
    # Lots (261329) have no condition descriptors.
    if not is_lot:
        descriptors = _card_condition_descriptors(token, category_id, worst.condition)
        if descriptors:
            item_body["conditionDescriptors"] = descriptors

    # eBay requires a package weight to publish. Cards ship in a penny sleeve +
    # top loader: ~1 oz as a Standard Envelope (≤$20), heavier package otherwise.
    if not heavy_shipping:
        item_body["packageWeightAndSize"] = {
            "weight": {"value": 1, "unit": "OUNCE"},
            "packageType": "LETTER",
        }
    else:
        item_body["packageWeightAndSize"] = {
            "weight": {"value": 3, "unit": "OUNCE"},
            "packageType": "PACKAGE_THICK_ENVELOPE",
        }

    with httpx.Client(timeout=20) as client:
        resp = client.put(
            f"{_INVENTORY_BASE}/{sku}",
            headers=headers,
            json=item_body,
        )
    if resp.status_code not in (200, 204):
        logger.error("eBay inventory item %s: %s", resp.status_code, resp.text)
        raise ValueError(f"eBay inventory item error {resp.status_code}: {resp.text[:400]}")

    # Step 2: schedule 30 minutes from now so seller can review before it goes live
    go_live = datetime.now(timezone.utc) + timedelta(minutes=30)
    listing_start_date = go_live.strftime("%Y-%m-%dT%H:%M:%S.000Z")

    location_key = _ensure_merchant_location_key(token)
    policies     = _ensure_policies(token)

    fulfillment_id = policies["ground"] if heavy_shipping else policies["pwe"]
    return_id      = policies["return"]

    offer_payload: dict = {
        "sku":            sku,
        "marketplaceId":  "EBAY_US",
        "format":         "AUCTION" if is_auction else "FIXED_PRICE",
        "categoryId":     category_id,
        "listingDescription": final_desc.replace("\n", "<br>") or final_title,
        "listingStartDate":   listing_start_date,
    }
    if is_auction:
        # `price` is the starting bid; auctions run for the chosen duration and
        # have an inherent quantity of 1 (no per-buyer limit).
        offer_payload["pricingSummary"] = {
            "auctionStartPrice": {"currency": "USD", "value": f"{price:.2f}"}
        }
        offer_payload["listingDuration"] = auction_duration
    else:
        offer_payload["pricingSummary"] = {
            "price": {"currency": "USD", "value": f"{price:.2f}"}
        }
        offer_payload["quantityLimitPerBuyer"] = 1
    listing_policies: dict = {}
    if fulfillment_id:
        listing_policies["fulfillmentPolicyId"] = fulfillment_id
    if return_id:
        listing_policies["returnPolicyId"] = return_id
    if listing_policies:
        offer_payload["listingPolicies"] = listing_policies
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
        listing_format = listing_format,
        status         = "scheduled",
    )
    db.add(draft)
    db.flush()

    listing_date = datetime.utcnow()
    for card in cards:
        db.add(DraftListingCard(draft_id=draft.id, card_id=card.id))
        card.is_selling   = True
        card.listing_date = listing_date
        card.listing_url  = listing_url
        # Lots carry the price on the listing, not per card (card values stay $0).
        card.listed_price = price if not is_lot else None

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
