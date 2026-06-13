#!/usr/bin/env bash
# One-command bootstrap for Atom Support Vision.
set -euo pipefail

echo "🛰️  Atom Support Vision — quickstart"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "→ created .env from .env.example"
fi

echo "→ building & starting the stack (this may take a few minutes the first time)…"
docker compose up -d --build

echo "→ waiting for the backend to become healthy…"
for i in $(seq 1 60); do
  if curl -fsS http://localhost:4000/health >/dev/null 2>&1; then echo "   backend is up"; break; fi
  sleep 3
done

echo "→ seeding demo users…"
docker compose exec -T backend sh -c "npm run db:seed" || true

cat <<'EOF'

✅ Ready!

   App      : http://localhost            (or http://localhost:3000)
   API docs : http://localhost:4000/api/docs
   Grafana  : http://localhost:3001       (admin / admin)
   MinIO    : http://localhost:9001

   Agent    : agent@atomvision.dev / Agent@123
   Admin    : admin@atomvision.dev / Admin@123
   Customer : join via an invite link generated from a session

EOF
