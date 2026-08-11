---
name: 8-Ball Coach architecture
description: Phase delivery status, key architecture decisions, and build/test commands for the 8-Ball Coach adaptive coaching app.
---

## Phase delivery

- **Phase 1** — COMPLETE. Committed `af56e95`. Adaptive engine, drills, clearances, UI. Tests A–O passing.
- **Phase 2** — COMPLETE. Committed `db3e0b8`. Multi-ruleset foundation: Blackball/International rule helpers, mixed-mode session generation, per-ruleset confidence tracking. Tests P–X, Y–AD, rules helpers passing.
- **Phase 2.1** — COMPLETE. Committed `3ea2d3e`, pushed to `origin/main`. 20 integrity fixes + tests AE–AV (all 73 tests A–AV passing). See scope below.
- **Phase 3** — NOT YET AUTHORISED.

## Phase 2.1 scope (what was fixed)

1. `applyClearanceBallResult` — pure function; failed ball stays in `remaining`, not potted
2. Explicit `plannedRoute / attemptedRoute / pottedRoute / remaining` separation via `ClearanceRouteState`
3. `evaluatePlannedRoute` — scores plan against authored routes, never auto-awards optimal
4. `ADAPTATION_SKILL_MAP` — routes adaptation choices to correct decision skill
5. Clearance attempts in mixed mode tagged with `activeRuleset` (not `null`)
6. Decision and execution evidence kept strictly separate in clearances
7. `sessionWeighting(profile, lfOverride?)` — confirmed LF shifts 12pp, provisional 6pp, clamped 25–75%
8. `selectMaintenanceSkill` — due-based: Established+ confidence, rating ≥ 50, not trained in last 7 days
9. Clearance slot reserved from `totalCount`, not appended (with dedup safety fill)
10. Final session composition validator + safety fill prevents count shrinkage from dedup
11. `RootCauseEvent` type on Profile; `rootCauseTally` kept as deprecated legacy
12. `decayRootCauseScore` — exponential decay, 21-day half-life; numeric confidence 0–1
13. `mixedRulesetSplit` Phase 1 (calibration) / Phase 2 (performance) allocation
14. Mixed mode priority: low confidence → calibrate; adequate → weaker performer gets more
15. Blackball/International rule-source accuracy reviewed; RULESETS.unsupportedNote updated
16. Tests AE–AV covering all above
17. Commit message: `"Fix Phase 2 adaptive and ruleset integrity"`
18. `docs/phase-2-known-limitations.md` updated — 8-ball-on-break rule documented as engine-captured but not exposed as a training scenario

## Key architectural decisions

- `"mixed"` is a `RulesMode` training preference only; `RuleSetId = "blackball" | "international"` — never "mixed"
- Execution skills are SHARED across rulesets; only decision skills have per-ruleset confidence tracking
- `attempt.ruleset === null` = genuinely shared execution; clearance execution attempts are tagged with `activeRuleset` (not null) since clearances run under a specific ruleset
- `updateRulesMode` lives in `profileStorage.ts` — NOT `engine/index.ts` (would create circular dep)
- `ClearanceRunner` uses `useState` for `remaining / attempted / potted` (not `useRef`) so `legalTargets` useMemo recomputes correctly after each shot
- Plan quality scored by `evaluatePlannedRoute(planned, clearance)` — NEVER auto-awarded
- Adaptation choices routed via `ADAPTATION_SKILL_MAP` to correct decision skill
- `onFinish(profile, summary, rootCauseEvents)` — SessionRunner extracts root-cause events at session end and passes them to App for persistence
- `buildRootCauseEvents` is called at session end inside SessionRunner, appended to `profile.rootCauseEvents` in `finishSession`
- Calibration slot (fires when `normalCount >= 6`) uses `otherIds` filter to prevent duplicate IDs; safety fill after dedup guarantees final count matches SESSION_LENGTHS

## Build / test commands

```sh
# Type-check
cd artifacts/mockup-sandbox && npx tsc --noEmit

# Tests (73 tests, A–AV)
pnpm --filter @workspace/mockup-sandbox run test:engine

# Full production build
cd artifacts/mockup-sandbox && PORT=3000 BASE_PATH=/mockup-sandbox pnpm run build
```

## Import gotchas

- `updateRulesMode` must be imported from `../persistence/profileStorage` in tests (not from engine)
- `evaluatePlannedRoute`, `applyClearanceBallResult`, `ADAPTATION_SKILL_MAP`, `buildRootCauseEvents`, `selectMaintenanceSkill`, `decayRootCauseScore`, `ROOT_CAUSE_CONFIDENCE_MAP` are all exported from `./engine/index.ts`
- `LimitingFactors` type (for mock LF in tests) is also exported from `./engine/index.ts`
