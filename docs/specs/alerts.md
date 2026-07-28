# Alerts

**Status:** Implemented
**Date:** 2026-07-28 (retroactive)

## Summary
A dedicated page listing every card whose most recent price jumped sharply versus the one before it — the same spike detection the Dashboard summarizes, but as a full sorted list.

## Scope / What it does
- `GET /api/alerts`: for every card with ≥2 `CardValue` entries, compares the two most recent by `fetched_at`; if the percent increase is ≥ `PRICE_SPIKE_THRESHOLD` (default 0.25, `config.py`), it's included with old price, new price, percent change, and spike date
- Results sorted by percent change, descending (biggest spike first)
- Threshold is configurable in `config.py` (`PRICE_SPIKE_THRESHOLD`), also editable from Settings

## Key files
- `backend/routers/alerts.py` — spike detection + sort
- `backend/config.py` — `PRICE_SPIKE_THRESHOLD`
- `frontend/src/pages/Alerts.jsx` — list view

## Non-goals
- No push notifications yet — this is a pull-based page the user checks; push (iOS Shortcuts + webhook) is tracked as a future feature in the project's `CLAUDE.md`
