# Deployment Guide

## A. Local development (Docker Compose — recommended)

```bash
cp .env.example .env          # adjust secrets if you like
docker compose up -d --build  # builds & starts the full stack
docker compose exec backend sh -c "npm run db:seed"   # demo users
```

Open **http://localhost** (NGINX) or **http://localhost:3000** (direct).
- API: http://localhost:4000/api/docs
- Grafana: http://localhost:3001 (admin/admin) · Prometheus: http://localhost:9090
- MinIO console: http://localhost:9001

Sign in as agent (`agent@atomvision.dev` / `Agent@123`) or admin
(`admin@atomvision.dev` / `Admin@123`). Generate an invite from a session and open
it in an incognito window to play the customer.

## B. Local without Docker

```bash
# bring up infra (or use your own):
docker compose up -d postgres redis minio

# backend (FastAPI)
cd apps/backend
python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
alembic upgrade head
python -m app.db.seed
uvicorn app.main:app --reload --port 4000 &

# web + media
cd ../.. && npm install
npm run dev:web &      # Next.js on :3000
npm run dev:media &    # mediasoup SFU on :5000
```
> The media server needs **FFmpeg** + **Python 3 / faster-whisper** on PATH for
> recording & live transcription, and build tools to compile the mediasoup worker
> on first `npm install`. (`npm run dev` runs all three together once the venv is active.)

## C. AWS EC2 (single box)

1. Launch an Ubuntu 22.04 instance (t3.large+). Open security-group ports:
   `80/443` (web), `4000`, `5000`, and the RTC range `40000-40100` (UDP **and** TCP).
2. Install Docker + compose plugin.
3. `git clone` the repo, `cp .env.example .env`.
4. **Critical:** set `MEDIA_ANNOUNCED_IP` to the instance's **public IP** so ICE
   candidates are reachable, and point `NEXT_PUBLIC_*` / `CORS_ORIGIN` at your domain.
5. `docker compose up -d --build && docker compose exec backend sh -c "npm run db:seed"`.
6. Put real TLS in front (Caddy/Let's Encrypt or an ALB). Browsers require HTTPS for
   `getUserMedia` outside `localhost`.

## D. AWS ECS (Fargate + EC2 for media)

- **web / backend** → Fargate services behind an ALB (path routing: `/api`,
  `/socket.io` → backend; `/` → web). Stateless → set desired count ≥ 2.
- **media** → EC2 launch type (Fargate can't open arbitrary UDP ranges well). Run with
  `network_mode: host`, one task per instance, register behind an NLB (UDP).
- **PostgreSQL** → RDS (Multi-AZ). **Redis** → ElastiCache. **Object storage** → S3.
- Inject secrets via SSM Parameter Store / Secrets Manager.
- Images published by the `release.yml` workflow to GHCR; reference them in task defs.

## E. Kubernetes (kustomize)

```bash
kubectl apply -k k8s/overlays/dev      # single replicas, tiny Whisper model
kubectl apply -k k8s/overlays/prod     # pinned image tags, scaled up, small.en
```

```
k8s/
  base/
    namespace.yaml        # atom namespace
    config.yaml           # ConfigMap (atom-config) + Secret template (atom-secrets)
    datastores.yaml       # Postgres StatefulSet, Redis, MinIO (swap for managed in prod)
    backend.yaml          # Deployment + HPA + migration initContainer + Service (sticky)
    web.yaml              # Deployment + HPA + Service
    media.yaml            # StatefulSet hostNetwork + podAntiAffinity + announced IP from node
    ingress.yaml          # nginx-ingress: /api,/socket.io→backend; /→web; cookie affinity
    observability.yaml    # Prometheus (pod SD) + Grafana
    kustomization.yaml
  overlays/{dev,prod}/kustomization.yaml
```
Key points: backend/web behind an Ingress with cookie sticky-sessions for SSE/socket.io
(the Redis event bus also keeps replicas in sync); the **backend init container runs
`alembic upgrade head`** before the app starts; media pods use `hostNetwork` + a UDP-capable
LB with `MEDIA_ANNOUNCED_IP` from the node IP (downward API). Scale the SFU horizontally;
sessions pin to a node by their room. faster-whisper runs in the media pod — use GPU node
pools + `WHISPER_DEVICE=cuda` for low-latency transcription at scale.

## Production hardening checklist
- [ ] Replace all `*_SECRET` values (`openssl rand -hex 64`).
- [ ] TLS everywhere; `secure` cookies (`NODE_ENV=production` already enables this).
- [ ] Lock down `/metrics`, Grafana, MinIO console to a private network/VPN.
- [ ] Set S3 bucket policies + lifecycle rules for recordings.
- [ ] Tune `MEDIASOUP_*_PORT` range and `MEDIA_NUM_WORKERS` to instance size.
- [ ] Configure Prometheus alerting (error-rate, p95 latency, media-peer drop).
