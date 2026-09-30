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


class MeetingHub:
    def __init__(self) -> None:
        self.rooms: dict[str, dict[str, Client]] = {}

    async def connect(self, meeting_id: str, client: Client) -> list[dict]:
        room = self.rooms.setdefault(meeting_id, {})
        existing = [self.public(item) for item in room.values()]
        room[client.participant_id] = client
        await self.broadcast(
            meeting_id,
            {"type": "participant-joined", "participant": self.public(client)},
            exclude=client.participant_id,
        )
        return existing

    async def disconnect(self, meeting_id: str, participant_id: str) -> None:
        room = self.rooms.get(meeting_id, {})
        room.pop(participant_id, None)
        await self.broadcast(meeting_id, {"type": "participant-left", "participantId": participant_id})
        if not room:
            self.rooms.pop(meeting_id, None)

    async def send_to(self, meeting_id: str, participant_id: str, payload: dict) -> None:
        client = self.rooms.get(meeting_id, {}).get(participant_id)
        if client:
            await client.websocket.send_json(payload)

    async def broadcast(self, meeting_id: str, payload: dict, exclude: str | None = None) -> None:
        for participant_id, client in list(self.rooms.get(meeting_id, {}).items()):
            if participant_id != exclude:
                await client.websocket.send_json(payload)

    @staticmethod
    def public(client: Client) -> dict:
        return {
            "id": client.participant_id,
            "name": client.name,
            "role": client.role,
            "muted": client.muted,
            "videoOff": client.video_off,
        }


hub = MeetingHub()

