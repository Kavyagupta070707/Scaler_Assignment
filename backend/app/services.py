import secrets
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import PUBLIC_FRONTEND_URL
from .models import Meeting, MeetingEvent, MeetingParticipant, MeetingStatus, MeetingType, User


def normalized_id(value: str) -> str:
    return "".join(character for character in value if character.isdigit())


def generate_meeting_id(db: Session) -> str:
    while True:
        raw = "".join(str(secrets.randbelow(10)) for _ in range(11))
        if not db.scalar(select(Meeting).where(Meeting.meeting_id == raw)):
            return raw


def format_meeting_id(value: str) -> str:
    digits = normalized_id(value)
    return f"{digits[:3]} {digits[3:7]} {digits[7:]}"


def meeting_payload(meeting: Meeting, include_host_token: bool = True) -> dict:
    return {
        "meeting_id": meeting.meeting_id,
        "title": meeting.title,
        "description": meeting.description,
        "meeting_type": meeting.meeting_type,
        "status": meeting.status,
        "scheduled_at": meeting.scheduled_at,
        "duration_minutes": meeting.duration_minutes,
        "timezone_name": meeting.timezone_name,
        "waiting_room": meeting.waiting_room,
        "participants_video": meeting.participants_video,
        "invite_url": f"{PUBLIC_FRONTEND_URL}/join?meeting={meeting.invite_token}",
        "host_token": meeting.host_token if include_host_token else None,
    }


def get_default_user(db: Session) -> User:
    user = db.scalar(select(User).where(User.email == "kavya@example.com"))
    if user:
        return user
    user = User(name="Kavya Gupta", email="kavya@example.com")
    db.add(user)
    db.flush()
    return user


def create_meeting(
    db: Session,
    *,
    title: str,
    meeting_type: MeetingType,
    scheduled_at: datetime,
    description: str = "",
    duration_minutes: int = 30,
    timezone_name: str = "Asia/Kolkata",
    waiting_room: bool = False,
    participants_video: bool = True,
) -> Meeting:
    host = get_default_user(db)
    meeting = Meeting(
        meeting_id=generate_meeting_id(db),
        invite_token=secrets.token_urlsafe(18),
        host_token=secrets.token_urlsafe(24),
        host_id=host.id,
        title=title,
        description=description,
        meeting_type=meeting_type,
        status=MeetingStatus.LIVE if meeting_type == MeetingType.INSTANT else MeetingStatus.SCHEDULED,
        scheduled_at=scheduled_at,
        duration_minutes=duration_minutes,
        timezone_name=timezone_name,
        waiting_room=waiting_room,
        participants_video=participants_video,
    )
    db.add(meeting)
    db.flush()
    db.add(MeetingEvent(meeting_pk=meeting.id, event_type="created"))
    db.commit()
    db.refresh(meeting)
    return meeting


def seed_database(db: Session) -> None:
    if db.scalar(select(Meeting.id).limit(1)):
        return
    from datetime import timedelta

    now = datetime.now(timezone.utc)
    create_meeting(
        db,
        title="Product design sync",
        description="Weekly product and design alignment.",
        meeting_type=MeetingType.SCHEDULED,
        scheduled_at=now + timedelta(days=1, hours=2),
        duration_minutes=45,
    )
    past = create_meeting(
        db,
        title="Engineering stand-up",
        description="Sprint progress and blockers.",
        meeting_type=MeetingType.SCHEDULED,
        scheduled_at=now - timedelta(days=1),
        duration_minutes=30,
    )
    past.status = MeetingStatus.ENDED
    past.ended_at = now - timedelta(days=1, minutes=-30)
    db.commit()

