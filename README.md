# Zoomly — Video Conferencing Platform

A full-stack Zoom-inspired meeting platform created for the Scaler SDE assignment. It supports instant and scheduled meetings, invitation links, browser-based audio/video, screen sharing, live participant state, and host moderation.

> Zoomly is an original educational project. It is not affiliated with or endorsed by Zoom Video Communications, Inc.

## Live application

- Frontend: https://scaler-assignment-psi.vercel.app
- Backend health: https://scaler-assignment-gkuc.onrender.com/health
- API documentation: https://scaler-assignment-gkuc.onrender.com/docs

## Features

- Professional, responsive meeting dashboard
- Instant meetings with unique 11-digit IDs
- Scheduled meetings with topic, description, date, duration and timezone
- Upcoming and recent meeting lists backed by SQLite
- Join by meeting ID or shareable invitation link
- Pre-join camera/microphone preview and display name
- Multi-participant WebRTC video rooms
- Mute, camera and screen-share controls
- Real-time participant presence through WebSockets
- Host mute-all, remove-participant and end-for-all controls
- Host-controlled waiting room with admit and deny actions
- In-meeting chat, emoji reactions and raise-hand state
- Automatic WebSocket reconnection with visible connection status
- Keyboard shortcuts, toast feedback, tooltips and loading skeletons
- Seeded sample meetings and automatic database setup
- API validation and useful meeting error states

## Architecture

```text
Next.js client ── REST ───────┐
                             ├── FastAPI ── SQLAlchemy ── SQLite
Next.js client ── WebSocket ─┘
       │
       └──── WebRTC peer-to-peer media ──── Other clients
```

FastAPI is the source of truth for meetings and participants. WebSockets carry WebRTC negotiation messages and live room events; video and audio travel directly between browsers. The peer mesh is intentionally designed for small assignment/demo rooms (approximately 2–6 people). A larger production system should use an SFU such as LiveKit or mediasoup.

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, Lucide |
| Real time | Native WebRTC and WebSockets |
| Backend | Python 3.12, FastAPI, Pydantic |
| Data | SQLite, SQLAlchemy 2 |
| Tests | Pytest, FastAPI TestClient |
| Deployment | Vercel, Render, Docker |

## Database schema

- `users`: default logged-in user, email and display metadata
- `meetings`: meeting identifiers, secure invite/host tokens, schedule, options and lifecycle status
- `meeting_participants`: display name, role, join/leave timestamps and removal state
- `meeting_events`: auditable meeting creation, join, leave, cancellation and ending events

Meeting IDs, invite tokens and user emails are uniquely indexed. Meeting, participant and event relationships use foreign keys.

## Local setup

### Prerequisites

- Node.js 20.9+
- Python 3.11+

### Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload
```

The API runs at `http://localhost:8000`; interactive OpenAPI documentation is at `http://localhost:8000/docs`.

### Frontend

```bash
cd frontend
npm install
copy .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

Alternatively, run the complete stack with `docker compose up --build`.

## Tests

```bash
cd backend
pytest -q

cd ../frontend
npm run build
```

## Deployment

### Backend on Render

1. Create a Render Web Service from this repository, select Docker, and set its root directory to `backend`.
2. Set the health-check path to `/health`. The included root-level `render.yaml` contains the same deployment configuration.
3. Configure:
   - `DATABASE_URL=sqlite:////app/data/zoom.db`
   - `PUBLIC_FRONTEND_URL=https://<your-vercel-domain>`
   - `FRONTEND_ORIGINS=https://<your-vercel-domain>`
4. Deploy and copy the generated `onrender.com` service URL.

SQLite requires a single backend replica. Render's free filesystem is ephemeral, so demo data can reset after a rebuild or service replacement. A paid persistent disk mounted at `/app/data` provides durable SQLite storage; horizontal scaling would require PostgreSQL instead.

### Frontend on Vercel

1. Import this repository and set the root directory to `/frontend`.
2. Configure:
   - `NEXT_PUBLIC_API_URL=https://<your-render-domain>`
   - `NEXT_PUBLIC_WS_URL=wss://<your-render-domain>`
3. Deploy and update the Render origin variables with the final Vercel domain.

For reliable WebRTC behind restrictive networks, configure a TURN service using the optional `NEXT_PUBLIC_TURN_*` variables in `frontend/.env.example`.

## Assumptions

- A seeded default user, Kavya Gupta, is considered logged in as required by the brief.
- Host credentials are stored only in the creator's browser. Public invite links do not expose host privileges.
- Waiting-room admission state is held by the live meeting server; guests must be admitted by the host when the option is enabled.
- Browser camera/screen APIs require HTTPS in deployment or localhost during development.

