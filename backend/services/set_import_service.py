"""
Set import service.

Primary method: scrape an Upper Deck checklist URL and store the full set.
After any import, run reconciliation against unmatched cards in the collection.
"""
import logging
import re
from datetime import datetime

import httpx
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session

from backend.config import SCRAPER_HEADERS
from backend.models import Card, SetChecklist, SetChecklistCard
from backend.schemas import ReconciliationResult

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Upper Deck URL scraper
# ---------------------------------------------------------------------------

async def scrape_upper_deck_url(url: str) -> dict | None:
    """
    Fetch an Upper Deck checklist page and parse it into a structured dict.
    Returns None on any failure so the caller can show a friendly error.
    """
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, headers=SCRAPER_HEADERS) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                logger.warning("Upper Deck URL returned %s: %s", resp.status_code, url)
                return None
            return _parse_upper_deck_html(resp.text, url)
    except httpx.TimeoutException:
        logger.warning("Timeout fetching Upper Deck URL: %s", url)
        return None
    except Exception as exc:
        logger.warning("Error fetching Upper Deck URL %s: %s", url, exc)
        return None


def _parse_upper_deck_html(html: str, url: str) -> dict | None:
    """
    Parse the Upper Deck checklist HTML.
    Columns: Set Name, Card #, Description, Team City, Team Name,
             Rookie, Auto, Tech, #'d, SPs, Stated Odds, Point
    """
    soup = BeautifulSoup(html, "html.parser")

    # Derive set name and year from page title or URL
    set_name, brand, year = _extract_set_metadata(soup, url)

    # Find the checklist table — UD uses a table with these header columns
    table = _find_checklist_table(soup)
    if table is None:
        logger.warning("No checklist table found at %s", url)
        return None

    headers, data_start = _extract_table_headers(table)
    col = _column_index(headers)

    cards = []
    for row in table.find_all("tr")[data_start:]:
        cells = row.find_all("td")
        if not cells:
            continue
        card = _parse_row(cells, col, set_name)
        if card:
            cards.append(card)

    if not cards:
        logger.warning("Table found but no cards parsed at %s", url)
        return None

    return {"set_name": set_name, "brand": brand, "year": year, "cards": cards}


def _extract_set_metadata(soup: BeautifulSoup, url: str) -> tuple[str, str, int]:
    brand = "Upper Deck"
    year = datetime.utcnow().year

    title = soup.find("h1") or soup.find("title")
    title_text = title.get_text(strip=True) if title else ""

    # Pull year from title or URL
    year_match = re.search(r"(20\d{2})", title_text + url)
    if year_match:
        year = int(year_match.group(1))

    set_name = title_text or _set_name_from_url(url)
    # Clean common suffixes
    set_name = re.sub(r"\s*(checklist|hockey cards?|cards?)\s*$", "", set_name, flags=re.I).strip()
    if not set_name:
        set_name = _set_name_from_url(url)

    return set_name, brand, year


def _set_name_from_url(url: str) -> str:
    slug = url.rstrip("/").split("/")[-1]
    return slug.replace("-", " ").replace("_", " ").title()


def _extract_table_headers(table) -> tuple[list[str], int]:
    """
    Return (header_list, first_data_row_index).

    Some UD pages (e.g. O-Pee-Chee Platinum) put an empty <th> row first and
    place the real column names in the first <td> row.  Fall back to that row
    when all <th> text is empty.
    """
    th_texts = [th.get_text(strip=True).lower() for th in table.find_all("th")]
    if any(th_texts):
        return th_texts, 1

    # Fallback: find the first <td> row whose text matches known column names
    known = {"card", "card #", "description", "player", "set name"}
    for i, row in enumerate(table.find_all("tr")):
        tds = row.find_all("td")
        texts = [td.get_text(strip=True).lower() for td in tds]
        if known & set(texts):          # at least one known header present
            return texts, i + 1         # data starts on the next row
    return [], 1


def _find_checklist_table(soup: BeautifulSoup):
    # Upper Deck wraps the checklist in a table; look for one with "Card #" header
    for table in soup.find_all("table"):
        text = table.get_text(separator=" ", strip=True).lower()
        if "card #" in text or "card#" in text or "description" in text:
            return table
    # Fallback: largest table on the page
    tables = soup.find_all("table")
    return max(tables, key=lambda t: len(t.find_all("tr"))) if tables else None


def _column_index(headers: list[str]) -> dict[str, int]:
    """Map expected column names to their indices (flexible matching)."""
    mapping = {}
    for i, h in enumerate(headers):
        if "set name" in h or "set" == h:
            mapping.setdefault("set_variant", i)
        elif ("card" in h and "#" in h) or h == "card":
            mapping["card_number"] = i
        elif "team city" in h or "city" in h:
            mapping.setdefault("team_city", i)
        elif "team name" in h or "team" == h:
            mapping.setdefault("team_name", i)
        elif "description" in h or "player" in h or h == "name":
            mapping["player_name"] = i
        elif "rookie" in h:
            mapping["rookie"] = i
        elif "auto" in h:
            mapping["auto"] = i
        elif "tech" in h or "relic" in h or "patch" in h:
            mapping["relic"] = i
        elif "#'d" in h or "numbered" in h or "print" in h:
            mapping["print_run"] = i
    return mapping


def _parse_row(cells: list, col: dict, set_name: str) -> dict | None:
    def cell(key, default=""):
        idx = col.get(key)
        if idx is None or idx >= len(cells):
            return default
        return cells[idx].get_text(strip=True)

    card_number = cell("card_number").lstrip("#")
    player_name = cell("player_name")

    if not card_number or not player_name or player_name.lower() in ("description", "player"):
        return None

    # Team
    team_city = cell("team_city")
    team_name = cell("team_name")
    team = f"{team_city} {team_name}".strip() if team_city or team_name else None

    # Compute parallel_color first — any non-base variant name is a parallel
    variant = cell("set_variant")
    base_labels = {set_name.lower(), "base", "base set", "base set - rookies", ""}
    parallel_color = variant if (variant and variant.lower() not in base_labels) else None

    # Card type — auto/relic take priority, then parallel (any parallel_color), then rookie, then base
    is_rookie = cell("rookie") not in ("", "0", "No", "N")
    is_auto = cell("auto") not in ("", "0", "No", "N")
    is_relic = cell("relic") not in ("", "0", "No", "N")

    if is_auto and is_relic:
        card_type = "patch_relic"
    elif is_auto:
        card_type = "autograph"
    elif parallel_color:
        card_type = "parallel"
    elif is_rookie:
        card_type = "rookie"
    else:
        card_type = "base"

    # Print run
    print_run_raw = cell("print_run")
    print_run = None
    if print_run_raw:
        m = re.search(r"(\d+)", print_run_raw)
        if m:
            print_run = int(m.group(1))

    return {
        "card_number": card_number,
        "player_name": player_name,
        "is_rookie": is_rookie,
        "has_auto": is_auto,
        "is_serialed": print_run is not None,
        "team": team,
        "card_type": card_type,
        "parallel_color": parallel_color,
        "print_run": print_run,
    }


# ---------------------------------------------------------------------------
# Save to DB + reconciliation
# ---------------------------------------------------------------------------

def save_set_and_reconcile(
    db: Session, parsed: dict, source_url: str
) -> tuple[SetChecklist, ReconciliationResult]:
    checklist = SetChecklist(
        set_name=parsed["set_name"],
        brand=parsed["brand"],
        year=parsed["year"],
        total_cards=len(parsed["cards"]),
        source_url=source_url,
        imported_at=datetime.utcnow(),
    )
    db.add(checklist)
    db.flush()

    for c in parsed["cards"]:
        db.add(SetChecklistCard(
            set_id=checklist.id,
            card_number=c["card_number"],
            player_name=c["player_name"],
            team=c.get("team"),
            card_type=c.get("card_type", "base"),
            parallel_color=c.get("parallel_color"),
            print_run=c.get("print_run"),
            is_serialed=c.get("is_serialed", False),
            has_auto=c.get("has_auto", False),
            is_rookie=c.get("is_rookie", False),
        ))

    db.commit()
    db.refresh(checklist)
    reconciliation = reconcile_unmatched(db)
    return checklist, reconciliation


def reconcile_unmatched(db: Session) -> ReconciliationResult:
    """Match unmatched collection cards against all imported checklists."""
    unmatched = db.query(Card).filter(Card.checklist_matched == False).all()  # noqa: E712
    newly_matched = 0

    for card in unmatched:
        if match_card_to_checklists(db, card):
            newly_matched += 1

    still_unmatched_cards = db.query(Card).filter(Card.checklist_matched == False).all()  # noqa: E712
    return ReconciliationResult(
        newly_matched=newly_matched,
        still_unmatched=len(still_unmatched_cards),
        unmatched_cards=still_unmatched_cards,
    )


def match_card_to_checklists(db: Session, card: Card) -> bool:
    """
    Try to find a matching set_checklist_card for a collection card.
    Matches on card_number + fuzzy player name within sets that match brand/year.
    Returns True if a match was found and saved.
    """
    candidates = (
        db.query(SetChecklistCard)
        .join(SetChecklist)
        .filter(
            SetChecklistCard.card_number == card.card_number,
            SetChecklist.brand.ilike(f"%{card.brand}%"),
        )
        .all()
    )

    for candidate in candidates:
        if _names_match(card.player_name, candidate.player_name):
            candidate.owned = True
            candidate.collection_card_id = card.id
            card.checklist_matched = True
            db.commit()
            return True

    return False


def _names_match(a: str, b: str) -> bool:
    """Fuzzy name match: exact after lowercasing, or last name match."""
    a, b = a.lower().strip(), b.lower().strip()
    if a == b:
        return True
    # Last name match
    return a.split()[-1] == b.split()[-1]
