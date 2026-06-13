# Atom Support Vision Architecture

Atom Support Vision is a self-hosted, AI-assisted video support platform. The core
architectural constraint is that audio and video must be routed through infrastructure
we own. Browser clients never use a hosted video SDK and never rely on raw peer-to-peer
media as the product path.

## System Context

```mermaid
flowchart TB
  Agent["Support agent browser"]
  Customer["Customer browser"]
  Admin["Admin browser"]

  Edge["NGINX reverse proxy\nHTTP, WebSocket, SSE"]
  Web["Next.js web app\nReact UI, room experience, dashboards"]
  API["FastAPI backend\nREST, SSE, Socket.IO realtime"]
  Media["Media server\nmediasoup SFU, FFmpeg, Whisper worker"]

  Postgres[("PostgreSQL\nsystem of record")]
  Redis[("Redis\npresence, reconnect grace, pub/sub")]
  ObjectStore[("MinIO / S3\nrecordings and shared files")]
  Observability["Prometheus, Grafana,\nLoki, Promtail, OTel"]

  Agent --> Edge
  Customer --> Edge
  Admin --> Edge
  Edge --> Web
  Edge --> API
  Edge --> Media

  Web --> API
  Web --> Media
  API --> Postgres
  API --> Redis
  API --> ObjectStore
  API --> Media
  Media --> ObjectStore
  Media --> API

  API --> Observability
  Media --> Observability
  Edge --> Observability
```

## Container Topology

```mermaid
flowchart LR
  subgraph Docker["Docker Compose network"]
    Nginx["nginx:80"]
    Web["web:3000\nNext.js standalone"]
    Backend["backend:4000\nFastAPI + Socket.IO"]
    Media["media:5000\nmediasoup signaling + SFU"]
    Postgres["postgres:5432"]
    Redis["redis:6379"]
    Minio["minio:9000/9001"]
    Prometheus["prometheus:9090"]
    Grafana["grafana:3000"]
    Loki["loki:3100"]
    Promtail["promtail"]
    Otel["otel-collector:4317/4318"]
  end

  Browser["Browser"] -->|http://localhost| Nginx
  Nginx -->|/| Web
  Nginx -->|/api, /socket.io| Backend
  Nginx -->|/sfu| Media

  Backend --> Postgres
  Backend --> Redis
  Backend --> Minio
  Backend --> Media
  Media --> Minio
  Media --> Backend

  Prometheus -->|scrape /metrics| Backend
  Prometheus -->|scrape /metrics| Media
  Grafana --> Prometheus
  Grafana --> Loki
  Promtail --> Loki
  Backend --> Otel
```

## Application Components

```mermaid
flowchart TB
  subgraph WebApp["apps/web"]
    Pages["App Router pages\nlogin, dashboard, room, history, admin, analytics"]
    Components["Room components\nvideo tile, chat, annotation canvas"]
    Clients["API, realtime, media clients"]
    Store["Zustand auth store\nReact Query server cache"]
  end

  subgraph BackendApp["apps/backend"]
    Routers["FastAPI routers\nauth, sessions, chat, recordings, files,\nadmin, analytics, audit, ai, transcripts, config"]
    Services["Service layer\nbusiness rules and persistence"]
    Realtime["Socket.IO /rt gateway\nchat, presence, annotations"]
    Streams["SSE streams\nlive dashboards and session updates"]
    EventBus["Redis event bus"]
    Models["SQLAlchemy models\nAlembic migrations"]
  end

  subgraph MediaApp["apps/media"]
    Signaling["Socket.IO /sfu signaling"]
    Workers["mediasoup worker pool"]
    Rooms["Room manager\none router per session"]
    Recorder["FFmpeg recorder"]
    Transcriber["FFmpeg audio tap\nfaster-whisper worker"]
    MediaMetrics["Prometheus metrics"]
  end

  Pages --> Components
  Components --> Clients
  Store --> Clients
  Clients --> Routers
  Clients --> Realtime
  Clients --> Signaling

  Routers --> Services
  Services --> Models
  Services --> EventBus
  EventBus --> Streams
  EventBus --> Realtime

  Signaling --> Rooms
  Rooms --> Workers
  Rooms --> Recorder
  Rooms --> Transcriber
  Recorder --> Routers
  Transcriber --> Routers
  MediaMetrics --> Workers
```

## Request And Realtime Paths

```mermaid
flowchart LR
  Browser["Browser client"]
  API["FastAPI REST"]
  RT["Backend Socket.IO /rt"]
  SSE["Backend SSE /api/stream/*"]
  SFU["Media Socket.IO /sfu"]
  RTP["DTLS/SRTP media path"]

  Browser -->|login, sessions, history, admin| API
  Browser -->|chat, presence, annotations| RT
  Browser -->|dashboard/admin/analytics live feed| SSE
  Browser -->|join room, create transports, produce, consume| SFU
  Browser <-->|audio/video/screen media| RTP
  RTP <-->|routed by mediasoup| SFU
```

## Session Join And Media Flow

```mermaid
sequenceDiagram
  participant B as Browser
  participant API as FastAPI backend
  participant DB as PostgreSQL
  participant R as Redis event bus
  participant SFU as Media server

  B->>API: Login or validate invite
  API->>DB: Load user/session/invite
  API-->>B: Access token or invite validation result
  B->>API: Join session
  API->>DB: Upsert participant and session state
  API->>R: Publish participant joined
  API-->>B: Session, participant, media token
  B->>SFU: sfu:join with media token
  SFU->>SFU: Verify token and create/get room router
  SFU-->>B: Router RTP capabilities and current producers
  B->>SFU: Create send and receive transports
  B->>SFU: Produce microphone, camera, or screen track
  SFU-->>B: Notify peers about new producers
  B->>SFU: Consume peer producers
  SFU-->>B: Routed DTLS/SRTP media
```

## Recording And Transcription Flow

```mermaid
sequenceDiagram
  participant Agent as Agent browser
  participant API as FastAPI backend
  participant SFU as Media server
  participant F as FFmpeg
  participant W as Whisper worker
  participant S3 as MinIO / S3
  participant DB as PostgreSQL

  Agent->>API: Start recording
  API->>DB: Create recording row
  API->>SFU: POST /recording/start
  SFU->>F: Start PlainTransport consumer pipeline
  F->>SFU: Write recording artifact
  SFU->>W: Stream audio chunks for STT
  W->>API: POST transcript segment
  API->>DB: Persist transcript
  API-->>Agent: Broadcast transcript event
  Agent->>API: Stop recording
  API->>SFU: POST /recording/stop
  SFU->>F: Flush and close file
  SFU->>S3: Upload recording
  SFU->>API: Recording callback with storage key
  API->>DB: Mark recording READY
  API-->>Agent: Broadcast recording status
```

## Reconnect Grace Window

```mermaid
sequenceDiagram
  participant B as Browser
  participant RT as Backend realtime gateway
  participant Redis as Redis
  participant Peers as Other participants

  B--xRT: Network or tab disconnect
  RT->>Redis: Set grace key for 15 seconds
  RT->>RT: Mark participant reconnecting
  Note over RT,Peers: Peers are not immediately told the user left
  alt Browser returns in time
    B->>RT: Reconnect with same session token
    RT->>Redis: Clear grace key
    RT->>Peers: Participant restored
  else Grace expires
    Redis-->>RT: Key expired
    RT->>Peers: Participant left
    RT->>RT: Clean room state
  end
```

## Data Model

```mermaid
erDiagram
  USER ||--o{ SESSION : owns
  USER ||--o{ REFRESH_TOKEN : has
  USER ||--o{ USER_PERMISSION : granted
  PERMISSION ||--o{ USER_PERMISSION : maps
  USER ||--o{ AUDIT_LOG : creates
  USER ||--o{ NOTIFICATION : receives

  SESSION ||--o{ INVITE : issues
  SESSION ||--o{ PARTICIPANT : includes
  SESSION ||--o{ MESSAGE : stores
  SESSION ||--o{ SHARED_FILE : contains
  SESSION ||--o{ RECORDING : captures
  SESSION ||--o{ SESSION_EVENT : logs
  SESSION ||--o{ TRANSCRIPT : transcribes
  SESSION ||--|| AI_INSIGHT : summarizes

  SHARED_FILE ||--o{ MESSAGE : referenced_by

  KB_ARTICLE {
    string id
    string title
    string url
    string category
    boolean is_active
  }

  APP_CONFIG {
    string key
    json value
    string description
  }
```

## Deployment View

```mermaid
flowchart TB
  Internet["Internet"]
  TLS["TLS load balancer / reverse proxy"]

  subgraph Stateless["Horizontally scalable services"]
    Web1["web replicas"]
    API1["backend replicas"]
  end

  subgraph MediaTier["Media tier"]
    Media1["media node A\nhost networking recommended"]
    Media2["media node B\nUDP/TCP RTC range"]
  end

  subgraph ManagedData["Stateful data"]
    DB[("PostgreSQL / RDS")]
    Cache[("Redis / ElastiCache")]
    Bucket[("S3-compatible object storage")]
  end

  subgraph Ops["Operations"]
    Metrics["Prometheus"]
    Dashboards["Grafana"]
    Logs["Loki"]
    Traces["OpenTelemetry collector"]
  end

  Internet --> TLS
  TLS --> Web1
  TLS --> API1
  TLS --> Media1
  TLS --> Media2

  API1 --> DB
  API1 --> Cache
  API1 --> Bucket
  Media1 --> Bucket
  Media2 --> Bucket
  Media1 --> API1
  Media2 --> API1

  API1 --> Traces
  API1 --> Metrics
  Media1 --> Metrics
  Media2 --> Metrics
  Logs --> Dashboards
  Metrics --> Dashboards
```

## Key Design Decisions

| Area | Decision | Reason |
|---|---|---|
| Video architecture | mediasoup SFU, one router per session | Keeps media server-routed and avoids hosted video APIs. |
| Backend framework | FastAPI with async SQLAlchemy | Good fit for REST, SSE, background IO, and Python AI integrations. |
| Realtime control | Socket.IO plus SSE | Socket.IO handles room interactions; SSE powers live dashboards cleanly. |
| State sharing | Redis pub/sub and transient keys | Supports reconnect grace windows and multi-replica realtime fanout. |
| Storage | PostgreSQL for records, MinIO/S3 for binary artifacts | Keeps queryable metadata separate from large files and recordings. |
| Recording | SFU PlainTransport to FFmpeg | Server-side recording remains under our control. |
| Transcription | FFmpeg audio tap to faster-whisper | Self-hosted STT with no transcription SaaS dependency. |
| Operations | Prometheus, Grafana, Loki, OTel | Standard observability stack for metrics, logs, and traces. |

## Service Responsibilities

| Service | Owns |
|---|---|
| `web` | Browser UI, room page, admin screens, analytics views, client API/realtime/media adapters. |
| `backend` | Auth, RBAC, sessions, invites, chat persistence, files, recordings metadata, AI summaries, admin, analytics, audit, SSE, Socket.IO `/rt`. |
| `media` | mediasoup workers, SFU room state, WebRTC transports, producers/consumers, recording pipeline, transcription pipeline. |
| `postgres` | Durable relational state. |
| `redis` | Presence, reconnect grace keys, pub/sub event bus. |
| `minio` | S3-compatible object storage for recordings and uploaded files. |
| `nginx` | Reverse proxy for web, API, backend WebSocket, and media signaling. |
| `prometheus` | Metrics scraping for backend and media. |
| `grafana` | Dashboards for metrics and logs. |
| `loki` / `promtail` | Container log collection. |
| `otel-collector` | Trace and OTLP metrics collection. |

## Security Model

- JWT access tokens and rotating HTTP-only refresh cookies protect authenticated app routes.
- Customer joins use HMAC-signed invite tokens; only token hashes are stored.
- Role and permission checks are enforced in backend dependencies, not only in the UI.
- Agent-only operations include session creation, invite creation, ending sessions, and recording controls.
- Admin operations include live monitoring, force-end, user review, audit logs, and runtime config changes.
- Uploaded files are size-limited, MIME-sniffed, stored outside the database, and downloaded through signed URLs.
- Browser media is encrypted with WebRTC DTLS/SRTP while still being routed by the self-hosted SFU.

## Runtime Configuration

Runtime configuration and knowledge-base content are stored in the database:

- `app_config` stores feature flags and tunables.
- `kb_articles` stores support knowledge used by the AI assistant.
- Changes are broadcast through Redis and SSE so dashboards and rooms update without redeploying.

## Local Docker Stack

```powershell
cd D:\atomquest
Copy-Item .env.example .env
docker compose up -d --build
docker compose ps
```

Main URLs:

- App through NGINX: `http://localhost`
- Web direct: `http://localhost:3000`
- API docs: `http://localhost:4000/api/docs`
- Media health: `http://localhost:5000/health`
- Grafana: `http://localhost:3001`
- Prometheus: `http://localhost:9090`
- MinIO console: `http://localhost:9001`
