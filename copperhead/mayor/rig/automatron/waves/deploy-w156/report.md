# Deploy Verification — Waves 150-156 Staging Refresh

## Services Deployed
| Service | Old Image | New Image | Status |
|---------|-----------|-----------|--------|
| fieldops-mobile | fieldops-mobile:staging (Feb 24) | fieldops-mobile:w156 | ✅ Deployed |
| fieldops-tech-web | fieldops-tech-web:latest (Feb 27) | fieldops-tech-web:w156 | ✅ Deployed |
| fieldops-docs | docs-web:latest | fieldops-docs:w156 | ✅ Deployed |
| fieldops-api | fieldops-api:w152b | unchanged | ✅ Running |
| fieldops-web | fieldops-web:w153 | unchanged | ✅ Running |

## Build Process
1. Mobile/Tech-web: `npx expo export --platform web` → nginx container (same Expo export, two containers)
2. Docs: `docker build -f apps/docs/Dockerfile .` from monorepo root (new Dockerfile with theme package support)
3. All images tagged `:w156`, transferred via `docker save | gzip | scp`, imported via `k3s ctr images import`
4. Deployed with `kubectl set image` + `kubectl rollout restart`

## Dockerfile Fix (Wave 156)
The docs Dockerfile was updated during deployment to use WORKDIR `/app/apps/docs` (matching monorepo layout) so the relative path `../../packages/theme/tailwind-colors.cjs` resolves correctly in both local dev and Docker builds.

## Verification Results — 9/9 Passed
- ✅ API login successful
- ✅ Dashboard renders
- ✅ Work orders endpoint healthy
- ✅ Clock-in verify endpoint accessible (wave 152 QR)
- ✅ Tech-web renders
- ✅ Tech-web /clock-in/ page accessible
- ✅ Docs site renders
- ✅ Docs has --fo-primary CSS variable (wave 156 theme tokens)
- ✅ Tech-web has React app root

## D03 Release Gate — 63/63 Passed
Duration: 52.5s, 0 failures.

## Screenshots Captured
- dashboard.png — web app dashboard
- tech-web-home.png — tech app home screen
- tech-web-clockin.png — /clock-in/ route (SPA)
- docs-home.png — docs site with theme CSS vars
