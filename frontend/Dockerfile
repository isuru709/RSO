# ============================================================================
# Frontend Dockerfile (Production — serves via Nginx)
# ============================================================================

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json ./
COPY frontend/package.json ./frontend/
RUN npm install --ignore-scripts -w frontend
COPY frontend/ ./frontend/
RUN npm run build -w frontend

FROM nginx:1.27-alpine AS runner
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:80/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
