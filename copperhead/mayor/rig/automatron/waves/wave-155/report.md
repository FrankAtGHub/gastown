# Wave 155 — Mobile Dark Theme Remaining Hardcoded Colors

## What Was Done
- EndOfDayScreen.tsx: replaced ~15 hardcoded hex colors with theme tokens (success, error, warning, info, textMuted, successBg, errorBg, borderLight, infoBg)
- LoginScreen.tsx: replaced 3 hardcoded hex colors (error border/text, version text opacity). SSO brand icons (#F25022 etc) and Apple button (#000000) intentionally preserved.
- CrewClockInScreen.tsx: replaced ~13 hardcoded hex colors (roleBadge colors, error icon/text, banner border, QR button text, clocked-in border, avatar text, status dots, clock-out button). Shadow #000 preserved (iOS platform constant).
- PhotoCaptureScreen.native.tsx: replaced ~14 hardcoded hex colors (category chip selected, camera button, gallery border/text, retry button, error overlay/icons, upload indicators, permission modal, photo type selector, caption save). Photo viewer chrome (#1a1a1a, #2a2a2a, #333, #000) intentionally preserved.

## Verification Results
- Static tests: 20/20 passed (useThemeStyles imports, hook calls, createStyles parameterized, no non-exempt hex colors)
- D03 Release Gate: 63/63 passed
- Note: Mobile-specific changes require Expo reload for device verification

## Exempt Hardcoded Colors (Intentional)
- SSO brand icons: Microsoft (#F25022, #7FBA00, #00A4EF, #FFB900), Google (#4285F4, #34A853, #FBBC05, #EA4335), Apple (#000000)
- Apple SSO button: #000000 bg, #ffffff text (brand requirement)
- iOS shadowColor: #000 (platform constant, not theme-dependent)
- Photo viewer chrome: #000, #1a1a1a, #2a2a2a, #333 (always-dark photo overlay, standard UX)
- Modal overlays: rgba(0,0,0,*) (semi-transparent, not theme-dependent)

## Gaps
- Mobile changes are code-only — phone device verification requires Expo tunnel reload
- Dark mode visual confirmation requires toggling theme on device

## DO NOT TOUCH Integrity
- All screen functionality preserved (clock-in/out, photo capture, end-of-day, login)
- No navigation changes
- No API call changes
- No business logic changes — purely visual token substitution
