# Deployment Guide

> **Quick path:** to deploy publicly **for free** with working video + invite
> links, jump to **[Section F — Free public deploy (Oracle + DuckDNS + HTTPS)](#f-free-public-deploy-oracle-cloud--duckdns--https)**.
> It uses `docker-compose.prod.yml` (adds Caddy auto-HTTPS) and is the recommended
> way to get customers joining from anywhere.

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

---

## F. Free public deploy (Oracle Cloud + DuckDNS + HTTPS)

The simplest way to get **a public URL where customers join via invite link with
real audio/video** — for free. Uses an Oracle Always-Free VM, a free DuckDNS
hostname, and the `docker-compose.prod.yml` overlay (adds **Caddy** for automatic
Let's Encrypt HTTPS in front of nginx).

> HTTPS is **required**: browsers block camera/mic on plain `http://` for any
> non-`localhost` host.

### F.1 — Create the VM
- Oracle Cloud free tier (<https://www.oracle.com/cloud/free/>): a
  **VM.Standard.A1.Flex** Ubuntu 22.04 instance (up to 4 OCPU / 24 GB, ARM, free).
- Note its **public IP**.

### F.2 — Open ports (in BOTH places)
WebRTC needs the UDP ranges or video silently fails.

| Port(s) | Proto | Purpose |
|---|---|---|
| 80, 443 | TCP | HTTP/HTTPS (Caddy + Let's Encrypt) |
| 3478 | UDP+TCP | TURN/STUN |
| 49160–49200 | UDP | TURN relay range |
| 40000–40100 | UDP+TCP | SFU media |

- **Oracle Security List**: add Ingress rules (Source `0.0.0.0/0`) for each.
- **On the VM** (`iptables`), open the same ports and persist:
  ```bash
  sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
  sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
  sudo iptables -I INPUT -p udp --dport 3478 -j ACCEPT
  sudo iptables -I INPUT -p tcp --dport 3478 -j ACCEPT
  sudo iptables -I INPUT -p udp --dport 49160:49200 -j ACCEPT
  sudo iptables -I INPUT -p udp --dport 40000:40100 -j ACCEPT
  sudo iptables -I INPUT -p tcp --dport 40000:40100 -j ACCEPT
  sudo netfilter-persistent save
  ```

### F.3 — Free hostname (DuckDNS)
- At <https://www.duckdns.org>, create e.g. `atom-support.duckdns.org` and point
  it at the VM's **public IP**. Verify with `ping atom-support.duckdns.org`.

### F.4 — Install Docker + clone
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
git clone https://github.com/RamanAsolekar/atomquest.git
cd atomquest && cp .env.example .env
```

### F.5 — Configure `.env`
```ini
PUBLIC_HOST=atom-support.duckdns.org      # your DuckDNS host

# Browser endpoints stay EMPTY (same-origin through Caddy/nginx)
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_WS_URL=
NEXT_PUBLIC_MEDIA_WS_URL=

MEDIA_ANNOUNCED_IP=<VM_PUBLIC_IP>         # the SFU's reachable IP
STUN_URL=stun:stun.l.google.com:19302
TURN_URL=turn:<VM_PUBLIC_IP>:3478         # enable bundled coturn
TURN_REALM=atom-support.duckdns.org
TURN_USER=atom
TURN_PASS=<strong secret>

# Replace ALL secrets (openssl rand -hex 64 / 32)
JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...
INVITE_TOKEN_SECRET=...
COOKIE_SECRET=...
POSTGRES_PASSWORD=...
GRAFANA_ADMIN_PASSWORD=...
```
Keep `DATABASE_URL` in sync with `POSTGRES_PASSWORD`.

### F.6 — Start with HTTPS
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```
Caddy auto-provisions the Let's Encrypt cert for `PUBLIC_HOST` (needs DNS to point
at the VM and ports 80/443 open). Verify:
```bash
docker compose ps
curl -s https://atom-support.duckdns.org/api/health
```

### F.7 — Use it
- App: **`https://atom-support.duckdns.org`**
- **Agent** signs in → creates a session → **Invite** → copies the link.
- **Customer** opens `https://atom-support.duckdns.org/join/<token>` on any device
  → green room → joins with camera/mic.
- **Admin** signs in for live sessions, analytics, audit, runtime config.

The invite URL is built from the request host, so it already points at your HTTPS
domain. **Change the seeded passwords before sharing publicly.**

### F.8 — Update after code changes
```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose restart nginx   # only if /rtc/ briefly 502s after a media rebuild
```

### Verification checklist
- [ ] `https://<host>/` loads with a valid padlock.
- [ ] Invite link opens on a **different device/network** and connects.
- [ ] Both sides see/hear each other (validates `MEDIA_ANNOUNCED_IP` + TURN).
- [ ] If signaling connects but no media flows → wrong `MEDIA_ANNOUNCED_IP` or a
      closed UDP port (recheck F.2 in **both** Oracle and `iptables`).

> A **$4–6/mo Hetzner/DigitalOcean VPS** follows the identical steps from F.2 and
> is the most reliable paid alternative if Oracle signup is fussy.
