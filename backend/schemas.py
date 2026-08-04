from datetime import datetime
from typing import Literal
from pydantic import BaseModel

CardType = Literal["base", "rookie", "parallel", "autograph", "patch_relic"]
Condition = Literal["poor", "good", "very_good", "excellent", "near_mint", "mint"]
Sport = Literal["Hockey", "Baseball", "Football"]


class CardBase(BaseModel):
    brand: str
    year: int
    set_name: str
    card_number: str
    player_name: str
    team: str | None = None
    position: str | None = None
    card_type: CardType = "base"
    sport: Sport = "Hockey"
    parallel_color: str | None = None
    print_run: int | None = None
    condition: Condition = "near_mint"
    pack_label: str | None = None
    notes: str | None = None
    grading_watchlist: bool = False
    sold_date: datetime | None = None
    sold_price: float | None = None
    sold_listing_url: str | None = None
    is_selling: bool = False
    listed_price: float | None = None
    listing_date: datetime | None = None
    listing_url: str | None = None
    is_sold: bool = False


class CardCreate(CardBase):
    pass


class CardUpdate(BaseModel):
    brand: str | None = None
    year: int | None = None
    set_name: str | None = None
    card_number: str | None = None
    player_name: str | None = None
    team: str | None = None
    position: str | None = None
    card_type: CardType | None = None
    sport: Sport | None = None
    parallel_color: str | None = None
    print_run: int | None = None
    condition: Condition | None = None
    pack_label: str | None = None
    notes: str | None = None
    grading_watchlist: bool | None = None
    sold_date: datetime | None = None
    sold_price: float | None = None
    sold_listing_url: str | None = None


class CardPhotoOut(BaseModel):
    """One side's photo. `url` is served by the /photos mount, so the frontend
    never has to know where on disk the file lives."""
    side: str
    url: str
    captured_at: datetime
    uploaded_to_ebay: bool = False


class CardOut(CardBase):
    id: int
    date_added: datetime
    # Filename of the front photo, relative to the /photos mount. Kept for the
    # collection thumbnail; /cards/{id}/photos is the full front+back view.
    photo_path: str | None = None
    checklist_matched: bool = False
    model_config = {"from_attributes": True}


class CardValueOut(BaseModel):
    id: int
    card_id: int
    source: str
    price: float
    fetched_at: datetime
    model_config = {"from_attributes": True}


class ActiveListingOut(BaseModel):
    title: str
    price: float
    url: str | None = None
    condition: str | None = None
    image_url: str | None = None


class ListingSummaryOut(BaseModel):
    card_id: int
    low: float | None = None
    high: float | None = None
    count: int = 0
    listings: list[ActiveListingOut] = []
    fetched_at: datetime
    stale: bool = False


# Autocomplete suggestion returned from /api/autocomplete
class AutocompleteSuggestion(BaseModel):
    set_checklist_card_id: int
    card_number: str
    player_name: str
    set_name: str
    brand: str
    year: int
    card_type: str
    parallel_color: str | None = None
    print_run: int | None = None
    team: str | None = None


# Variant options for a specific card number within a set
class CardVariantOut(BaseModel):
    id: int
    card_number: str
    player_name: str
    team: str | None = None
    card_type: str
    parallel_color: str | None = None
    print_run: int | None = None
    is_serialed: bool = False
    has_auto: bool = False
    is_rookie: bool = False
    model_config = {"from_attributes": True}


# Set checklist schemas
class SetChecklistCardOut(BaseModel):
    id: int
    card_number: str
    player_name: str
    team: str | None = None
    card_type: str
    parallel_color: str | None = None
    print_run: int | None = None
    is_serialed: bool = False
    has_auto: bool = False
    is_rookie: bool = False
    owned: bool
    collection_card_id: int | None = None
    model_config = {"from_attributes": True}


class SetChecklistOut(BaseModel):
    id: int
    set_name: str
    brand: str
    year: int
    sport: Sport = "Hockey"
    total_cards: int
    source_url: str | None = None
    imported_at: datetime
    owned_count: int = 0
    model_config = {"from_attributes": True}


class SetChecklistDetail(SetChecklistOut):
    cards: list[SetChecklistCardOut] = []


class SetImportPreview(BaseModel):
    set_name: str
    brand: str
    year: int
    sport: Sport = "Hockey"
    card_count: int
    source_url: str


class ReconciliationResult(BaseModel):
    newly_matched: int
    still_unmatched: int
    unmatched_cards: list[CardOut] = []


class SetImportResult(BaseModel):
    set_id: int
    set_name: str
    brand: str
    year: int
    sport: Sport = "Hockey"
    card_count: int
    reconciliation: ReconciliationResult


class ImportUrlRequest(BaseModel):
    """URL plus optional corrections made on the preview screen."""
    url: str
    set_name: str | None = None
    brand: str | None = None
    year: int | None = None
    sport: Sport | None = None


class PreviewUrlRequest(BaseModel):
    url: str


# Grading
class GradingRecommendationOut(BaseModel):
    id: int
    card_id: int
    estimated_graded_value: float
    grading_cost_estimate: float
    roi_estimate: float
    verdict: str
    recommendation: str
    generated_at: datetime
    model_config = {"from_attributes": True}


class GradingRequest(BaseModel):
    grading_service: str = "PSA Standard"


# Dashboard
class DashboardOut(BaseModel):
    total_cards: int
    total_value: float
    value_change_30d: float
    top_cards: list[CardOut]
    watchlist_worth_it: list[CardOut]
    set_completion: list[dict]
    price_spikes: list[dict]


# Selling
class SellingUpdate(BaseModel):
    """All selling fields sent together so nulls can clear existing values."""
    is_selling: bool = False
    listed_price: float | None = None
    listing_date: datetime | None = None
    listing_url: str | None = None
    is_sold: bool = False
    sold_price: float | None = None
    sold_date: datetime | None = None


class SellingGroupOut(BaseModel):
    """A listed/sold unit on the selling page: a single card or a multi-card lot."""
    kind: str               # "listing" (eBay lot/single) or "card" (manual, no listing)
    ref_id: int             # listing id when kind == "listing", else card id
    title: str
    is_lot: bool
    price: float | None     # listing price (lots) or card listed_price
    url: str | None
    listing_date: datetime | None = None
    sold_price: float | None = None
    sold_date: datetime | None = None
    cards: list[CardOut]


class ListingSoldUpdate(BaseModel):
    sold_price: float | None = None
    sold_date: datetime | None = None


class SellingDashboardOut(BaseModel):
    listed_count: int
    sold_count: int
    listed_value: float
    sold_value: float
    listed_groups: list[SellingGroupOut]
    sold_groups: list[SellingGroupOut]


# Alerts
class AlertOut(BaseModel):
    card: CardOut
    old_price: float
    new_price: float
    pct_change: float
    spike_date: datetime
