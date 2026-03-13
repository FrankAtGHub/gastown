# Wave 156 — Theme Standardizer Phase 3: Docs App Integration

## What Was Done
- tailwind.config.ts: imported fieldOpsColors from CJS bridge, added `fo` namespace (26 tokens) to theme.extend.colors. Preserved fumadocs preset and brand colors.
- global.css: injected 26 `--fo-*` CSS custom properties for `:root` (light) and `.dark` (dark) scopes. Preserved fumadocs-ui style import and Tailwind directives.
- package.json: added `@field-ops/theme` as file dependency
- Dockerfile: updated to monorepo-root build context pattern. Copies `packages/theme`, creates `@field-ops/theme` symlink, preserves standalone Next.js output.

## Pattern Match
Mirrors Wave 153 (web app) exactly:
- Same CJS bridge (`tailwind-colors.cjs`) for Tailwind config consumption
- Same 26 `--fo-*` CSS variables in `:root` and `.dark` blocks
- Same Docker symlink pattern for build resolution

## Verification Results
- Static tests: 15/15 passed (imports, namespaces, CSS var counts, regressions)
- E2E: 3/3 passed (docs site renders, staging login, dashboard)
- D03 Release Gate: 63/63 passed
- Screenshots: 2 captured (docs-home, dashboard)
- Note: Docs site needs rebuild+deploy to verify fo-* classes render. Current verification confirms no regression.

## Gaps
- Docs site rebuild+deploy required to visually confirm fo-* Tailwind classes work
- No existing docs components use fo-* classes yet — this wave only wires the plumbing

## DO NOT TOUCH Integrity
- fumadocs-ui preset preserved in Tailwind config
- brand colors (amber palette) preserved
- darkMode: 'class' preserved
- fumadocs-ui/style.css import preserved in global.css
- All existing docs functionality unchanged
