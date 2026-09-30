import os
from pathlib import Path
from datetime import datetime, timedelta, timezone

TEST_DB = Path(__file__).parent / "test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"

from fastapi.testclient import TestClient
from app.main import app
from app.database import engine


def test_meeting_workflow():
    with TestClient(app) as client:
        created = client.post("/api/meetings/instant")
        assert created.status_code == 201
        meeting = created.json()
        assert len(meeting["meeting_id"]) == 11
        assert client.get(f"/api/meetings/{meeting['meeting_id']}").status_code == 200
        joined = client.post(f"/api/meetings/{meeting['meeting_id']}/join", json={"display_name": "Test Guest"})
        assert joined.status_code == 200
        assert joined.json()["role"] == "guest"


def test_scheduled_meeting_invite_and_lifecycle():
    with TestClient(app) as client:
        scheduled = client.post(
            "/api/meetings/scheduled",
            json={
                "title": "Architecture review",
                "description": "Review the proposed service boundaries",
                "scheduled_at": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
                "duration_minutes": 45,
                "timezone_name": "Asia/Kolkata",
                "waiting_room": False,
                "participants_video": True,
            },
        )
        assert scheduled.status_code == 201
        meeting = scheduled.json()
        invite_token = meeting["invite_url"].split("meeting=")[-1]
        assert client.get(f"/api/meetings/{invite_token}").json()["meeting_id"] == meeting["meeting_id"]

        unauthorized = client.post(f"/api/meetings/{meeting['meeting_id']}/end?host_token=wrong")
        assert unauthorized.status_code == 403
        ended = client.post(
            f"/api/meetings/{meeting['meeting_id']}/end?host_token={meeting['host_token']}"
        )
        assert ended.status_code == 204
        rejected_join = client.post(
            f"/api/meetings/{meeting['meeting_id']}/join", json={"display_name": "Late Guest"}
        )
        assert rejected_join.status_code == 410


def test_schedule_rejects_past_dates_and_unknown_meetings():
    with TestClient(app) as client:
        invalid = client.post(
            "/api/meetings/scheduled",
            json={
                "title": "Past meeting",
                "scheduled_at": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
                "duration_minutes": 30,
            },
        )
        assert invalid.status_code == 422
        assert client.get("/api/meetings/00000000000").status_code == 404


def receive_type(socket, expected: str) -> dict:
    for _ in range(8):
        message = socket.receive_json()
        if message.get("type") == expected:
            return message
    raise AssertionError(f"Did not receive websocket message type {expected}")


def test_waiting_room_admission_and_chat():
    with TestClient(app) as client:
        created = client.post(
            "/api/meetings/scheduled",
            json={
                "title": "Waiting room test",
                "scheduled_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
                "duration_minutes": 30,
                "waiting_room": True,
            },
        ).json()
        host = client.post(
            f"/api/meetings/{created['meeting_id']}/join",
            json={"display_name": "Host", "host_token": created["host_token"]},
        ).json()
        guest = client.post(
            f"/api/meetings/{created['meeting_id']}/join",
            json={"display_name": "Guest"},
        ).json()

        with client.websocket_connect(f"/ws/meetings/{created['meeting_id']}?participant_id={host['participant_id']}") as host_socket:
            assert receive_type(host_socket, "room-state")["participants"] == []
            assert receive_type(host_socket, "waiting-room-state")["participants"] == []
            with client.websocket_connect(f"/ws/meetings/{created['meeting_id']}?participant_id={guest['participant_id']}") as guest_socket:
                assert receive_type(guest_socket, "waiting-room")["type"] == "waiting-room"
                waiting = receive_type(host_socket, "waiting-participant")
                assert waiting["participant"]["name"] == "Guest"
                host_socket.send_json({"type": "admit", "target": guest["participant_id"]})
                assert receive_type(guest_socket, "admitted")["participants"][0]["name"] == "Host"
                receive_type(host_socket, "participant-joined")
                guest_socket.send_json({"type": "chat", "text": "Hello from the waiting room"})
                chat = receive_type(host_socket, "chat")
                assert chat["message"]["text"] == "Hello from the waiting room"
                assert receive_type(guest_socket, "chat")["message"]["text"] == "Hello from the waiting room"

                guest_socket.send_json({"type": "reaction", "emoji": "👍", "clientId": "reaction-test"})
                reaction = receive_type(host_socket, "reaction")
                assert reaction["emoji"] == "👍"
                assert reaction["id"] == "reaction-test"
                assert receive_type(guest_socket, "reaction")["id"] == "reaction-test"


def teardown_module():
    engine.dispose()
    if TEST_DB.exists():
        TEST_DB.unlink()
