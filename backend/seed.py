"""
Seeds the database on first run:
  1. Imports the Flair 2025-26 checklist from flair_2025_checklist.json
  2. Adds 5 sample cards to the collection
"""
import json
import logging
from datetime import datetime
from pathlib import Path

from backend.database import SessionLocal
from backend.models import Card, SetChecklist, SetChecklistCard

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).parent.parent


def run_seed():
    db = SessionLocal()
    try:
        if db.query(Card).count() > 0:
            return  # Already seeded
        _seed_flair_checklist(db)
        _seed_sample_cards(db)
        logger.info("Database seeded successfully")
    finally:
        db.close()


def _seed_flair_checklist(db):
    checklist_path = PROJECT_ROOT / "flair_2025_checklist.json"
    if not checklist_path.exists():
        logger.warning("flair_2025_checklist.json not found — skipping checklist seed")
        return

    data = json.loads(checklist_path.read_text())
    checklist = SetChecklist(
        set_name=data["set_name"],
        brand=data["brand"],
        year=data["year"],
        total_cards=len(data["cards"]),
        source_url=data.get("source_url"),
        imported_at=datetime.utcnow(),
    )
    db.add(checklist)
    db.flush()

    for c in data["cards"]:
        db.add(SetChecklistCard(
            set_id=checklist.id,
            card_number=str(c["card_number"]),
            player_name=c["player_name"],
            team=c.get("team"),
            card_type=c.get("card_type", "base"),
            parallel_color=c.get("parallel_color"),
            print_run=c.get("print_run"),
        ))

    db.commit()
    logger.info("Seeded Flair 2025-26 checklist with %d cards", len(data["cards"]))


def _seed_sample_cards(db):
    samples = [
        {
            "brand": "Upper Deck", "year": 2025, "set_name": "2025-26 Upper Deck Flair Hockey",
            "card_number": "1", "player_name": "Connor McDavid",
            "team": "Edmonton Oilers", "position": "C", "card_type": "base",
            "condition": "near_mint",
        },
        {
            "brand": "Upper Deck", "year": 2025, "set_name": "2025-26 Upper Deck Flair Hockey",
            "card_number": "5", "player_name": "Auston Matthews",
            "team": "Toronto Maple Leafs", "position": "C", "card_type": "base",
            "condition": "mint",
        },
        {
            "brand": "Upper Deck", "year": 2025, "set_name": "2025-26 Upper Deck Flair Hockey",
            "card_number": "10", "player_name": "Nathan MacKinnon",
            "team": "Colorado Avalanche", "position": "C", "card_type": "base",
            "condition": "near_mint",
        },
        {
            "brand": "Upper Deck", "year": 2025, "set_name": "2025-26 Upper Deck Flair Hockey",
            "card_number": "51", "player_name": "Matvei Michkov",
            "team": "Philadelphia Flyers", "position": "RW", "card_type": "rookie",
            "condition": "near_mint", "notes": "Hot rookie",
        },
        {
            "brand": "Upper Deck", "year": 2025, "set_name": "2025-26 Upper Deck Flair Hockey",
            "card_number": "3", "player_name": "Leon Draisaitl",
            "team": "Edmonton Oilers", "position": "C", "card_type": "base",
            "condition": "excellent",
        },
    ]

    from backend.services.set_import_service import match_card_to_checklists

    for s in samples:
        card = Card(**s, checklist_matched=False, date_added=datetime.utcnow())
        db.add(card)
        db.flush()
        match_card_to_checklists(db, card)

    db.commit()
    logger.info("Seeded %d sample cards", len(samples))
