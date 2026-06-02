"""
Price service — eBay OAuth Browse API + 130point.com scraping.

Priority order per query:
  1. eBay Marketplace Insights API (OAuth) — requires special eBay approval;
     skipped with a warning until access is granted.
  2. eBay Browse API (OAuth) — active BIN listings as a market-price proxy.
  3. 130point.com scrape — aggregates real eBay sold data, no key needed.
  4. Legacy Finding API (App ID) — kept as last-resort fallback.

Search strategy (most specific → broadest):
  year + player + card# + parallel/serial
  year + player + card# + set hint
  year + player + card#
  player + card# (no year, no # prefix for inserts)

Graded slabs (PSA/BGS/SGC/CGC) are excluded from all results.
"""
import base64
import logging
import re
import time
from datetime import datetime

import httpx
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session

from backend.config import EBAY_APP_ID, EBAY_CERT_ID, SCRAPER_HEADERS
from backend.database import SessionLocal
from backend.models import Card, CardValue

logger = logging.getLogger(__name__)

GRADED_KEYWORDS   = {"psa", "bgs", "sgc", "cgc", "graded", "beckett"}
EBAY_TOKEN_URL    = "https://api.ebay.com/identity/v1/oauth2/token"
EBAY_INSIGHTS_URL = "https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search"
EBAY_BROWSE_URL   = "https://api.ebay.com/buy/browse/v1/item_summary/search"
EBAY_FINDING_URL  = "https://svcs.ebay.com/services/search/FindingService/v1"

_token_cache: dict = {"token": None, "expires_at": 0.0}


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

async def fetch_sold_history_bg(card_id: int, max_results: int = 5) -> None:
    db = SessionLocal()
    try:
        card = db.query(Card).filter(Card.id == card_id).first()
        if card:
            await fetch_sold_history(card, db, max_results)
    except Exception as exc:
        logger.warning("Background price fetch for card %s: %s", card_id, exc)
    finally:
        db.close()


async def fetch_sold_history(card: Card, db: Session, max_results: int = 5) -> list[CardValue]:
    if not EBAY_APP_ID:
        logger.warning("EBAY_APP_ID not configured — skipping price fetch")
        return []

    items = await _search_sold(card, limit=max_results)
    if not items:
        return []

    all_existing = db.query(CardValue).filter(CardValue.card_id == card.id).all()

    # If we already have actual sold data, don't add listed-price placeholders on top of it.
    has_real_sold = any(_source_type(v.source) == "sold" for v in all_existing)

    # Dedup key: (source_type, rounded_price, date)
    # "listed" entries use today's date so we key on price+type alone to prevent
    # the same active listing from being added again on a new calendar day.
    existing_sold   = {(round(v.price, 2), v.fetched_at.date()) for v in all_existing if _source_type(v.source) == "sold"}
    existing_listed = {round(v.price, 2) for v in all_existing if _source_type(v.source) == "listed"}

    saved = []
    for item in items:
        stype = _source_type(item["source"])
        price = round(item["price"], 2)

        if stype == "listed":
            if has_real_sold:
                continue                          # real sold data supersedes listing prices
            if price in existing_listed:
                continue                          # same listed price already stored
        else:
            if (price, item["sold_at"].date()) in existing_sold:
                continue                          # exact same sale already stored

        cv = CardValue(card_id=card.id, source=item["source"],
                       price=price, fetched_at=item["sold_at"])
        db.add(cv)
        saved.append(cv)

    if saved:
        db.commit()
        for cv in saved:
            db.refresh(cv)
    return saved


def _source_type(source: str) -> str:
    return "listed" if "listed price" in (source or "").lower() else "sold"


async def fetch_price(card: Card, db: Session) -> CardValue | None:
    from datetime import timedelta
    cutoff = datetime.utcnow() - timedelta(hours=24)
    recent = (
        db.query(CardValue)
        .filter(CardValue.card_id == card.id, CardValue.fetched_at >= cutoff)
        .order_by(CardValue.fetched_at.desc())
        .first()
    )
    if recent:
        return recent
    new_values = await fetch_sold_history(card, db, max_results=1)
    return new_values[0] if new_values else None


async def fetch_market_price(card: Card) -> float | None:
    """
    Return the lowest active BIN price from Browse API as a market reference.
    NOT stored in the database — use only for display alongside sold history.
    """
    token = await _get_oauth_token()
    if not token:
        return None
    for query in _build_queries(card):
        items = await _call_browse_api(query, 3, token)
        if items:
            return min(i["price"] for i in items)
    return None


# ---------------------------------------------------------------------------
# OAuth token
# ---------------------------------------------------------------------------

async def _get_oauth_token() -> str | None:
    if _token_cache["token"] and time.time() < _token_cache["expires_at"] - 60:
        return _token_cache["token"]
    if not EBAY_CERT_ID:
        return None
    credentials = base64.b64encode(f"{EBAY_APP_ID}:{EBAY_CERT_ID}".encode()).decode()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                EBAY_TOKEN_URL,
                headers={"Authorization": f"Basic {credentials}",
                         "Content-Type": "application/x-www-form-urlencoded"},
                data={"grant_type": "client_credentials",
                      "scope": "https://api.ebay.com/oauth/api_scope"},
            )
        if resp.status_code != 200:
            logger.warning("OAuth token failed %s: %s", resp.status_code, resp.text[:200])
            return None
        data = resp.json()
        _token_cache["token"]      = data["access_token"]
        _token_cache["expires_at"] = time.time() + data.get("expires_in", 7200)
        logger.info("eBay OAuth token refreshed")
        return _token_cache["token"]
    except Exception as exc:
        logger.warning("OAuth token error: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Search orchestration
# ---------------------------------------------------------------------------

async def _search_sold(card: Card, limit: int = 5) -> list[dict]:
    import asyncio
    token = await _get_oauth_token()

    for i, query in enumerate(_build_queries(card)):
        if i > 0:
            await asyncio.sleep(1.0)

        # 1. Marketplace Insights (requires special eBay approval — 403 until granted)
        if token:
            items = await _call_insights_api(query, limit, token)
            if items:
                logger.info("eBay Insights: %d results for %r", len(items), query)
                return items

        # 2. 130point.com scrape (real sold data, no key needed)
        items = await _call_130point(query, limit)
        if items:
            logger.info("130point: %d results for %r", len(items), query)
            return items

        # 3. Finding API (legacy fallback)
        items = await _call_finding_api(query, limit)
        if items:
            logger.info("eBay Finding: %d results for %r", len(items), query)
            return items

        logger.info("No sold results for %r — trying broader", query)

    return []


# ---------------------------------------------------------------------------
# Marketplace Insights API (OAuth — needs special eBay access)
# ---------------------------------------------------------------------------

_insights_403_logged = False   # log once so startup noise stays low


async def _call_insights_api(query: str, limit: int, token: str) -> list[dict]:
    global _insights_403_logged
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                EBAY_INSIGHTS_URL,
                headers={"Authorization": f"Bearer {token}"},
                params={
                    "q":     query,
                    "limit": str(min(limit * 3, 25)),
                    "sort":  "lastSoldDate",   # most recent sales first
                },
            )
        if resp.status_code == 401:
            _token_cache["token"] = None
            return []
        if resp.status_code == 403:
            if not _insights_403_logged:
                logger.warning("Marketplace Insights API: access not yet approved (403). "
                               "Once approved this will resolve automatically.")
                _insights_403_logged = True
            return []
        if resp.status_code == 200:
            _insights_403_logged = False   # reset if access is later granted
        else:
            logger.warning("Insights API %s: %s", resp.status_code, resp.text[:200])
            return []

        results = []
        for item in resp.json().get("itemSales", []):
            if _is_graded(item.get("title", "").lower()):
                continue
            try:
                price_data = item.get("lastSoldPrice") or item.get("price", {})
                price      = float(price_data["value"])
                date_str   = item.get("lastSoldDate") or item.get("soldDate", "")
                sold_at    = _parse_date(date_str)
            except (KeyError, ValueError, TypeError):
                continue
            results.append({"price": round(price, 2), "sold_at": sold_at,
                             "source": "eBay sold", "title": item.get("title", "")})
            if len(results) >= limit:
                break
        return results
    except Exception as exc:
        logger.warning("Insights API error: %s", exc)
        return []


# ---------------------------------------------------------------------------
# 130point.com scraper (aggregates eBay sold data)
# ---------------------------------------------------------------------------

async def _call_130point(query: str, limit: int) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True,
                                      headers=SCRAPER_HEADERS) as client:
            resp = await client.get("https://130point.com/sales/", params={"q": query})
        if resp.status_code != 200:
            return []

        soup    = BeautifulSoup(resp.text, "html.parser")
        results = []

        for row in soup.select("table tr, .sale-row, .result-row"):
            cells = row.find_all(["td", "div"])
            if not cells:
                continue

            text = " ".join(c.get_text(strip=True) for c in cells).lower()
            if _is_graded(text):
                continue

            # Extract price — look for $XX.XX pattern
            price_match = re.search(r"\$(\d+(?:\.\d{2})?)", " ".join(c.get_text() for c in cells))
            if not price_match:
                continue
            price = float(price_match.group(1))
            if price < 0.50:
                continue

            # Extract date if present
            date_match = re.search(r"(\d{1,2}/\d{1,2}/\d{2,4}|\d{4}-\d{2}-\d{2})",
                                   " ".join(c.get_text() for c in cells))
            if date_match:
                try:
                    raw = date_match.group(1)
                    sold_at = (datetime.strptime(raw, "%m/%d/%Y") if "/" in raw
                               else datetime.strptime(raw, "%Y-%m-%d"))
                except ValueError:
                    sold_at = datetime.utcnow()
            else:
                sold_at = datetime.utcnow()

            results.append({"price": round(price, 2), "sold_at": sold_at,
                             "source": "130point (eBay sold)", "title": query})
            if len(results) >= limit:
                break

        return results
    except Exception as exc:
        logger.warning("130point error: %s", exc)
        return []


# ---------------------------------------------------------------------------
# Browse API (OAuth — active BIN listings as market-price proxy)
# ---------------------------------------------------------------------------

async def _call_browse_api(query: str, limit: int, token: str) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                EBAY_BROWSE_URL,
                headers={"Authorization": f"Bearer {token}"},
                params={
                    "q":      query,
                    "filter": "buyingOptions:{FIXED_PRICE}",
                    "sort":   "price",
                    "limit":  str(min(limit * 3, 25)),
                },
            )
        if resp.status_code == 401:
            _token_cache["token"] = None
            return []
        if resp.status_code != 200:
            logger.warning("Browse API %s: %s", resp.status_code, resp.text[:200])
            return []

        results = []
        for item in resp.json().get("itemSummaries", []):
            if _is_graded(item.get("title", "").lower()):
                continue
            try:
                price = float(item["price"]["value"])
            except (KeyError, ValueError, TypeError):
                continue
            results.append({"price": round(price, 2), "sold_at": datetime.utcnow(),
                             "source": f"eBay listed price · fetched {datetime.utcnow().strftime('%b %d, %Y')}",
                             "title": item.get("title", "")})
            if len(results) >= limit:
                break
        return results
    except Exception as exc:
        logger.warning("Browse API error: %s", exc)
        return []


# ---------------------------------------------------------------------------
# Finding API (legacy last-resort)
# ---------------------------------------------------------------------------

async def _call_finding_api(query: str, limit: int) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                EBAY_FINDING_URL,
                params={
                    "OPERATION-NAME":                "findCompletedItems",
                    "SERVICE-VERSION":               "1.0.0",
                    "SECURITY-APPNAME":              EBAY_APP_ID,
                    "RESPONSE-DATA-FORMAT":          "JSON",
                    "keywords":                      query,
                    "itemFilter(0).name":            "SoldItemsOnly",
                    "itemFilter(0).value":           "true",
                    "sortOrder":                     "EndTimeSoonest",
                    "paginationInput.entriesPerPage": str(min(limit * 3, 25)),
                },
            )
        if resp.status_code != 200:
            return []
        items = (resp.json().get("findCompletedItemsResponse", [{}])[0]
                 .get("searchResult", [{}])[0].get("item", []))
        results = []
        for item in items:
            if _is_graded(item.get("title", [""])[0].lower()):
                continue
            try:
                price   = float(item["sellingStatus"][0]["currentPrice"][0]["__value__"])
                sold_at = _parse_date(item["listingInfo"][0]["endTime"][0])
            except (KeyError, IndexError, ValueError):
                continue
            results.append({"price": round(price, 2), "sold_at": sold_at,
                             "source": "eBay sold", "title": item.get("title", [""])[0]})
            if len(results) >= limit:
                break
        return results
    except Exception as exc:
        logger.warning("Finding API error: %s", exc)
        return []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_queries(card: Card) -> list[str]:
    num      = _card_num_str(card.card_number)
    year     = _year_str(card.year, card.set_name)
    base     = f"{year} {card.player_name} {num}"
    set_hint = _short_set_name(card.set_name)
    queries  = []

    specific = base
    if card.parallel_color:
        specific += f" {card.parallel_color}"
    if card.print_run:
        specific += f" /{card.print_run}"
    if specific != base:
        queries.append(specific)
    if set_hint:
        queries.append(f"{base} {set_hint}")
    queries.append(base)
    queries.append(f"{card.player_name} {num}")

    seen, unique = set(), []
    for q in queries:
        if q not in seen:
            seen.add(q)
            unique.append(q)
    return unique


def _card_num_str(card_number: str) -> str:
    return f"#{card_number}" if card_number.isdigit() else card_number


def _year_str(year: int, set_name: str) -> str:
    m = re.search(r"(\d{4})-(\d{2,4})", set_name)
    return f"{m.group(1)}-{m.group(2)[-2:]}" if m else str(year)


def _short_set_name(set_name: str) -> str:
    cleaned = re.sub(r"^\d{4}[-–]\d{2,4}\s*", "", set_name).strip()
    return " ".join(w for w in cleaned.split() if len(w) > 2)[:40]


def _is_graded(title: str) -> bool:
    return any(kw in title for kw in GRADED_KEYWORDS)


def _parse_date(date_str: str) -> datetime:
    clean = re.sub(r"\.\d+Z?$", "", date_str).replace("Z", "")
    return datetime.strptime(clean, "%Y-%m-%dT%H:%M:%S")
