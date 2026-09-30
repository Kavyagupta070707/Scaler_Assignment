from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .config import FRONTEND_ORIGINS
from .database import Base, SessionLocal, engine, get_db
from .models import Meeting, MeetingEvent, MeetingParticipant, MeetingStatus, MeetingType
from .realtime import Client, hub
from .schemas import JoinRequest, JoinResponse, MeetingCreate, MeetingLists, MeetingOut, MeetingUpdate
from .services import create_meeting, meeting_payload, normalized_id, seed_database


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_database(db)
    yield


app = FastAPI(title="Zoomly API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def find_meeting(db: Session, identifier: str) -> Meeting:
    clean_id = normalized_id(identifier)
    meeting = db.scalar(select(Meeting).where(or_(Meeting.meeting_id == clean_id, Meeting.invite_token == identifier)))
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/meetings", response_model=MeetingLists)
def list_meetings(db: Session = Depends(get_db)) -> dict:
    now = datetime.now(timezone.utc)
    meetings = list(db.scalars(select(Meeting).order_by(Meeting.scheduled_at.asc())).all())
    upcoming, recent = [], []
    for meeting in meetings:
        payload = meeting_payload(meeting)
        scheduled = meeting.scheduled_at
        if scheduled.tzinfo is None:
            scheduled = scheduled.replace(tzinfo=timezone.utc)
        if meeting.status in {MeetingStatus.LIVE, MeetingStatus.SCHEDULED} and (scheduled >= now or meeting.status == MeetingStatus.LIVE):
            upcoming.append(payload)
        else:
            recent.append(payload)
    return {"upcoming": upcoming, "recent": list(reversed(recent))[:10]}


@app.post("/api/meetings/instant", response_model=MeetingOut, status_code=201)
def instant_meeting(db: Session = Depends(get_db)) -> dict:
    meeting = create_meeting(db, title="Kavya's Zoom Meeting", meeting_type=MeetingType.INSTANT, scheduled_at=datetime.now(timezone.utc))
    return meeting_payload(meeting)


@app.post("/api/meetings/scheduled", response_model=MeetingOut, status_code=201)
def scheduled_meeting(data: MeetingCreate, db: Session = Depends(get_db)) -> dict:
    meeting = create_meeting(db, meeting_type=MeetingType.SCHEDULED, **data.model_dump())
    return meeting_payload(meeting)


@app.get("/api/meetings/{identifier}", response_model=MeetingOut)
def get_meeting(identifier: str, db: Session = Depends(get_db)) -> dict:
    meeting = find_meeting(db, identifier)
    if meeting.status == MeetingStatus.CANCELLED:
        raise HTTPException(status_code=410, detail="This meeting was cancelled")
    return meeting_payload(meeting, include_host_token=False)


@app.patch("/api/meetings/{identifier}", response_model=MeetingOut)
def update_meeting(identifier: str, data: MeetingUpdate, db: Session = Depends(get_db)) -> dict:
    meeting = find_meeting(db, identifier)
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(meeting, key, value)
    db.commit()
    db.refresh(meeting)
    return meeting_payload(meeting)


@app.delete("/api/meetings/{identifier}", status_code=204)
def cancel_meeting(identifier: str, db: Session = Depends(get_db)) -> None:
    meeting = find_meeting(db, identifier)
    meeting.status = MeetingStatus.CANCELLED
    db.add(MeetingEvent(meeting_pk=meeting.id, event_type="cancelled"))
    db.commit()


@app.post("/api/meetings/{identifier}/join", response_model=JoinResponse)
def join_meeting(identifier: str, data: JoinRequest, db: Session = Depends(get_db)) -> dict:
    meeting = find_meeting(db, identifier)
    if meeting.status in {MeetingStatus.ENDED, MeetingStatus.CANCELLED}:
        raise HTTPException(status_code=410, detail="This meeting has ended")
    role = "host" if data.host_token and data.host_token == meeting.host_token else "guest"
    participant = MeetingParticipant(meeting_pk=meeting.id, display_name=data.display_name.strip(), role=role)
    if meeting.status == MeetingStatus.SCHEDULED:
        meeting.status = MeetingStatus.LIVE
    db.add(participant)
    db.flush()
    db.add(MeetingEvent(meeting_pk=meeting.id, event_type="joined", participant_id=participant.id))
    db.commit()
    return {"participant_id": participant.id, "role": role, "meeting": meeting_payload(meeting, include_host_token=False)}


@app.post("/api/meetings/{identifier}/end", status_code=204)
async def end_meeting(identifier: str, host_token: str, db: Session = Depends(get_db)) -> None:
    meeting = find_meeting(db, identifier)
    if host_token != meeting.host_token:
        raise HTTPException(status_code=403, detail="Only the host can end this meeting")
    meeting.status = MeetingStatus.ENDED
    meeting.ended_at = datetime.now(timezone.utc)
    db.add(MeetingEvent(meeting_pk=meeting.id, event_type="ended"))
    db.commit()
    await hub.broadcast(meeting.meeting_id, {"type": "meeting-ended"})


@app.websocket("/ws/meetings/{meeting_id}")
async def meeting_socket(websocket: WebSocket, meeting_id: str, participant_id: str = Query(...)):
    with SessionLocal() as db:
        meeting = db.scalar(select(Meeting).where(Meeting.meeting_id == normalized_id(meeting_id)))
        participant = db.get(MeetingParticipant, participant_id)
        if not meeting or not participant or participant.meeting_pk != meeting.id:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        name, role = participant.display_name, participant.role

    await websocket.accept()
    client = Client(websocket=websocket, participant_id=participant_id, name=name, role=role)
    existing = await hub.connect(meeting.meeting_id, client)
    await websocket.send_json({"type": "room-state", "participants": existing})
    try:
        while True:
            message = await websocket.receive_json()
            message_type = message.get("type")
            if message_type == "signal" and message.get("target"):
                await hub.send_to(meeting.meeting_id, message["target"], {"type": "signal", "from": participant_id, "data": message.get("data")})
            elif message_type == "media-state":
                client.muted = bool(message.get("muted"))
                client.video_off = bool(message.get("videoOff"))
                await hub.broadcast(meeting.meeting_id, {"type": "media-state", "participant": hub.public(client)}, exclude=participant_id)
            elif message_type == "remove" and role == "host" and message.get("target"):
                await hub.send_to(meeting.meeting_id, message["target"], {"type": "removed"})
            elif message_type == "mute-all" and role == "host":
                await hub.broadcast(meeting.meeting_id, {"type": "mute-request"}, exclude=participant_id)
    except WebSocketDisconnect:
        with SessionLocal() as db:
            record = db.get(MeetingParticipant, participant_id)
            if record:
                record.left_at = datetime.now(timezone.utc)
                db.add(MeetingEvent(meeting_pk=record.meeting_pk, event_type="left", participant_id=participant_id))
                db.commit()
        await hub.disconnect(meeting.meeting_id, participant_id)

