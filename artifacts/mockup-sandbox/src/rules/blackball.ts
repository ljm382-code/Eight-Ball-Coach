/**
 * WPA Blackball (Blackball International) Rules
 * Source: WPA Rules of Play (effective 2025-09-15), Section 5 – Black ball
 *         https://wpapool.com/rules/
 *
 * Only the rules required by the current MVP training/scenario flows are modelled.
 * Unsupported edge cases are documented in docs/phase-2-known-limitations.md.
 */
import type { RulesetDefinition, TableState, FoulConsequence, BreakOutcome, BallDef } from "./types";

export const BLACKBALL_DEFINITION: RulesetDefinition = {
  id: "blackball",
  name: "Blackball Rules",
  description: "The compact, tactical game built around reds, yellows and the black.",
  reference: {
    objective:
      "Pot all balls of your assigned group (reds or yellows) and then legally pot the black to win the frame.",
    break:
      "Break from baulk. Legal break: ≥2 object balls cross the middle-pocket line, or ≥1 ball potted. " +
      "Failure: incoming player gets one free shot with cue ball in hand in baulk.",
    groups:
      "Table is open until the first pot after the break. The group containing the first legitimately potted " +
      "ball (or deliberately chosen ball during a free shot) is assigned to the pocketing player.",
    legalShots:
      "First ball struck must be the player's own group. During a free shot, any ball may be nominated as 'on'. " +
      "The cue ball must make contact with the nominated/on ball first.",
    fouls:
      "Standard fouls: pot opponent's ball, miss own ball, pot cue ball, etc. " +
      "Incoming player receives one free shot with cue ball in hand in baulk.",
    cueBallPlacement:
      "After a foul: cue ball in hand in baulk (the D). " +
      "During a free shot the player may play from anywhere within baulk.",
    eightBall:
      "Black may only be potted once all balls of the player's group have been potted. " +
      "Potting black at the wrong time or off an illegal shot = loss of frame.",
    deliberateFoul:
      "Deliberately touching or moving any ball without cue-ball contact, " +
      "or obvious deliberate foul where the referee is satisfied, may be ruled loss of frame.",
  },
  breakRules: {
    minBallsOverMiddle: 2,
    potAlternative: true,
    // WPA Blackball §5.5: black potted on break → respot, no free shot to incoming player;
    // breaker may continue if other balls were potted, else incoming plays from where cue ball lies.
    blackOnBreakAction: "respot_continue",
    breakerContinuesIfPot: true,
  },
  foulRules: {
    incomingEntitlement: "free_shot_baulk",
    cueBallPlacement: "baulk",
    freeShotGranted: true,
    canNominateAnyBall: true,
  },
};

/**
 * Resolve what the incoming player is entitled to after a foul under Blackball rules.
 * @param lossOfFrameFoul - true when the foul is of a severity that immediately ends the frame
 */
export function blackballFoulConsequence(lossOfFrameFoul = false): FoulConsequence {
  return {
    incomingEntitlement: "free_shot_baulk",
    cueBallPlacement: "baulk",
    freeShotGranted: true,
    canNominateAnyBall: true,
    lossOfFrame: lossOfFrameFoul,
    respotBlack: false, // black is only respot if pocketed illegally
    note: lossOfFrameFoul
      ? "Loss of frame: deliberate or serious foul."
      : "Incoming player: cue ball in hand in baulk, one free shot — any ball may be nominated as 'on'.",
  };
}

/**
 * Determine whether the break was legal under Blackball rules.
 * Minimal model: does not track exact ball positions; uses caller-supplied flags.
 */
export function blackballBreakOutcome(opts: {
  ballsOverMiddle: number;
  potOccurred: boolean;
  blackPottedOnBreak: boolean;
}): BreakOutcome {
  const { ballsOverMiddle, potOccurred, blackPottedOnBreak } = opts;
  const legal = ballsOverMiddle >= 2 || potOccurred;
  return {
    legalBreak: legal,
    potOccurred,
    blackPottedOnBreak,
    groupAssigned: false, // groups never assigned on the break itself
    continuesTurn: legal && potOccurred && !blackPottedOnBreak,
    note: blackPottedOnBreak
      ? "Black potted on break: respot. Breaker continues if other balls were potted, else incoming player plays."
      : legal
      ? potOccurred
        ? "Legal break with pot: breaker continues. Groups not yet assigned."
        : "Legal break, no pot: incoming player's turn. Groups not yet assigned."
      : "Illegal break: incoming player gets one free shot with cue ball in hand in baulk.",
  };
}

/**
 * Resolve group assignment under Blackball rules.
 * Assignment occurs on the first pot of a coloured ball after the break
 * (or on a deliberately chosen nominated ball during a free shot).
 */
export function blackballResolveGroupAssignment(
  currentAssignment: "open" | "assigned",
  pottedGroup: "red" | "yellow" | null
): { playerGroup: "red" | "yellow" | null; assigned: boolean } {
  if (currentAssignment === "assigned" || pottedGroup === null) {
    return { playerGroup: null, assigned: currentAssignment === "assigned" };
  }
  return { playerGroup: pottedGroup, assigned: true };
}

/**
 * Return the IDs of balls the player may legally select under Blackball rules.
 *
 * During a normal shot: player must strike their own group first.
 * During a free shot (after opponent foul): any ball may be nominated.
 * 8-ball/black is only legal when all player-group balls have been potted.
 */
export function blackballGetLegalBalls(state: TableState): BallDef[] {
  if (state.groupAssignment === "open") {
    // Table open: player can target any coloured ball (not the black yet)
    return state.balls.filter((b) => b.group !== "black");
  }
  if (state.freeShotActive) {
    // Free shot: any ball may be nominated
    return state.balls;
  }
  const targets: BallDef[] = [];
  if (state.playerBallsRemaining > 0) {
    // Must play own group
    targets.push(...state.balls.filter((b) => b.group === state.playerGroup));
  } else {
    // All own balls potted: only the black is legal
    targets.push(...state.balls.filter((b) => b.group === "black"));
  }
  return targets;
}

/**
 * Is the 8-ball/black legally available to pot under Blackball rules?
 */
export function blackballIsEightBallLegal(state: TableState): boolean {
  if (state.groupAssignment !== "assigned") return false;
  return state.playerBallsRemaining === 0;
}
