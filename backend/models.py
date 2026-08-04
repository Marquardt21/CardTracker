from datetime import datetime
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.database import Base


class Card(Base):
    __tablename__ = "cards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    brand: Mapped[str] = mapped_column(String, nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    set_name: Mapped[str] = mapped_column(String, nullable=False)
    card_number: Mapped[str] = mapped_column(String, nullable=False)
    player_name: Mapped[str] = mapped_column(String, nullable=False)
    team: Mapped[str | None] = mapped_column(String, nullable=True)
    position: Mapped[str | None] = mapped_column(String, nullable=True)
    card_type: Mapped[str] = mapped_column(String, default="base")
    sport: Mapped[str] = mapped_column(String, default="Hockey")
    parallel_color: Mapped[str | None] = mapped_column(String, nullable=True)
    print_run: Mapped[int | None] = mapped_column(Integer, nullable=True)
    condition: Mapped[str] = mapped_column(String, default="near_mint")
    date_added: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    pack_label: Mapped[str | None] = mapped_column(String, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    photo_path: Mapped[str | None] = mapped_column(String, nullable=True)
    grading_watchlist: Mapped[bool] = mapped_column(Boolean, default=False)
    checklist_matched: Mapped[bool] = mapped_column(Boolean, default=False)
    sold_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    sold_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    sold_listing_url: Mapped[str | None] = mapped_column(String, nullable=True)
    is_selling: Mapped[bool] = mapped_column(Boolean, default=False)
    listed_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    listing_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    listing_url: Mapped[str | None] = mapped_column(String, nullable=True)
    is_sold: Mapped[bool] = mapped_column(Boolean, default=False)

    values: Mapped[list["CardValue"]] = relationship("CardValue", back_populates="card", cascade="all, delete-orphan")
    photos: Mapped[list["CardPhoto"]] = relationship(
        "CardPhoto", back_populates="card", cascade="all, delete-orphan"
    )
    grading_recommendations: Mapped[list["GradingRecommendation"]] = relationship(
        "GradingRecommendation", back_populates="card", cascade="all, delete-orphan"
    )


class CardPhoto(Base):
    """A captured photo of one side of a card.

    `filename` is a bare name relative to `PHOTOS_DIR`, never an absolute path —
    the DB is shared between the Windows and Linux machines, so an absolute path
    written on one is meaningless on the other.

    `ebay_image_url` caches the eBay Picture Services URL produced when the photo
    was uploaded for a listing. EPS images expire, so `ebay_image_expires_at`
    decides whether it can be reused or has to be re-uploaded.

    Rows are deleted (with their files) by the retention purge once the card has
    been sold for CARD_PHOTO_RETENTION_DAYS."""
    __tablename__ = "card_photos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    card_id: Mapped[int] = mapped_column(Integer, ForeignKey("cards.id"), nullable=False)
    side: Mapped[str] = mapped_column(String, nullable=False)  # "front" | "back"
    filename: Mapped[str] = mapped_column(String, nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    ebay_image_url: Mapped[str | None] = mapped_column(String, nullable=True)
    ebay_image_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    card: Mapped["Card"] = relationship("Card", back_populates="photos")

    # One photo per side per card — a retake replaces the existing row.
    __table_args__ = (Index("ix_card_photos_card_side", "card_id", "side", unique=True),)


class CardValue(Base):
    __tablename__ = "card_values"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    card_id: Mapped[int] = mapped_column(Integer, ForeignKey("cards.id"), nullable=False)
    source: Mapped[str] = mapped_column(String, nullable=False)
    price: Mapped[float] = mapped_column(Float, nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    card: Mapped["Card"] = relationship("Card", back_populates="values")


class ActiveListingCache(Base):
    """Cached summary of current eBay active (asking) listings for a card.

    Populated by the Collection price button; reused for ACTIVE_LISTING_TTL_DAYS
    so we don't re-hit the eBay Browse API on every view. `listings_json` holds
    the full listing array (for the expand-to-carousel view)."""
    __tablename__ = "active_listing_cache"

    card_id: Mapped[int] = mapped_column(Integer, ForeignKey("cards.id"), primary_key=True)
    low: Mapped[float | None] = mapped_column(Float, nullable=True)
    high: Mapped[float | None] = mapped_column(Float, nullable=True)
    count: Mapped[int] = mapped_column(Integer, default=0)
    listings_json: Mapped[str] = mapped_column(Text, default="[]")
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SetChecklist(Base):
    __tablename__ = "set_checklists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    set_name: Mapped[str] = mapped_column(String, nullable=False)
    brand: Mapped[str] = mapped_column(String, nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    sport: Mapped[str] = mapped_column(String, default="Hockey")
    total_cards: Mapped[int] = mapped_column(Integer, default=0)
    source_url: Mapped[str | None] = mapped_column(String, nullable=True)
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    cards: Mapped[list["SetChecklistCard"]] = relationship(
        "SetChecklistCard", back_populates="checklist", cascade="all, delete-orphan"
    )

    __table_args__ = (Index("ix_set_checklists_lookup", "brand", "year", "set_name"),)


class SetChecklistCard(Base):
    __tablename__ = "set_checklist_cards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    set_id: Mapped[int] = mapped_column(Integer, ForeignKey("set_checklists.id"), nullable=False)
    card_number: Mapped[str] = mapped_column(String, nullable=False)
    player_name: Mapped[str] = mapped_column(String, nullable=False)
    team: Mapped[str | None] = mapped_column(String, nullable=True)
    card_type: Mapped[str] = mapped_column(String, default="base")
    parallel_color: Mapped[str | None] = mapped_column(String, nullable=True)
    print_run: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_serialed: Mapped[bool] = mapped_column(Boolean, default=False)
    has_auto: Mapped[bool] = mapped_column(Boolean, default=False)
    is_rookie: Mapped[bool] = mapped_column(Boolean, default=False)
    owned: Mapped[bool] = mapped_column(Boolean, default=False)
    collection_card_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("cards.id"), nullable=True)

    checklist: Mapped["SetChecklist"] = relationship("SetChecklist", back_populates="cards")

    __table_args__ = (Index("ix_set_checklist_cards_lookup", "set_id", "card_number"),)


class EbayToken(Base):
    __tablename__ = "ebay_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    access_token: Mapped[str] = mapped_column(Text, nullable=False)
    refresh_token: Mapped[str] = mapped_column(Text, nullable=False)
    access_expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    refresh_expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class EbayDraftListing(Base):
    __tablename__ = "ebay_draft_listings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ebay_draft_id: Mapped[str | None] = mapped_column(String, nullable=True)
    ebay_draft_url: Mapped[str | None] = mapped_column(String, nullable=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    price: Mapped[float] = mapped_column(Float, nullable=False)
    listing_format: Mapped[str] = mapped_column(String, default="FIXED_PRICE")  # FIXED_PRICE | AUCTION
    status: Mapped[str] = mapped_column(String, default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    sold_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    sold_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    cards: Mapped[list["DraftListingCard"]] = relationship(
        "DraftListingCard", back_populates="listing", cascade="all, delete-orphan"
    )


class DraftListingCard(Base):
    __tablename__ = "draft_listing_cards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    draft_id: Mapped[int] = mapped_column(Integer, ForeignKey("ebay_draft_listings.id"), nullable=False)
    card_id: Mapped[int] = mapped_column(Integer, ForeignKey("cards.id"), nullable=False)

    listing: Mapped["EbayDraftListing"] = relationship("EbayDraftListing", back_populates="cards")
    card: Mapped["Card"] = relationship("Card")


class GradingRecommendation(Base):
    __tablename__ = "grading_recommendations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    card_id: Mapped[int] = mapped_column(Integer, ForeignKey("cards.id"), nullable=False)
    estimated_graded_value: Mapped[float] = mapped_column(Float, nullable=False)
    grading_cost_estimate: Mapped[float] = mapped_column(Float, nullable=False)
    roi_estimate: Mapped[float] = mapped_column(Float, nullable=False)
    verdict: Mapped[str] = mapped_column(String, nullable=False)
    recommendation: Mapped[str] = mapped_column(Text, nullable=False)
    generated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    card: Mapped["Card"] = relationship("Card", back_populates="grading_recommendations")
