/**
 * IEPF International Rules (International Eightball Pool Federation)
 * Source: WPA Rules page links to IEPF Int'l Rules; WPA rules reference confirms
 *         the key differences vs Blackball.  https://wpapool.com/rules/
 *
 * Only the rules required by the current MVP training/scenario flows are modelled.
 * Unsupported edge cases are documented in docs/phase-2-known-limitations.md.
 */
import type { RulesetDefinition, TableState, FoulConsequence, BreakOutcome, BallDef } from "./types";

export const INTERNATIONAL_DEFINITION: RulesetDefinition = {
  id: "international",
  name: "International Rules",
  description: "The internationally recognised 8-ball format with its own tactical rhythm.",
  reference: {
    objective:
      "Pot all balls of your assigned group and then legally pot the 8-ball to win the frame.",
    break:
      "Break from behind the head string (baulk line). Legal break: ≥4 object balls reach a cushion, " +
      "or ≥1 ball potted. Failure: incoming player may accept the table or request a re-rack.",
    groups:
      "Groups are assigned when the first pot of a coloured ball is made after the break. " +
      "No free-ball nomination concept — table is simply 'open' until the first pot.",
    legalShots:
      "First ball struck must be the player's own group (once assigned). " +
      "No free-shot / nomination rule: after a foul the incoming player gets ball-in-hand anywhere.",
    fouls:
      "Standard fouls: pot opponent's ball, miss own ball, pot cue ball, etc. " +
      "Incoming player receives ball-in-hand anywhere on the table.",
    cueBallPlacement:
      "After a foul: ball in hand anywhere on the table (not restricted to baulk). " +
      "This is the key practical difference from Blackball.",
    eightBall:
      "8-ball may only be potted once all balls of the player's group have been potted. " +
      "Potting the 8-ball at the wrong time or illegally = loss of frame.",
    deliberateFoul:
      "Deliberate foul on the 8-ball after all other balls are potted = loss of frame. " +
      "Other deliberate fouls are handled as standard fouls at referee discretion.",
  },
  breakRules: {
    minBallsOverMiddle: 0, // International uses ≥4 cushion contacts, not middle-pocket rule
    potAlternative: true,
    // IEPF: 8-ball potted on break → respot, no free shot; incoming does NOT get ball in hand
    blackOnBreakAction: "respot_no_free_shot",
    breakerContinuesIfPot: true,
  },
  foulRules: {
    incomingEntitlement: "ball_in_hand_anywhere",
    cueBallPlacement: "anywhere",
    freeShotGranted: false,
    canNominateAnyBall: false,
  },
};

/**
 * Resolve what the incoming player is entitled to after a foul under International Rules.
 */
export function internationalFoulConsequence(lossOfFrameFoul = false): FoulConsequence {
  return {
    incomingEntitlement: "ball_in_hand_anywhere",
    cueBallPlacement: "anywhere",
    freeShotGranted: false,
    canNominateAnyBall: false,
    lossOfFrame: lossOfFrameFoul,
    respotBlack: false,
    note: lossOfFrameFoul
      ? "Loss of frame: deliberate foul on 8-ball after legally clearing own group."
      : "Incoming player: ball in hand anywhere on the table. No free-shot/nomination.",
  };
}

/**
 * Determine whether the break was legal under International Rules.
 * Minimal model using caller-supplied flags.
 * International: ≥4 cushion contacts OR ≥1 ball potted constitutes a legal break.
 */
export function internationalBreakOutcome(opts: {
  cushionContactCount: number;
  potOccurred: boolean;
  blackPottedOnBreak: boolean;
}): BreakOutcome {
  const { cushionContactCount, potOccurred, blackPottedOnBreak } = opts;
  const legal = cushionContactCount >= 4 || potOccurred;
  return {
    legalBreak: legal,
    potOccurred,
    blackPottedOnBreak,
    groupAssigned: false,
    continuesTurn: legal && potOccurred && !blackPottedOnBreak,
    note: blackPottedOnBreak
      ? "8-ball potted on break: respot. No ball-in-hand or free-shot awarded. Play continues."
      : legal
      ? potOccurred
        ? "Legal break with pot: breaker continues. Groups not yet assigned."
        : "Legal break, no pot: incoming player's turn. Groups not yet assigned."
      : "Illegal break: incoming player may accept table or request a re-rack.",
  };
}

/**
 * Resolve group assignment under International Rules.
 * Same logic as Blackball: first pot after break assigns groups.
 * No nomination/free-ball mechanic exists.
 */
export function internationalResolveGroupAssignment(
  currentAssignment: "open" | "assigned",
  pottedGroup: "red" | "yellow" | null
): { playerGroup: "red" | "yellow" | null; assigned: boolean } {
  if (currentAssignment === "assigned" || pottedGroup === null) {
    return { playerGroup: null, assigned: currentAssignment === "assigned" };
  }
  return { playerGroup: pottedGroup, assigned: true };
}

/**
 * Return the IDs of balls the player may legally select under International Rules.
 *
 * No free-shot / nomination concept: after a foul, ball-in-hand is already resolved
 * before the next shot. During normal play the player must strike their own group first.
 */
export function internationalGetLegalBalls(state: TableState): BallDef[] {
  if (state.groupAssignment === "open") {
    return state.balls.filter((b) => b.group !== "black");
  }
  const targets: BallDef[] = [];
  if (state.playerBallsRemaining > 0) {
    targets.push(...state.balls.filter((b) => b.group === state.playerGroup));
  } else {
    targets.push(...state.balls.filter((b) => b.group === "black"));
  }
  return targets;
}

/**
 * Is the 8-ball legally available to pot under International Rules?
 */
export function internationalIsEightBallLegal(state: TableState): boolean {
  if (state.groupAssignment !== "assigned") return false;
  return state.playerBallsRemaining === 0;
}
