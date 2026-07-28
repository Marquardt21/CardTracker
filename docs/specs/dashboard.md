# Dashboard

**Status:** Implemented
**Date:** 2026-07-28 (retroactive)

## Summary
A single `GET /api/dashboard` endpoint that rolls up collection-wide stats for the home screen: total value, recent value change, top cards, grading callouts, set-completion progress, and price-spike alerts.

## Scope / What it does
- `total_cards`, `total_value` (sum of each card's latest `CardValue`), `value_change_30d` (current total minus the total using each card's latest value *before* a 30-day-ago cutoff — 0 if no card has data that old)
- `top_cards`: top 5 cards by latest value, descending
- `watchlist_worth_it`: watchlisted cards whose most recent `GradingRecommendation.verdict == "Worth It"`
- `set_completion`: every imported set where owned ≥ 10% of `total_cards`, with owned/total/percent
- `price_spikes`: cards whose two most recent values show a jump ≥ `PRICE_SPIKE_THRESHOLD` (25%) — same computation as the dedicated Alerts endpoint, just not sorted or deduped the same way (see [alerts.md](alerts.md))

## Key files
- `backend/routers/dashboard.py` — the single aggregation endpoint
- `frontend/src/pages/Dashboard.jsx` — renders the sections above

## Non-goals
- No caching — every dashboard load recomputes from scratch over the full `Card`/`CardValue`/`SetChecklist` tables. Fine at current collection size; would need revisiting if the collection grows enough for this to be slow.
