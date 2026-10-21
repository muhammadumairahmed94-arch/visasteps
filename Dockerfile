# UHA Legal client portal — production image.
#   runner: the portal itself (Next.js standalone server)
#   tools:  full toolchain for one-off commands (migrations, admin:create, setup:onedrive, init:production)

FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS tools
# Backups: pg_dump matching the Postgres 16 server (PGDG repo) and age for encryption
RUN apt-get update && apt-get install -y --no-install-recommends curl gnupg age \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 \
 && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npx prisma generate && touch .env
ENV NODE_ENV=production

FROM tools AS build
RUN npx next build

FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NODE_OPTIONS=--max-old-space-size=512
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
RUN mkdir -p /data/queue /data/local-storage && chown -R node:node /data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
