# Phase 2 — Known Limitations

> Last updated: August 2026.  
> Authoritative rules sources: WPA Blackball Rules of Play (effective 2025-09-15) and IEPF International Rules, both linked from [wpapool.com/rules/](https://wpapool.com/rules/).

This document records every rules-layer simplification or gap in the Phase 2 implementation. It is NOT a bug list — these are intentional scope decisions. Each item notes what is modelled and what is not.

---

## 1. Foul-consequence rules — MODELLED

| Aspect | Blackball | International |
|--------|-----------|---------------|
| Incoming entitlement after foul | Free shot from baulk (cue ball behind baulk line; can nominate any ball) | Ball in hand anywhere on the table |
| Loss-of-frame foul | Deliberate foul on 8-ball after all group balls are potted | Deliberate foul on 8-ball after all group balls are potted |

This is the one genuine tactical difference that is fully modelled and used in the `tac5_foul_recovery` scenario.

---

## 2. What is NOT modelled

### 2.1 Blackball — unsupported rules

| Rule | WPA Reference | Status |
|------|--------------|--------|
| Stalemate procedure (referee calls "touching ball", etc.) | Rule 5.6 | Not modelled |
| Simultaneous foul by both players | Rule 5.4 | Not modelled |
| Cue ball touching an object ball (snookered-on-own-ball edge case) | Rule 5.5 | Not modelled |
| Push-out rule (where it exists in some local variants) | Not in WPA Blackball | N/A — WPA Blackball does not include a push-out |
| Interference by a non-player | Rule 7 | Not modelled |
| Shot-clock rules in tournament play | Rule 8 | Not modelled |
| Detailed referee-call procedures | Section 7 | Not modelled |

### 2.2 International Rules — unsupported rules

| Rule | Status |
|------|--------|
| Push-out rule (specific IEPF variant) | Not modelled — push-outs require an additional deliberate-foul / free-ball pass exchange that is not represented in the current drill structure |
| Stalemate / threefold repetition | Not modelled |
| Referee-declared ball-in-hand (referee spots ball) | Not modelled |
| Simultaneous foul | Not modelled |
| Shot clock in tournament play | Not modelled |

---

## 3. Break rules — PARTIALLY MODELLED

### Blackball (modelled)
- ≥2 balls must pass the middle pockets from the break, or ≥1 ball potted.
- 8-ball potted on break: respot + free shot from baulk for incoming player.
- Group is NOT assigned on the break regardless of what is potted.

### International (modelled)
- ≥4 object balls must reach a cushion, or ≥1 ball potted.
- 8-ball potted on break: respot, breaker does NOT receive a penalty; incoming player does NOT get ball-in-hand (modelled as respot-only).

### Not modelled (both rulesets)
- Break is evaluated via caller-supplied `cushionContactCount` / `ballsOverMiddle` flags — there is no real ball-tracking physics.
- Players can manually record these flags but the app cannot automatically detect them.

---

## 4. Group-assignment rules — PARTIALLY MODELLED

Both rulesets: groups are assigned to the player who first pots a coloured ball after the break. This is correctly modelled.

**Not modelled:**
- "Splitting" at the start of the break (specific tournament formats).
- Automatic group assignment on break pots (both rulesets: correct — groups are NOT assigned on the break itself even if a coloured ball is potted).
- Simultaneous group assignment when both players pot in the same visit (referee decision required).

---

## 5. Free shot / ball-in-hand interactions — PARTIALLY MODELLED

### Blackball free-shot (modelled)
- Incoming player receives one free shot from baulk.
- Can nominate any ball (own group, opponent group, or even 8-ball under certain conditions).
- The app models the nomination choice as a decision drill.

### Not modelled
- The specific geometry of the baulk D / baulk line — the app presents the concept but does not render it spatially.
- "Hidden" positions where no ball is accessible from baulk (referee intervenes) — not modelled.
- "Cue ball in baulk, all balls in baulk" special case (rare).

---

## 6. 8-Ball (black ball) rules — MODELLED

- 8-ball may only be potted once all balls of the player's group have been potted (both rulesets).
- Potting the 8-ball prematurely = loss of frame (both rulesets).
- `isEightBallLegal()` returns false unless `playerBallsRemaining === 0` and `groupAssignment === "assigned"`.

**Not modelled:**
- The precise pocket(s) in which the 8-ball must be potted in some tournament variants.
- Jump shots over the 8-ball when it is the only remaining ball.

---

## 7. Decision drills — scope

The current MVP models one genuine multi-ruleset scenario (`tac5_foul_recovery`) where the rules materially change the correct decision. Artificial differences were intentionally excluded.

Other scenarios (e.g., safety play, snooker attempts, pattern planning) have the same correct answer under both rulesets and are shared.

---

## 8. Clearance modelling

### Phase 2 correction
- All clearances now use one player group (yellows) + optional obstacle reds + 8-ball.
- Opponent reds are marked `role: "obstacle"` and are not offered as legal targets.
- `isEightBallLegal` prevents the 8-ball from being selected until all player yellows are potted.

### Not modelled
- Balls potted "out of order" by accident in a real clearance (e.g., opponent ball goes in).
- Balls touching the cushion in a clearance (restricted shots).
- The "touching ball" rule when the cue ball is frozen against an object ball.

---

## 9. Mixed Training — scope

`preferredRulesMode: "mixed"` is a training preference, not a third ruleset.

- All execution drills are shared across both rulesets (no separate execution ratings per ruleset).
- Decision confidence is tracked per ruleset using `attempt.ruleset` tags.
- The mixed-mode split adapts based on relative ruleset-specific confidence, with a 25% minimum for each ruleset.
- In-session ruleset transitions are announced to the player with a brief transition card.

**Not modelled:**
- Per-ruleset execution ratings (deliberate scope decision — execution is treated as ruleset-independent).
- Ruleset-specific clearance variants (Phase 2 clearances are compatible with both rulesets).
