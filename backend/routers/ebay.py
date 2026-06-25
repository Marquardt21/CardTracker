from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import EbayDraftListing, EbayToken
from backend.services import ebay_sell_service

router = APIRouter(prefix="/api/ebay", tags=["ebay"])

AUCTION_DURATIONS = {"DAYS_1", "DAYS_3", "DAYS_5", "DAYS_7", "DAYS_10"}

_SUCCESS_HTML = """
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>CardTracker – eBay Connected</title>
<style>body{font-family:sans-serif;background:#0D1B2A;color:#fff;display:flex;
align-items:center;justify-content:center;height:100vh;margin:0}
.box{text-align:center;padding:2rem}h2{color:#4ade80}p{color:#94A3B8}
a{color:#A8DADC}</style></head>
<body><div class="box">
  <h2>eBay Connected!</h2>
  <p>Your eBay account is now linked to CardTracker.</p>
  <a href="/">Back to CardTracker</a>
</div></body></html>
"""

_FAIL_HTML_TMPL = (
    "<!DOCTYPE html><html>"
    "<head><meta charset='utf-8'><title>CardTracker – eBay Error</title>"
    "<style>body{font-family:sans-serif;background:#0D1B2A;color:#fff;"
    "display:flex;align-items:center;justify-content:center;height:100vh;margin:0}"
    ".box{text-align:center;padding:2rem}p{color:#94A3B8}a{color:#A8DADC}</style></head>"
    "<body><div class='box'><h2>Connection Failed</h2><p>DETAIL_PLACEHOLDER</p>"
    "<a href='/'>Back to CardTracker</a></div></body></html>"
)


class DraftRequest(BaseModel):
    card_ids:       list[int]
    price:          float
    title:          str | None = None
    description:    str | None = None
    image_urls:     list[str] = []
    listing_format: str = "FIXED_PRICE"  # FIXED_PRICE | AUCTION (price = starting bid)
    auction_duration: str = "DAYS_7"     # one of AUCTION_DURATIONS, used when AUCTION


class CodeRequest(BaseModel):
    code: str


class UserTokenRequest(BaseModel):
    token: str


@router.get("/auth/status")
def auth_status(db: Session = Depends(get_db)):
    token = db.query(EbayToken).first()
    if not token:
        return {"connected": False}
    connected = datetime.utcnow() < token.refresh_expires_at
    return {"connected": connected}


@router.get("/auth/start")
def auth_start():
    return {"url": ebay_sell_service.get_auth_url()}


@router.get("/auth/callback", response_class=HTMLResponse)
def auth_callback(
    code:              str | None = None,
    error:             str | None = None,
    error_description: str | None = None,
    db: Session = Depends(get_db),
):
    if error or not code:
        detail = error_description or "Authorization was declined or failed."
        return HTMLResponse(_FAIL_HTML_TMPL.replace("DETAIL_PLACEHOLDER", detail))
    try:
        ebay_sell_service.exchange_code(code, db)
    except Exception as exc:
        return HTMLResponse(_FAIL_HTML_TMPL.replace("DETAIL_PLACEHOLDER", str(exc)[:200]))
    return HTMLResponse(_SUCCESS_HTML)


@router.post("/auth/code")
def submit_code(req: CodeRequest, db: Session = Depends(get_db)):
    """Exchange a manually-pasted authorization code for tokens."""
    code = req.code.strip()
    if not code:
        raise HTTPException(status_code=400, detail="Code is required")
    try:
        ebay_sell_service.exchange_code(code, db)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"connected": True}


@router.post("/auth/user-token")
def store_user_token(req: UserTokenRequest, db: Session = Depends(get_db)):
    """Store a User Token pasted directly from developer.ebay.com."""
    token_str = req.token.strip()
    if not token_str:
        raise HTTPException(status_code=400, detail="Token is required")
    try:
        ebay_sell_service.store_user_token(token_str, db)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return {"connected": True}


@router.delete("/auth/token")
def disconnect(db: Session = Depends(get_db)):
    """Remove stored eBay credentials."""
    token = db.query(EbayToken).first()
    if token:
        db.delete(token)
        db.commit()
    return {"connected": False}


@router.post("/listings/draft")
def create_draft(req: DraftRequest, db: Session = Depends(get_db)):
    if not req.card_ids:
        raise HTTPException(status_code=400, detail="No cards selected")
    if req.price <= 0:
        raise HTTPException(status_code=400, detail="Price must be greater than 0")
    if req.listing_format not in ("FIXED_PRICE", "AUCTION"):
        raise HTTPException(status_code=400, detail="Invalid listing format")
    if req.listing_format == "AUCTION" and req.auction_duration not in AUCTION_DURATIONS:
        raise HTTPException(status_code=400, detail="Invalid auction duration")
    try:
        return ebay_sell_service.create_draft(
            db, req.card_ids, req.price, req.title, req.description, req.image_urls,
            listing_format=req.listing_format,
            auction_duration=req.auction_duration,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/listings")
def get_drafts(db: Session = Depends(get_db)):
    drafts = (
        db.query(EbayDraftListing)
        .order_by(EbayDraftListing.created_at.desc())
        .all()
    )
    return [
        {
            "id":             d.id,
            "title":          d.title,
            "price":          d.price,
            "status":         d.status,
            "ebay_draft_url": d.ebay_draft_url,
            "created_at":     d.created_at.isoformat(),
            "card_count":     len(d.cards),
            "card_ids":       [dlc.card_id for dlc in d.cards],
        }
        for d in drafts
    ]
