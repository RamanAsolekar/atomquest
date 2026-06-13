# Atom Support Vision — FastAPI backend
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System deps: curl for healthcheck, libpq for psycopg2/asyncpg, build for bcrypt
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl libpq5 gcc && rm -rf /var/lib/apt/lists/*

COPY apps/backend/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY apps/backend/ ./

EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD curl -fsS http://localhost:4000/health || exit 1

# Run migrations, then start uvicorn (the app also auto-seeds idempotently on boot).
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 4000 --proxy-headers"]
