# syntax=docker/dockerfile:1
FROM node:18-alpine AS base
WORKDIR /usr/src/app

# Install deps first (better layer caching)
COPY package*.json ./
# Use npm install with production-only to avoid lockfile mismatch errors during CI builds
RUN npm install --omit=dev --no-audit --no-fund

# Copy source
COPY . .

ENV NODE_ENV=production \
    PORT=5002

EXPOSE 5002

# Ensure uploads dir exists at runtime
RUN mkdir -p /usr/src/app/uploads

# Run migrations on container start, then start server
CMD ["sh", "-c", "node ./scripts/migrate.js && node ./scripts/migrate-json-to-pg.js || true; node server.js"]
