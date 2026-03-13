# Wave 153 — Theme Standardizer Phase 2: Web App Integration

## What Was Done
- Created `packages/theme/src/tailwind-preset.ts` — maps tokens to Tailwind color config via CSS variables (ESM)
- Created `packages/theme/src/css-variables.ts` — generates CSS custom property names and values from tokens
- Created `packages/theme/tailwind-colors.cjs` — CJS-compatible color map for Tailwind config consumption
- Updated `packages/theme/src/index.ts` — barrel re-exports for css-variables and tailwind-preset
- Updated `packages/theme/package.json` — added export paths for `./tailwind-preset` and `./css-variables`, bumped to v0.1.0
- Updated `apps/web/tailwind.config.cjs` — imports fieldOpsColors, extends theme with `fo` namespace (26 tokens)
- Updated `apps/web/src/input.css` — injected 26 CSS custom properties for `:root` (light) and `.dark` scopes
- Updated `apps/web/Dockerfile` — copies `packages/theme/` and symlinks as `@field-ops/theme`

## Verification Results
- Static tests: 22/22 passed (package structure, CJS loading, web integration, regression)
- CSS variables confirmed in deployed app: `--fo-background=#f8fafc`, `--fo-primary=#1e40af`, `--fo-text=#0f172a`
- Dashboard and work orders pages render correctly after deploy
- D03 Release Gate: 63/63 passed
- Screenshots: 2 captured (dashboard-light, work-orders)

## Gaps
- No existing web components migrated to `fo-*` classes yet — this is Phase 4 (optional incremental codemod)
- Dark mode CSS variables set but no existing components use them yet (they still use raw Tailwind dark: classes)

## DO NOT TOUCH Integrity
- Existing Tailwind dark mode (`darkMode: 'class'`) preserved
- All scrollbar styles in input.css preserved
- Original theme tokens (lightTokens, darkTokens, statusTokens) unchanged
- Mobile app imports from `@field-ops/theme` unaffected
- shared-domain and shared-ui packages unmodified
