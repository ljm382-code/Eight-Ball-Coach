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

## Test suite
- 335 tests total, all passing
- Tests A–GP = Phases 1–4.7
- Tests GQ–HQ (33 new) = Phase 4.8 geometry completeness contract
- Tests HR–IO (34 new) = Phase 4.9 missing cue balls, player group, sequence diagrams

## Phase 4.8 summary
- Added `VisualContract` type to engine
- Added `visualContract?` field to `Drill` and `Clearance` types
- Authored `TrainingDiagram` for every previously-missing drill (20+ drills)
- Updated `cue1` and `pbe1` diagrams to add missing fields
- Added `visualContract` to all 38 drills and 3 clearances
- Added new `pbd3` drill ("Late-Development Risk", difficulty 6, decision type)
- Added `validatePlayableDrillGeometry()`, `diagramSignature()`, `diagramDistance()` helpers
- Added `PLAYABLE_DRILLS` and `PLAYABLE_CLEARANCES` exports (filtered by validity)
- `generateSession()` now filters drills through `validatePlayableDrillGeometry`
- Added `TrainingDiagramAudit` dev-only component in App.tsx (accessible via `?__audit`)
- 41/41 items (38 drills + 3 clearances) pass geometry validation

## Key counts
- DRILLS: 38 (not 30 as session-summary claimed — tactical family has 7 drills)
- CLEARANCES: 3 (clr3, clr4, clr5)
- PLAYABLE_DRILLS: 38
- PLAYABLE_CLEARANCES: 3

## Drill family breakdown
- Execution: pot1-4, spd1-4, pos1-4, cue1-3, pbe1-3, brk1-3, 8b1-3 = 24
- Decision: pat1-4, pbd1-3, tac1-4, tac5_foul_recovery, tac_bb1, tac_int1 = 14
- Total: 38

## Key files
- `artifacts/mockup-sandbox/src/engine/index.ts` — engine core (~2083 lines after 4.8)
- `artifacts/mockup-sandbox/src/App.tsx` — UI + TrainingDiagramAudit component
- `artifacts/mockup-sandbox/src/engine/engine.test.ts` — 301 tests

## Key engine facts
- Coordinate system: x=0–100 (rack/left → baulk/right), y=0–100 (top → bottom)
- BAULK_FRACTION = 0.775, D_RADIUS_FRACTION = 0.22, BLACK_SPOT_X_FRACTION = 0.25
- Break drill CB must be at x > BAULK_FRACTION × 100 = 77.5
- `createEnglishEightBallRack(apexX, apexY)` — returns 15 balls, apex ball ID "Y1"
- Push pattern: git commit → git checkout -b tmp origin/main → git cherry-pick <sha> → gitPush({branch:"main"}) → git checkout main → git branch -D tmp

**Why:** Tracking phase completions avoids re-implementing what's already done and provides accurate test count expectations for future phases.
