---
name: 8-Ball Coach architecture
description: Phase completion status, test count, file locations, and key engine exports for the 8-Ball Coach app.
---

## Completion status
- Phases 1–4.7: complete and pushed (commit 65f9ac3)
- Phase 4.8: complete and pushed (commit f0cea39 on origin/main)
  - Commit message: "Standardize geometry across all training drills"
- Phase 4.9: complete and pushed (commit 5b51f94 on origin/main)
  - Commit message: "Fix missing diagrams and player group context"
- Phase 5: complete and pushed (commit 89abe79 on origin/main)
  - Commit message: "Improve training geometry and decision variety"

## Test suite
- 372 tests total (A–JX), all passing
- Tests A–GP = Phases 1–4.7
- Tests GQ–HQ (33 new) = Phase 4.8 geometry completeness contract
- Tests HR–IO (34 new) = Phase 4.9 missing cue balls, player group, sequence diagrams
- Tests IP–JX (37 new) = Phase 5 geometry axis, helpers, drill QA, pbd3 spatial claims

## Phase 5 summary
- New engine types: `ShotAxis`, `SpatialClaim`
- New Drill fields: `shotAxis?`, `spatialClaims?`
- New `TrainingDiagram` field: `routeSegments?: RouteSegment[]`
- New helpers (all exported): `inferPrimaryShotAxis`, `isLongAxisShot`, `shuffleDecisionOptions`,
  `generateBallOrderPermutations`, `formatRouteSequence`, `validateUniqueDecisionOptions`, `auditOptimalOptionPositions`
- `validatePlayableDrillGeometry` now checks declared `shotAxis` matches `inferPrimaryShotAxis`
- Drill fixes: pot3/cue2/pos1/cue1 all redesigned to long-axis geometry, brk1-3 got `shotAxis:"long"`
- pat1 opt-d replaced (was duplicate of opt-b — "play numbered order")
- pbd3 fully rewritten: renamed LATEPROB→Y3, near top cushion (y=8), R1 blocker (y=20), focusBallId:"Y3", spatialClaims
- tac_int1 gained `tableMarkings: { showBaulkLine: true, showD: true }`
- cue2 gained `routeSegments` for draw-back path visual
- App.tsx: decision options now shuffled per-attempt (seeded Fisher-Yates via `shuffleDecisionOptions`)
- TrainingDiagramAudit updated to "Phase 5" with axis/optCount/optimalPos/dupCheck columns

## Key counts
- DRILLS: 38 (not 30 as session-summary claimed — tactical family has 7 drills)
- CLEARANCES: 3 (clr3, clr4, clr5)
- PLAYABLE_DRILLS: 38 (41/41 geometry validations pass including clearances)
- PLAYABLE_CLEARANCES: 3

## Drill family breakdown
- Execution: pot1-4, spd1-4, pos1-4, cue1-3, pbe1-3, brk1-3, 8b1-3 = 24
- Decision: pat1-4, pbd1-3, tac1-4, tac5_foul_recovery, tac_bb1, tac_int1 = 14
- Total: 38

## Key files
- `artifacts/mockup-sandbox/src/engine/index.ts` — engine core (~2220 lines after Phase 5)
- `artifacts/mockup-sandbox/src/App.tsx` — UI + TrainingDiagramAudit component
- `artifacts/mockup-sandbox/src/engine/engine.test.ts` — 372 tests (A–JX)

## Key engine facts
- Coordinate system: x=0–100 (rack/left → baulk/right), y=0–100 (top → bottom)
- Table orientation: LANDSCAPE — X is the LONG axis, Y is the short axis
- `inferPrimaryShotAxis` threshold: deltaX > deltaY × 1.5 AND deltaX > 20 → "long"
- `isLongAxisShot` threshold: deltaX > deltaY AND deltaX ≥ 55 (strict qualifying long shot)
- BAULK_FRACTION = 0.775, D_RADIUS_FRACTION = 0.22, BLACK_SPOT_X_FRACTION = 0.25
- Break drill CB must be at x > BAULK_FRACTION × 100 = 77.5
- `createEnglishEightBallRack(apexX, apexY)` — returns 15 balls, apex ball ID "Y1"
- Push pattern: git commit → git checkout -b tmp origin/main → git cherry-pick <sha> → git push origin HEAD:main → git checkout main → git branch -D tmp

## tac5_foul_recovery special case
- Uses `rulesetOptions` (not base `options`) — base options array has no "optimal" tier
- Per-ruleset checks in test JX must iterate `rulesetOptions` entries, not base opts

**Why:** Tracking phase completions avoids re-implementing what's already done and provides accurate test count expectations for future phases.
