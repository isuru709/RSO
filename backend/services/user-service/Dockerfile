# ============================================================================
# User Profile Service — Multi-stage Docker Build
# Context: project root (Resource Share/)
# ============================================================================
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json ./
COPY backend/services/shared/package.json ./backend/services/shared/
COPY backend/services/user-service/package.json ./backend/services/user-service/

RUN npm install --ignore-scripts

COPY backend/services/shared/tsconfig.json ./backend/services/shared/
COPY backend/services/shared/src/ ./backend/services/shared/src/
RUN npm run build -w backend/services/shared

COPY backend/services/user-service/tsconfig.json ./backend/services/user-service/
COPY backend/services/user-service/src/ ./backend/services/user-service/src/
RUN npm run build -w backend/services/user-service

# ============================================================================
FROM node:22-alpine AS runner
RUN addgroup -g 1001 -S appgroup && adduser -u 1001 -S appuser -G appgroup
WORKDIR /app

COPY package.json ./
COPY backend/services/shared/package.json ./backend/services/shared/
COPY backend/services/user-service/package.json ./backend/services/user-service/

RUN npm install --omit=dev --ignore-scripts

COPY --from=builder /app/backend/services/shared/dist ./backend/services/shared/dist
COPY --from=builder /app/backend/services/user-service/dist ./backend/services/user-service/dist

# Pre-create uploads directory with correct ownership
RUN mkdir -p /app/uploads/avatars && chown -R appuser:appgroup /app/uploads

USER appuser
EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3002/health || exit 1

CMD ["node", "backend/services/user-service/dist/index.js"]
