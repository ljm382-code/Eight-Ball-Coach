---
name: 8-Ball Coach architecture
description: Phase delivery status, key architecture decisions, and build/test commands for the 8-Ball Coach adaptive coaching app.
---

## Phase delivery

- **Phase 1** — COMPLETE. Adaptive engine, drills, clearances, UI. Tests A–O.
- **Phase 2** — COMPLETE. Multi-ruleset: Blackball/International helpers, mixed mode, confidence tracking. Tests P–AD.
- **Phase 2.1** — COMPLETE. 20 integrity fixes, tests AE–AV. 73 total.
- **Phase 3** — COMPLETE. Real-match adaptive coaching intelligence. Tests AW–BN. 111 total.
- **Phase 3.1** — COMPLETE. Integrity patch. Tests BO–BZ. 149 total.
- **Phase 4** — COMPLETE. Committed `88e28c7`, pushed to `origin/main`. Premium UX/UI redesign. Display helper tests CA–CJ. 159 total tests.
- **Phase 4.1** — COMPLETE. Sage-Teal Balanced visual theme. Committed locally `f7bed69`, pushed to `origin/main` as `f3712b0` (via Git Data API, rebased on top of `a09c012` deploy-pages commit). 159 tests still pass. TypeScript clean. Production build clean.

## Phase 4.1 — Sage-Teal Balanced theme (palette-only swap)

- **COLORS constant** introduced: `background #F2F5F1`, `surface #FFFFFF`, `surfaceTeal #EAF3F1`, `surfaceSage #EEF3EF`, `primary #2E7F7C`, `primaryDark #1F4F4C`, `sage #86A695`, `slateBlue #527A8E`, `gold #C79A38`, `text #1E2B25`, `textSecondary #6B7874`, `border #DDE4E0`, `success #2F7D4C`, `danger #B84A3A`.
- **C alias** maps old `C.xxx` names to new COLORS values — all existing component references unchanged.
- **Gold vs primary teal**: `C.brass` → `COLORS.primary` (teal) for most uses; targeted overrides apply `COLORS.gold` for: RulesBadge blackball, PRIORITY badge, active match banner, POSITION LOST label, Summary adaptation note, TIER_LABELS highrisk, won-match score colors.
- **Won score colors**: `won ? C.green : C.rust` everywhere (green win, red loss) — NOT primary teal.
- **Btn text**: primary/success/danger variants use `"#FFFFFF"` (not `C.bg` / `C.ink` which would be dark).
- **Pool table cloth**: changed from dark green `#1a4d33` to teal `#2A8790`.
- **Pool ball colours**: hardcoded in `ExecDrillDiagram`/`DecisionDrillDiagram`/`simpleBalls` — `#5d99b2` (blue ball), `#c49b58` (gold/yellow ball) — decoupled from theme palette.
- **Card**: added `boxShadow: "0 1px 4px rgba(30,43,37,0.07)"` for depth on white background.
- **LibraryView filter tabs**: `DDE4E0` track, white selected tab with teal text.

## Phase 4 scope (UX/UI redesign — engine FROZEN)

- **Design system**: Refined cue-sports palette; spacing constants `SP`; radius constants `R`.
- **Navigation**: TODAY / MATCHES / TRAIN / PROGRESS / MORE (was Today/Matches/Library/Progress/Rules). `NAV_ITEMS` array with `target` view; `navTab()` maps all sub-views. TRAIN tab → `pickTime`, MORE tab → `settings`.
- **Nav hidden during**: `["session", "assessment"]` (HIDE_NAV). `session` view gets its own lean shell without bottom nav.
- **AppShell**: Separate slim header for session view; mode badge in header; safe-area bottom padding.
- **Onboarding**: 3 screens — brand/hero, "how it works" numbered list, rules picker.
- **Dashboard**: Hero card with coaching reason quote; secondary grid (current focus, session mix); recent match card with `matchCoachingLine()`; recent sessions; skill profile link.
- **PickTime**: Shows current LF priority above duration chips; "Browse drill library" secondary link.
- **Pool table SVG**: `PoolTable` component — proper proportions, 6 pockets, baize surface, frame rail, ball specs with radial gradient highlights. Replaces old crude `TableDiagram`. `ExecDrillDiagram` and `DecisionDrillDiagram` convenience components.
- **DrillRunner**: Full-screen layout — diagram above, card below; tier labels use `TIER_LABELS` map; decision options styled as full-width cards.
- **ClearanceRunner**: SVG pool table with colored balls; "Just Play" option alongside "Confirm Plan"; improved plan UI with numbered items.
- **SessionRunner**: Ruleset transition card shows "NEXT / INTERNATIONAL RULES" / "NEXT / BLACKBALL" with Bebas display; progress bar with %.
- **Summary**: 4 sections — What held up well / What limited you / Key insight / What changes next. Two CTAs: Return to Today + View Progress.
- **LogFrameView**: "Did you win the frame?" → big Won/Lost targets (80px min-height). Lost → grid of category tiles. Impact simplified to 3 choices: Minor / Important / Frame-deciding (mapped via `displayToImpact`).
- **MatchActiveView**: 72px score hero; two large frame buttons (Won/Lost, 64px); secondary grid for Edit Last + View Frames; W/L badges in frame log.
- **MatchHistoryView**: Match cards with score, ruleset badge, competition badge, outcome, coaching line; empty state with 🎱 icon.
- **MatchCompleteView**: Centred large score; MATCH WON/LOST; 4 cards (Takeaway / Key Issues / Training vs Match / What Changes Next).
- **ProgressView**: Focus card first; radar; balance bars; Shot-Making section (exec skills); Table-Reading section (decision skills); skill cards with rating, level, trend, confidence display, progress bar, ruleset breakdown for mixed.
- **LibraryView**: Filter tabs (All/Execution/Decision); priority badge on skill groups; ruleset badge per drill.
- **SettingsView** (MORE tab): Renamed; includes training mode selector, rules notes, drill library link, reset.
- **EmptyState** component: icon + title + body pattern.
- **RulesBadge**: Now has subtle background tint (`#22` alpha), border, and colour-matched text (brass for BB, chalk for INT).

## Display helpers (pure, exported from App.tsx, tested CA–CJ)

| Helper | Maps |
|--------|------|
| `ratingLevel(n)` | 0–34 Foundation → 86+ Elite (6 bands) |
| `confidenceDisplay(tier, stale)` | Low/Emerging/Established/Strong → plain copy; stale overrides |
| `rulesetBadgeLabel(ruleset)` | "BLACKBALL" / "INTERNATIONAL" |
| `impactLabel(impact)` | low/medium/high → Minor/Important; decisive → Frame-deciding |
| `displayToImpact(display)` | Minor → low; Important → high; Frame-deciding → decisive |
| `matchCoachingLine(match)` | One-line coaching takeaway for match cards |

## Key architectural decisions — Phase 4

- Engine, match, rules, persistence modules are **completely unchanged**.
- All state and handlers in `App()` are **unchanged** — only JSX/styles redesigned.
- `PickTime` now receives `profile` and `matches` props to compute LF for priority display (presentation only).
- `Summary` now receives `onProgress` prop to navigate directly to progress view.
- `SettingsView` now receives `onLibrary` prop for library shortcut.
- No new npm dependencies added.
- `displayToImpact` replaces the 4-option impact grid with 3-option simplified choices (Minor/Important/Frame-deciding). Internally maps to `low`/`high`/`decisive` — `"medium"` impact is no longer selectable via UI (existing stored data unaffected).

## Phase 3.1 scope (three integrity fixes)

1. **Root-cause guessing removed** — `inferMatchCause` no longer maps plain `missed_pot` → "positional". Plain missed pot stays as direct potting issue (`inferredCause = null`). Upstream causes only inferred when optional `precededBy` field is provided.
2. **Edit Last Frame is non-destructive** — `editLastFrame()` sets `editFrameId` and navigates to `matchEditFrame`. No deletion, no mutation. `editFrame()` only called on Save; Cancel is fully non-destructive.
3. **Mixed Training uses match-derived ruleset evidence** — `matchAwareMixedSplit(profile, matches, now)` blends training split with ruleset-specific match error boosts; `generateAdaptiveSession` passes `splitOverride` for mixed mode.

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

# Tests (159 tests, A–BZ + CA–CJ)
pnpm --filter @workspace/mockup-sandbox run test:engine

# Full production build
cd artifacts/mockup-sandbox && PORT=3000 BASE_PATH=/mockup-sandbox pnpm run build
```

## Import gotchas

- `updateRulesMode` must be imported from `../persistence/profileStorage` in tests (not from engine)
- Display helpers (`ratingLevel`, `confidenceDisplay`, `rulesetBadgeLabel`, `impactLabel`, `displayToImpact`) are exported from `../App` — referenced in engine.test.ts
- Match module exports: `buildFrameEvent`, `buildMatchSummary`, `computeMatchPriorityBoost`, `computeRulesetMatchBoost`, `matchAwareLimitingFactor`, `matchAwareMixedSplit`, `generateAdaptiveSession`, `createMatch`, `addFrame`, `editFrame`, `deleteFrameFromMatch`, `completeMatch`, `deleteMatch`, `frameScore`, `FRAME_LOSS_CATEGORIES`, `POSITIVE_EVENT_TYPES`
- `App.tsx` imports `type FrameEvent, type Frame` from `./match` (needed for `saveFrameEdit` and `EditFrameView`)
