from dataclasses import dataclass

from fastapi import WebSocket


@dataclass
class Client:
    websocket: WebSocket
    participant_id: str
    name: str
    role: str
    muted: bool = False
    video_off: bool = False
    sharing: bool = False
    raised_hand: bool = False


class MeetingHub:
    """Ephemeral presence state; persistent meeting data remains in SQLite."""

    def __init__(self) -> None:
        self.rooms: dict[str, dict[str, Client]] = {}
        self.pending: dict[str, dict[str, Client]] = {}
        self.admitted_ids: dict[str, set[str]] = {}

    async def connect(self, meeting_id: str, client: Client) -> list[dict]:
        room = self.rooms.setdefault(meeting_id, {})
        existing = [self.public(item) for key, item in room.items() if key != client.participant_id]
        is_reconnect = client.participant_id in room
        room[client.participant_id] = client
        self.admitted_ids.setdefault(meeting_id, set()).add(client.participant_id)
        if not is_reconnect:
            await self.broadcast(
                meeting_id,
                {"type": "participant-joined", "participant": self.public(client)},
                exclude=client.participant_id,
            )
        return existing

    async def queue(self, meeting_id: str, client: Client) -> None:
        self.pending.setdefault(meeting_id, {})[client.participant_id] = client
        await client.websocket.send_json({"type": "waiting-room"})
        await self.broadcast_to_hosts(meeting_id, {"type": "waiting-participant", "participant": self.public(client)})

    def should_wait(self, meeting_id: str, participant_id: str, waiting_room: bool, role: str) -> bool:
        return waiting_room and role != "host" and participant_id not in self.admitted_ids.get(meeting_id, set())

    async def admit(self, meeting_id: str, participant_id: str) -> bool:
        client = self.pending.get(meeting_id, {}).pop(participant_id, None)
        if not client:
            return False
        existing = await self.connect(meeting_id, client)
        await client.websocket.send_json({"type": "admitted", "participants": existing})
        await self.broadcast_to_hosts(meeting_id, {"type": "waiting-participant-left", "participantId": participant_id})
        return True

    async def deny(self, meeting_id: str, participant_id: str) -> bool:
        client = self.pending.get(meeting_id, {}).pop(participant_id, None)
        if not client:
            return False
        await client.websocket.send_json({"type": "denied"})
        await self.broadcast_to_hosts(meeting_id, {"type": "waiting-participant-left", "participantId": participant_id})
        return True

    async def disconnect(self, meeting_id: str, participant_id: str, websocket: WebSocket) -> bool:
        room = self.rooms.get(meeting_id, {})
        current = room.get(participant_id)
        if current and current.websocket is websocket:
            room.pop(participant_id, None)
            await self.broadcast(meeting_id, {"type": "participant-left", "participantId": participant_id})
            if not room:
                self.rooms.pop(meeting_id, None)
            return True
        waiting = self.pending.get(meeting_id, {})
        current_pending = waiting.get(participant_id)
        if current_pending and current_pending.websocket is websocket:
            waiting.pop(participant_id, None)
            await self.broadcast_to_hosts(meeting_id, {"type": "waiting-participant-left", "participantId": participant_id})
            if not waiting:
                self.pending.pop(meeting_id, None)
        return False

    def is_active(self, meeting_id: str, participant_id: str) -> bool:
        return participant_id in self.rooms.get(meeting_id, {})

    def waiting_list(self, meeting_id: str) -> list[dict]:
        return [self.public(client) for client in self.pending.get(meeting_id, {}).values()]

    async def send_to(self, meeting_id: str, participant_id: str, payload: dict) -> None:
        client = self.rooms.get(meeting_id, {}).get(participant_id)
        if client:
            try:
                await client.websocket.send_json(payload)
            except RuntimeError:
                pass

    async def broadcast(self, meeting_id: str, payload: dict, exclude: str | None = None) -> None:
        for participant_id, client in list(self.rooms.get(meeting_id, {}).items()):
            if participant_id != exclude:
                try:
                    await client.websocket.send_json(payload)
                except RuntimeError:
                    pass

    async def broadcast_to_hosts(self, meeting_id: str, payload: dict) -> None:
        for client in list(self.rooms.get(meeting_id, {}).values()):
            if client.role == "host":
                try:
                    await client.websocket.send_json(payload)
                except RuntimeError:
                    pass

    @staticmethod
    def public(client: Client) -> dict:
        return {
            "id": client.participant_id,
            "name": client.name,
            "role": client.role,
            "muted": client.muted,
            "videoOff": client.video_off,
            "sharing": client.sharing,
            "raisedHand": client.raised_hand,
        }


hub = MeetingHub()
