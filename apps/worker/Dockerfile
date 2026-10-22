# Worker de Scout: consume la cola y ejecuta el pipeline
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
RUN npm ci --omit=dev --workspace @scout/worker --workspace @scout/core --include-workspace-root=false || npm ci
COPY packages ./packages
COPY apps/worker ./apps/worker
ENV NODE_ENV=production
CMD ["node_modules/.bin/tsx", "apps/worker/src/index.ts"]
