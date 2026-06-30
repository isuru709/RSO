FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json ./
COPY backend/services/shared/package.json ./backend/services/shared/
COPY backend/services/booking-service/package.json ./backend/services/booking-service/
RUN npm install --ignore-scripts
COPY backend/services/shared/tsconfig.json ./backend/services/shared/
COPY backend/services/shared/src/ ./backend/services/shared/src/
RUN npm run build -w backend/services/shared
COPY backend/services/booking-service/tsconfig.json ./backend/services/booking-service/
COPY backend/services/booking-service/src/ ./backend/services/booking-service/src/
RUN npm run build -w backend/services/booking-service

FROM node:22-alpine AS runner
RUN addgroup -g 1001 -S appgroup && adduser -u 1001 -S appuser -G appgroup
WORKDIR /app
COPY package.json ./
COPY backend/services/shared/package.json ./backend/services/shared/
COPY backend/services/booking-service/package.json ./backend/services/booking-service/
RUN npm install --omit=dev --ignore-scripts
COPY --from=builder /app/backend/services/shared/dist ./backend/services/shared/dist
COPY --from=builder /app/backend/services/booking-service/dist ./backend/services/booking-service/dist
USER appuser
EXPOSE 3004
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3004/health || exit 1
CMD ["node", "backend/services/booking-service/dist/index.js"]
