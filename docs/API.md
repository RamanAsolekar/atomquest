# Atom Support Vision — REST, SSE & WebSocket API

Implemented with **FastAPI**. Base URL: `http://localhost:4000/api` · interactive
OpenAPI/Swagger UI at **`/api/docs`**. JSON uses camelCase, identical to the previous
contract (the web client is unchanged).

All errors share one envelope:
```json
{ "statusCode": 403, "message": "Requires role: AGENT", "path": "/api/sessions" }
```
Auth: `Authorization: Bearer <accessToken>`. Refresh token lives in the `atom_rt` httpOnly cookie.

---

## Authentication

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/auth/login` | public | `{ email, password }` | `{ user, accessToken, expiresIn }` + sets refresh cookie |
| POST | `/auth/register` | public | `{ email, name, password }` | `AuthUser` |
| POST | `/auth/refresh` | cookie | — | `{ user, accessToken, expiresIn }` (rotates refresh) |
| POST | `/auth/logout` | bearer | — | `{ ok: true }` |
| GET | `/auth/me` | bearer | — | `AuthUser` |

## Sessions

| Method | Path | Auth / RBAC | Notes |
|---|---|---|---|
| POST | `/sessions` | AGENT/ADMIN · `session:create` | Create. Body `CreateSessionRequest`. |
| GET | `/sessions?status&search&take&skip` | AGENT/ADMIN | Agents see own; admins all. |
| GET | `/sessions/:id` | AGENT/ADMIN | Detail incl. participants, AI insight. |
| GET | `/sessions/:id/events` | AGENT/ADMIN | Session event log (history). |
| GET | `/sessions/:id/participants` | AGENT/ADMIN | Who joined / status / duration. |
| POST | `/sessions/:id/end` | owner AGENT / ADMIN | Clean teardown. |
| POST | `/sessions/:id/invites` | AGENT/ADMIN · `invite:create` | Returns `{ token, url, expiresAt }`. |
| GET | `/sessions/:id/invites` | AGENT/ADMIN | List issued invites. |
| GET | `/sessions/invite/:token/validate` | public | Customer pre-join check. |
| POST | `/sessions/:id/join` | optional bearer / invite | Returns `{ session, participant, mediaToken }`. |

## Chat

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/sessions/:id/messages` | AGENT/ADMIN | Full chat history (post-call retrievable). |

Real-time chat is sent over the `/rt` socket (`rt:sendMessage`) and broadcast as `rt:message`.

## Recordings

| Method | Path | Auth / RBAC | Notes |
|---|---|---|---|
| POST | `/sessions/:id/recording/start` | owner AGENT · `recording:start` | → status RECORDING |
| POST | `/sessions/:id/recording/stop` | owner AGENT · `recording:stop` | → PROCESSING → READY |
| GET | `/sessions/:id/recordings` | AGENT/ADMIN | Statuses. |
| GET | `/recordings/:id/download` | AGENT/ADMIN · `recording:download` | 302 → signed S3 URL. |
| POST | `/recordings/callback` | internal | Media-server → API ready callback. |

## Files

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/files/upload` | media token (multipart) | `file` + `mediaToken`. 25 MB cap, mime sniffed. Posts to chat. |
| GET | `/files/:id/download` | public | 302 → signed S3 URL. |
| GET | `/files/session/:id` | bearer | Files shared in a session. |

## Admin (ADMIN · `admin:dashboard`)

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/sessions/live` | Live sessions + participants + running duration. |
| POST | `/admin/sessions/:id/force-end` | `admin:force_end`. Force-end any session. |
| GET | `/admin/events?sessionId&take` | Platform event log. |
| GET | `/admin/users` | User list. |

## Analytics (AGENT/ADMIN · `analytics:view`)

| Method | Path | Response |
|---|---|---|
| GET | `/analytics/overview` | `AnalyticsOverview` (totals, sentiment, leaderboard, heatmap, resolution rate). |

## AI (AGENT/ADMIN)

| Method | Path | Notes |
|---|---|---|
| POST | `/sessions/:id/ai/summary` | Generate summary / sentiment / action items / KB / quality. |
| GET | `/sessions/:id/ai/summary` | Retrieve stored insight. |

## Audit (ADMIN · `audit:view`)

| Method | Path |
|---|---|
| GET | `/audit/logs?take&skip&action&actorId` |

## Runtime config & Knowledge base (dynamic — no redeploy)

| Method | Path | Auth / RBAC | Notes |
|---|---|---|---|
| GET | `/config` | AGENT/ADMIN | All settings + feature flags. |
| PUT | `/config/{key}` | ADMIN · `admin:dashboard` | Update a setting/flag; broadcasts `config_updated`. |
| GET | `/kb` | AGENT/ADMIN | List knowledge-base articles. |
| POST | `/kb` | ADMIN · `admin:dashboard` | Create an article. |
| PUT | `/kb/{id}` | ADMIN | Update an article. |
| DELETE | `/kb/{id}` | ADMIN | Delete an article. |

## Live transcript (Whisper STT)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/transcripts/ingest` | internal | Media-server Whisper worker posts STT segments; persisted + broadcast live. |
| GET | `/sessions/{id}/transcript` | AGENT/ADMIN | Full transcript for a session. |

## Live streams (SSE — the dynamic backbone)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/stream/{topic}?token=<access>` | token in query | Server-Sent Events. Topics: `dashboard`, `admin` (admin only), `analytics`, `config`, `session:<id>`. Emits `session_created/updated/ended`, `metrics`, `recording_status`, `message`, `transcript`, `ai_insight`, `config_updated`. |

## Health & Metrics (public)

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness. |
| GET | `/health/ready` | DB + Redis readiness. |
| GET | `/metrics` | Prometheus exposition (also media server `:5000/metrics`). |

---

## WebSocket namespaces

### `/rt` (API — chat / presence / annotations)
Auth: `auth.mediaToken`. Client → server: `rt:sendMessage`, `rt:typing`, `rt:toggleMedia`,
`rt:annotate`, `rt:clearAnnotations`, `rt:pointer`, `rt:heartbeat`, `rt:endSession`.
Server → client: `rt:message`, `rt:roomState`, `rt:participantJoined/Left/Reconnecting`, `rt:transcript`,
`rt:mediaToggled`, `rt:annotation`, `rt:pointer`, `rt:recordingStatus`, `rt:aiInsight`, `rt:sessionEnded`.

### `/sfu` (Media — mediasoup signaling)
Auth: `sfu:join { mediaToken }`. Client → server: `sfu:createTransport`, `sfu:connectTransport`,
`sfu:produce`, `sfu:consume`, `sfu:resumeConsumer`, `sfu:pauseProducer/resumeProducer`,
`sfu:closeProducer`, `sfu:restartIce`. Server → client: `sfu:joined`, `sfu:newProducer`,
`sfu:producerClosed`, `sfu:peerClosed`.
