# AI Selling Strategy

**Status:** Implemented
**Date:** 2026-07-28

## Summary
A new "Strategy" tab where the user filters/selects a cohort of cards (e.g. all Auston Matthews cards, or all Series 2 inserts), sends them to Claude for a batched analysis, and reviews AI-generated recommendations — sell individually, bundle as a lot, send to grading, or hold — before choosing which ones to execute via the app's existing eBay listing and grading endpoints. The analysis call is agentic: Claude can call two read/refresh tools mid-analysis to pull live eBay data for specific cards instead of relying only on whatever was pre-computed into the initial prompt.

## Scope / What changes

### Backend
- `backend/services/strategy_service.py` (new): builds one prompt per analysis run from the selected cohort's card details, recent sold prices (`card_values`), cached active-listing summaries (`active_listing_cache`), and a computed grading ROI (reusing `GRADING_MULTIPLIERS`/`GRADING_COSTS` math from `grading_service.py`, computed inline without requiring watchlist status or persisting a `GradingRecommendation`). Calls Claude (`claude-sonnet-4-6`, `ANTHROPIC_API_KEY`, same call pattern as `recommendation_service.py`) once per run and parses a structured JSON response:
  ```json
  { "groups": [
    { "card_ids": [123, 456], "action": "list" | "send_to_grading" | "hold",
      "listing_format": "FIXED_PRICE" | "AUCTION" | null,
      "auction_duration": "DAYS_7" | null,
      "suggested_price": 45.00,
      "reasoning": "..." }
  ]}
  ```
  A `"list"` group with 1 card is an individual listing; 2+ cards is a lot — same auto-detection `ebay_sell_service.create_draft` already applies by card count. Server-side validation: drop groups referencing card ids outside the requested cohort, drop groups with an unrecognized `action`, drop empty groups. Overlapping card ids across groups are not specially prevented — a duplicate execute attempt will simply fail at `ebay_sell_service` with its existing "already listed" guard.

  **Agentic tool loop:** the Claude call passes `tools=[...]` and runs a real multi-turn loop (send prompt → if the response contains `tool_use` blocks, execute them and send back `tool_result`s → repeat) instead of a single request/response. Two tools are exposed:
  - `get_live_active_listings(card_id)` — wraps the existing cache-aware `_get_or_fetch_listings` helper in `backend/routers/values.py` (not `force`, so it's free/instant if the 7-day cache is still fresh and only hits the real eBay Browse API when missing/stale — identical caching behavior to every other read path in the app). Lets Claude pull current asking-price data for a specific card it's uncertain about instead of working off "no cached listings" in the prompt.
  - `refresh_sold_prices(card_id)` — wraps the existing `fetch_price` in `backend/services/price_service.py`, which already no-ops if that card was priced within the last 24 hours. Lets Claude get fresher sold comps for a specific card before recommending a price.

  A hard cap of **`STRATEGY_MAX_TOOL_CALLS = 15`** tool calls per analysis run (new `config.py` constant) bounds latency/eBay load/cost — once hit, no further tool calls are honored and Claude is asked to finalize with whatever data it has. The system prompt tells Claude these tools exist, what they cost (a live eBay call, not instant), and to use them selectively — e.g. cards with no cached data, wide/uncertain price ranges, or cards it's about to bundle into an expensive lot — not for every card in the cohort by default.
- `backend/routers/strategy.py` (new): `POST /api/strategy/analyze { card_ids: [...] }` runs the above and returns the groups. Nothing is persisted to the DB — each run is ephemeral, regenerate anytime.
- `backend/config.py`: add `STRATEGY_MAX_CARDS = 50` — the cohort size cap per analysis run, to bound prompt size/cost. The endpoint returns 400 if `card_ids` exceeds this. Also add `STRATEGY_MAX_TOOL_CALLS = 15` — the tool-call cap for the agentic loop described below.
- **Execution reuses existing endpoints as-is — no new write paths:**
  - `"list"` groups → `POST /api/ebay/listings/draft` with `card_ids`, `price = suggested_price`, `listing_format`, `auction_duration` (default `DAYS_7`), title/description left `None` so the existing auto-builder generates them, `image_urls = [EBAY_PLACEHOLDER_IMAGE_URL]` if configured in Settings — if not configured, that group's execute call fails with a clear "set a placeholder image URL in Settings first" message (consistent with existing eBay listing behavior) rather than silently omitting the image.
  - `"send_to_grading"` groups → for each card id: `PATCH /api/cards/{id}/watchlist` (only if not already on the watchlist) then `POST /api/grading/{id}/generate` with default `{"grading_service": "PSA Standard"}`.
  - `"hold"` groups → no execution; informational only.

### Frontend
- `frontend/src/pages/Strategy.jsx` (new): filter UI mirroring `Collection.jsx`'s cascading Sport → Set → Type/Parallel/Player/Team filter logic, with a multi-select card list below it (same interaction pattern as Collection's existing Select mode). A "Generate Strategy" button (disabled with a message if selection exceeds `STRATEGY_MAX_CARDS`) posts to `/api/strategy/analyze` and renders the returned groups as review cards: cards included, action, suggested price/format, reasoning. Each actionable group (`list` / `send_to_grading`) has a checkbox; `hold` groups render as info-only with no checkbox. One "Execute Selected" button iterates the checked groups, calling the matching endpoint per group, and reports per-group success/failure inline (a failure in one group doesn't block the others).
- `frontend/src/components/NavBar.jsx`: add a 7th tab — "Strategy" (🎯), route `/strategy`.
- `frontend/src/api/client.js`: add `analyzeStrategy(card_ids)` calling the new endpoint.
- Router registration for `/strategy` alongside the existing page routes (wherever the app's route table lives, e.g. `App.jsx`).

## Key files
- `backend/services/strategy_service.py` — new: prompt building, Claude call, response parsing/validation
- `backend/routers/strategy.py` — new: `POST /api/strategy/analyze`
- `backend/config.py` — add `STRATEGY_MAX_CARDS`, `STRATEGY_MAX_TOOL_CALLS`
- `backend/routers/values.py` — no changes, but `_get_or_fetch_listings` is reused as-is by the new `get_live_active_listings` tool
- `backend/services/price_service.py` — no changes, but `fetch_price` is reused as-is by the new `refresh_sold_prices` tool
- `backend/main.py` — register the new router
- `frontend/src/pages/Strategy.jsx` — new: cohort filter/select + recommendation review UI
- `frontend/src/components/NavBar.jsx` — add Strategy tab
- `frontend/src/api/client.js` — add `analyzeStrategy`

## Non-goals
- No Gemini integration — Claude only.
- No Whatnot integration in this flow — Whatnot's CSV export stays a separate, manual, per-card action; the AI does not recommend or execute against it.
- No fully-automatic execution — every action requires the user to check it and click Execute; nothing fires without explicit per-group confirmation.
- No persistence of past strategy runs and no scheduled/background runs — on-demand, one session at a time; reloading the page loses the last analysis.
- No natural-language card search/segments — cohort selection reuses the existing structured Sport/Set/Type/Parallel/Player/Team filters.
- No multi-agent pipeline (separate pricing/grading/bundling agents) — this is still one Claude conversation per analysis run (now with tool calls inside it, see above), not a fleet of specialized agents. Overkill for a ≤50-card cohort.
- No autonomous execution by the agent — the tool loop is read-only (live listing lookups, sold-price refresh); it cannot create eBay listings or touch the grading watchlist. Execution still requires the user to check a group and click Execute, same as before.

## Decisions & rationale
- **Ephemeral, no persistence table:** considered a `selling_strategy_runs` table for history, but the user's stated workflow ("review individually and then click which ones I want executed") is a single-sitting review, so persistence was cut to keep the feature surgical; can be added later if needed.
- **Grouping via card count, not a separate `list_individual`/`list_lot` action:** matches `ebay_sell_service.create_draft`'s existing `is_lot = len(cards) > 1` auto-detection, avoiding a parallel classification that could disagree with it.
- **Grading ROI computed inline, not by pre-marking cards on the watchlist:** so the LLM gets ROI signal for every card in the cohort (not just already-watchlisted ones) without side effects until the user actually executes a `send_to_grading` group.
- **50-card cap per run:** default engineering choice to bound Claude prompt size/cost on a 955-card collection; not raised with the user as a separate question since it's a reasonable technical default and cohorts (by player/team/insert type) are expected to be well under this in practice.
- **Agentic tool loop added post-launch (this session), scoped to read-only market-data tools:** the user asked whether "agents" could be used here. Considered and rejected: (a) a multi-agent pipeline (pricing/grading/bundling as separate agents) — too much added cost/complexity for a bounded per-card decision task; (b) letting the agent execute recommendations itself — rejected because eBay listings and grading watchlist changes are real, hard-to-reverse actions with a real human's money on the line, so execution stays a manual, per-group click. What shipped instead: give the single analysis call two tools (`get_live_active_listings`, `refresh_sold_prices`) so Claude can pull fresher data for specific cards it's uncertain about, capped at `STRATEGY_MAX_TOOL_CALLS = 15` per run (user-confirmed) to bound eBay load/latency/cost.
