---
name: 8-Ball Coach architecture
description: Phase delivery status, key architecture decisions, and build/test commands for the 8-Ball Coach adaptive coaching app.
---

## Phase delivery

- **Phase 1** — COMPLETE. Committed `af56e95`. Adaptive engine, drills, clearances, UI. Tests A–O passing.
- **Phase 2** — COMPLETE. Committed `db3e0b8`. Multi-ruleset foundation: Blackball/International rule helpers, mixed-mode session generation, per-ruleset confidence tracking. Tests P–X, Y–AD, rules helpers passing.
- **Phase 2.1** — COMPLETE. Committed `3ea2d3e`, pushed. 20 integrity fixes + tests AE–AV (all 73 tests A–AV passing).
- **Phase 3** — COMPLETE. Committed `aaa3a1d`. Real-match adaptive coaching intelligence. Tests AW–BN (111 total tests passing).
- **Phase 3.1** — COMPLETE. Committed `09a3404`, pushed to `origin/main`. Integrity patch. Tests BO–BZ (149 total tests passing).

## Phase 3.1 scope (three integrity fixes)

1. **Root-cause guessing removed** — `inferMatchCause` no longer maps plain `missed_pot` → "positional". Plain missed pot stays as direct potting issue (`inferredCause = null`). Upstream causes only inferred when optional `precededBy` field is provided with structured evidence.
2. **Edit Last Frame is now non-destructive** — Phase 3 deleted the frame then re-logged it (unsafe). Phase 3.1 uses true edit semantics: frame preserved in state, `EditFrameView` opens with preloaded values, `editFrame()` only called on Save; Cancel is fully non-destructive.
3. **Mixed Training uses match-derived ruleset evidence** — `matchAwareMixedSplit(profile, matches, now)` blends training split with ruleset-specific match error boosts; `computeRulesetMatchBoost(matches, ruleset, now)` aggregates decision-skill evidence per ruleset; `generateAdaptiveSession` passes `splitOverride` into `generateSession`.

## Phase 3 scope

- `src/match/index.ts` — full match module: types, MATCH_CONFIG, FRAME_LOSS_CATEGORIES (12), POSITIVE_EVENT_TYPES (6), all pure functions
- `src/persistence/matchStorage.ts` — `loadMatches()` / `saveMatches()` using `"8bc:matches"` key
- `src/engine/index.ts` — `generateSession` accepts `options?: { lfOverride?: LimitingFactors; splitOverride?: { blackball; international } }`
- `src/App.tsx` — Matches tab (5-item nav), 7 match sub-views (including `matchEditFrame`), match+editFrame state + actions, `generateAdaptiveSession` replaces `generateSession` in `startSession`
- Tests AW–BN (38 tests); BO–BZ (38 tests); 149 total tests A–BZ, all passing.

## Key architectural decisions — Phase 3.1

- **`inferMatchCause(category, skillId, precededBy?)`** — takes optional `precededBy`; `PRECEDED_BY_SKILL` map converts "poor_position" → "positional", "poor_speed" → "speed", etc. No inference without structured evidence.
- **`FrameEvent.precededBy?: string`** — optional upstream context field; stored on the event for round-trip persistence.
- **`EditFrameView`** — separate component from `LogFrameView`; preloads `frame.result`, `frame.keyEvents[0]?.category`, `frame.keyEvents[0]?.impact`. Save calls `saveFrameEdit()` → `editFrame()`. Cancel navigates back without any state mutation.
- **`editLastFrame`** — now sets `editFrameId` and navigates to `"matchEditFrame"`. NO deletion, NO mutation.
- **`computeRulesetMatchBoost(matches, ruleset, now)`** — sums decayed boost across all decision skills for one ruleset.
- **`matchAwareMixedSplit`** — blends `mixedRulesetSplit(profile)` with match error fractions; influence scales with evidence volume (capped 30%); floor 25% always preserved.
- **`generateAdaptiveSession`** — now also passes `splitOverride` for mixed mode.

## Key architectural decisions — Phases 1–3

- `"mixed"` is a `RulesMode` training preference only; `RuleSetId = "blackball" | "international"` — never "mixed"
- Execution skills are SHARED across rulesets; only decision skills have per-ruleset confidence tracking
- Match events do NOT write to `profile.skills` — they only shift priority via `computeMatchPriorityBoost` → `matchAwareLimitingFactor`
- Match data stored in `"8bc:matches"` localStorage key, never mixed with profile
- `updateRulesMode` lives in `profileStorage.ts` — NOT `engine/index.ts` (would create circular dep)

## Build / test commands

```sh
# Type-check
cd artifacts/mockup-sandbox && npx tsc --noEmit

# Tests (149 tests, A–BZ)
pnpm --filter @workspace/mockup-sandbox run test:engine

# Full production build
cd artifacts/mockup-sandbox && PORT=3000 BASE_PATH=/mockup-sandbox pnpm run build
```

## Import gotchas

- `updateRulesMode` must be imported from `../persistence/profileStorage` in tests (not from engine)
- `evaluatePlannedRoute`, `applyClearanceBallResult`, `ADAPTATION_SKILL_MAP`, `buildRootCauseEvents`, `selectMaintenanceSkill`, `decayRootCauseScore`, `ROOT_CAUSE_CONFIDENCE_MAP`, `LimitingFactors`, `mixedRulesetSplit` all exported from `./engine/index.ts`
- Match module exports: `buildFrameEvent`, `buildMatchSummary`, `computeMatchPriorityBoost`, `computeRulesetMatchBoost`, `matchAwareLimitingFactor`, `matchAwareMixedSplit`, `generateAdaptiveSession`, `createMatch`, `addFrame`, `editFrame`, `deleteFrameFromMatch`, `completeMatch`, `deleteMatch`, `frameScore`, `FRAME_LOSS_CATEGORIES`, `POSITIVE_EVENT_TYPES` from `./match`
- `App.tsx` imports `type FrameEvent, type Frame` from `./match` (needed for `saveFrameEdit` and `EditFrameView`)
