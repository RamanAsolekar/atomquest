# Atom Support Vision

Self-hosted, AI-assisted real-time video customer support for teams that need
visual context without sending calls through a hosted video SDK.

Atom Support Vision lets an agent create a support session, invite a customer by
a shareable link (just like Google Meet), talk over server-routed audio/video,
chat, share files, share their screen, annotate, record the call, stream live
transcription, and review AI-generated notes after the session — all running on
infrastructure you control.

---

## Table of Contents

- [What This Project Demonstrates](#what-this-project-demonstrates)
- [How It Works — The Connectivity Model](#how-it-works--the-connectivity-model)
- [Architecture At A Glance](#architecture-at-a-glance)
- [Tech Stack](#tech-stack)
- [Repository Layout](#repository-layout)
- [Local Docker Setup](#local-docker-setup)
- [Demo Accounts](#demo-accounts)
- [Demo Flow](#demo-flow)
- [The Invite-Link / Guest-Join Model](#the-invite-link--guest-join-model)
- [Networking: Same-Origin, Announced IP, and TURN](#networking-same-origin-announced-ip-and-turn)
- [Docker Operations](#docker-operations)
- [Environment](#environment)
- [Troubleshooting](#troubleshooting)
- [Development Without Docker](#development-without-docker)
- [API And Realtime Interfaces](#api-and-realtime-interfaces)
- [Testing](#testing)
- [Kubernetes](#kubernetes)
- [License](#license)

---

## What This Project Demonstrates

- Browser-based agent and customer video calls with **no customer install and no
  customer account** — customers join through a shareable invite link.
- **Server-routed media** through a self-hosted [mediasoup](https://mediasoup.org)
  SFU (Selective Forwarding Unit) — never peer-to-peer — which is how Google Meet
  and Zoom scale beyond two people.
- **NAT traversal with STUN + a bundled TURN relay (coturn)** so calls connect
  from restrictive networks, exactly like a production conferencing product.
- Agent / customer / admin roles with **backend-enforced RBAC**.
- Full session lifecycle: single-use signed invites, presence, a reconnect grace
  window, and post-call history.
- In-call **chat, file sharing, screen sharing, annotations, and recording**.
- **Live faster-whisper transcription** and AI session intelligence (summary,
  sentiment, action items) with a no-key heuristic fallback.
- Runtime-editable feature flags and a knowledge-base, stored in the database.
- Observability with Prometheus, Grafana, Loki, Promtail, and OpenTelemetry.
- Docker Compose for local deployment and Kubernetes manifests for clusters.

---

## How It Works — The Connectivity Model

This project deliberately follows the **Google Meet / Zoom model**, and the most
important design decision is that **the browser only ever talks to one origin —
the page it loaded.** Everything is routed by path behind a single reverse proxy:

| Path the browser requests | Routed by nginx to | Purpose |
|---|---|---|
| `/` (catch-all) | `web:3000` | Next.js app |
| `/api/*` | `backend:4000` | REST API |
| `/api/stream/*` | `backend:4000` | Server-Sent Events (live dashboards/transcript) |
| `/socket.io/*` | `backend:4000` | Realtime chat/presence (Socket.IO namespace `/rt`) |
| `/rtc/*` | `media:5000` (rewritten to `/socket.io/`) | Media SFU signaling (Socket.IO namespace `/sfu`) |

Why this matters: **a shared invite link works for any device** because the
remote participant opens the same host the agent is on, and all media signaling
rides that one origin. No hardcoded `localhost`, no separate port for the browser
to reach. The actual audio/video then flows over WebRTC (DTLS/SRTP) directly to
the media server's announced IP, with STUN/TURN for NAT traversal.

Two distinct realtime channels run in a call:

1. **Media** (`/rtc/` → SFU `/sfu` namespace): join the room, create transports,
   produce your camera/mic/screen, consume other peers' tracks.
2. **Presence & chat** (`/socket.io/` → backend `/rt` namespace): chat messages,
   participant list, media-state sync, annotations, pointer, session-end.

Both Socket.IO connections are **polling-first then upgrade to WebSocket**, which
is the most proxy-robust order.

---

## Architecture At A Glance

```mermaid
flowchart TB
  Browser["Agent / Customer / Admin browser"]
  Nginx["NGINX reverse proxy (single origin)"]
  Web["Next.js web app"]
  Backend["FastAPI backend\nREST, SSE, Socket.IO /rt"]
  Media["mediasoup media server\nSFU + FFmpeg + Whisper"]
  Turn["coturn\nSTUN / TURN relay"]
  Postgres[("PostgreSQL")]
  Redis[("Redis")]
  Minio[("MinIO / S3")]
  Ops["Prometheus, Grafana,\nLoki, OTel"]

  Browser -->|http(s), one origin| Nginx
  Nginx -->|/| Web
  Nginx -->|/api, /socket.io/| Backend
  Nginx -->|/rtc/| Media

  Browser -.->|WebRTC ICE STUN/TURN| Turn
  Browser <-.->|DTLS/SRTP media| Media

  Web --> Backend
  Backend --> Postgres
  Backend --> Redis
  Backend --> Minio
  Backend --> Media
  Media --> Minio
  Media --> Backend
  Backend --> Ops
  Media --> Ops
```

Detailed Mermaid diagrams live in [`docs/diagrams/`](docs/diagrams/) and an
overview in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md):

| Diagram | What it shows |
|---|---|
| `01-system-context` | Actors and the system boundary |
| `02-container-topology` | Docker services, ports, and the `/rtc/` + TURN paths |
| `03-application-components` | Internal module breakdown |
| `04-request-and-realtime-paths` | REST, SSE, `/rt`, `/sfu`, and media paths |
| `05-session-join-and-media-flow` | Full agent/guest join → produce → consume sequence |
| `06-recording-and-transcription-flow` | Recording + Whisper pipeline |
| `07-reconnect-grace-window` | Disconnect/reconnect handling |
| `08-data-model` | Database entities |
| `09-deployment-view` | Production topology with TURN and a media tier |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Web | Next.js 15, React 19, TypeScript, Tailwind CSS, Zustand, React Query, mediasoup-client, socket.io-client |
| Backend | FastAPI, SQLAlchemy 2, Alembic, python-socketio, Server-Sent Events, PyJWT |
| Media | Node.js, mediasoup (SFU), FFmpeg (recording), faster-whisper (STT) |
| NAT traversal | coturn (STUN/TURN), Google STUN as default |
| Data | PostgreSQL, Redis, MinIO / S3 |
| Observability | Prometheus, Grafana, Loki, Promtail, OpenTelemetry |
| Deployment | Docker Compose, Kubernetes kustomize manifests, NGINX |

---

## Repository Layout

```text
.
├── apps
│   ├── backend        # FastAPI API, SQLAlchemy models, Alembic, realtime gateway, tests
│   ├── media          # mediasoup SFU, recorder, Whisper transcriber, signaling
│   └── web            # Next.js app (rooms, pre-join, dashboards, admin)
├── packages
│   └── shared         # shared TypeScript DTOs, enums, signaling contracts
├── infra              # NGINX, Prometheus, Grafana, Loki, OTel config
├── k8s                # Kubernetes base and dev/prod overlays
├── docs               # API, architecture, deployment, schema, Mermaid diagrams
├── tests              # Playwright e2e and k6 load tests
├── docker-compose.yml
└── .env.example
```

---

## Local Docker Setup

Start Docker Desktop first on Windows and wait until the engine is running.

```powershell
cd D:\atomquest

# First run only, if .env does not already exist:
Copy-Item .env.example .env

# Build and start the whole platform:
docker compose up -d --build

# Check containers (all should be Up / healthy):
docker compose ps
```

> **Open the app at `http://localhost`.** Use a **real standalone browser**
> (Chrome / Edge / Firefox) — the VS Code "Simple Browser" preview pane cannot
> sustain the WebRTC/WebSocket connection and will fail to join calls.

| Service | URL |
|---|---|
| App through NGINX | http://localhost |
| Web direct (also proxies /api, /rtc) | http://localhost:3000 |
| Backend API docs (Swagger) | http://localhost:4000/api/docs |
| Backend health | http://localhost:4000/health |
| Media health | http://localhost:5000/health |
| Grafana | http://localhost/grafana |
| Prometheus | http://localhost:9090 |
| MinIO console | http://localhost:9001 |

The backend runs Alembic migrations at startup and idempotently seeds demo data.
To run it manually:

```powershell
docker compose exec backend sh -c "alembic upgrade head && python -m app.db.seed"
```

---

## Demo Accounts

| Role | Email | Password |
|---|---|---|
| Agent | `agent@atomvision.dev` | `Agent@123` |
| Admin | `admin@atomvision.dev` | `Admin@123` |

Customers do **not** need accounts — they join with an invite link.

---

## Demo Flow

1. Open `http://localhost` in a real browser and sign in as the **agent**.
2. Create a new session from the dashboard.
3. Click **Invite** and copy the generated link.
4. Open the invite link in a **different browser or an incognito window** (this
   simulates a real customer — see [the guest-join model](#the-invite-link--guest-join-model)).
5. In the **pre-join "green room"**, check your camera/mic and click **Join now**.
6. Allow the camera/mic prompt. If you joined without devices, an
   **"Enable camera & mic"** bar appears in the room to turn them on later.
7. Try mute, camera toggle, screen share, annotation, chat, file upload, and
   recording.
8. End the session as the agent.
9. Open **History** to review events, chat, transcript, recording status, and AI
   notes.
10. Sign in as **admin** for live sessions, analytics, audit logs, and runtime config.

---

## The Invite-Link / Guest-Join Model

Invite links behave like Google Meet links: **opening `/join/<token>` joins you
as the invited guest, regardless of whether you're also signed in as the agent in
the same browser.** When an invite token is present, the backend always creates a
distinct *customer* participant and the frontend does not send the agent's auth
token. This is what makes "share a link → a new participant appears in the People
panel" work, even when you test the link in the same browser you're signed into.

Invite tokens are **HMAC-signed and single-use**, with a configurable TTL
(`INVITE_TOKEN_TTL`). The generated URL is built from the request's own
`X-Forwarded-Host`, so the shared link always points at the host the agent is
actually using.

---

## Networking: Same-Origin, Announced IP, and TURN

Three settings determine whether media actually flows once signaling connects.

### 1. Browser endpoints — leave them empty for same-origin

`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`, and `NEXT_PUBLIC_MEDIA_WS_URL` are
**inlined into the browser bundle at build time**. Leave them **empty** so the
browser uses its own origin and nginx routes everything. Setting them to a
Docker-internal hostname (e.g. `media:5000`) breaks the browser, because the
browser cannot resolve container DNS names.

### 2. `MEDIA_ANNOUNCED_IP` — the address browsers send media to

The SFU advertises this IP in its ICE candidates. The media server runs in a
container, so it **cannot auto-detect the host IP** — you must set it:

| Scenario | `MEDIA_ANNOUNCED_IP` |
|---|---|
| Same machine + same Wi-Fi (LAN testing) | your host's LAN IP, e.g. `192.168.1.20` |
| Internet / deployed server | the server's **public IP** |

If it is wrong (e.g. left as a loopback/`127.0.0.1`), signaling connects but no
audio/video ever flows for remote participants.

### 3. TURN — required for internet joins

STUN handles most home networks. **Symmetric NAT and strict firewalls need a TURN
relay.** A coturn service is bundled and enabled by setting:

```ini
MEDIA_ANNOUNCED_IP=<your.public.ip>
TURN_URL=turn:<your.public.ip>:3478
TURN_REALM=<your-host>
TURN_USER=atom
TURN_PASS=<a-strong-secret>
```

Open these ports to the internet: **UDP/TCP 3478** (TURN), **49160–49200**
(TURN relay range), and **40000–40100** (SFU media). With `TURN_URL` empty the
stack runs STUN-only, which is fine for same-network testing.

---

## Docker Operations

```powershell
# Start existing containers
docker compose up -d

# Rebuild after code changes (one or more services)
docker compose up -d --build web backend media

# Force a clean rebuild (when a NEXT_PUBLIC_* build arg changed)
docker compose build --no-cache web

# Restart services
docker compose restart backend media web nginx

# Follow logs
docker compose logs -f             # all
docker compose logs -f backend     # one service

# Stop the stack
docker compose down                # keep volumes
docker compose down -v             # also wipe DB/storage volumes
```

Service names:

```text
postgres redis minio backend media coturn web nginx
prometheus grafana otel-collector loki promtail
```

---

## Environment

Configuration starts from [.env.example](.env.example). Key values:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Backend PostgreSQL connection string |
| `REDIS_URL` | Backend Redis connection string (also Socket.IO cross-replica fan-out) |
| `S3_ENDPOINT` / `S3_PUBLIC_ENDPOINT` | MinIO/S3 internal and browser-visible endpoints |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Token signing secrets |
| `INVITE_TOKEN_SECRET` / `INVITE_TOKEN_TTL` | Invite HMAC secret and lifetime |
| `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_WS_URL` / `NEXT_PUBLIC_MEDIA_WS_URL` | Browser endpoints — **leave empty for same-origin** |
| `MEDIA_ANNOUNCED_IP` | IP advertised in WebRTC ICE candidates (LAN or public IP) |
| `MEDIASOUP_MIN_PORT` / `MEDIASOUP_MAX_PORT` | SFU RTC media port range (default 40000–40100) |
| `STUN_URL` / `TURN_URL` / `TURN_REALM` / `TURN_USER` / `TURN_PASS` | NAT traversal |
| `ANTHROPIC_API_KEY` | Optional AI key; a local heuristic is used if empty |
| `WHISPER_MODEL` / `WHISPER_DEVICE` / `WHISPER_COMPUTE_TYPE` | Live STT tuning |

For production, replace every development secret, set `MEDIA_ANNOUNCED_IP` to a
reachable IP, and configure TURN.

### Getting an Anthropic API key (optional, for AI summaries)

1. Go to <https://console.anthropic.com> and sign in.
2. Add billing/credits (API usage is pay-as-you-go; a few dollars is plenty).
3. **API Keys → Create Key**, copy it (shown once, `sk-ant-...`).
4. Put it in `.env` as `ANTHROPIC_API_KEY=...` and run `docker compose up -d backend`.

The app fully works without this key — only the AI summary falls back to a basic
heuristic.

---

## Troubleshooting

**"Could not join the session — Cannot reach the media server"**
- You are likely in the **VS Code Simple Browser**. Use a real standalone
  Chrome/Edge/Firefox window.
- Stale JS bundle: hard-reload (DevTools → "Empty Cache and Hard Reload") or use
  an Incognito window. The app sends `no-cache` headers to reduce this.
- In the browser console, look for `[media] connecting` → `[media] engine open`
  → `[media] connected`. An `[media] engine close — <reason>` line names the
  exact failure.

**Camera/mic or video not working**
- Allow the camera/mic browser prompt. If previously blocked, click the lock/ⓘ
  icon next to the address bar and reset permissions, then reload.
- In the room, use the **"Enable camera & mic"** bar (shown in view-only mode).
- Chrome **device-emulation** (responsive mode) can behave differently for media
  than a normal window.

**Chat/messages not appearing**
- Chat rides the backend `/rt` Socket.IO namespace; check the console for
  `[rt] connected`. DTOs sent over Socket.IO are ISO-serialized so the realtime
  handler does not crash on datetimes.

**`502 Bad Gateway` right after a rebuild**
- nginx caches upstream container IPs; rebuilding gives a service a new IP. The
  config uses a Docker DNS `resolver` so HTTP paths self-heal, but if you still
  see 502 on `/rtc/`, run `docker compose restart nginx`.

**Remote participant connects but no audio/video**
- `MEDIA_ANNOUNCED_IP` is wrong, or TURN isn't configured. See
  [Networking](#networking-same-origin-announced-ip-and-turn).

**Control bar buttons hidden on small/landscape screens**
- The control bar is a pinned, horizontally-scrollable footer; on very narrow
  widths scroll it sideways. This is already handled — file an issue if a control
  is genuinely unreachable.

---

## Development Without Docker

Docker Compose is recommended because the media server needs FFmpeg, Python,
faster-whisper, and native mediasoup dependencies. For local dev, start the
infrastructure first:

```powershell
docker compose up -d postgres redis minio
```

Then the app processes:

```powershell
# Backend
cd apps/backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
alembic upgrade head
python -m app.db.seed
uvicorn app.main:app --reload --host 0.0.0.0 --port 4000
```

```powershell
# Web and media, from repo root
npm install
npm run dev:web
npm run dev:media
```

> Without nginx, the browser can't use the same-origin `/rtc/` path for media
> (Next.js dev rewrites don't proxy WebSockets reliably). Run the full stack via
> Docker for media to work, or set `NEXT_PUBLIC_MEDIA_WS_URL=http://localhost:5000`
> to point the browser directly at the media server.

---

## API And Realtime Interfaces

- REST API base: `http://localhost:4000/api`
- Swagger UI: `http://localhost:4000/api/docs`
- Backend realtime Socket.IO: path `/socket.io`, namespace `/rt`
- Media signaling Socket.IO: engine path `/rtc/`, namespace `/sfu`
- SSE streams: `/api/stream/{topic}`
- Metrics: `/metrics` on backend and media

Full API details are in [docs/API.md](docs/API.md).

---

## Testing

```powershell
# Backend unit tests
cd apps/backend; pytest -q

# Media tests
npm -w @atom/media run test

# End-to-end (stack must be running)
npm run test:e2e

# Load test (requires k6)
k6 run -e BASE_URL=http://localhost:4000 tests/load/api-load.js
```

---

## Deploy Publicly (free)

To put this online so customers join via invite link from anywhere — for free,
with working video — follow **[docs/DEPLOYMENT.md → Section F](docs/DEPLOYMENT.md#f-free-public-deploy-oracle-cloud--duckdns--https)**
(Oracle Cloud Always-Free VM + DuckDNS hostname + automatic Let's Encrypt HTTPS).

The short version, on a Linux VM with a public IP and a hostname pointing at it:

```bash
git clone https://github.com/RamanAsolekar/atomquest.git && cd atomquest
cp .env.example .env
# set PUBLIC_HOST=<your-host>, MEDIA_ANNOUNCED_IP=<vm-public-ip>,
# TURN_URL=turn:<vm-public-ip>:3478, strong secrets; leave NEXT_PUBLIC_* empty
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

This adds **Caddy** in front of nginx for automatic HTTPS (browsers require HTTPS
for camera/mic on non-`localhost`). Open firewall ports **80, 443 (TCP)**,
**3478 (UDP/TCP)**, **49160–49200 (UDP)**, **40000–40100 (UDP/TCP)**.

## Kubernetes

```bash
kubectl apply -k k8s/overlays/dev
```

Production manifests are in `k8s/overlays/prod`. The media service is designed
for host networking (or equivalent UDP/TCP exposure) so WebRTC candidates remain
reachable, and a TURN relay should sit alongside the media tier for clients
behind restrictive NAT.

---

## Operational Notes

- `getUserMedia` works on `http://localhost`; **production domains require HTTPS**.
- On Docker Desktop, the RTC range is published as explicit TCP/UDP ports; on
  Linux, host networking for the media service is recommended at higher concurrency.
- Whisper defaults to CPU `int8` with `base.en`; use `tiny.en` for lower latency
  or CUDA settings on GPU nodes.
- Recording and transcription target the one-to-one support-call use case.

---

## License

MIT. Built for AtomQuest Hackathon 1.0 Finale.
