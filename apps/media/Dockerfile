# ---- Build stage ----
# mediasoup compiles a native worker, so we need python3 + build tooling.
FROM node:20-bookworm-slim AS build
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip build-essential pkg-config && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/media/package.json apps/media/
RUN npm install --workspaces --include-workspace-root || npm install

COPY packages/shared ./packages/shared
COPY apps/media ./apps/media
RUN npm -w @atom/shared run build
RUN npm -w @atom/media run build

# ---- Runtime stage ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production \
    WHISPER_WORKER=/repo/apps/media/whisper_worker.py \
    WHISPER_PYTHON=python3
WORKDIR /repo
# FFmpeg powers server-side recording + STT audio tap; python3 runs faster-whisper.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg curl python3 python3-pip && rm -rf /var/lib/apt/lists/*

# faster-whisper (self-hosted STT). CPU int8 build keeps the image lean; for GPU
# nodes swap in a CUDA base + ctranslate2-gpu. --break-system-packages for slim.
RUN pip3 install --no-cache-dir --break-system-packages faster-whisper==1.1.0 numpy || \
    echo "faster-whisper install skipped (worker degrades gracefully)"

# Root node_modules holds hoisted workspace deps incl. the compiled mediasoup worker.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared ./packages/shared
COPY --from=build /repo/apps/media/dist ./apps/media/dist
COPY --from=build /repo/apps/media/package.json ./apps/media/
COPY apps/media/whisper_worker.py ./apps/media/whisper_worker.py

WORKDIR /repo/apps/media
EXPOSE 5000
# RTC media ports + recording/STT RTP ports are published in docker-compose.
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD curl -fsS http://localhost:5000/health || exit 1
CMD ["node", "dist/index.js"]
