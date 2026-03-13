# Wave 154 — Mobile Dark Theme Navigator Fix

## What Was Done
- AppNavigator.js: replaced all hardcoded hex colors (#1e40af, #ffffff, #e5e7eb, #6b7280) with useThemeStyles() tokens
- AppNavigator.js: added React Navigation theme integration (DefaultTheme/DarkTheme + navTheme override)
- AppNavigator.js: created shared `themedHeader` config applied to all stack screens (reduced 200+ lines of duplicated header options)
- ProfileScreen.js: converted to use useThemeStyles() for all colors
- package.json: added @field-ops/theme as file dependency
- metro.config.js: added @field-ops/theme resolution for Metro bundler

## Verification Results
- Static tests: 18/18 passed (theme imports, no hardcoded hex, regression checks)
- E2E against staging: 3/3 passed (API health, login, dashboard renders)
- D03 Release Gate: 63/63 passed
- Screenshots: 2 captured (dashboard, work-orders)
- Note: Mobile-specific changes (tab bar, headers, loading screen) require Expo reload for device verification

## Gaps
- Mobile changes are code-only at this stage — phone device verification requires Expo tunnel reload
- Dark mode visual confirmation requires toggling theme on device

## DO NOT TOUCH Integrity
- All navigation routes preserved (Login, MainTabs, all stack screens)
- Authentication flow unchanged (isAuthenticated check, navigationRef)
- Tab screen configuration (icons, labels, badge counts) unchanged
- No web app changes — no regression risk
