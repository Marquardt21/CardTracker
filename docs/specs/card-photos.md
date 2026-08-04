# Card Photos

Capture a front and a back photo of each card in the app, list with them on
eBay, and delete them two weeks after the card sells.

## Why this exists

Listings were going up against `EBAY_PLACEHOLDER_IMAGE_URL` or a manually pasted
Imgur link, and real photos had to be added afterwards in the eBay app. This
closes that loop: shoot the card on the iPad, and the listing publishes with the
real pictures.

## What it does

- Each card carries at most two photos, one per side. **Front is always the
  primary image** — the collection thumbnail, the card detail hero, and the first
  picture on the eBay listing.
- Photos are captured from the iPad's rear camera, or picked from the library.
- Listing a card uploads its photos to eBay and uses them as the listing images.
- Once a card has been sold for `CARD_PHOTO_RETENTION_DAYS` (14), its photos are
  deleted from disk and from the database.

## Capture

`CardPhotoCapture.jsx` renders two tiles, Front and Back. Each is a file input
with `capture="environment"`, which opens the rear camera directly on iPad
Safari and otherwise falls back to the photo library.

This is deliberately **not** `getUserMedia`. A live in-page camera with an
alignment overlay would be nicer, but `getUserMedia` requires a secure context
and the app is served over plain `http://` on the home network — it would simply
not work on the iPad as things stand.

The component appears in two places:

- **Card Detail**, replacing the old single-photo block.
- **Add Card**, in the "Card saved!" panel — the card has an id at that point, so
  you can photograph it and list it without leaving the page.

Retaking a side replaces the file, deletes the old one, and clears the cached
eBay URL (which now points at a picture of something else).

## Storage

`card_photos` — one row per card per side.

| Column | Notes |
|---|---|
| `card_id`, `side` | Unique together. `side` is `front` or `back`. |
| `filename` | **Bare filename**, relative to `photos/`. Never an absolute path. |
| `captured_at` | When it was taken. |
| `ebay_image_url` | Cached eBay Picture Services URL, once uploaded. |
| `ebay_image_expires_at` | When that URL stops being reusable. |

`filename` is a bare name on purpose. The same `cards.db` gets opened on the
Ubuntu box and on the Windows desktop, and an absolute path written on one is
meaningless on the other. `photo_service.resolve()` is the only place a filename
becomes a real path.

`cards.photo_path` still exists and still holds the front photo, so the
collection thumbnail and anything else reading it keeps working. It stores a
bare filename now too; the startup migration rewrites old absolute paths and
adopts any existing photo as that card's front.

Files live in `photos/`, which is gitignored — card photos never enter git.

## Getting photos onto eBay

The Sell Inventory API only accepts `imageUrls`, i.e. public HTTPS links. A file
sitting in `photos/` on a machine behind home WiFi has no such URL, and exposing
this backend to the internet to give it one would publish an app that has no
authentication.

So `ebay_media_service` uses the **Media API**, which takes the file bytes and
returns an eBay-hosted URL — the same thing the eBay app does when you upload
from your phone:

```
photo file ──▶ POST /image/create_image_from_file ──▶ image_id
                                                      │
                          GET /image/{image_id} ──────┴──▶ https://i.ebayimg.com/…
```

Notes:

- This replaces the Trading API's `UploadSiteHostedPictures`, which eBay
  **decommissions on 2026-09-30**. Do not go back to it.
- The scope required is `sell.inventory`, which the app already requests — an
  already-connected eBay account needs no re-consent.
- Resulting URLs are cached on the row and reused until they near expiry.
- Base URL and limits are in `config.py` (`EBAY_MEDIA_BASE`, `EBAY_MAX_IMAGES`).

### Which pictures a listing gets

`_resolve_image_urls` in `ebay_sell_service.py`, highest priority first:

1. A URL typed into the listing modal — an explicit override always wins.
2. The cards' own photos, uploaded to eBay. Every card's **front first**, then
   the backs, so a lot listing leads with a row of card fronts.
3. `EBAY_PLACEHOLDER_IMAGE_URL`, for cards that were never photographed.

If a card has photos but the upload fails, the listing **fails** rather than
falling through to the placeholder. Publishing a real card under a placeholder
picture is a bad listing, not a degraded one.

The image count is capped at `EBAY_MAX_IMAGES` (24). Because fronts are ordered
first, hitting the cap drops backs before it drops any front.

## Retention

Photos exist to make a listing. Once the card has been sold for
`CARD_PHOTO_RETENTION_DAYS` (14, overridable in `.env`), the files and rows go.
eBay keeps its own copy of anything that reached a listing, so purging never
blanks a live listing.

- Runs **once at startup** and then every `CARD_PHOTO_PURGE_INTERVAL_HOURS` (12).
  Startup matters because the machine is often off for days — a timer-only purge
  would keep missing its window.
- A card flagged sold with **no `sold_date` is never purged**. Without a date
  there is no way to know the window has passed, and keeping a photo too long is
  the recoverable mistake.
- `GET /api/photos/status` reports what's stored and what's due.
  `POST /api/photos/purge?dry_run=true` shows what a purge would take.
- Set `CARD_PHOTO_RETENTION_DAYS=0` to disable it entirely.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/cards/{id}/photos` | Both sides, front first |
| `POST` | `/api/cards/{id}/photos/{side}` | Capture or retake (multipart, field `photo`) |
| `DELETE` | `/api/cards/{id}/photos/{side}` | Remove one side |
| `GET` | `/api/photos/status` | Stored count, pending purge, retention window |
| `POST` | `/api/photos/purge` | Run the purge now (`?dry_run=true` to preview) |

`POST /api/cards/{id}/photo` (the old single-photo upload) still works and
stores its image as the front.

Uploads are rejected above 12 MB (eBay's per-image ceiling) and for formats
outside `CARD_PHOTO_SUFFIXES`. iPad Safari posts camera captures as JPEG and
library picks sometimes as HEIC, occasionally as a blob with no filename — in
that last case the content type decides the extension.

## Non-goals

- **No image processing.** Photos are stored as received: no downscaling, no
  HEIC→JPEG conversion, no cropping or auto-rotation. That would mean Pillow
  plus `pillow-heif`, and eBay accepts HEIC directly.
- **No more than two photos per card.** Front and back is what a raw single
  needs. eBay allows 24, which the lot path uses across cards.
- **No photo backup.** These are deliberately short-lived.
