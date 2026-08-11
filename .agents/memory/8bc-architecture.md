---
name: 8-Ball Coach architecture
description: Phase 1+2 complete — rules module layout, mixed mode, key import gotchas, build env vars
---

# 8-Ball Coach — durable architecture notes

## Rules module layout (`src/rules/`)
- `types.ts` — pure interfaces shared by both rule modules; no engine imports
- `blackball.ts` — WPA Blackball rule implementations; exports `BLACKBALL_DEFINITION` and named helpers
- `international.ts` — IEPF International implementations; exports `INTERNATIONAL_DEFINITION` and named helpers
- `index.ts` — unified dispatch helpers (`getLegalBalls`, `isEightBallLegal`, `resolveFoulConsequences`, `getCueBallPlacement`, `resolveGroupAssignment`, `resolveBreakOutcome`, `evaluateDecision`, `FOUL_RECOVERY_SCENARIO_OPTIONS`)

## Key import gotcha
`updateRulesMode` lives in `src/persistence/profileStorage.ts`, NOT in `src/engine/index.ts`.
Engine cannot export it (circular dep: persistence → engine). Tests must import from persistence.

## Build env vars
`pnpm run build` requires both `PORT` and `BASE_PATH` set:
```
PORT=3000 BASE_PATH=/mockup-sandbox pnpm run build
```

## Mixed mode
`preferredRulesMode: "mixed"` is a training preference, NOT a third `RuleSetId`.
- `RuleSetId` = `"blackball" | "international"` only
- Execution attempts tagged `ruleset: null` (shared); decision attempts tagged with the active ruleset
- `mixedRulesetSplit()` adapts BB/INT proportions based on relative ruleset-specific confidence; 25% minimum floor each

## The one genuine tactical difference
Foul recovery scenario (`tac5_foul_recovery`):
- Blackball: free shot from baulk → snooker/safety is often optimal (limited angles from D)
- International: ball in hand anywhere → attack is strongly optimal
This is the only authored scenario with `rulesetOptions` overrides; all other scenarios share the same correct answer.

## Clearance model
All clearances use one player group (yellows) + optional obstacle reds + 8-ball.
Opponent reds have `role: "obstacle"` and are NEVER offered as selectable targets.
`isEightBallLegal` prevents 8-ball selection until `playerBallsRemaining === 0`.

## Test suite
Tests A–O: Phase 1 engine (must remain passing, never weaken)
Tests P–X: Ruleset layer
Tests Y–AD: Mixed training mode
Rules helpers: blackball/international helpers + unified dispatchers
Run: `pnpm --filter @workspace/mockup-sandbox run test:engine`

**Why:** Engine is complex enough that regressions are silent without tests; the split matters.
**How to apply:** Any engine/rules change must re-run the full test suite before commit.
