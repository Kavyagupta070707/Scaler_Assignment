import os
from pathlib import Path

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


def teardown_module():
    engine.dispose()
    if TEST_DB.exists():
        TEST_DB.unlink()
