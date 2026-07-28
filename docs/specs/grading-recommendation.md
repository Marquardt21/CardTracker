# Grading Recommendation Engine

**Status:** Implemented
**Date:** 2026-07-28 (retroactive)

## Summary
A simple ROI calculator (not an ML model) that estimates whether a watchlisted card is worth sending to PSA/BGS: `estimated graded value = latest raw price × card-type multiplier`, minus a configurable grading cost, verdict from configurable ROI thresholds.

## Scope / What it does
- Toggle any card onto a "Grading Watchlist" (`PATCH /api/cards/{id}/watchlist`) from Collection or Card Detail
- `POST /api/grading/{id}/generate` (body picks a grading service — e.g. "PSA Standard") computes:
  - `multiplier = GRADING_MULTIPLIERS[card.card_type]` (rookie 2.5, autograph 1.8, patch_relic 2.0, parallel 1.5, base 1.3 — `config.py`)
  - `estimated_graded = latest_sold_value × multiplier`
  - `roi = estimated_graded − latest_sold_value − GRADING_COSTS[grading_service]`
  - Verdict: `roi > GRADING_ROI_WORTH_IT (20)` → "Worth It"; `>= GRADING_ROI_BORDERLINE (5)` → "Borderline"; else "Not Worth It"
  - Returns 400 if the card has no price data yet (nothing to base the estimate on)
- Regenerating replaces the card's previous `GradingRecommendation` row rather than accumulating history
- `GET /api/grading` lists the full watchlist with each card's latest recommendation (or none)
- Dashboard surfaces watchlist cards whose latest verdict is "Worth It" (see [dashboard.md](dashboard.md))

## Key files
- `backend/services/grading_service.py` — ROI math, verdict thresholds
- `backend/routers/grading.py` — watchlist list + generate endpoint
- `backend/config.py` — `GRADING_COSTS`, `GRADING_MULTIPLIERS`, `GRADING_ROI_WORTH_IT`, `GRADING_ROI_BORDERLINE`
- `backend/models.py` — `GradingRecommendation`

## Non-goals
- This is a heuristic multiplier model, not a prediction based on comparable graded sales — there's a *separate* AI price-recommendation feature (`recommendation_service.py`, Anthropic Claude, `POST /api/cards/{id}/price-recommendation`) that reasons over actual sold comps for a raw selling-price suggestion; the two are not the same feature and aren't currently combined
