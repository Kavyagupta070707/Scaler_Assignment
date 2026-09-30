from datetime import datetime, timedelta, timezone

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .models import MeetingStatus, MeetingType


class MeetingCreate(BaseModel):
    title: str = Field(min_length=2, max_length=180)
    description: str = Field(default="", max_length=2000)
    scheduled_at: datetime
    duration_minutes: int = Field(default=30, ge=15, le=480)
    timezone_name: str = Field(default="Asia/Kolkata", max_length=80)
    waiting_room: bool = False
    participants_video: bool = True

    @field_validator("scheduled_at")
    @classmethod
    def scheduled_meeting_cannot_be_in_the_past(cls, value: datetime) -> datetime:
        comparable = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        if comparable < datetime.now(timezone.utc) - timedelta(minutes=1):
            raise ValueError("Scheduled time must be in the future")
        return value


class MeetingUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=180)
    description: str | None = Field(default=None, max_length=2000)
    scheduled_at: datetime | None = None
    duration_minutes: int | None = Field(default=None, ge=15, le=480)
    status: MeetingStatus | None = None


class MeetingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    meeting_id: str
    title: str
    description: str
    meeting_type: MeetingType
    status: MeetingStatus
    scheduled_at: datetime
    duration_minutes: int
    timezone_name: str
    waiting_room: bool
    participants_video: bool
    invite_url: str
    host_token: str | None = None


class MeetingLists(BaseModel):
    upcoming: list[MeetingOut]
    recent: list[MeetingOut]


class JoinRequest(BaseModel):
    display_name: str = Field(min_length=2, max_length=100)
    host_token: str | None = None


class JoinResponse(BaseModel):
    participant_id: str
    role: str
    meeting: MeetingOut
