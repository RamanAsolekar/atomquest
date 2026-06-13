# ---- Build stage ----
FROM node:20-bookworm-slim AS build
WORKDIR /repo
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_WS_URL=http://localhost:4000
ARG NEXT_PUBLIC_MEDIA_WS_URL=http://localhost:5000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_MEDIA_WS_URL=$NEXT_PUBLIC_MEDIA_WS_URL

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN npm install --workspaces --include-workspace-root || npm install

COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN npm -w @atom/web run build

# ---- Runtime stage (Next standalone) ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# With outputFileTracingRoot at the repo root, the standalone bundle preserves
# the monorepo layout: server.js lives under apps/web/.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD curl -fsS http://localhost:3000 || exit 1
CMD ["node", "apps/web/server.js"]
