---
name: 8-Ball Coach architecture
description: Phase delivery status, key architecture decisions, and build/test commands for the 8-Ball Coach adaptive coaching app.
---

## Phase delivery

- **Phase 1** — COMPLETE. Committed `af56e95`. Adaptive engine, drills, clearances, UI. Tests A–O passing.
- **Phase 2** — COMPLETE. Committed `db3e0b8`. Multi-ruleset foundation: Blackball/International rule helpers, mixed-mode session generation, per-ruleset confidence tracking. Tests P–X, Y–AD, rules helpers passing.
- **Phase 2.1** — COMPLETE. Committed `3ea2d3e`, pushed. 20 integrity fixes + tests AE–AV (all 73 tests A–AV passing).
- **Phase 3** — COMPLETE. Committed `aaa3a1d`, pushed to `origin/main`. Real-match adaptive coaching intelligence. Tests AW–BN (all 111 tests A–BN passing).

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
17. `docs/phase-2-known-limitations.md` updated

## Phase 3 scope

- `src/match/index.ts` — full match module: types, MATCH_CONFIG, FRAME_LOSS_CATEGORIES (12), POSITIVE_EVENT_TYPES (6), all pure functions
- `src/persistence/matchStorage.ts` — `loadMatches()` / `saveMatches()` using `"8bc:matches"` key
- `src/engine/index.ts` — `generateSession` accepts `options?: { lfOverride?: LimitingFactors }`; `generateAdaptiveSession` is the orchestration wrapper
- `src/App.tsx` — Matches tab (5-item nav), 6 match sub-views, match state + actions, `generateAdaptiveSession` replaces `generateSession` in `startSession`
- Tests AW–BN (38 tests, all passing)

## Key architectural decisions — Phase 3

- **Engine stays frozen**: only seam is `options?.lfOverride ?? limitingFactor(profile)` in `generateSession`
- **Match events do NOT write to profile.skills** — they only shift priority via `computeMatchPriorityBoost` → `matchAwareLimitingFactor`
- **`generateAdaptiveSession(profile, matches, minutes)`** is the thin orchestration wrapper; it computes match-aware LF then passes it as `lfOverride` to the frozen `generateSession`
- Match data stored in `"8bc:matches"` localStorage key, never mixed with profile
- Decision skills respect ruleset filtering in boost calculation; execution skills are ruleset-agnostic (aggregate across rulesets)
- A skill qualifies for LF status from match evidence alone if `boost >= MATCH_CONFIG.qualifyingBoostThreshold (0.3)`
- `matchWeightInLF = 0.3` — match evidence shifts but cannot fully override training evidence
- `positiveDiscountFactor = 0.3` — positive match events dampen error boosts, don't eliminate them
- `inferMatchCause`: "missed_pot" → inferredCause: "positional"; all other categories → direct skill; positive events → null

## Key architectural decisions — Phases 1–2

- `"mixed"` is a `RulesMode` training preference only; `RuleSetId = "blackball" | "international"` — never "mixed"
- Execution skills are SHARED across rulesets; only decision skills have per-ruleset confidence tracking
- `attempt.ruleset === null` = genuinely shared execution; clearance execution attempts are tagged with `activeRuleset` (not null) since clearances run under a specific ruleset
- `updateRulesMode` lives in `profileStorage.ts` — NOT `engine/index.ts` (would create circular dep)
- `ClearanceRunner` uses `useState` for `remaining / attempted / potted` (not `useRef`) so `legalTargets` useMemo recomputes correctly after each shot
- Plan quality scored by `evaluatePlannedRoute(planned, clearance)` — NEVER auto-awarded
- `onFinish(profile, summary, rootCauseEvents)` — SessionRunner extracts root-cause events at session end

## Build / test commands

```sh
# Type-check
cd artifacts/mockup-sandbox && npx tsc --noEmit

# Tests (111 tests, A–BN)
pnpm --filter @workspace/mockup-sandbox run test:engine

# Full production build
cd artifacts/mockup-sandbox && PORT=3000 BASE_PATH=/mockup-sandbox pnpm run build
```

## Import gotchas

- `updateRulesMode` must be imported from `../persistence/profileStorage` in tests (not from engine)
- `evaluatePlannedRoute`, `applyClearanceBallResult`, `ADAPTATION_SKILL_MAP`, `buildRootCauseEvents`, `selectMaintenanceSkill`, `decayRootCauseScore`, `ROOT_CAUSE_CONFIDENCE_MAP`, `LimitingFactors` exported from `./engine/index.ts`
- Match module exports `buildFrameEvent`, `buildMatchSummary`, `computeMatchPriorityBoost`, `matchAwareLimitingFactor`, `generateAdaptiveSession`, `createMatch`, `addFrame`, `editFrame`, `deleteFrameFromMatch`, `completeMatch`, `deleteMatch`, `frameScore`, `FRAME_LOSS_CATEGORIES`, `POSITIVE_EVENT_TYPES` from `./match`
