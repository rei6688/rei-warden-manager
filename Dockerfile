# ── Stage 1: Build frontend ───────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:20-alpine

# Install rclone and tar
RUN apk add --no-cache ca-certificates tar curl && \
    curl -fsSL https://downloads.rclone.org/rclone-current-linux-amd64.zip -o /tmp/rclone.zip && \
    unzip /tmp/rclone.zip -d /tmp/rclone && \
    mv /tmp/rclone/rclone-*/rclone /usr/local/bin/rclone && \
    chmod +x /usr/local/bin/rclone && \
    rm -rf /tmp/rclone /tmp/rclone.zip && \
    apk add --no-cache unzip

WORKDIR /app

# Install backend dependencies
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Copy backend source
COPY backend/server.js ./

# Copy built frontend into a static directory served by backend
COPY --from=frontend-builder /build/frontend/dist ./public

# Serve static files from backend (add static middleware)
# The server already handles API routes; we add a static fallback for the frontend.
# This is handled at runtime via express.static in server.js (see ENV below).

# Create necessary directories
RUN mkdir -p /vw-data /backups /config /var/log

# Expose app port
EXPOSE 3001

# Environment variable defaults (override at runtime)
ENV PORT=3001 \
    APP_PASSWORD=changeme \
    JWT_SECRET="" \
    DATA_DIR=/vw-data \
    BACKUP_DIR=/backups \
    LOG_FILE=/var/log/backup.log \
    CONFIG_DIR=/config \
    STATIC_DIR=/app/public

CMD ["node", "server.js"]
