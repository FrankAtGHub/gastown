# =============================================================================
# Field Ops Web Dispatch - Production Dockerfile
# =============================================================================
# Multi-stage build for React/Vite app with nginx serving static files
#
# Build: docker build -t fieldops-web:latest .
# Run:   docker run -p 80:80 fieldops-web:latest
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files for workspaces
COPY package*.json ./

# Copy workspace packages source
COPY packages/shared-domain ./packages/shared-domain
COPY packages/shared-ui ./packages/shared-ui
COPY packages/theme ./packages/theme

# Build shared-domain package
WORKDIR /app/packages/shared-domain
RUN npm install --ignore-scripts
RUN npm run build

# Build shared-ui package (depends on shared-domain)
WORKDIR /app/packages/shared-ui
RUN npm install --ignore-scripts
RUN npm run build

# Copy web app package files
WORKDIR /app
COPY apps/web/package*.json ./apps/web/

# Install web app dependencies (--legacy-peer-deps for react-leaflet/React 19 compat)
WORKDIR /app/apps/web
RUN npm install --ignore-scripts --legacy-peer-deps

# Manually link workspace packages
RUN mkdir -p node_modules/@field-ops && \
    ln -s /app/packages/shared-domain node_modules/@field-ops/shared-domain && \
    ln -s /app/packages/shared-ui node_modules/@field-ops/shared-ui && \
    ln -s /app/packages/theme node_modules/@field-ops/theme

# Copy web app source
COPY apps/web ./

# Build arguments for environment configuration
ARG VITE_API_URL=/api
ARG VITE_DEMO_MODE=false
ARG VITE_SALESOPS=true

# Set build-time environment variables
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_DEMO_MODE=$VITE_DEMO_MODE
ENV VITE_SALESOPS=$VITE_SALESOPS

# Build the application (vite build only, skip tsc type-check in CI)
RUN npx vite build

# -----------------------------------------------------------------------------
# Stage 2: Production
# -----------------------------------------------------------------------------
FROM nginx:alpine AS production

# Copy custom nginx configuration
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder stage
COPY --from=builder /app/apps/web/build /usr/share/nginx/html

# Create non-root user for security (nginx needs specific setup)
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown -R nginx:nginx /var/run/nginx.pid

# Switch to non-root user
USER nginx

# Expose port 80
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:80/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
