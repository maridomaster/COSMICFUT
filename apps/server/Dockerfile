# COSMICFUT server — build a partir da RAIZ do monorepo:
#   docker build -f apps/server/Dockerfile -t cosmicfut-server .
#   docker run -p 8787:8787 -v cosmicfut-data:/data -e CORS_ORIGINS=https://seu-front.example cosmicfut-server
# (o BuildKit usa apps/server/Dockerfile.dockerignore automaticamente)
FROM node:26-slim

# (carreira online salva) /data guarda as carreiras: monte um VOLUME PERSISTENTE nele (sem volume, tudo some no deploy)
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    PERSIST_DIR=/data \
    DATA_DIR=/app/apps/web/public/data \
    LOBBY_TTL_MS=21600000 \
    ROOM_UNLOAD_MS=600000 \
    MAX_BACKUP_MB=30 \
    PUBLIC_URL_FILE=/data/public-url.txt

WORKDIR /app

# manifests primeiro (cache das dependências)
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace @cosmicfut/server --ignore-scripts && npm cache clean --force

# código (TypeScript roda direto com o type stripping do Node) + dados do jogo (só JSON, sem assets)
COPY packages/shared/src packages/shared/src
COPY packages/engine/src packages/engine/src
COPY apps/server/src apps/server/src
COPY apps/web/public/data apps/web/public/data

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/server/src/start.ts"]
