"""
AI selling-strategy service using Anthropic Claude.

Builds ONE prompt from a cohort of cards (details, recent sold prices, cached
active-listing summaries and a computed grading ROI) and asks Claude to group
them into list / send_to_grading / hold actions the user can then execute.

The Claude call is a multi-turn tool loop: Claude can pull fresher market data
for a specific card (live active listings, refreshed sold prices) mid-analysis
instead of working only off what was pre-computed into the prompt. Both tools
are read-only market lookups, capped at STRATEGY_MAX_TOOL_CALLS per run.
"""
import json
import logging
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from backend.config import (
    ACTIVE_LISTING_TTL_DAYS,
    ANTHROPIC_API_KEY,
    DEFAULT_SPORT,
    STRATEGY_MAX_TOOL_CALLS,
)
from backend.models import ActiveListingCache, Card, CardValue
from backend.services.grading_service import compute_grading_roi

logger = logging.getLogger(__name__)

GRADING_SERVICE = "PSA Standard"
VALID_ACTIONS = {"list", "send_to_grading", "hold"}

_CARD_ID_SCHEMA = {
    "type": "object",
    "properties": {"card_id": {"type": "integer"}},
    "required": ["card_id"],
}

TOOLS = [
    {
        "name": "get_live_active_listings",
        "description": (
            "Look up the current eBay asking prices for one card in this cohort. "
            "Returns how many raw copies are listed right now and the low/high "
            "asking price. Use it when the card has no cached listing data or the "
            "cached range is too wide/stale to price against."
        ),
        "input_schema": _CARD_ID_SCHEMA,
    },
    {
        "name": "refresh_sold_prices",
        "description": (
            "Pull the most recent eBay sold price for one card in this cohort. "
            "Use it when the card has no sold data, or its sold data looks old "
            "enough that it may not reflect the current market."
        ),
        "input_schema": _CARD_ID_SCHEMA,
    },
]

SYSTEM_PROMPT = f"""You have two tools that pull fresh market data for a single card:
get_live_active_listings and refresh_sold_prices.

Each call is a real network request to eBay, so it is slow, and you have a hard
budget of {STRATEGY_MAX_TOOL_CALLS} tool calls for the whole analysis. Use them
selectively — only where the extra data would actually change your
recommendation: a card with no market data at all, a card whose price range is
so wide the right price is unclear, or a card you are about to price into a
meaningful-value lot. Do NOT look up every card in the cohort.

Once you have the data you need, reply with the final JSON object and nothing
else."""


def _card_block(card: Card, sold_values: list[CardValue], cache: ActiveListingCache | None) -> str:
    parallel = card.parallel_color or "none"
    print_run = f"/{card.print_run}" if card.print_run else "not serialized"
    lines = [
        f"[card {card.id}] {card.player_name} — {card.year} {card.brand} {card.set_name} "
        f"#{card.card_number} | sport: {card.sport or DEFAULT_SPORT} | type: {card.card_type} "
        f"| parallel: {parallel} | print run: {print_run} | condition: {card.condition} "
        f"| team: {card.team or 'unknown'}"
    ]

    if sold_values:
        sold = "; ".join(
            f"${v.price:.2f} on {v.fetched_at.strftime('%b %d, %Y')} ({v.source})"
            for v in sold_values
        )
        lines.append(f"    recent sold: {sold}")
    else:
        lines.append("    recent sold: no sold data available")

    # low/high are null when no cached listing carried a price, even with count > 0
    if cache and cache.count and cache.low is not None and cache.high is not None:
        lines.append(
            f"    current eBay listings: {cache.count} asking "
            f"${cache.low:.2f}–${cache.high:.2f}"
        )
    else:
        lines.append("    current eBay listings: none cached")

    if sold_values:
        raw = sold_values[0].price
        roi = compute_grading_roi(card.card_type, raw, GRADING_SERVICE)
        lines.append(
            f"    grading ROI ({GRADING_SERVICE}): raw ${raw:.2f} → est. graded "
            f"${roi['estimated_graded']:.2f}, cost ${roi['grading_cost']}, "
            f"net ROI ${roi['roi']:.2f} ({roi['verdict']})"
        )

    return "\n".join(lines)


def _build_prompt(blocks: list[str]) -> str:
    return f"""You are an expert sports card dealer advising a collector on what to do with
part of their collection. Below is a cohort of raw (ungraded) cards they own.

{chr(10).join(blocks)}

Group these cards into recommended actions. For each group pick ONE action:

- "list" — sell now on eBay. A group with a SINGLE card id is an individual
  listing; a group with MULTIPLE card ids is a lot, sold together as one
  listing. Group cards into a lot when they are worth more or more likely to
  sell bundled (e.g. many cards of the same player, or a full insert-set run);
  otherwise list them individually. "suggested_price" for a lot is the TOTAL
  price for the whole lot, not per card. Set "listing_format" to "FIXED_PRICE"
  (Buy It Now) or "AUCTION"; for an auction also set "auction_duration" to one
  of DAYS_1, DAYS_3, DAYS_5, DAYS_7, DAYS_10 (for fixed price set it to null),
  and treat "suggested_price" as the starting bid.
- "send_to_grading" — worth sending to PSA for grading first. Base this on the
  grading ROI figures above and say so in the reasoning. Set "listing_format",
  "auction_duration" and "suggested_price" to null.
- "hold" — not worth selling or grading right now (prices trending up, no
  market data yet, too low value to bother). Explain why in the reasoning. Set
  "listing_format", "auction_duration" and "suggested_price" to null.

Every card id listed above must appear in exactly one group.

Respond with ONLY a JSON object in this exact format, no other text:
{{
  "groups": [
    {{
      "card_ids": [<number>, ...],
      "action": "list" | "send_to_grading" | "hold",
      "listing_format": "FIXED_PRICE" | "AUCTION" | null,
      "auction_duration": "DAYS_7" | null,
      "suggested_price": <number or null>,
      "reasoning": "<1-3 sentence explanation>"
    }}
  ]
}}"""


def _validate(raw_groups, requested_ids: set[int]) -> list[dict]:
    """Drop groups referencing unknown card ids, unrecognized actions, or no cards.
    A partially-malformed response is filtered, not rejected outright."""
    groups = []
    for g in raw_groups if isinstance(raw_groups, list) else []:
        if not isinstance(g, dict):
            continue
        action = g.get("action")
        if action not in VALID_ACTIONS:
            continue
        ids = [i for i in (g.get("card_ids") or []) if isinstance(i, int)]
        if not ids or not set(ids) <= requested_ids:
            continue
        price = g.get("suggested_price")
        groups.append({
            "card_ids":         ids,
            "action":           action,
            "listing_format":   g.get("listing_format") if action == "list" else None,
            "auction_duration": g.get("auction_duration") if action == "list" else None,
            "suggested_price":  float(price) if isinstance(price, (int, float)) else None,
            "reasoning":        g.get("reasoning", ""),
        })
    return groups


async def _run_tool(name: str, tool_input: dict, db: Session, cohort_ids: set[int]) -> str:
    """Execute one Claude tool call and return its result as plain text.

    Card ids outside the requested cohort are rejected rather than looked up, and
    every failure comes back as a short string so Claude can recover instead of
    the whole run dying."""
    card_id = (tool_input or {}).get("card_id")
    if not isinstance(card_id, int) or card_id not in cohort_ids:
        return f"Error: card {card_id} is not part of this analysis."

    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        return f"Error: card {card_id} not found."

    if name == "get_live_active_listings":
        from backend.routers.values import _get_or_fetch_listings
        listings, _, _ = await _get_or_fetch_listings(db, card, force=False)
        prices = [l["price"] for l in listings if l.get("price") is not None]
        if not prices:
            return f"card {card_id}: no active eBay listings found."
        return (
            f"card {card_id}: {len(listings)} active eBay listings, "
            f"asking ${min(prices):.2f}–${max(prices):.2f}."
        )

    if name == "refresh_sold_prices":
        from backend.services.price_service import fetch_price
        value = await fetch_price(card, db)
        if not value:
            return f"card {card_id}: no sold data found."
        return (
            f"card {card_id}: most recent sold ${value.price:.2f} on "
            f"{value.fetched_at.strftime('%b %d, %Y')} ({value.source})."
        )

    return f"Error: unknown tool {name}."


async def _run_tool_loop(client, prompt: str, db: Session, cohort_ids: set[int]) -> str:
    """Drive the Claude conversation until it stops asking for tools, then return
    its final text. Tool calls are capped at STRATEGY_MAX_TOOL_CALLS; once the
    budget is spent, tool use is switched off so the model has to finalize."""
    messages = [{"role": "user", "content": prompt}]
    calls_used = 0

    # Worst case is one tool call per turn plus a final turn to answer; the bound
    # guarantees we terminate even if the model keeps requesting tools anyway.
    for _ in range(STRATEGY_MAX_TOOL_CALLS + 2):
        extra = {} if calls_used < STRATEGY_MAX_TOOL_CALLS else {"tool_choice": {"type": "none"}}
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
            **extra,
        )

        if message.stop_reason != "tool_use":
            return next(b.text for b in message.content if b.type == "text").strip()

        messages.append({"role": "assistant", "content": message.content})
        results = []
        for block in message.content:
            if block.type != "tool_use":
                continue
            if calls_used >= STRATEGY_MAX_TOOL_CALLS:
                content = (
                    "Tool call budget exhausted — finalize your recommendation "
                    "using the data you already have."
                )
            else:
                calls_used += 1
                content = await _run_tool(block.name, block.input, db, cohort_ids)
            results.append({"type": "tool_result", "tool_use_id": block.id, "content": content})
        messages.append({"role": "user", "content": results})

    raise RuntimeError("AI kept requesting tools after the budget was exhausted.")


async def generate_strategy(card_ids: list[int], db: Session) -> dict:
    if not ANTHROPIC_API_KEY:
        return {"error": "Anthropic API key not configured."}

    cards = db.query(Card).filter(Card.id.in_(card_ids)).all()
    if not cards:
        return {"error": "No cards found."}

    fresh_after = datetime.utcnow() - timedelta(days=ACTIVE_LISTING_TTL_DAYS)
    blocks = []
    for card in cards:
        sold_values = (
            db.query(CardValue)
            .filter(CardValue.card_id == card.id)
            .order_by(CardValue.fetched_at.desc())
            .limit(3)
            .all()
        )
        cache = (
            db.query(ActiveListingCache)
            .filter(
                ActiveListingCache.card_id == card.id,
                ActiveListingCache.fetched_at >= fresh_after,
            )
            .first()
        )
        blocks.append(_card_block(card, sold_values, cache))

    cohort_ids = {c.id for c in cards}

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

        raw = await _run_tool_loop(client, _build_prompt(blocks), db, cohort_ids)

        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        result = json.loads(raw)
        return {"groups": _validate(result.get("groups"), cohort_ids)}

    except json.JSONDecodeError as exc:
        logger.warning("Could not parse AI strategy JSON: %s", exc)
        return {"error": "Could not parse strategy response."}
    except Exception as exc:
        logger.warning("AI strategy error: %s", exc)
        return {"error": str(exc)}
