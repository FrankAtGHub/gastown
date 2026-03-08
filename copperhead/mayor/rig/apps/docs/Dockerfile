# =============================================================================
# Field Ops Docs - Production Dockerfile
# =============================================================================
# Build context: monorepo root (run with -f apps/docs/Dockerfile .)
# =============================================================================

FROM node:20-alpine AS builder
WORKDIR /app

# Copy theme package (needed by Tailwind config)
COPY packages/theme ./packages/theme

# Copy docs app
COPY apps/docs/package.json apps/docs/package-lock.json ./apps/docs/
WORKDIR /app/apps/docs
COPY apps/docs/source.config.ts ./
RUN npm ci

# Symlink theme package for Tailwind config resolution
RUN mkdir -p node_modules/@field-ops && \
    ln -s /app/packages/theme node_modules/@field-ops/theme

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
