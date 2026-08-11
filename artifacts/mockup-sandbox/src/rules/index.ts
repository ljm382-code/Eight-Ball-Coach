/**
 * Unified rules-layer API.
 * All legality, group assignment, foul consequences, and scenario evaluation
 * MUST go through these helpers. The UI must not hard-code legality.
 */
import type { RuleSetId } from "../engine";
import type {
  TableState,
  FoulConsequence,
  BreakOutcome,
  BallDef,
  RulesetDefinition,
} from "./types";
import {
  BLACKBALL_DEFINITION,
  blackballFoulConsequence,
  blackballBreakOutcome,
  blackballGetLegalBalls,
  blackballIsEightBallLegal,
  blackballResolveGroupAssignment,
} from "./blackball";
import {
  INTERNATIONAL_DEFINITION,
  internationalFoulConsequence,
  internationalBreakOutcome,
  internationalGetLegalBalls,
  internationalIsEightBallLegal,
  internationalResolveGroupAssignment,
} from "./international";

export type { TableState, FoulConsequence, BreakOutcome, BallDef, RulesetDefinition };
export { BLACKBALL_DEFINITION, INTERNATIONAL_DEFINITION };

export const RULESET_DEFINITIONS: Record<RuleSetId, RulesetDefinition> = {
  blackball: BLACKBALL_DEFINITION,
  international: INTERNATIONAL_DEFINITION,
};

// ─── Core helpers ────────────────────────────────────────────────────────────

/**
 * Return the balls the player may legally target under the active ruleset.
 * The UI must call this and only offer legal targets.
 */
export function getLegalBalls(state: TableState): BallDef[] {
  return state.ruleset === "blackball"
    ? blackballGetLegalBalls(state)
    : internationalGetLegalBalls(state);
}

/**
 * Is the 8-ball/black currently a legal pot target?
 */
export function isEightBallLegal(state: TableState): boolean {
  return state.ruleset === "blackball"
    ? blackballIsEightBallLegal(state)
    : internationalIsEightBallLegal(state);
}

/**
 * Resolve group assignment after a pot.
 * Returns null playerGroup if not yet assigned.
 */
export function resolveGroupAssignment(
  state: TableState,
  pottedGroup: "red" | "yellow" | null
): { playerGroup: "red" | "yellow" | null; assigned: boolean } {
  return state.ruleset === "blackball"
    ? blackballResolveGroupAssignment(state.groupAssignment, pottedGroup)
    : internationalResolveGroupAssignment(state.groupAssignment, pottedGroup);
}

/**
 * Resolve foul consequences for the incoming player.
 */
export function resolveFoulConsequences(
  ruleset: RuleSetId,
  lossOfFrameFoul = false
): FoulConsequence {
  return ruleset === "blackball"
    ? blackballFoulConsequence(lossOfFrameFoul)
    : internationalFoulConsequence(lossOfFrameFoul);
}

/**
 * Structured cue-ball placement zone after a foul.
 * Blackball → baulk; International → anywhere.
 */
export function getCueBallPlacement(ruleset: RuleSetId): "baulk" | "anywhere" {
  return RULESET_DEFINITIONS[ruleset].foulRules.cueBallPlacement;
}

/**
 * Evaluate a player's decision choice for a given scenario under a specific ruleset.
 *
 * scenarioId maps to an authored scenario in the drills data.
 * If rulesetOptions are provided for the active ruleset, those tiers are used.
 * Falls back to the base options when no ruleset-specific override exists.
 *
 * Returns the tier and rationale for the given choice key.
 */
export function evaluateDecision(opts: {
  choiceKey: string;
  baseOptions: Array<{ key: string; tier: string; rationale: string }>;
  rulesetOptions?: Partial<Record<RuleSetId, Array<{ key: string; tier: string; rationale: string }>>>;
  ruleset: RuleSetId;
}): { tier: string; rationale: string } | null {
  const { choiceKey, baseOptions, rulesetOptions, ruleset } = opts;
  const pool = rulesetOptions?.[ruleset] ?? baseOptions;
  const match = pool.find((o) => o.key === choiceKey);
  return match ? { tier: match.tier, rationale: match.rationale } : null;
}

/**
 * Break outcome helper — dispatches to the correct ruleset.
 * Blackball uses ballsOverMiddle; International uses cushionContactCount.
 */
export function resolveBreakOutcome(opts: {
  ruleset: RuleSetId;
  potOccurred: boolean;
  blackPottedOnBreak: boolean;
  ballsOverMiddle?: number;
  cushionContactCount?: number;
}): BreakOutcome {
  const { ruleset, potOccurred, blackPottedOnBreak, ballsOverMiddle = 0, cushionContactCount = 0 } = opts;
  return ruleset === "blackball"
    ? blackballBreakOutcome({ ballsOverMiddle, potOccurred, blackPottedOnBreak })
    : internationalBreakOutcome({ cushionContactCount, potOccurred, blackPottedOnBreak });
}

// ─── Authored scenario evaluation for the genuinely different foul-recovery scenario ──

/**
 * Foul recovery scenario: opponent fouls; player must decide how to use the advantage.
 *
 * This is the one scenario in the current MVP where the correct answer materially
 * differs between rulesets due to the free-shot/baulk vs ball-in-hand difference.
 *
 * Blackball: cue ball in baulk + free shot (can nominate any ball).
 *   From baulk, an open pot may not be available — a safety/snooker can be optimal.
 *
 * International: ball in hand anywhere.
 *   Full positional freedom makes attacking strongly preferable.
 */
export const FOUL_RECOVERY_SCENARIO_OPTIONS: {
  key: string;
  label: string;
  baselineTier: string;
  baselineRationale: string;
  rulesetOverrides: Partial<Record<RuleSetId, { tier: string; rationale: string }>>;
}[] = [
  {
    key: "attack_direct",
    label: "Attack — pot a ball directly",
    baselineTier: "acceptable",
    baselineRationale: "Taking a pot can be correct, but consider your positional advantage first.",
    rulesetOverrides: {
      blackball: {
        tier: "acceptable",
        rationale:
          "From baulk you have limited angles — a direct attack is workable only if a pot is clearly on from the D.",
      },
      international: {
        tier: "optimal",
        rationale:
          "Ball in hand anywhere gives full positional freedom. Placing the cue ball for the best pot is strongly correct.",
      },
    },
  },
  {
    key: "snooker_safety",
    label: "Play a snooker or safety to extend the advantage",
    baselineTier: "acceptable",
    baselineRationale: "A safety compounds the opponent's difficulty, though it gives up a pot opportunity.",
    rulesetOverrides: {
      blackball: {
        tier: "optimal",
        rationale:
          "With a free shot from baulk, a nominated snooker is often the strongest play — " +
          "you keep control, can nominate the best ball, and the opponent faces another awkward position.",
      },
      international: {
        tier: "acceptable",
        rationale:
          "With ball in hand anywhere, you can almost always find a pot. A safety here gives up too much value unless the table is very locked up.",
      },
    },
  },
  {
    key: "play_random_contact",
    label: "Hit something without a clear plan",
    baselineTier: "poor",
    baselineRationale: "Wastes a significant positional advantage regardless of ruleset.",
    rulesetOverrides: {},
  },
  {
    key: "play_safe_passively",
    label: "Roll up safe without taking the free-shot advantage",
    baselineTier: "highrisk",
    baselineRationale: "Surrendering the full advantage of the foul is rarely correct.",
    rulesetOverrides: {
      blackball: { tier: "highrisk", rationale: "You have a free shot — wasting it by playing passively gives up a material edge." },
      international: { tier: "poor", rationale: "Ball in hand anywhere is too strong an advantage to waste with a passive roll-up." },
    },
  },
];
