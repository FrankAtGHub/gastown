# Agent Instructions

## MANDATORY PRE-READ GATE (DO NOT SKIP)

**Before writing ANY code in copperhead/mayor/rig/, you MUST read:**

1. **`docs/PROTECTED-SYSTEMS.md`** — 9 protected systems. Breaking these causes cascading bugs.
   - System 5 (Estimates/Line Items/BOM) — multiplier chain, pricing modes, snapshot columns
   - System 2 (Theme/Colors) — dark mode class patterns
   - System 4 (Multi-tenant) — every query needs tenant_id
2. **`docs/GOTCHAS.md`** — Mistakes already made. Do not repeat them.
3. **If touching estimates/pricing:** Read the DB trigger `calculate_estimate_line_totals` in migration 129 AND the snapshot columns in migration 130 BEFORE changing any calculation logic.
4. **If adding RBAC middleware:** Apply `requireRole()` per-route on write operations (POST/PATCH/DELETE). Do NOT use `router.use()` which blocks GETs for all roles.

**Post-mortem (2026-02-24):** Wave 58 applied router-level RBAC that blocked GET endpoints for dispatchers/techs on billing and estimate areas. Always leave GETs open unless there's an explicit security reason to restrict reads.

---

## WAVE VALIDATION GATE (MANDATORY — 2026-02-24 Post-Mortem)

**The mayor takes shortcuts.** To prevent shipping unverified work, every wave MUST follow this protocol:

### Before Starting Wave N: Validate Wave N-1

**DO NOT start a new wave until the previous wave's deliverables are verified:**

1. **Locate previous wave directory** — `docs/waves/wave-XX/` or equivalent
2. **Check for screenshots** — Must exist. If missing, the previous wave is NOT complete.
   - Screenshots must show the actual feature working in the app (not just code)
   - At minimum: one screenshot per changed page/component
3. **Check for reports** — D03 release gate report, test results, or verification summary
   - If no report exists, the previous wave skipped the release gate
4. **If deliverables are missing** — Do NOT proceed. Go back and complete Wave N-1 first.
5. **Log validation** — Note in your wave handoff: "Validated Wave N-1: screenshots ✓, report ✓"

### During Each Wave: Step-by-Step

```
Step 1: PRIME — Read wave requirements, read PROTECTED-SYSTEMS.md, read GOTCHAS.md
Step 2: IMPLEMENT — Write code (TDD: failing test → implementation → passing test)
Step 3: VALIDATE — Take screenshots of every changed page/feature. Generate test report.
Step 4: SELF-CHECK — Review your own screenshots. Does the feature actually work?
         - If screenshots show errors, broken UI, or missing data → fix before proceeding
         - If you cannot take screenshots (no display) → document why and flag for E2E
Step 5: RELEASE GATE — Run D03 gate checks (tests pass, lint clean, build succeeds)
Step 6: COMMIT & PUSH — Only after Steps 3-5 are complete
```

### What Counts as Validation

| Deliverable | Required | Example |
|---|---|---|
| Screenshots | YES — per changed page | `wave-53/billing-dark-mode-invoices.png` |
| Test report | YES — jest + lint output | `wave-53/test-results.txt` |
| D03 gate | YES — pass/fail summary | `wave-53/d03-gate.md` |
| Handoff notes | YES — what was done, what's next | In commit message or wave dir |

### Why This Exists

Waves 53-58 shipped with: router-level RBAC blocking GETs, untested calculation changes, no screenshots proving features work. Validation-first prevents regressions from compounding across waves.

---

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

