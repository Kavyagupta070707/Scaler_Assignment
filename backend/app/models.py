import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class MeetingType(str, enum.Enum):
    INSTANT = "instant"
    SCHEDULED = "scheduled"


class MeetingStatus(str, enum.Enum):
    SCHEDULED = "scheduled"
    LIVE = "live"
    ENDED = "ended"
    CANCELLED = "cancelled"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    avatar_color: Mapped[str] = mapped_column(String(16), default="#7B5CFA")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    meetings: Mapped[list["Meeting"]] = relationship(back_populates="host")


class Meeting(Base):
    __tablename__ = "meetings"

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[str] = mapped_column(String(11), unique=True, index=True)
    invite_token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    host_token: Mapped[str] = mapped_column(String(64), unique=True)
    host_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(180))
    description: Mapped[str] = mapped_column(Text, default="")
    meeting_type: Mapped[MeetingType] = mapped_column(Enum(MeetingType))
    status: Mapped[MeetingStatus] = mapped_column(Enum(MeetingStatus), index=True)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=30)
    timezone_name: Mapped[str] = mapped_column(String(80), default="Asia/Kolkata")
    waiting_room: Mapped[bool] = mapped_column(Boolean, default=False)
    participants_video: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    host: Mapped[User] = relationship(back_populates="meetings")
    participants: Mapped[list["MeetingParticipant"]] = relationship(
        back_populates="meeting", cascade="all, delete-orphan"
    )
    events: Mapped[list["MeetingEvent"]] = relationship(
        back_populates="meeting", cascade="all, delete-orphan"
    )


class MeetingParticipant(Base):
    __tablename__ = "meeting_participants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    meeting_pk: Mapped[int] = mapped_column(ForeignKey("meetings.id"), index=True)
    display_name: Mapped[str] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(16), default="guest")
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    removed: Mapped[bool] = mapped_column(Boolean, default=False)
    meeting: Mapped[Meeting] = relationship(back_populates="participants")


class MeetingEvent(Base):
    __tablename__ = "meeting_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_pk: Mapped[int] = mapped_column(ForeignKey("meetings.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(32), index=True)
    participant_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    meeting: Mapped[Meeting] = relationship(back_populates="events")

