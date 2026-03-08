# =============================================================================
# Field Ops Docs - Production Dockerfile
# =============================================================================
# Build context: monorepo root (run with: docker build -f apps/docs/Dockerfile .)
# =============================================================================

FROM node:20-alpine AS builder

# Set up directory structure matching monorepo layout
# so relative paths (../../packages/theme) resolve correctly
WORKDIR /app/apps/docs

# Copy theme package first (tailwind.config.ts references ../../packages/theme/)
COPY packages/theme /app/packages/theme

# Copy docs app package files and install deps
COPY apps/docs/package.json apps/docs/package-lock.json ./
COPY apps/docs/source.config.ts ./
RUN npm install

# Ensure theme package symlink exists
RUN mkdir -p node_modules/@field-ops && \
    ln -sf /app/packages/theme node_modules/@field-ops/theme

# Copy full docs app source
COPY apps/docs/ .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/docs/.next/standalone ./
COPY --from=builder /app/apps/docs/.next/static ./.next/static
COPY --from=builder /app/apps/docs/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
