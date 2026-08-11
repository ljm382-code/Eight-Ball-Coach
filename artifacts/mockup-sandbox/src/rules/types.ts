// Phase 2 — Rules layer types
// Shared interfaces for both Blackball and International rule modules.
// Pure data structures: no React, no engine imports.

import type { RuleSetId } from "../engine";

export type BallGroup = "red" | "yellow" | "black";
export type BallOwner = "player" | "opponent" | "unassigned";
/** target = player should pot; obstacle = present but not a legal ordinary target */
export type BallRole = "target" | "obstacle" | "black";

export type BallDef = {
  id: string;
  group: BallGroup;
  owner: BallOwner;
  role: BallRole;
  label: string;
  /** 0–1 fractional position on the table, origin top-left */
  x?: number;
  y?: number;
};

export type GroupAssignmentState = "open" | "assigned";

export type TableState = {
  ruleset: RuleSetId;
  groupAssignment: GroupAssignmentState;
  /** null = table still open */
  playerGroup: BallGroup | null;
  opponentGroup: BallGroup | null;
  balls: BallDef[];
  cueBallInHand: boolean;
  /** Blackball-specific: active after an opponent foul, before the free shot is taken */
  freeShotActive: boolean;
  playerBallsRemaining: number;
  opponentBallsRemaining: number;
};

export type FoulConsequence = {
  /**
   * free_shot_baulk — WPA Blackball: cue ball in hand in baulk, one free shot
   *   (any ball may be nominated as "on" for that one shot).
   * ball_in_hand_anywhere — IEPF International: full ball-in-hand, anywhere on table.
   */
  incomingEntitlement: "free_shot_baulk" | "ball_in_hand_anywhere";
  cueBallPlacement: "baulk" | "anywhere";
  /** Only true in Blackball; the nominated ball is the one-shot "on" ball */
  freeShotGranted: boolean;
  /** Blackball: during the free shot any ball may be targeted */
  canNominateAnyBall: boolean;
  lossOfFrame: boolean;
  /** 8-ball/black potted illegally: resput under both rulesets for most fouls */
  respotBlack: boolean;
  note: string;
};

export type BreakOutcome = {
  legalBreak: boolean;
  potOccurred: boolean;
  /** Black/8-ball pocketed off the break */
  blackPottedOnBreak: boolean;
  /** Groups assigned as a result of the break */
  groupAssigned: boolean;
  continuesTurn: boolean;
  note: string;
};

export type RulesetDefinition = {
  id: RuleSetId;
  name: string;
  description: string;
  /** Concise factual summaries for future rule-reference display */
  reference: {
    objective: string;
    break: string;
    groups: string;
    legalShots: string;
    fouls: string;
    cueBallPlacement: string;
    eightBall: string;
    deliberateFoul: string;
  };
  breakRules: {
    minBallsOverMiddle: number;
    potAlternative: boolean;
    blackOnBreakAction: "respot_continue" | "respot_no_free_shot";
    breakerContinuesIfPot: boolean;
  };
  foulRules: {
    incomingEntitlement: FoulConsequence["incomingEntitlement"];
    cueBallPlacement: FoulConsequence["cueBallPlacement"];
    freeShotGranted: boolean;
    canNominateAnyBall: boolean;
  };
};
