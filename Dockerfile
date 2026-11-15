# Production image. Uploads MUST be mounted as a persistent volume at /data/uploads.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production PRIVATE_UPLOAD_DIR=/data/uploads PORT=3000
RUN groupadd -r app && useradd -r -g app app && mkdir -p /data/uploads && chown app:app /data/uploads
COPY --from=build /app ./
RUN npm prune --omit=dev && chown -R app:app /app
USER app
EXPOSE 3000
# Migrations are a separate, controlled release step: `docker run ... npx prisma migrate deploy`
CMD ["npx", "next", "start", "-p", "3000"]
