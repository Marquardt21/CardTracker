"""
AI price recommendation service using Anthropic Claude.

Builds a prompt from the card's details and eBay sold history, then
asks Claude to recommend a selling price with reasoning.
"""
import json
import logging

from backend.config import ANTHROPIC_API_KEY
from backend.models import Card, CardValue

logger = logging.getLogger(__name__)

COND_LABELS = {
    "poor": "Poor", "good": "Good", "very_good": "Very Good",
    "excellent": "Excellent", "near_mint": "Near Mint", "mint": "Mint",
}
TYPE_LABELS = {
    "base": "Base", "rookie": "Rookie", "parallel": "Parallel",
    "autograph": "Autograph", "patch_relic": "Patch / Relic",
}


def _build_prompt(card: Card, sold_values: list[CardValue]) -> str:
    parallel = card.parallel_color or "None (base version)"
    print_run = f"/{card.print_run} (serialized)" if card.print_run else "Not serialized"
    condition = COND_LABELS.get(card.condition, card.condition)
    card_type = TYPE_LABELS.get(card.card_type, card.card_type)

    if sold_values:
        sorted_values = sorted(sold_values, key=lambda v: v.fetched_at, reverse=True)
        price_lines = "\n".join(
            f"  - ${v.price:.2f} sold on {v.fetched_at.strftime('%b %d, %Y')} ({v.source})"
            for v in sorted_values
        )
        price_section = f"Recent eBay sold prices for this card:\n{price_lines}"
    else:
        price_section = "No eBay sold data is currently available for this card."

    return f"""You are an expert hockey card dealer and pricing specialist with deep knowledge of the sports card market.

A collector needs a selling price recommendation for the following card:

CARD DETAILS:
  Player:    {card.player_name}
  Year/Set:  {card.year} {card.set_name}
  Card #:    {card.card_number}
  Type:      {card_type}
  Parallel:  {parallel}
  Print Run: {print_run}
  Condition: {condition}
  Brand:     {card.brand}

{price_section}

Based on this information, provide a selling price recommendation. Consider:
- The card's rarity (parallel type, print run)
- Current market trends for this player and set
- The condition of the card
- Whether prices are trending up or down based on the sold data
- A reasonable profit margin vs a quick-sale price

Respond with ONLY a JSON object in this exact format, no other text:
{{
  "recommended_price": <number>,
  "price_range_low": <number>,
  "price_range_high": <number>,
  "confidence": "high" | "medium" | "low",
  "reasoning": "<2-3 sentence explanation of the recommendation>"
}}"""


async def generate_price_recommendation(card: Card, sold_values: list[CardValue]) -> dict:
    if not ANTHROPIC_API_KEY:
        return {"error": "Anthropic API key not configured."}

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

        prompt = _build_prompt(card, sold_values)

        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
        )

        raw = message.content[0].text.strip()

        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        result = json.loads(raw)
        return {
            "recommended_price": float(result["recommended_price"]),
            "price_range_low":   float(result["price_range_low"]),
            "price_range_high":  float(result["price_range_high"]),
            "confidence":        result.get("confidence", "medium"),
            "reasoning":         result.get("reasoning", ""),
        }

    except json.JSONDecodeError as exc:
        logger.warning("Could not parse AI recommendation JSON: %s", exc)
        return {"error": "Could not parse recommendation response."}
    except Exception as exc:
        logger.warning("AI recommendation error: %s", exc)
        return {"error": str(exc)}
