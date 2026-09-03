# Foreman (CMS Agent) — container image for hosting on a NAS, a VPS, Railway, Render or Fly.
# Build from the cms-agent directory:  docker build -f server/Dockerfile -t foreman .
FROM node:22-slim AS build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --no-audit --no-fund
COPY server/ ./
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production PORT=8787 CMS_AGENT_DB=/data/cms-agent.db
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/server/dist ./dist
COPY server/knowledge ./knowledge
COPY web /app/web
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "dist/index.js"]
