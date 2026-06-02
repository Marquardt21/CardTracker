"""
Price service — eBay API primary, 130point.com scraper fallback.
Results cached in card_values; never re-fetches within 24 hours.
"""
import logging
from datetime import datetime, timedelta

import httpx
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session

from backend.config import EBAY_APP_ID, SCRAPER_HEADERS
from backend.models import Card, CardValue

logger = logging.getLogger(__name__)
CACHE_HOURS = 24


async def fetch_price(card: Card, db: Session) -> CardValue | None:
    # Check cache first
    cutoff = datetime.utcnow() - timedelta(hours=CACHE_HOURS)
    recent = (
        db.query(CardValue)
        .filter(CardValue.card_id == card.id, CardValue.fetched_at >= cutoff)
        .order_by(CardValue.fetched_at.desc())
        .first()
    )
    if recent:
        return recent

    price, source = None, None

    if EBAY_APP_ID:
        price, source = await _fetch_ebay(card)

    if price is None:
        price, source = await _fetch_130point(card)

    if price is None:
        return None

    value = CardValue(card_id=card.id, source=source, price=price, fetched_at=datetime.utcnow())
    db.add(value)
    db.commit()
    db.refresh(value)
    return value


async def _fetch_ebay(card: Card) -> tuple[float | None, str | None]:
    query = f"{card.year} {card.brand} {card.player_name} #{card.card_number}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                "https://svcs.ebay.com/services/search/FindingService/v1",
                params={
                    "OPERATION-NAME": "findCompletedItems",
                    "SERVICE-VERSION": "1.0.0",
                    "SECURITY-APPNAME": EBAY_APP_ID,
                    "RESPONSE-DATA-FORMAT": "JSON",
                    "keywords": query,
                    "itemFilter(0).name": "SoldItemsOnly",
                    "itemFilter(0).value": "true",
                    "paginationInput.entriesPerPage": "10",
                },
            )
            if resp.status_code != 200:
                return None, None
            data = resp.json()
            items = (
                data.get("findCompletedItemsResponse", [{}])[0]
                .get("searchResult", [{}])[0]
                .get("item", [])
            )
            prices = [
                float(i["sellingStatus"][0]["currentPrice"][0]["__value__"])
                for i in items
                if i.get("sellingStatus")
            ]
            if not prices:
                return None, None
            avg = sum(prices) / len(prices)
            return round(avg, 2), "eBay sold"
    except Exception as exc:
        logger.warning("eBay fetch error: %s", exc)
        return None, None


async def _fetch_130point(card: Card) -> tuple[float | None, str | None]:
    query = f"{card.year} {card.brand} {card.player_name} {card.card_number}"
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True, headers=SCRAPER_HEADERS) as client:
            resp = await client.get(
                "https://130point.com/sales/",
                params={"q": query},
            )
            if resp.status_code != 200:
                return None, None
            soup = BeautifulSoup(resp.text, "html.parser")
            prices = []
            for tag in soup.select(".sale-price, .price, [class*='price']"):
                text = tag.get_text(strip=True).replace("$", "").replace(",", "")
                try:
                    prices.append(float(text))
                except ValueError:
                    pass
            if not prices:
                return None, None
            avg = sum(prices) / len(prices)
            return round(avg, 2), "130point"
    except Exception as exc:
        logger.warning("130point fetch error: %s", exc)
        return None, None
