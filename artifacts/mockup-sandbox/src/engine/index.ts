// ─── Core types ───────────────────────────────────────────────────────────────

export type RuleSetId = "blackball" | "international";
/** Training-preference mode. "mixed" is NOT a ruleset — it drives session generation only. */
export type RulesMode = "blackball" | "international" | "mixed";
export type SkillType = "execution" | "decision";
export type SkillId =
  | "potting" | "cueBall" | "speed" | "positional"
  | "problemBallExec" | "breakExec" | "eightBall"
  | "pattern" | "problemBallDec" | "tactical";

export type Attempt = {
  ts: number;
  value: number;
  difficulty: number;
  drillId?: string;
  source?: "assessment" | "training" | "planDecision" | "adaptation";
  reportedError?: string;
  tier?: string;
  clearance?: boolean;
  ballId?: string;
  /**
   * null = shared/rule-neutral execution (not counted toward ruleset-specific confidence).
   * "blackball" | "international" = evidence gathered under that specific ruleset.
   */
  ruleset?: RuleSetId | null;
};

export type RootCauseEvent = {
  skillId: SkillId;
  ts: number;
  /** Numeric diagnostic confidence 0–1. High-confidence chains contribute more to LF evidence. */
  confidence: number;
  ruleset?: RuleSetId | null;
};

export type SkillDefinition = {
  id: SkillId;
  name: string;
  shortName: string;
  type: SkillType;
  priority?: boolean;
};

export type SkillState = {
  rating: number;
  attempts: Attempt[];
};

export type Profile = {
  dataVersion: number;
  /** Legacy single-ruleset field; used as fallback when preferredRulesMode is single. */
  ruleset: RuleSetId;
  /** Active training preference. Does not alter shared skill ratings when changed. */
  preferredRulesMode: RulesMode;
  assessmentComplete: boolean;
  skills: Record<SkillId, SkillState>;
  ratingHistory: Partial<Record<SkillId, { ts: number; rating: number }[]>>;
  /** @deprecated — replaced by rootCauseEvents; kept for migration only */
  rootCauseTally: Partial<Record<SkillId, number>>;
  /** Timestamped root-cause evidence with numeric confidence. Decays with age. */
  rootCauseEvents: RootCauseEvent[];
  sessions: SessionRecord[];
};

export type DecisionTier = "optimal" | "acceptable" | "highrisk" | "poor";
// ─── Training diagram types (presentation layer — no engine state) ─────────────

/** One step in a coached decision sequence shown as route feedback after answering. */
export type DecisionSequenceStep = {
  ballId: string;       // ball ID in the accompanying TrainingDiagram
  shot: string;         // coaching shot term, e.g. "stun", "follow", "left-draw"
  positionFor?: string; // ball ID, "black", or "pocket" (last step)
};

/** A cue-ball travel segment drawn between two balls in the route feedback. */
export type RouteSegment = {
  fromBallId: string;
  toBallId: string;
  /** cueBallRoute = dashed line; objectBallRoute = solid line with arrowhead */
  type: "cueBallRoute" | "objectBallRoute";
};

/** A ball in an authored training diagram (display metadata only; separate from rules-engine ClearanceBall). */
export type TrainingBall = {
  id: string;
  group: "red" | "yellow" | "black" | "cue";
  /** 0–100, percentage of playing-surface width (0 = left cushion, 100 = right cushion). */
  x: number;
  /** 0–100, percentage of playing-surface height (0 = top cushion, 100 = bottom cushion). */
  y: number;
  /** External coaching marker, e.g. "1"/"2"/"3". NOT printed on the ball. Cue and black should not have one. */
  trainingLabel?: string;
  role?: "target" | "obstacle" | "black" | "cue";
  playerBall?: boolean;
};

export type PocketId = "topLeft" | "topMiddle" | "topRight" | "bottomLeft" | "bottomMiddle" | "bottomRight";

export type TableMarkings = {
  /** Blackball: vertical line near the baulk/right end of the landscape table */
  showBaulkLine?: boolean;
  /** Shade the baulk region (right of baulk line in landscape orientation) */
  showBaulkArea?: boolean;
  /** Blackball: cross/dot at the black-ball rack position */
  showBlackSpot?: boolean;
  /** International: longitudinal rack line through the black spot */
  showRackLine?: boolean;
  /** International: marker at the head ball position on the rack line */
  showHeadBallSpot?: boolean;
  /** International: transverse break line — same geometry as baulk line */
  showBreakLine?: boolean;
  /** Both: faint centre transverse line */
  showCentreLine?: boolean;
  /** Optional: D-shaped training reference — NOT a rules requirement */
  showTrainingD?: boolean;
  /** Show the D semicircle attached to the baulk line (right side, baulk/right end) */
  showD?: boolean;
  /** Show three dot-markers at the top, centre, and bottom of the baulk line */
  showBaulkPoints?: boolean;
  /** Optional label rendered in the baulk/break area */
  baulkLabel?: string;
};

export type AimLine = {
  /** Ball ID (usually cue ball) to start from */
  fromBallId: string;
  /** Ball ID to pass through (usually object ball) */
  throughBallId?: string;
  /** Target pocket */
  toPocket?: PocketId;
  style?: "solid" | "dashed";
};

export type RackMetadata = {
  /** Apex (front) ball, 0–100% of playing surface (lowest y = top/rack end) */
  apexX: number;
  apexY: number;
  /** True = English 8-ball rack: 7 red + 7 yellow + 1 black */
  englishEightBall?: boolean;
};

export type DiagramVisualRequirement = "targetZone" | "aimLine" | "targetPocket" | "baulkArea" | "rack";

/** Explicit visual requirements for a playable drill — validated by validatePlayableDrillGeometry.
 *  Fields default to false when absent. cueBall is always enforced unconditionally. */
export type VisualContract = {
  /** Diagram must contain exactly one ball with group="cue". */
  cueBall?: boolean;
  /** diagram.targetPocket must be set to a valid PocketId. */
  targetPocket?: boolean;
  /** diagram.aimLines must be non-empty with non-trivial line length (≥ 5 coordinate units). */
  aimLine?: boolean;
  /** diagram.targetZone must be set with positive width and height. */
  targetZone?: boolean;
  /** Diagram must define a cue-ball route or equivalent target zone. */
  cueRoute?: boolean;
};

/** Diagram metadata attached to a drill for data-driven table rendering.
 *  Orientation convention: BAULK END = bottom (y=100%), RACK END = top (y=0%). */
export type TrainingDiagram = {
  /** The group the player owns. Required for pattern/clearance exercises. */
  playerGroup?: "red" | "yellow";
  balls: TrainingBall[];
  /** Shaded coaching zone. Coordinates 0–100% of playing surface. */
  targetZone?: { x: number; y: number; width: number; height: number };
  /** Nominated pocket — rendered with a highlight ring. */
  targetPocket?: PocketId;
  /** Optional ruleset-relevant table markings (baulk line, black spot, etc.). */
  tableMarkings?: TableMarkings;
  /** Instructional aim/potting lines: cue ball → object ball → pocket. */
  aimLines?: AimLine[];
  /** Rack geometry for break drills. */
  rack?: RackMetadata;
  /** Visual elements that setup/objective text references; checked by validateDrillDiagramIntegrity. */
  requiresVisuals?: DiagramVisualRequirement[];
};

export type DecisionOption = {
  key: string;
  label: string;
  tier: DecisionTier;
  rationale: string;
  risk: "low" | "medium" | "high";
  /** Coached shot sequence shown as route feedback after answering (pattern drills). */
  sequence?: DecisionSequenceStep[];
};

export type Drill = {
  id: string;
  skillId: SkillId;
  type: SkillType;
  difficulty: number;
  name: string;
  desc: string;
  options?: DecisionOption[];
  /** Ruleset-specific option overrides; used when the correct answer genuinely differs. */
  rulesetOptions?: Partial<Record<RuleSetId, DecisionOption[]>>;
  familyId: string;
  assessmentEligible?: boolean;
  rulesets: RuleSetId[];
  /** null / undefined = shared (no rules badge needed) */
  rulesContext?: RuleSetId | null;
  secondarySkills?: SkillId[];
  reason?: string;
  /** Authored table diagram for data-driven rendering. Overrides generic fallback diagrams. */
  diagram?: TrainingDiagram;
  // ─── Structured instructional content (shown before attempts; answers never revealed) ────
  setup?: string;
  objective?: string;
  successCriteria?: string[];
  constraints?: string[];
  coachingFocus?: string;
  playerGroup?: "red" | "yellow";
  assessmentInstruction?: string;
  trainingInstruction?: string;
  scenarioPurpose?: string;
  /** Explicit visual requirements — validated by validatePlayableDrillGeometry. */
  visualContract?: VisualContract;
  /** ID of the ball in diagram that should receive a focus highlight (gold outer ring). */
  focusBallId?: string;
};

export type ClearanceBall = {
  id: string;
  group: "red" | "yellow" | "black";
  label: string;
  execSkill: SkillId;
  /** "player" = legal clearance target; "opponent" = obstacle only */
  owner: "player" | "opponent";
  /** "target" = offered as pot; "obstacle" = shown but not selectable; "black" = 8-ball */
  role: "target" | "obstacle" | "black";
};

export type Clearance = {
  id: string;
  name: string;
  type: "combined";
  difficulty: number;
  clearanceStage: number;
  assessmentEligible?: boolean;
  planEligible: boolean;
  adaptationEligible: boolean;
  failureMode: "reset_shot" | "continue_from_position" | "end_clearance";
  balls: ClearanceBall[];
  preferredRoute: string[];
  acceptableRoutes: string[][];
  preferredAdaptation?: string | null;
  rulesets: RuleSetId[];
  reason?: string;
  // ─── Instructional content & exercise definition ───────────────────────────
  setup?: string;
  objective?: string;
  successCriteria?: string[];
  playerGroup?: "red" | "yellow";
  /** Explicitly declares whether the 8-ball is the required finishing ball. */
  includesBlack?: boolean;
  /** Authored diagram giving ball positions and cue-ball starting location. */
  diagram?: TrainingDiagram;
  /** Explicit visual requirements — validated by validatePlayableDrillGeometry. */
  visualContract?: VisualContract;
};

/** Pure mutable state for a clearance in progress — kept separately from React state for testability. */
export type ClearanceRouteState = {
  plannedRoute: string[] | null;
  attemptedRoute: string[];
  pottedRoute: string[];
  remaining: string[];
};

export type SessionItem = Drill | Clearance;
export type SessionRecord = {
  ts: number;
  minutes: number;
  summary: SessionSummary;
};

export type LimitingFactor = SkillDefinition & {
  rating: number;
  gap: number;
  confidence: Confidence;
  score: number;
  status: "confirmed" | "provisional" | "none";
  rootCauseScore: number;
};

export type Confidence = { score: number; tier: "Low" | "Emerging" | "Established" | "High" };
export type LimitingFactors = {
  primary: LimitingFactor | null;
  secondary: LimitingFactor | null;
  status: "confirmed" | "provisional" | "insufficient";
};

export type SessionSummary = {
  todayWentWell: string[];
  todayLimited: string[];
  chainNarratives: string[];
  adaptations: unknown[];
  newLf: LimitingFactors;
  changeNote: string;
};

export type GeneratedSession = {
  drills: SessionItem[];
  lf: LimitingFactors;
  weighting: { execWeight: number; decWeight: number; exec: number; dec: number };
  focusSkillIds: SkillId[];
  startingRatings: Record<SkillId, number>;
  /** Ruleset assigned to each drill slot (null = genuinely shared execution; never null for rules-sensitive clearances) */
  drillRulesets: (RuleSetId | null)[];
};

// ─── Config ───────────────────────────────────────────────────────────────────

export const CONFIG = {
  dataVersion: 5,
  kMin: 0.06,
  kMax: 0.35,
  difficultyMidpoint: 5,
  difficultySensitivity: 0.05,
  diffMultiplierMin: 0.6,
  diffMultiplierMax: 1.5,
  recencyWindowMs: 1000 * 60 * 60 * 24 * 21, // 21 days
  meanGapThreshold: 8,
  mixed: {
    minRulesetFloor: 0.25,
    defaultBlackballFraction: 0.5,
    adequateConfidenceThreshold: 0.22, // "Emerging" tier and above counts as adequate
  },
  confidence: {
    volumeCap: 15,
    diversityCap: 4,
    recentCap: 5,
    weights: { volumeDiversity: 0.85, recency: 0.15 },
    diversityFloor: 0.35,
    tiers: { emerging: 0.22, established: 0.5, high: 0.75 },
    assessmentWeight: 0.4,
  },
  evidence: {
    weights: { gap: 0.35, confidence: 0.2, recentError: 0.15, clearanceFail: 0.1, rootCause: 0.2 },
    confirmedThreshold: 0.5,
    provisionalThreshold: 0.28,
  },
  rootCause: {
    /** Half-life for root-cause event decay. Events older than this have half the original weight. */
    halfLifeMs: 1000 * 60 * 60 * 24 * 21, // 21 days
    numericConfidence: {
      Low: 0.3,
      Emerging: 0.6,
      Established: 0.8,
      High: 0.9,
    } as Record<string, number>,
  },
  session: {
    /** Percentage-point shift in exec/dec split when LF is confirmed */
    lfConfirmedShift: 12,
    /** Percentage-point shift in exec/dec split when LF is provisional */
    lfProvisionalShift: 6,
    /** Minimum rating before a skill qualifies for a maintenance slot */
    maintenanceMinRatingThreshold: 50,
    /** Minimum days since last trained before a skill qualifies for maintenance */
    maintenanceMinAgeDays: 7,
  },
};

// ─── Skills ───────────────────────────────────────────────────────────────────

export const SKILLS: SkillDefinition[] = [
  { id: "potting",         name: "Potting",                                  shortName: "Potting",    type: "execution", priority: true },
  { id: "cueBall",         name: "Cue-Ball Control",                         shortName: "Cue Ball",   type: "execution" },
  { id: "speed",           name: "Speed / Touch Control",                    shortName: "Speed",      type: "execution", priority: true },
  { id: "positional",      name: "Positional Execution",                     shortName: "Position",   type: "execution", priority: true },
  { id: "problemBallExec", name: "Problem-Ball Execution",                   shortName: "Problem Ball",type: "execution" },
  { id: "breakExec",       name: "Break & Post-Break Execution",             shortName: "Break",      type: "execution" },
  { id: "eightBall",       name: "8-Ball Finishing",                         shortName: "8-Ball",     type: "execution" },
  { id: "pattern",         name: "Pattern Recognition & Clearance Planning", shortName: "Patterns",   type: "decision", priority: true },
  { id: "problemBallDec",  name: "Problem-Ball Identification & Management", shortName: "Problem ID", type: "decision" },
  { id: "tactical",        name: "Tactical / Safety Decision-Making",        shortName: "Tactics",    type: "decision", priority: true },
];

export const SKILL_MAP = Object.fromEntries(SKILLS.map((s) => [s.id, s])) as Record<SkillId, SkillDefinition>;

/**
 * Context-aware mapping of adaptation choice labels to the correct decision skill.
 * Used by ClearanceRunner to route adaptation evidence to the right skill.
 */
export const ADAPTATION_SKILL_MAP: Record<string, SkillId> = {
  "Re-plan clearance":       "pattern",
  "Continue original route": "pattern",
  "Develop a problem ball":  "problemBallDec",
  "Play safe":               "tactical",
  "Other":                   "pattern",
};

// ─── Rulesets ─────────────────────────────────────────────────────────────────

export const RULESETS: Record<RuleSetId, {
  id: RuleSetId;
  name: string;
  description: string;
  tacticalNote: string;
  unsupportedNote: string;
}> = {
  blackball: {
    id: "blackball",
    name: "Blackball Rules",
    description: "The compact, tactical game built around reds, yellows and the black.",
    tacticalNote: "Containing safeties and controlled snookers are especially useful. After a foul you receive one free shot from baulk — plan your nomination carefully.",
    unsupportedNote:
      "The key foul/free-shot rule difference is implemented. The exact WPA Blackball rule for 8-ball potted on the break (Rule 4.3) involves a respot and cue ball in hand from baulk; this is documented but not exposed as a training scenario in this version. Stalemate procedures, simultaneous fouls, and tournament administration are not modelled.",
  },
  international: {
    id: "international",
    name: "International Rules",
    description: "The internationally recognised 8-ball format with its own tactical rhythm.",
    tacticalNote: "Plan the clearance around the open table and protect your first legal shot. After a foul you receive full ball-in-hand — use the positional freedom.",
    unsupportedNote:
      "The key foul/ball-in-hand difference is implemented. Push-out rules, stalemate procedures, and referee-call edge cases are not modelled.",
  },
};

export const RULES_MODE_INFO: Record<RulesMode, { label: string; description: string }> = {
  blackball:    { label: "Blackball Rules",    description: "Train under WPA Blackball rules." },
  international:{ label: "International Rules", description: "Train under IEPF International rules." },
  mixed:        { label: "Both",               description: "Your training will include both rulesets. Every rules-specific exercise will be clearly labelled." },
};

// ─── Canonical ball colours (shared by renderer and tests) ────────────────────
/** Off-white cue, English pool red/yellow/near-black. Use these everywhere — never infer colour from an arbitrary string. */
export const BALL_COLORS = {
  cue:    "#F2F0E8",
  red:    "#B83E35",
  yellow: "#D6A52E",
  black:  "#151918",
} as const;

// ─── Table geometry constants (fractions of playing surface) ─────────────────
/** Orientation: RACK END = left (x=0%), BAULK END = right (x=100%). The table is landscape. */
/** Baulk line sits at 77.5% of playing-surface width from the rack/left end. */
export const BAULK_FRACTION = 0.775;
/** D-semicircle radius as fraction of playing-surface height. */
export const D_RADIUS_FRACTION = 0.22;
/** Black spot sits 25% of playing-surface width from the rack/left end (rack half). */
export const BLACK_SPOT_X_FRACTION = 0.25;
/** Default rack-apex x (front ball, closest to baulk) as fraction of playing-surface width. */
export const RACK_APEX_X_FRACTION = 0.22;

// ─── English 8-ball rack helper ───────────────────────────────────────────────
/**
 * Produce 15 TrainingBall objects for an English 8-ball rack (7 red, 7 yellow, 1 black).
 *
 * Landscape orientation: RACK END = left, BAULK END = right.
 * The apex (front ball) is the rightmost ball of the triangle — closest to the baulk/break end.
 * Rows step LEFT (−x toward the rack cushion); balls within each row spread VERTICALLY (y).
 *
 *   dX = 3.4 — one ball diameter in x-coordinate space (each row steps left by this amount)
 *   dY = 5.89 — equilateral-triangle ball spacing in y-coordinate space
 *
 * apexX, apexY: position (0–100%) of the apex (front) ball.
 */
export function createEnglishEightBallRack(apexX: number, apexY: number): TrainingBall[] {
  const dX = 3.4, dY = 5.89;
  // Row r: x = apexX − r*dX (steps LEFT from apex)
  // Ball i in row r: y = apexY + (i − r/2)*dY (spread vertically, centred at apexY)
  const rx = (r: number) => apexX - r * dX;
  const ry = (r: number, i: number) => apexY + (i - r / 2) * dY;
  return [
    // Row 0 — apex (rightmost, faces baulk)
    { id: "Y1",  group: "yellow", x: rx(0), y: ry(0, 0) },
    // Row 1
    { id: "R1",  group: "red",    x: rx(1), y: ry(1, 0) },
    { id: "R2",  group: "red",    x: rx(1), y: ry(1, 1) },
    // Row 2 — black at centre
    { id: "Y2",  group: "yellow", x: rx(2), y: ry(2, 0) },
    { id: "BLK", group: "black",  x: rx(2), y: ry(2, 1), role: "black" as const },
    { id: "Y3",  group: "yellow", x: rx(2), y: ry(2, 2) },
    // Row 3
    { id: "R3",  group: "red",    x: rx(3), y: ry(3, 0) },
    { id: "Y4",  group: "yellow", x: rx(3), y: ry(3, 1) },
    { id: "R4",  group: "red",    x: rx(3), y: ry(3, 2) },
    { id: "Y5",  group: "yellow", x: rx(3), y: ry(3, 3) },
    // Row 4 — base (leftmost, furthest from baulk)
    { id: "R5",  group: "red",    x: rx(4), y: ry(4, 0) },
    { id: "Y6",  group: "yellow", x: rx(4), y: ry(4, 1) },
    { id: "R6",  group: "red",    x: rx(4), y: ry(4, 2) },
    { id: "Y7",  group: "yellow", x: rx(4), y: ry(4, 3) },
    { id: "R7",  group: "red",    x: rx(4), y: ry(4, 4) },
  ];
}

// ─── Diagram integrity validation ─────────────────────────────────────────────
/** Validate that all elements listed in diagram.requiresVisuals are actually present. */
export function validateDrillDiagramIntegrity(drill: Drill): { valid: boolean; errors: string[] } {
  const d = drill.diagram;
  if (!d) return { valid: true, errors: [] };
  const errors: string[] = [];
  for (const req of d.requiresVisuals ?? []) {
    switch (req) {
      case "targetZone":
        if (!d.targetZone) errors.push("'targetZone' required but diagram.targetZone is missing");
        break;
      case "aimLine":
        if (!d.aimLines || d.aimLines.length === 0) errors.push("'aimLine' required but diagram.aimLines is empty/missing");
        break;
      case "targetPocket":
        if (!d.targetPocket) errors.push("'targetPocket' required but diagram.targetPocket is missing");
        break;
      case "baulkArea":
        if (!d.tableMarkings?.showBaulkLine && !d.tableMarkings?.showBreakLine && !d.tableMarkings?.showBaulkArea)
          errors.push("'baulkArea' required but no baulk/break table marking is defined");
        break;
      case "rack":
        if (!d.rack) errors.push("'rack' required but diagram.rack is missing");
        break;
    }
  }
  return { valid: errors.length === 0, errors };
}

// ─── Geometry completeness contract ───────────────────────────────────────────

/**
 * Return a normalized signature string for a TrainingDiagram.
 * Used to detect accidentally duplicated diagrams across drills.
 */
export function diagramSignature(diagram: TrainingDiagram | undefined | null): string {
  if (!diagram) return "empty";
  const balls = [...diagram.balls]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(b => `${b.group}:${Math.round(b.x)},${Math.round(b.y)}`)
    .join("|");
  const pocket = diagram.targetPocket ?? "none";
  const zone = diagram.targetZone
    ? `${Math.round(diagram.targetZone.x)},${Math.round(diagram.targetZone.y)},${Math.round(diagram.targetZone.width)},${Math.round(diagram.targetZone.height)}`
    : "none";
  const hasRack = diagram.rack ? "rack" : "norack";
  return `${balls}::pocket=${pocket}::zone=${zone}::${hasRack}`;
}

/**
 * Geometric distance between two diagrams, normalised to 0–1.
 * Returns 0 for identical diagrams, 1 for completely different.
 * Same-family drill pairs scoring < 0.10 are suspiciously similar.
 */
export function diagramDistance(
  a: TrainingDiagram | undefined | null,
  b: TrainingDiagram | undefined | null,
): number {
  if (!a || !b) return (a === b) ? 0 : 1;
  let totalDistSq = 0;
  let count = 0;
  const matched = new Set<string>();
  for (const ballA of a.balls) {
    const ballB = b.balls.find(bb => bb.group === ballA.group && !matched.has(bb.id));
    if (ballB) {
      matched.add(ballB.id);
      totalDistSq += (ballA.x - ballB.x) ** 2 + (ballA.y - ballB.y) ** 2;
      count++;
    }
  }
  if (!count) return 1;
  // Max possible per ball = 100² + 100² = 20 000; normalise to 0–1
  return Math.min(1, Math.sqrt(totalDistSq / count) / Math.sqrt(20000));
}

/**
 * Validate that a playable drill or clearance has a complete, authored diagram
 * that fulfils its declared visual contract.
 * Pure function — no DOM, no React.
 */
export function validatePlayableDrillGeometry(
  item: { id: string; diagram?: TrainingDiagram; visualContract?: VisualContract; focusBallId?: string; playerGroup?: "red" | "yellow" },
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const id = item.id;

  if (!item.diagram) {
    errors.push(`${id}: no authored TrainingDiagram`);
    return { valid: false, errors };
  }
  const d = item.diagram;

  if (!item.visualContract) {
    errors.push(`${id}: visualContract not declared`);
  }
  const vc = item.visualContract;

  // Cue ball: always enforce exactly one regardless of visualContract
  const cueBalls = d.balls.filter(b => b.group === "cue");
  if (cueBalls.length !== 1) {
    errors.push(`${id}: expected exactly 1 cue ball, found ${cueBalls.length}`);
  }

  // targetPocket contract
  if (vc?.targetPocket && !d.targetPocket) {
    errors.push(`${id}: visualContract.targetPocket=true but diagram.targetPocket is missing`);
  }

  // aimLine contract — must be non-empty, and each line must have a resolvable fromBallId
  if (vc?.aimLine) {
    if (!d.aimLines || d.aimLines.length === 0) {
      errors.push(`${id}: visualContract.aimLine=true but diagram.aimLines is empty`);
    } else {
      for (const al of d.aimLines) {
        const fromBall = d.balls.find(b => b.id === al.fromBallId);
        if (!fromBall) {
          errors.push(`${id}: aimLine fromBallId "${al.fromBallId}" not found in diagram.balls`);
        } else if (al.throughBallId) {
          const thruBall = d.balls.find(b => b.id === al.throughBallId);
          if (thruBall) {
            const dist = Math.sqrt((fromBall.x - thruBall.x) ** 2 + (fromBall.y - thruBall.y) ** 2);
            if (dist < 5) {
              errors.push(`${id}: aimLine ${al.fromBallId}→${al.throughBallId} has trivial length (${dist.toFixed(1)} < 5)`);
            }
          }
        }
      }
    }
  }

  // targetZone contract — must have positive dimensions
  if (vc?.targetZone) {
    if (!d.targetZone) {
      errors.push(`${id}: visualContract.targetZone=true but diagram.targetZone is missing`);
    } else if (d.targetZone.width <= 0 || d.targetZone.height <= 0) {
      errors.push(`${id}: diagram.targetZone has non-positive dimensions`);
    }
  }

  // rack contract — break drills must have 15 balls besides the cue ball
  if (d.rack) {
    const rackBalls = d.balls.filter(b => b.group !== "cue");
    if (rackBalls.length < 15) {
      errors.push(`${id}: break drill rack has only ${rackBalls.length} balls (expected ≥ 15)`);
    }
  }

  // focusBallId: if set, the referenced ball must exist in diagram.balls
  if (item.focusBallId) {
    const focusBall = d.balls.find(b => b.id === item.focusBallId);
    if (!focusBall) {
      errors.push(`${id}: focusBallId "${item.focusBallId}" not found in diagram.balls`);
    }
  }

  // playerGroup: if diagram has yellow target balls AND red balls, playerGroup must be declared
  const hasYellowTargets = d.balls.some(b => b.group === "yellow" && b.role === "target");
  const hasRedBalls      = d.balls.some(b => b.group === "red");
  if (hasYellowTargets && hasRedBalls && !d.playerGroup) {
    errors.push(`${id}: diagram has yellow targets and red balls but playerGroup is not set on diagram`);
  }

  return { valid: errors.length === 0, errors };
}

// ─── Shared table geometry helper ─────────────────────────────────────────────

/** Absolute SVG-coordinate geometry for an English pool table of a given pixel width.
 *  All coordinates are in the same SVG user units used by PoolTable.
 *  Orientation: rack end = left (small x), baulk end = right (large x). */
export type TableGeometry = {
  bX: number; bY: number; bW: number; bH: number;  // playing-surface rect
  baulkLineX: number;    // x of the vertical baulk line
  baulkTopY: number;     // y of the top of the baulk line (= bY)
  baulkBottomY: number;  // y of the bottom of the baulk line (= bY + bH)
  dCentreY: number;      // vertical centre of the D (= bY + bH/2)
  dRadius: number;       // radius of the D semicircle (D_RADIUS_FRACTION * bH)
  blackSpotX: number;    // x of the black-spot reference mark (rack half)
  blackSpotY: number;    // y of the black-spot (= bY + bH/2)
  pocketCenters: Record<PocketId, [number, number]>;  // SVG centre of each pocket
  diamondSpacingX: number;  // spacing between diamond marks on the long rails (bW/8)
  diamondSpacingY: number;  // spacing between diamond marks on the short rails (bH/4)
};

/**
 * Compute authoritative SVG-coordinate geometry for a PoolTable of the given pixel width.
 * Uses the same layout constants as the PoolTable React component.
 */
export function getEnglishPoolTableGeometry(width: number): TableGeometry {
  const h   = width * 0.56;
  const pW  = width * 0.08;
  const bX  = pW;
  const bY  = pW * 0.85;
  const bW  = width - pW * 2;
  const bH  = h - bY * 2;
  const pR  = pW * 0.42;

  const baulkLineX  = bX + BAULK_FRACTION * bW;
  const centreY     = bY + bH / 2;
  const dRadius     = D_RADIUS_FRACTION * bH;
  const blackSpotX  = bX + BLACK_SPOT_X_FRACTION * bW;

  const pocketCenters: Record<PocketId, [number, number]> = {
    topLeft:      [bX,          bY],
    topMiddle:    [bX + bW / 2, bY - pR * 0.3],
    topRight:     [bX + bW,     bY],
    bottomLeft:   [bX,          bY + bH],
    bottomMiddle: [bX + bW / 2, bY + bH + pR * 0.3],
    bottomRight:  [bX + bW,     bY + bH],
  };

  return {
    bX, bY, bW, bH,
    baulkLineX,
    baulkTopY:    bY,
    baulkBottomY: bY + bH,
    dCentreY:     centreY,
    dRadius,
    blackSpotX,
    blackSpotY:   centreY,
    pocketCenters,
    diamondSpacingX: bW / 8,   // 7 evenly-spaced diamonds on each long rail
    diamondSpacingY: bH / 4,   // 3 evenly-spaced diamonds on each short rail
  };
}

// ─── Table-marking primitives (pure — no DOM, no React) ───────────────────────

export type TableMarkingPrimitive = {
  type: "line" | "arc" | "spot" | "point" | "rect";
  role: "baulkLine" | "dSemicircle" | "blackSpot" | "baulkPoint" | "diamondMark" | "baulkArea";
  // line / rect coords
  x1?: number; y1?: number; x2?: number; y2?: number;
  x?: number; y?: number; width?: number; height?: number;
  // arc / spot / point coords
  cx?: number; cy?: number;
  /** Radius for arc or spot primitives. */
  radius?: number;
  /** SVG path `d` attribute for arc primitives. */
  d?: string;
  /** For arcs: which direction the curve extends beyond its chord line. */
  extendDirection?: "left" | "right";
  /** For diamonds: which rail they sit on. */
  axis?: "long" | "short";
};

/**
 * Convert TableMarkings + TableGeometry into concrete SVG-level primitives.
 * Diamond marks are always returned (they are a permanent table feature).
 * Pure function — no DOM, no React, safe to call in tests.
 */
export function buildTableMarkingPrimitives(
  markings: TableMarkings | undefined | null,
  geometry: TableGeometry,
): TableMarkingPrimitive[] {
  const {
    bX, bY, bW, bH,
    baulkLineX, baulkTopY, baulkBottomY,
    dCentreY, dRadius,
    blackSpotX, blackSpotY,
    diamondSpacingX, diamondSpacingY,
  } = geometry;
  const prims: TableMarkingPrimitive[] = [];

  // ── Baulk area (shaded rect to the right of the baulk line) ─────────────
  if (markings?.showBaulkArea) {
    prims.push({
      type: "rect", role: "baulkArea",
      x: baulkLineX, y: bY, width: bX + bW - baulkLineX, height: bH,
    });
  }

  // ── Baulk / break line (vertical) ────────────────────────────────────────
  if (markings?.showBaulkLine || markings?.showBreakLine) {
    prims.push({
      type: "line", role: "baulkLine",
      x1: baulkLineX, y1: baulkTopY,
      x2: baulkLineX, y2: baulkBottomY,
    });
  }

  // ── D semicircle ─────────────────────────────────────────────────────────
  if (markings?.showD || markings?.showTrainingD) {
    const startY = dCentreY - dRadius;
    const endY   = dCentreY + dRadius;
    prims.push({
      type: "arc", role: "dSemicircle",
      // Arc from (baulkLineX, startY) to (baulkLineX, endY) curving RIGHT
      d: `M ${baulkLineX},${startY} A ${dRadius},${dRadius} 0 0,1 ${baulkLineX},${endY}`,
      cx: baulkLineX, cy: dCentreY, radius: dRadius,
      extendDirection: "right",
    });
  }

  // ── Baulk line marker points (top, centre, bottom) ────────────────────────
  if (markings?.showBaulkPoints) {
    prims.push({ type: "point", role: "baulkPoint", cx: baulkLineX, cy: baulkTopY  });
    prims.push({ type: "point", role: "baulkPoint", cx: baulkLineX, cy: dCentreY   });
    prims.push({ type: "point", role: "baulkPoint", cx: baulkLineX, cy: baulkBottomY });
  }

  // ── Black spot (rack half — small cross + fill circle) ───────────────────
  if (markings?.showBlackSpot) {
    prims.push({ type: "spot", role: "blackSpot", cx: blackSpotX, cy: blackSpotY });
  }

  // ── Diamond / sight marks (always present — permanent table feature) ──────
  // Long rails (top y=bY, bottom y=bY+bH): 7 diamonds, spacing bW/8
  for (let k = 1; k <= 7; k++) {
    const dx = bX + k * diamondSpacingX;
    prims.push({ type: "point", role: "diamondMark", cx: dx, cy: bY,      axis: "long" });
    prims.push({ type: "point", role: "diamondMark", cx: dx, cy: bY + bH, axis: "long" });
  }
  // Short rails (left x=bX, right x=bX+bW): 3 diamonds, spacing bH/4
  for (let k = 1; k <= 3; k++) {
    const dy = bY + k * diamondSpacingY;
    prims.push({ type: "point", role: "diamondMark", cx: bX,      cy: dy, axis: "short" });
    prims.push({ type: "point", role: "diamondMark", cx: bX + bW, cy: dy, axis: "short" });
  }

  return prims;
}

// ─── Aim-line segment primitives (geometry-aware, pure) ───────────────────────

export type AimSegPrimitive = {
  role: "cueBallToObject" | "objectToPocket" | "directToPocket";
  x1: number; y1: number;
  x2: number; y2: number;
  stroke: string;
  strokeDasharray: string;
  withArrow: boolean;
};

/**
 * Resolve each AimLine in a diagram to concrete SVG segment(s).
 * Returns { segments, errors }. errors is non-empty if any ball ID is missing.
 * Each fromBallId + throughBallId + toPocket combination yields:
 *   Segment A (cueBallToObject):  white dashed,  from cue-ball centre to object-ball centre
 *   Segment B (objectToPocket):   gold dashed,   from object-ball centre to pocket centre
 * A fromBallId + toPocket (no throughBall) yields:
 *   Segment (directToPocket):     gold dashed,   from ball centre to pocket centre
 * Pure function — no DOM, no React, safe to call in tests.
 */
export function buildAimLinePrimitives(
  diagram: TrainingDiagram | undefined | null,
  geometry: TableGeometry,
): { segments: AimSegPrimitive[]; errors: string[] } {
  if (!diagram) return { segments: [], errors: [] };
  const { bX, bY, bW, bH, pocketCenters } = geometry;
  const segments: AimSegPrimitive[] = [];
  const errors: string[] = [];

  const svgPos = (ball: { x: number; y: number }): [number, number] => [
    bX + (ball.x / 100) * bW,
    bY + (ball.y / 100) * bH,
  ];

  for (const al of diagram.aimLines ?? []) {
    const fromBall = diagram.balls.find(b => b.id === al.fromBallId);
    if (!fromBall) { errors.push(`buildAimLinePrimitives: ball "${al.fromBallId}" not found`); continue; }
    const [fx, fy] = svgPos(fromBall);

    if (al.throughBallId) {
      const thruBall = diagram.balls.find(b => b.id === al.throughBallId);
      if (!thruBall) { errors.push(`buildAimLinePrimitives: ball "${al.throughBallId}" not found`); continue; }
      const [tx, ty] = svgPos(thruBall);

      // Segment A — cue ball → object ball (white dashed, no arrow)
      segments.push({
        role: "cueBallToObject",
        x1: fx, y1: fy, x2: tx, y2: ty,
        stroke: "rgba(255,255,255,0.85)",
        strokeDasharray: "5,4",
        withArrow: false,
      });

      // Segment B — object ball → pocket (gold dashed, with arrow)
      if (al.toPocket) {
        const [px, py] = pocketCenters[al.toPocket];
        segments.push({
          role: "objectToPocket",
          x1: tx, y1: ty, x2: px, y2: py,
          stroke: "#E0B84C",
          strokeDasharray: "5,4",
          withArrow: true,
        });
      }
    } else if (al.toPocket) {
      const [px, py] = pocketCenters[al.toPocket];
      segments.push({
        role: "directToPocket",
        x1: fx, y1: fy, x2: px, y2: py,
        stroke: "#E0B84C",
        strokeDasharray: "5,4",
        withArrow: true,
      });
    }
  }

  return { segments, errors };
}

// ─── Render-model types and builder (pure — no DOM, no React) ────────────────

export type BallRenderPrimitive = {
  id:      string;
  group:   TrainingBall["group"];
  /** Canonical fill resolved from BALL_COLORS — never from arbitrary input. */
  fill:    string;
  x:       number;   // diagram % (0–100)
  y:       number;   // diagram % (0–100)
  opacity: number;
};

export type ZonePrimitive = {
  x: number; y: number; width: number; height: number;
  fill:          string;
  stroke:        string;
  strokeOpacity: number;
  label?:        string;
};

export type AimLinePrimitive = {
  fromId:        string;
  throughId?:    string;
  toPocket?:     PocketId;
  style:         "solid" | "dashed";
  stroke:        string;
  strokeOpacity: number;
};

export type TableRenderModel = {
  balls:        BallRenderPrimitive[];
  zones:        ZonePrimitive[];
  aimLines:     AimLinePrimitive[];
  targetPocket: PocketId | null;
  hasMarkings:  boolean;
  hasBaulkLine: boolean;
  hasBaulkArea: boolean;
  hasBlackSpot: boolean;
  hasD:         boolean;
  hasRack:      boolean;
  /** Layer names in render order — every required training visual must appear after "cloth". */
  renderOrder:  string[];
};

/**
 * Convert a TrainingDiagram into render primitives with resolved styles.
 * Pure function — no DOM, no React, safe to call in tests.
 */
export function buildTableRenderModel(diagram: TrainingDiagram | undefined | null): TableRenderModel {
  if (!diagram) {
    return {
      balls: [], zones: [], aimLines: [], targetPocket: null,
      hasMarkings: false, hasBaulkLine: false, hasBaulkArea: false,
      hasBlackSpot: false, hasD: false, hasRack: false, renderOrder: ["cloth"],
    };
  }

  const balls: BallRenderPrimitive[] = diagram.balls.map(b => ({
    id:      b.id,
    group:   b.group,
    fill:    b.group === "cue"   ? BALL_COLORS.cue
           : b.group === "black" ? BALL_COLORS.black
           : b.group === "red"   ? BALL_COLORS.red
           :                       BALL_COLORS.yellow,
    x:       b.x,
    y:       b.y,
    opacity: b.role === "obstacle" ? 0.55 : 1,
  }));

  const zones: ZonePrimitive[] = diagram.targetZone ? [{
    x: diagram.targetZone.x, y: diagram.targetZone.y,
    width: diagram.targetZone.width, height: diagram.targetZone.height,
    fill:          "rgba(255,245,150,0.24)",
    stroke:        "#E0B84C",
    strokeOpacity: 0.90,
    label:         "TARGET ZONE",
  }] : [];

  const aimLines: AimLinePrimitive[] = (diagram.aimLines ?? []).map(al => ({
    fromId:        al.fromBallId,
    throughId:     al.throughBallId,
    toPocket:      al.toPocket,
    style:         al.style ?? "dashed",
    stroke:        "rgba(255,255,255,0.85)",
    strokeOpacity: 0.85,
  }));

  const tm           = diagram.tableMarkings;
  const hasBaulkLine = !!(tm?.showBaulkLine || tm?.showBreakLine);
  const hasBaulkArea = !!tm?.showBaulkArea;
  const hasBlackSpot = !!tm?.showBlackSpot;
  const hasD         = !!(tm?.showD || tm?.showTrainingD);
  const hasMarkings  = hasBaulkLine || hasBaulkArea || hasBlackSpot || hasD || !!(tm?.showRackLine);
  const hasRack      = !!diagram.rack;

  const renderOrder: string[] = [
    "cloth",
    ...(hasBaulkArea    ? ["tablemark_baulkArea"] : []),
    ...(hasBaulkLine    ? ["tablemark_baulkLine"] : []),
    ...(hasD            ? ["tablemark_dSemicircle"] : []),
    ...(hasBlackSpot    ? ["tablemark_blackSpot"] : []),
    ...(zones.length    ? ["targetZone"]          : []),
    ...(aimLines.length ? ["aimLines"]            : []),
    "balls",
    ...(diagram.targetPocket ? ["targetPocket"]   : []),
  ];

  return {
    balls, zones, aimLines,
    targetPocket:  diagram.targetPocket ?? null,
    hasMarkings, hasBaulkLine, hasBaulkArea, hasBlackSpot, hasD, hasRack,
    renderOrder,
  };
}

// ─── Decision option helpers ──────────────────────────────────────────────────

const opt = (label: string, tier: DecisionTier, rationale: string, risk: DecisionOption["risk"]): DecisionOption =>
  ({ key: label, label, tier, rationale, risk });

const execDrill = (id: string, skillId: SkillId, difficulty: number, name: string, desc: string, assessmentEligible = false): Drill => ({
  id, skillId, type: "execution", difficulty, name, desc, familyId: `${skillId}-family`,
  assessmentEligible, rulesets: ["blackball", "international"], rulesContext: null,
});

const decDrill = (
  id: string, skillId: SkillId, difficulty: number, name: string, desc: string,
  options: DecisionOption[], assessmentEligible = false,
  rulesets: RuleSetId[] = ["blackball", "international"],
  rulesetOptions?: Partial<Record<RuleSetId, DecisionOption[]>>
): Drill => ({
  id, skillId, type: "decision", difficulty, name, desc, options, familyId: `${skillId}-family`,
  assessmentEligible, rulesets, rulesContext: rulesets.length === 1 ? rulesets[0] : null, rulesetOptions,
});

// ─── Drills ───────────────────────────────────────────────────────────────────

export const DRILLS: Drill[] = [
  { ...execDrill("pot1","potting",2,"Straight Pot — Middle Pocket","Set the object ball one diamond from a middle pocket, straight in.",true), diagram: { balls: [
    { id: "OBJ", group: "yellow" as const, x: 50, y: 22 },
    { id: "CB",  group: "cue"    as const, x: 50, y: 72 },
  ], targetPocket: "topMiddle", aimLines: [{ fromBallId: "CB", throughBallId: "OBJ", toPocket: "topMiddle", style: "dashed" }], requiresVisuals: ["targetPocket"] }, visualContract: { cueBall: true, targetPocket: true, aimLine: true }, objective: "Pot the yellow into the top-middle pocket.", setup: "Place the yellow one diamond below the top-middle pocket. Position the cue ball directly in line, approximately two diamonds away.", successCriteria: ["Yellow ball potted cleanly into the top-middle pocket."] },
  { ...execDrill("pot2","potting",4,"Angled Pot — 30°","Cut angle pot into a corner pocket."), diagram: { balls: [
    { id: "OBJ", group: "yellow" as const, x: 80, y: 25 },
    { id: "CB",  group: "cue"    as const, x: 50, y: 55 },
  ], targetPocket: "topRight" as const, aimLines: [{ fromBallId: "CB", throughBallId: "OBJ", toPocket: "topRight" as const, style: "dashed" as const }] }, visualContract: { cueBall: true, targetPocket: true, aimLine: true }, setup: "Place the yellow near the top-right area. Position the cue ball to the side to create a 30° cut angle.", objective: "Pot the yellow into the top-right corner pocket using an angled cut shot.", successCriteria: ["Yellow potted cleanly into the top-right pocket.", "Correct cut angle demonstrated."] },
  { ...execDrill("pot3","potting",6,"Long Pot — Full Length","Full-length straight pot, top rail to bottom rail."), diagram: { balls: [
    { id: "OBJ", group: "yellow" as const, x: 48, y: 10 },
    { id: "CB",  group: "cue"    as const, x: 52, y: 84 },
  ], targetPocket: "topMiddle" as const, aimLines: [{ fromBallId: "CB", throughBallId: "OBJ", toPocket: "topMiddle" as const, style: "dashed" as const }] }, visualContract: { cueBall: true, targetPocket: true, aimLine: true }, setup: "Place the yellow near the top cushion close to the middle pocket. Place the cue ball near the opposite end.", objective: "Pot the yellow into the top-middle pocket across the full length of the table.", successCriteria: ["Yellow potted from full-table distance.", "Cue-ball delivery remains controlled."] },
  { ...execDrill("pot4","potting",8,"Thin Cut Under Pressure","Thin cut with a problem ball nearby restricting the cue-ball path."), diagram: { balls: [
    { id: "OBJ", group: "yellow" as const, x: 88, y: 18 },
    { id: "CB",  group: "cue"    as const, x: 40, y: 55 },
    { id: "BLO", group: "red"    as const, x: 62, y: 35, role: "obstacle" as const },
  ], targetPocket: "topRight" as const, aimLines: [{ fromBallId: "CB", throughBallId: "OBJ", toPocket: "topRight" as const, style: "dashed" as const }] }, visualContract: { cueBall: true, targetPocket: true, aimLine: true }, setup: "Place the yellow tight to the top-right corner. Position the blocker to restrict the cue-ball path. Deliver a thin-cut shot.", objective: "Pot the yellow into the top-right pocket with a thin cut, avoiding the obstacle ball.", successCriteria: ["Yellow potted via thin cut.", "Cue ball does not contact the blocker.", "Cue ball stays on the table."] },
  { ...execDrill("spd1","speed",2,"Stop-Ball Speed Gate","Stun the cue ball dead inside the marked zone.",true), diagram: { balls: [
    { id: "OBJ", group: "yellow" as const, x: 55, y: 45 },
    { id: "CB",  group: "cue"    as const, x: 35, y: 65 },
  ], targetZone: { x: 44, y: 35, width: 24, height: 24 }, targetPocket: "topRight", aimLines: [{ fromBallId: "CB", throughBallId: "OBJ", toPocket: "topRight", style: "dashed" }], requiresVisuals: ["targetZone", "targetPocket"] }, visualContract: { cueBall: true, targetPocket: true, aimLine: true, targetZone: true }, objective: "Pot the object ball and stop the cue ball inside the marked zone.", setup: "Place the yellow and cue ball as shown. Pot the yellow into the top-right corner using a stun shot. The cue ball must stop within the highlighted target zone near the contact point.", successCriteria: ["Object ball potted.", "Cue ball finishes within the marked zone."] },
  { ...execDrill("spd2","speed",4,"Two-Cushion Speed Control","Land the cue ball in a target zone after two cushions."), diagram: { balls: [
    { id: "OBJ", group: "yellow" as const, x: 60, y: 38 },
    { id: "CB",  group: "cue"    as const, x: 35, y: 62 },
  ], targetZone: { x: 62, y: 62, width: 28, height: 30 }, targetPocket: "topRight" as const, aimLines: [{ fromBallId: "CB", throughBallId: "OBJ", toPocket: "topRight" as const, style: "dashed" as const }] }, visualContract: { cueBall: true, targetPocket: true, aimLine: true, targetZone: true }, setup: "Place the yellow and cue ball as shown. Pot the yellow into the top-right corner and control the cue ball two cushions into the target zone.", objective: "Pot the object ball and control the cue ball to finish inside the target zone after two-cushion travel.", successCriteria: ["Object ball potted.", "Cue ball finishes within the marked target zone."] },
  { ...execDrill("spd3","speed",6,"Soft Touch Safety Roll","Roll the cue ball just past the object ball at minimal pace."), diagram: { balls: [
    { id: "OBJ", group: "yellow" as const, x: 65, y: 50 },
    { id: "CB",  group: "cue"    as const, x: 45, y: 50 },
  ], targetZone: { x: 55, y: 22, width: 30, height: 24 }, aimLines: [{ fromBallId: "CB", throughBallId: "OBJ", style: "dashed" as const }] }, visualContract: { cueBall: true, aimLine: true, targetZone: true }, setup: "Place the cue ball and object ball close together as shown. Roll the cue ball gently into the object ball at minimum pace.", objective: "Contact the object ball softly and leave the cue ball in the marked target zone.", successCriteria: ["Cue ball contacts the object ball.", "Cue ball finishes within the target zone.", "Shot pace is visibly soft."] },
  { ...execDrill("spd4","speed",8,"Precision Lag to Baulk","Cue ball must finish within a tight zone by the baulk cushion."), diagram: { balls: [
    { id: "OBJ", group: "yellow" as const, x: 28, y: 40 },
    { id: "CB",  group: "cue"    as const, x: 55, y: 62 },
  ], targetZone: { x: 76, y: 22, width: 20, height: 56 }, tableMarkings: { showBaulkLine: true, showD: true }, aimLines: [{ fromBallId: "CB", throughBallId: "OBJ", style: "dashed" as const }] }, visualContract: { cueBall: true, aimLine: true, targetZone: true }, setup: "Place the yellow and cue ball as shown. Strike the yellow and lag the cue ball precisely into the tight baulk-side target zone.", objective: "Hit the object ball and lag the cue ball precisely into the target zone near the baulk cushion.", successCriteria: ["Object ball contacted.", "Cue ball finishes within the baulk-side target zone."] },
  { ...execDrill("pos1","positional",2,"Simple Follow Route","Pot and follow the cue ball into the highlighted zone.",true), diagram: { balls: [
    { id: "OBJ", group: "yellow" as const, x: 68, y: 30 },
    { id: "CB",  group: "cue"    as const, x: 38, y: 58 },
  ], targetZone: { x: 60, y: 5, width: 36, height: 28 }, targetPocket: "topRight", aimLines: [{ fromBallId: "CB", throughBallId: "OBJ", toPocket: "topRight", style: "dashed" }], requiresVisuals: ["targetZone", "targetPocket"] }, visualContract: { cueBall: true, targetPocket: true, aimLine: true, targetZone: true }, objective: "Pot the yellow and follow the cue ball into the highlighted zone.", setup: "Place the yellow and cue ball as shown. Pot the yellow into the top-right corner with follow. The cue ball must continue into the highlighted zone beyond the contact point.", successCriteria: ["Yellow potted.", "Cue ball finishes in the highlighted follow zone."] },
  { ...execDrill("pos2","positional",4,"Screw Round the Angle","Pot and screw the cue ball back around a cluster."), diagram: { balls: [
    { id: "OBJ", group: "yellow" as const, x: 72, y: 28 },
    { id: "CB",  group: "cue"    as const, x: 45, y: 52 },
    { id: "NXT", group: "yellow" as const, x: 25, y: 48, trainingLabel: "N" },
  ], targetZone: { x: 15, y: 44, width: 28, height: 30 }, targetPocket: "topRight" as const, aimLines: [{ fromBallId: "CB", throughBallId: "OBJ", toPocket: "topRight" as const, style: "dashed" as const }] }, visualContract: { cueBall: true, targetPocket: true, aimLine: true, targetZone: true }, setup: "Place balls as shown. Ball N is your next target. Pot the yellow with backspin and screw the cue ball back into the marked zone.", objective: "Pot the yellow and screw the cue ball back into the target zone to set up access to ball N.", successCriteria: ["Yellow potted into top-right pocket.", "Cue ball finishes in the screw-back zone."] },
  { ...execDrill("pos3","positional",6,"Side-Spin Route","Use side spin to reach a tucked-away next ball."), diagram: { balls: [
    { id: "OBJ", group: "yellow" as const, x: 18, y: 45 },
    { id: "CB",  group: "cue"    as const, x: 50, y: 65 },
    { id: "NXT", group: "yellow" as const, x: 68, y: 22, trainingLabel: "N" },
  ], targetZone: { x: 60, y: 12, width: 30, height: 28 }, targetPocket: "bottomLeft" as const, aimLines: [{ fromBallId: "CB", throughBallId: "OBJ", toPocket: "bottomLeft" as const, style: "dashed" as const }] }, visualContract: { cueBall: true, targetPocket: true, aimLine: true, targetZone: true }, setup: "Place balls as shown. Ball N is tucked in the upper-right area. Pot the yellow using right side-spin so the cue ball deflects into the target zone.", objective: "Pot the yellow using side-spin to deflect the cue ball into the target zone, setting up ball N.", successCriteria: ["Yellow potted into bottom-left pocket.", "Cue ball finishes in the target zone."] },
  { ...execDrill("pos4","positional",8,"Congested Cluster Route","Navigate the cue ball through a tight cluster to the next ball."), diagram: { balls: [
    { id: "OBJ", group: "yellow" as const, x: 32, y: 38 },
    { id: "CB",  group: "cue"    as const, x: 58, y: 65 },
    { id: "BL1", group: "red"    as const, x: 48, y: 42, role: "obstacle" as const },
    { id: "BL2", group: "red"    as const, x: 62, y: 32, role: "obstacle" as const },
    { id: "BL3", group: "red"    as const, x: 40, y: 28, role: "obstacle" as const },
    { id: "NXT", group: "yellow" as const, x: 18, y: 22, trainingLabel: "N" },
  ], targetZone: { x: 10, y: 12, width: 26, height: 32 }, targetPocket: "bottomLeft" as const, aimLines: [{ fromBallId: "CB", throughBallId: "OBJ", toPocket: "bottomLeft" as const, style: "dashed" as const }] }, visualContract: { cueBall: true, targetPocket: true, aimLine: true, targetZone: true }, setup: "The cluster of red balls blocks the natural cue-ball route. Pot the yellow and navigate the cue ball into the target zone.", objective: "Pot the yellow and thread the cue ball through the congested cluster to reach ball N in the target zone.", successCriteria: ["Yellow potted into bottom-left pocket.", "Cue ball finishes in the target zone without disturbing obstacle balls."] },
  { ...execDrill("cue1","cueBall",2,"Basic Stun","Play a clean stun shot; the cue ball stops on the contact line.",true), diagram: { balls: [
    { id: "OBJ", group: "yellow" as const, x: 58, y: 42 },
    { id: "CB",  group: "cue"    as const, x: 33, y: 62 },
  ], targetZone: { x: 50, y: 36, width: 16, height: 14 }, targetPocket: "topRight" as const, aimLines: [{ fromBallId: "CB", throughBallId: "OBJ", toPocket: "topRight" as const, style: "dashed" as const }] }, visualContract: { cueBall: true, targetPocket: true, aimLine: true, targetZone: true }, objective: "Pot the yellow using a stun shot. The cue ball must stop near the contact point.", setup: "Place the yellow as shown. Position the cue ball at a straight or near-straight angle.", successCriteria: ["Yellow potted.", "Cue ball stops within one ball-width of the original contact point."] },
  { ...execDrill("cue2","cueBall",4,"Screw Shot","Basic screw back off the object ball."), diagram: { balls: [
    { id: "OBJ", group: "yellow" as const, x: 50, y: 30 },
    { id: "CB",  group: "cue"    as const, x: 50, y: 60 },
  ], targetZone: { x: 38, y: 65, width: 24, height: 24 }, targetPocket: "topMiddle" as const, aimLines: [{ fromBallId: "CB", throughBallId: "OBJ", toPocket: "topMiddle" as const, style: "dashed" as const }] }, visualContract: { cueBall: true, targetPocket: true, aimLine: true, targetZone: true }, setup: "Place the yellow straight in front of the cue ball as shown. Apply backspin and pot the yellow.", objective: "Pot the yellow and use backspin to draw the cue ball back into the target zone behind the starting position.", successCriteria: ["Yellow potted into top-middle pocket.", "Cue ball finishes in the screw-back target zone."] },
  { ...execDrill("cue3","cueBall",6,"Swerve Around a Blocker","Use swerve to avoid a blocking ball."), diagram: { balls: [
    { id: "CB",  group: "cue"    as const, x: 50, y: 72 },
    { id: "BLO", group: "red"    as const, x: 50, y: 50, role: "obstacle" as const },
    { id: "OBJ", group: "yellow" as const, x: 48, y: 25 },
  ], targetZone: { x: 38, y: 60, width: 26, height: 24 }, targetPocket: "topMiddle" as const, aimLines: [{ fromBallId: "CB", throughBallId: "OBJ", toPocket: "topMiddle" as const, style: "dashed" as const }] }, visualContract: { cueBall: true, targetPocket: true, aimLine: true, targetZone: true }, setup: "The blocker sits between cue ball and object ball. Use side-spin to swerve the cue ball around the obstacle.", objective: "Curve the cue ball around the blocking ball to contact the yellow and pot it into the top-middle pocket.", successCriteria: ["Cue ball passes the blocker without touching it.", "Yellow potted into top-middle pocket."] },
  { ...execDrill("pbe1","problemBallExec",2,"Simple Nudge","Nudge a problem ball a few inches into open space.",true), diagram: { balls: [
    { id: "PROB", group: "yellow" as const, x: 88, y: 48, role: "obstacle" as const },
    { id: "CB",   group: "cue"    as const, x: 42, y: 65 },
  ], targetZone: { x: 72, y: 25, width: 22, height: 35 } }, visualContract: { cueBall: true, targetZone: true }, objective: "Use the cue ball to nudge the obstacle ball clear of the right cushion.", setup: "Place the obstacle ball close to the right cushion as shown. Position the cue ball in the central area for a controlled contact.", successCriteria: ["Obstacle ball moves clear of the cushion.", "Cue ball remains in a playable position."] },
  { ...execDrill("pbe2","problemBallExec",4,"Cannon Off Two Balls","Use a cannon to move two problem balls apart."), diagram: { balls: [
    { id: "CB",  group: "cue"    as const, x: 45, y: 58 },
    { id: "STR", group: "yellow" as const, x: 62, y: 40, trainingLabel: "1" },
    { id: "PB2", group: "red"    as const, x: 75, y: 28, role: "obstacle" as const },
  ], targetZone: { x: 62, y: 10, width: 32, height: 25 } }, visualContract: { cueBall: true, targetZone: true }, setup: "Place cue ball, striker ball (1), and problem ball as shown. Strike ball 1 so it cannons into the problem ball.", objective: "Cannon the cue ball into ball 1, which strikes the problem ball and opens both into the target zone.", successCriteria: ["Both balls contacted in the cannon.", "Problem ball moves into the development zone."] },
  { ...execDrill("pbe3","problemBallExec",6,"Break-Out From a Cluster","Break out a buried ball from a tight cluster."), diagram: { balls: [
    { id: "CB",  group: "cue"    as const, x: 52, y: 62 },
    { id: "TGT", group: "yellow" as const, x: 32, y: 42, trainingLabel: "T" },
    { id: "CL1", group: "yellow" as const, x: 25, y: 32 },
    { id: "CL2", group: "yellow" as const, x: 20, y: 38 },
    { id: "CL3", group: "yellow" as const, x: 28, y: 48 },
  ], targetZone: { x: 10, y: 22, width: 28, height: 38 } }, visualContract: { cueBall: true, targetZone: true }, setup: "Set up the cluster of balls as shown. Ball T is buried in the cluster. Strike T to scatter the cluster into open space.", objective: "Contact the target ball (T) to shatter the cluster, dispersing balls into the highlighted development zone.", successCriteria: ["Target ball separates from the cluster.", "Cluster balls disperse into the highlighted zone.", "Cue ball does not pocket (no scratch)."] },
  { ...execDrill("brk1","breakExec",2,"Controlled Break","Break with control and aim for a stable spread.",true), diagram: { balls: [
    // Rack at LEFT (rack end). Apex at x=25 faces RIGHT toward baulk. CB at x=82 (right of baulk line) y=83 (>75 for baulk-area check).
    ...createEnglishEightBallRack(25, 50),
    { id: "CB", group: "cue" as const, x: 82, y: 83 },
  ], tableMarkings: { showBaulkLine: true, showBaulkArea: true, showBlackSpot: true, showD: true }, rack: { apexX: 25, apexY: 50, englishEightBall: true }, requiresVisuals: ["baulkArea", "rack"] }, visualContract: { cueBall: true }, objective: "Break the rack and achieve a stable, controlled spread.", setup: "Rack all 15 balls tightly in the triangle shown at the left (rack) end of the table. Place the white cue ball anywhere inside the D area at the right (baulk) end.", successCriteria: ["Cue ball strikes the rack cleanly.", "Balls spread across the table.", "Cue ball does not enter a pocket (no scratch)."] },
  { ...execDrill("brk2","breakExec",4,"Break for a Pot","Break attempting to pot a ball off the break."), diagram: { balls: [
    ...createEnglishEightBallRack(25, 50),
    { id: "CB", group: "cue" as const, x: 82, y: 50 },
  ], targetPocket: "topLeft" as const, tableMarkings: { showBaulkLine: true, showBaulkArea: true, showD: true, showBlackSpot: true }, rack: { apexX: 25, apexY: 50, englishEightBall: true } }, visualContract: { cueBall: true, targetPocket: true }, setup: "Rack all 15 balls at the left (rack) end. Place the cue ball in the D area. Drive the cue ball into the apex ball aiming to pot a ball off the break.", objective: "Break the rack and pot at least one ball directly from the break.", successCriteria: ["Cue ball strikes the rack cleanly.", "At least one ball is potted from the break.", "Cue ball does not pocket (no scratch)."] },
  { ...execDrill("brk3","breakExec",6,"Break Under Baulk Restriction","Break within tighter baulk-area constraints."), diagram: { balls: [
    ...createEnglishEightBallRack(25, 50),
    { id: "CB", group: "cue" as const, x: 85, y: 65 },
  ], tableMarkings: { showBaulkLine: true, showBaulkArea: true, showD: true, showBlackSpot: true, showBaulkPoints: true }, rack: { apexX: 25, apexY: 50, englishEightBall: true } }, visualContract: { cueBall: true }, setup: "Rack all 15 balls at the left (rack) end. The cue ball must be placed within the restricted portion of the D shown. Execute a legal break from this constrained position.", objective: "Break the rack legally from the restricted cue-ball placement, achieving a stable spread.", successCriteria: ["Cue ball placed legally within the highlighted zone.", "Cue ball strikes the rack cleanly.", "Balls spread across the table."] },
  { ...execDrill("8b1","eightBall",2,"Straight 8-Ball","Simple straight 8-ball pot.",true), diagram: { balls: [
    { id: "BLK", group: "black" as const, x: 50, y: 28 },
    { id: "CB",  group: "cue"   as const, x: 50, y: 70 },
  ], targetPocket: "topMiddle", aimLines: [{ fromBallId: "CB", throughBallId: "BLK", toPocket: "topMiddle", style: "dashed" }], requiresVisuals: ["aimLine", "targetPocket"] }, visualContract: { cueBall: true, targetPocket: true, aimLine: true }, objective: "Pot the 8-ball into the nominated top-middle pocket.", setup: "Place the 8-ball on the straight potting line as shown. Place the cue ball directly in line behind it.", successCriteria: ["8-ball potted into the nominated pocket.", "Cue ball does not scratch."] },
  { ...execDrill("8b2","eightBall",4,"Angled 8-Ball With Position","Angled 8-ball; cue ball must finish clear of cushions."), diagram: { balls: [
    { id: "BLK", group: "black" as const, x: 58, y: 25 },
    { id: "CB",  group: "cue"   as const, x: 35, y: 55 },
  ], targetZone: { x: 18, y: 40, width: 35, height: 35 }, targetPocket: "topRight" as const, aimLines: [{ fromBallId: "CB", throughBallId: "BLK", toPocket: "topRight" as const, style: "dashed" as const }] }, visualContract: { cueBall: true, targetPocket: true, aimLine: true, targetZone: true }, setup: "Place the 8-ball and cue ball as shown. The 8-ball requires a cut angle to reach the top-right pocket.", objective: "Pot the 8-ball into the top-right pocket and leave the cue ball in the target zone, clear of all cushions.", successCriteria: ["8-ball potted into the nominated pocket.", "Cue ball finishes in the target zone.", "Cue ball does not scratch."] },
  { ...execDrill("8b3","eightBall",6,"8-Ball Under Pressure","8-ball pot with a tight pocket angle."), diagram: { balls: [
    { id: "BLK", group: "black" as const, x: 25, y: 35 },
    { id: "CB",  group: "cue"   as const, x: 52, y: 62 },
    { id: "OBS", group: "red"   as const, x: 38, y: 50, role: "obstacle" as const },
  ], targetPocket: "topLeft" as const, aimLines: [{ fromBallId: "CB", throughBallId: "BLK", toPocket: "topLeft" as const, style: "dashed" as const }] }, visualContract: { cueBall: true, targetPocket: true, aimLine: true }, setup: "Place the 8-ball near the top-left area. A blocker restricts the easiest cue-ball path. The pocket angle is tight.", objective: "Pot the 8-ball into the top-left pocket under pressure, navigating the restricted cue-ball approach.", successCriteria: ["8-ball potted into the nominated pocket.", "Cue ball does not contact the obstacle.", "Cue ball does not scratch."] },

  { ...decDrill("pat1","pattern",2,"Choose the Ball Order","Player is Yellow. Three balls are on the table — the numbers identify the balls only, not the correct pot order. Which sequence clears the layout most safely?",[
    { key: "opt-a", label: "Ball 3 → Ball 1 → Ball 2 → Black", tier: "optimal"    as const, rationale: "Ball 3 is the most natural starting angle from the cue ball. Playing in numerical order ignores the geometry — the label is a reference, not a route.", risk: "low"    as const, sequence: [
      { ballId: "B3",  shot: "stun",       positionFor: "B1"     },
      { ballId: "B1",  shot: "follow",     positionFor: "B2"     },
      { ballId: "B2",  shot: "check-side", positionFor: "BLK"    },
      { ballId: "BLK", shot: "natural",    positionFor: "pocket" },
    ] },
    { key: "opt-b", label: "Ball 1 → Ball 2 → Ball 3 → Black", tier: "acceptable" as const, rationale: "Numerical order is geometrically workable here but demands tougher positional control between Ball 2 and Ball 3.", risk: "medium" as const, sequence: [
      { ballId: "B1",  shot: "follow",    positionFor: "B2"     },
      { ballId: "B2",  shot: "right-side",positionFor: "B3"     },
      { ballId: "B3",  shot: "stun",      positionFor: "BLK"    },
      { ballId: "BLK", shot: "natural",   positionFor: "pocket" },
    ] },
    { key: "opt-c", label: "Ball 2 → Ball 3 → Ball 1 → Black", tier: "highrisk"   as const, rationale: "Starting on Ball 2 leaves a hard cross-table route to Ball 3 with speculative position for Ball 1.", risk: "high"   as const },
    { key: "opt-d", label: "Play in the order the balls are numbered — Ball 1 first, always", tier: "poor" as const, rationale: "Treating the labels as the intended shot order is a common misread. They are coaching reference numbers only.", risk: "high" as const },
  ],true), diagram: { playerGroup: "yellow" as const, balls: [
    { id: "CB",  group: "cue"    as const, x: 50, y: 77 },
    { id: "B1",  group: "yellow" as const, x: 40, y: 24, trainingLabel: "1", role: "target"  as const },
    { id: "B2",  group: "yellow" as const, x: 73, y: 52, trainingLabel: "2", role: "target"  as const },
    { id: "B3",  group: "yellow" as const, x: 22, y: 60, trainingLabel: "3", role: "target"  as const },
    { id: "BLK", group: "black"  as const, x: 57, y: 20, role: "black"   as const },
  ] }, visualContract: { cueBall: true }, scenarioPurpose: "natural_pattern", objective: "Identify the shot order that gives the largest positional margin while maintaining access to the black." },
  { ...decDrill("pat2","pattern",4,"Two Viable Routes","Player is Yellow. Two routes look reasonable. Which order keeps the angle on the Black most accessible?",[
    { key: "opt-a", label: "Ball 3 → Ball 1 → Ball 2 → Black", tier: "optimal"    as const, rationale: "Potting Ball 3 first angles the cue ball toward Ball 1 naturally, then Ball 2 leaves a comfortable open angle on the Black.", risk: "low"    as const, sequence: [
      { ballId: "B3",  shot: "stun",    positionFor: "B1"     },
      { ballId: "B1",  shot: "follow",  positionFor: "B2"     },
      { ballId: "B2",  shot: "screw",   positionFor: "BLK"   },
      { ballId: "BLK", shot: "natural", positionFor: "pocket" },
    ] },
    { key: "opt-b", label: "Ball 1 → Ball 3 → Ball 2 → Black", tier: "acceptable" as const, rationale: "A reasonable route, though finishing on Ball 2 from that angle makes the Black slightly harder to control.", risk: "medium" as const, sequence: [
      { ballId: "B1",  shot: "follow",      positionFor: "B3"     },
      { ballId: "B3",  shot: "right-side",  positionFor: "B2"     },
      { ballId: "B2",  shot: "stun",        positionFor: "BLK"   },
      { ballId: "BLK", shot: "natural",     positionFor: "pocket" },
    ] },
    { key: "opt-c", label: "Ball 2 → Ball 1 → Ball 3 → Black", tier: "highrisk"   as const, rationale: "Starting on Ball 2 leaves difficult cross-table positional work that often leaves no clear angle on the Black.", risk: "high"   as const },
    { key: "opt-d", label: "Pot whichever looks easiest first", tier: "poor"       as const, rationale: "One-ball-at-a-time thinking ignores how each pot sets up the next. The finish on the Black must be considered from the start.", risk: "high"   as const },
  ]), diagram: { playerGroup: "yellow" as const, balls: [
    { id: "CB",  group: "cue"    as const, x: 45, y: 78 },
    { id: "B1",  group: "yellow" as const, x: 28, y: 35, trainingLabel: "1", role: "target" as const },
    { id: "B2",  group: "yellow" as const, x: 70, y: 26, trainingLabel: "2", role: "target" as const },
    { id: "B3",  group: "yellow" as const, x: 62, y: 58, trainingLabel: "3", role: "target" as const },
    { id: "BLK", group: "black"  as const, x: 40, y: 18, role: "black"  as const },
  ] }, visualContract: { cueBall: true }, scenarioPurpose: "black_access", objective: "Identify the route that leaves the most accessible angle on the black as the finishing ball." },
  { ...decDrill("pat3","pattern",6,"Awkward Layout Planning","Player is Yellow. A red obstacle ball sits near Ball 3. Which order reduces risk across the full clearance?",[
    { key: "opt-a", label: "Ball 1 → Ball 2 → Ball 3 → Black", tier: "optimal"    as const, rationale: "Clear the loose open balls first. By the time you reach Ball 3, the table is simpler and you have better information about the angle needed past the obstacle.", risk: "low"    as const, sequence: [
      { ballId: "B1",  shot: "follow",    positionFor: "B2"     },
      { ballId: "B2",  shot: "left-side", positionFor: "B3"     },
      { ballId: "B3",  shot: "stun",      positionFor: "BLK"    },
      { ballId: "BLK", shot: "natural",   positionFor: "pocket" },
    ] },
    { key: "opt-b", label: "Ball 3 → Ball 1 → Ball 2 → Black", tier: "acceptable" as const, rationale: "Tackling the obstacle early can work if the angle is available. The risk is that a mistake on Ball 3 leaves the table more difficult.", risk: "medium" as const },
    { key: "opt-c", label: "Ball 2 → Ball 3 → Ball 1 → Black", tier: "highrisk"   as const, rationale: "Jumping to Ball 3 second, before clearing Ball 1, creates unnecessary positional difficulty around the obstacle.", risk: "high"   as const },
    { key: "opt-d", label: "Play the easiest-looking pot each time without a plan", tier: "poor" as const, rationale: "Reacting to each shot in isolation ignores the cluster problem. It will still be there — on worse terms.", risk: "high" as const },
  ]), diagram: { playerGroup: "yellow" as const, balls: [
    { id: "CB",  group: "cue"    as const, x: 48, y: 73 },
    { id: "B1",  group: "yellow" as const, x: 20, y: 38, trainingLabel: "1", role: "target"   as const },
    { id: "B2",  group: "yellow" as const, x: 72, y: 25, trainingLabel: "2", role: "target"   as const },
    { id: "B3",  group: "yellow" as const, x: 54, y: 50, trainingLabel: "3", role: "target"   as const },
    { id: "OPP", group: "red"    as const, x: 63, y: 57, role: "obstacle" as const },
    { id: "BLK", group: "black"  as const, x: 38, y: 20, role: "black"    as const },
  ] }, visualContract: { cueBall: true }, scenarioPurpose: "problem_ball", objective: "Identify the route that safely addresses the obstacle-blocked ball without exposing unnecessary risk." },
  { ...decDrill("pat4","pattern",8,"When to Abandon the Plan","Player is Yellow. You planned Ball 1 → Ball 2 → Black, but the cue ball is now tucked near the bottom-right cushion. What do you do?",[
    { key: "opt-a", label: "Reassess from this position — Ball 2 may now be the better starting ball from this angle.", tier: "optimal"    as const, rationale: "The cue ball's actual position determines the best next ball, not the original plan. Ball 2 is now reachable with a better angle from the bottom-right.", risk: "low"    as const, sequence: [
      { ballId: "B2",  shot: "stun",    positionFor: "B1"     },
      { ballId: "B1",  shot: "follow",  positionFor: "BLK"   },
      { ballId: "BLK", shot: "natural", positionFor: "pocket" },
    ] },
    { key: "opt-b", label: "Adjust only the next shot and try to recover the original Ball 1 → Ball 2 → Black route.", tier: "acceptable" as const, rationale: "A tactical adjustment is reasonable, but over-committing to the original route after a significant positional change may create further difficulties.", risk: "medium" as const },
    { key: "opt-c", label: "Force Ball 1 despite the awkward angle — the original plan was correct.", tier: "poor"       as const, rationale: "Ignoring that the position has genuinely changed and forcing the original route is the most common clearance mistake.", risk: "high"   as const },
    { key: "opt-d", label: "Play safe immediately — the clearance opportunity has passed.", tier: "highrisk"   as const, rationale: "Conceding a clearance prematurely when the position is salvageable wastes a significant opportunity.", risk: "medium" as const },
  ]), visualContract: { cueBall: true }, scenarioPurpose: "recovery", objective: "Decide how to adapt your clearance route after an unexpected positional leave.", diagram: { playerGroup: "yellow" as const, balls: [
    { id: "CB",  group: "cue"    as const, x: 82, y: 78 },
    { id: "B1",  group: "yellow" as const, x: 22, y: 38, trainingLabel: "1", role: "target" as const },
    { id: "B2",  group: "yellow" as const, x: 58, y: 28, trainingLabel: "2", role: "target" as const },
    { id: "BLK", group: "black"  as const, x: 42, y: 12, role: "black"  as const },
  ] } },
  { ...decDrill("pbd1","problemBallDec",2,"Spot the Problem Ball","Player is Yellow. Three yellows are on the table. Which one is the key problem ball you need to plan around?",[
    { key: "opt-a", label: "Ball 2 — its position tight to the right cushion limits your pocket choice and makes controlling the cue ball after potting unpredictable.", tier: "optimal"    as const, rationale: "Ball 2 at x=92 is tight against the right cushion. The restricted angle means only one pocket is realistically available, and position control after potting is severely limited. It must be planned early.", risk: "low"    as const },
    { key: "opt-b", label: "Ball 1 — it is closest to the cue ball so should be addressed first.",                                                                        tier: "highrisk"   as const, rationale: "Proximity to the cue ball does not make a ball a problem. Ball 1 is in open space with comfortable pocket access. Playing it first is actually fine, but it is not the diagnostic problem.", risk: "high"   as const },
    { key: "opt-c", label: "Ball 3 — it is the farthest from the black so it needs early attention.",                                                                     tier: "acceptable" as const, rationale: "Distance from the black is a weak heuristic. Ball 3 is open and accessible. The black distance alone does not make it a problem ball.", risk: "medium" as const },
    { key: "opt-d", label: "None — all three can safely be left to situational judgment.",                                                                                 tier: "poor"       as const, rationale: "Ball 2 is a genuine problem ball due to its cushion position. Ignoring it and reacting shot-by-shot will lead to a forced or missed clearance.", risk: "high"   as const },
  ],true), visualContract: { cueBall: true }, scenarioPurpose: "problem_ball", objective: "Identify which yellow ball presents the greatest planning challenge and should be considered first in your route.", diagram: { playerGroup: "yellow" as const, balls: [
    { id: "CB",  group: "cue"    as const, x: 53, y: 65 },
    { id: "B1",  group: "yellow" as const, x: 30, y: 40, trainingLabel: "1", role: "target"  as const },
    { id: "B2",  group: "yellow" as const, x: 92, y: 32, trainingLabel: "2", role: "target"  as const },
    { id: "B3",  group: "yellow" as const, x: 48, y: 72, trainingLabel: "3", role: "target"  as const },
    { id: "OPP", group: "red"    as const, x: 78, y: 50, role: "obstacle" as const },
    { id: "BLK", group: "black"  as const, x: 50, y: 18, role: "black"   as const },
  ] } },
  { ...decDrill("pbd2","problemBallDec",4,"When to Develop","Ball 2 has restricted access. When should you develop it?",[
    opt("Develop Ball 2 now while you still have a safe route to it","optimal","Waiting risks losing the safe angle needed to move Ball 2. The route exists now — act on it.","low"),
    opt("Leave Ball 2 and hope a later shot opens it","acceptable","Sometimes true, but relies on luck rather than a plan.","medium"),
    opt("Attack Ball 2 directly as a full pot attempt despite the poor angle","highrisk","High difficulty with little reward — Ball 2 is genuinely awkward from this position.","high"),
    opt("Ignore Ball 2 for the rest of the clearance","poor","Ball 2 still needs addressing, likely on worse terms if left.","high"),
  ]), focusBallId: "PROB", visualContract: { cueBall: true }, diagram: { playerGroup: "yellow" as const, balls: [
    { id: "CB",   group: "cue"    as const, x: 50, y: 62 },
    { id: "PROB", group: "yellow" as const, x: 18, y: 28, trainingLabel: "2", role: "target"   as const },
    { id: "Y1",   group: "yellow" as const, x: 58, y: 35, trainingLabel: "1", role: "target"   as const },
    { id: "Y3",   group: "yellow" as const, x: 40, y: 22, trainingLabel: "3", role: "target"   as const },
    { id: "OPP",  group: "red"    as const, x: 72, y: 48, role: "obstacle" as const },
    { id: "BLK",  group: "black"  as const, x: 30, y: 12, role: "black"    as const },
  ] } },
  { ...decDrill("pbd3","problemBallDec",6,"Late-Development Risk","Player is Yellow. Ball 3 was left and is now harder to reach. What do you do?",[
    { key: "opt-a", label: "Develop ball 3 now — a partial route still exists from this angle", tier: "optimal" as const, rationale: "The window for safely reaching ball 3 is closing. A harder development is still better than a forced leave at the end of the clearance.", risk: "low" as const },
    { key: "opt-b", label: "Pot ball 1 first, then approach ball 3 from the new angle", tier: "acceptable" as const, rationale: "Playing ball 1 first may open a better line to ball 3 — this can work if ball 1 naturally delivers position nearby.", risk: "medium" as const },
    { key: "opt-c", label: "Continue to ball 2 and hope position for ball 3 appears", tier: "highrisk" as const, rationale: "Deferring further risks leaving ball 3 completely inaccessible — the opponent's ball already blocks the most natural route.", risk: "high" as const },
    { key: "opt-d", label: "Write off ball 3 and complete the clearance without it", tier: "poor" as const, rationale: "Abandoning a ball prematurely when a route exists is the most common planning error. The window is narrow but has not closed.", risk: "high" as const },
  ]), visualContract: { cueBall: true }, scenarioPurpose: "problem_ball", objective: "Decide whether to address the late-developing ball now or risk losing access to it entirely.", diagram: { playerGroup: "yellow" as const, balls: [
    { id: "CB",       group: "cue"    as const, x: 55, y: 68 },
    { id: "LATEPROB", group: "yellow" as const, x: 12, y: 20, trainingLabel: "3", role: "target"   as const },
    { id: "Y1",       group: "yellow" as const, x: 45, y: 32, trainingLabel: "1", role: "target"   as const },
    { id: "Y2",       group: "yellow" as const, x: 68, y: 25, trainingLabel: "2", role: "target"   as const },
    { id: "OPP",      group: "red"    as const, x: 25, y: 55, role: "obstacle" as const },
    { id: "BLK",      group: "black"  as const, x: 50, y: 15, role: "black"    as const },
  ] } },
  { ...decDrill("tac1","tactical",2,"Attack or Safety","Player is Yellow. The cue ball is central with a clear, unobstructed angle on Ball 1 near the top-right area. The red ball is not on the potting line. What is the correct decision?",[
    { key: "opt-a", label: "Pot Ball 1 — the angle is clean and the cue ball naturally follows toward the black.", tier: "optimal"    as const, rationale: "When a direct pot is genuinely on with a comfortable angle and natural position for the next ball, attacking is the correct decision. The red is not blocking.", risk: "low"    as const },
    { key: "opt-b", label: "Play safe behind the red obstacle to maintain positional control.",                    tier: "acceptable" as const, rationale: "Safety is a reasonable option if confidence is low, but it gives up real value here — the pot is clearly available and position naturally follows.", risk: "low"    as const },
    { key: "opt-c", label: "Try a combination or plant to clear two balls at once.",                               tier: "highrisk"   as const, rationale: "When a straightforward direct pot is available, introducing a combination adds unnecessary difficulty and risk.", risk: "high"   as const },
    { key: "opt-d", label: "Play a cushion shot with no clear intention.",                                         tier: "poor"       as const, rationale: "Playing aimlessly when a direct pot is on wastes a clear opportunity and leaves the table in an uncertain state.", risk: "high"   as const },
  ],true), visualContract: { cueBall: true }, scenarioPurpose: "safety", objective: "Decide whether to attack the available pot or play safe based on the geometry shown.", diagram: { playerGroup: "yellow" as const, balls: [
    { id: "CB",  group: "cue"    as const, x: 48, y: 58 },
    { id: "B1",  group: "yellow" as const, x: 64, y: 28, trainingLabel: "1", role: "target"  as const },
    { id: "OPP", group: "red"    as const, x: 72, y: 65, role: "obstacle" as const },
    { id: "BLK", group: "black"  as const, x: 45, y: 15, role: "black"   as const },
  ] } },
  { ...decDrill("tac2","tactical",4,"Create a Snooker","You are YELLOWS. Is creating a snooker behind the red blocker stronger than attacking your available yellow?",[
    opt("Yes — use Ball 1 to leave the cue ball behind the red blocker and hide the opponent's direct path","optimal","Best use of the position when nothing better is on.","low"),
    opt("Play a containing safety without attempting the full snooker","acceptable","Safer to execute, with slightly lower tactical value.","low"),
    opt("Attack Ball 1 despite the poor percentage","highrisk","Low-percentage shot when a stronger option exists.","high"),
    opt("Play an uncontrolled shot without a defined safety or potting objective","poor","Wastes the tactical opportunity entirely.","high"),
  ]), visualContract: { cueBall: true }, diagram: { playerGroup: "yellow" as const, balls: [
    { id: "CB",    group: "cue"    as const, x: 48, y: 72 },
    { id: "B1",    group: "yellow" as const, x: 20, y: 22, trainingLabel: "1", role: "target"  as const },
    { id: "BLOCK", group: "red"    as const, x: 42, y: 45, role: "obstacle" as const },
    { id: "OPP",   group: "red"    as const, x: 62, y: 28, role: "obstacle" as const },
    { id: "BLK",   group: "black"  as const, x: 70, y: 12, role: "black"   as const },
  ] } },
  { ...decDrill("tac3","tactical",6,"Finish Onto the 8-Ball","Choose the right finishing position for the 8-ball.",[
    opt("Leave a straightforward angle on the 8-ball","optimal","The whole clearance is only as good as its finish.","low"),
    opt("Leave it playable but at a tougher angle","acceptable","Still gives a chance, just harder than it needed to be.","medium"),
    opt("Prioritise an easier second-to-last pot over 8-ball position","highrisk","Solves the wrong problem — the 8-ball is what matters most.","high"),
    opt("Do not think about the 8-ball at all","poor","Ignores the actual objective of the clearance.","high"),
  ]), visualContract: { cueBall: true }, diagram: { playerGroup: "yellow" as const, balls: [
    { id: "CB",  group: "cue"    as const, x: 52, y: 55 },
    { id: "B1",  group: "yellow" as const, x: 35, y: 32, trainingLabel: "1", role: "target"  as const },
    { id: "OPP", group: "red"    as const, x: 25, y: 48, role: "obstacle" as const },
    { id: "BLK", group: "black"  as const, x: 62, y: 18, role: "black"   as const },
  ] } },
  { ...decDrill("tac4","tactical",8,"Match-Situation Pressure Call","Deciding frame — attack or contain?",[
    opt("Take the safe, high-percentage route given the situation","optimal","Pressure rewards reducing risk, not adding to it.","low"),
    opt("Attack, since a clearance would end it outright","acceptable","Understandable, but raises risk more than the situation calls for.","medium"),
    opt("Attack the hardest ball for maximum reward","highrisk","Needlessly raises risk in a situation that punishes mistakes.","high"),
    opt("Play without regard for the match situation","poor","Ignores the context entirely.","high"),
  ]), visualContract: { cueBall: true }, diagram: { playerGroup: "yellow" as const, balls: [
    { id: "CB",    group: "cue"    as const, x: 58, y: 68 },
    { id: "B1",    group: "yellow" as const, x: 35, y: 28, trainingLabel: "1", role: "target"  as const },
    { id: "BLOCK", group: "red"    as const, x: 50, y: 48, role: "obstacle" as const },
    { id: "OPP",   group: "red"    as const, x: 72, y: 35, role: "obstacle" as const },
    { id: "BLK",   group: "black"  as const, x: 42, y: 18, role: "black"   as const },
  ] } },
  { ...decDrill(
    "tac5_foul_recovery","tactical",5,
    "Foul Recovery — Using Your Advantage",
    "Your opponent has fouled. You are in a reasonable position with balls still on. What do you do with your advantage?",
    [
      opt("Attack — pot a ball directly","acceptable","Taking a pot can be correct, but consider your positional advantage first.","medium"),
      opt("Play a snooker or safety to extend the advantage","acceptable","A safety compounds the opponent's difficulty.","low"),
      opt("Hit something without a clear plan","poor","Wastes a significant positional advantage.","high"),
      opt("Roll up safe without taking the free-shot advantage","highrisk","Surrendering the advantage of the foul is rarely correct.","high"),
    ],
    false,["blackball","international"],
    {
      blackball:[
        opt("Attack — pot a ball directly","acceptable","From baulk you have limited angles — a direct attack is workable only if a pot is clearly on from the D.","medium"),
        opt("Play a snooker or safety to extend the advantage","optimal","With a free shot from baulk, a nominated snooker is often the strongest play — you keep control and the opponent faces another awkward position.","low"),
        opt("Hit something without a clear plan","poor","Wastes your free-shot advantage entirely.","high"),
        opt("Roll up safe without taking the free-shot advantage","highrisk","You have a free shot — wasting it by playing passively gives up a material edge.","high"),
      ],
      international:[
        opt("Attack — pot a ball directly","optimal","Ball in hand anywhere gives full positional freedom. Placing the cue ball for the best pot is strongly correct.","low"),
        opt("Play a snooker or safety to extend the advantage","acceptable","With ball in hand anywhere you can almost always find a pot. A safety gives up too much value unless the table is very locked up.","low"),
        opt("Hit something without a clear plan","poor","Wastes a ball-in-hand advantage.","high"),
        opt("Roll up safe without taking the free-shot advantage","poor","Ball in hand anywhere is too strong an advantage to waste with a passive roll-up.","high"),
      ],
    }
  ), visualContract: { cueBall: true }, diagram: { playerGroup: "yellow" as const, balls: [
    { id: "CB",  group: "cue"    as const, x: 80, y: 52 },
    { id: "Y1",  group: "yellow" as const, x: 30, y: 35, trainingLabel: "1", role: "target"  as const },
    { id: "Y2",  group: "yellow" as const, x: 55, y: 22, trainingLabel: "2", role: "target"  as const },
    { id: "OPP", group: "red"    as const, x: 65, y: 58, role: "obstacle" as const },
    { id: "BLK", group: "black"  as const, x: 42, y: 15, role: "black"   as const },
  ], tableMarkings: { showBaulkLine: true, showD: true } } },
  { ...decDrill("tac_bb1","tactical",5,"Free-Shot Nomination — Blackball","You have a free shot from baulk. Which ball should you nominate?",[
    opt("Nominate your own group ball that is closest to a pocket","optimal","Maximises the pot opportunity from baulk while keeping group continuity.","low"),
    opt("Nominate any convenient ball for a safety","acceptable","A safety on a nominated ball is a legitimate free-shot use.","low"),
    opt("Nominate the 8-ball for an immediate win attempt","highrisk","Only valid once all your group balls are potted — otherwise illegal.","high"),
    opt("Play without nominating — treat it as a normal shot","poor","Ignores the free-shot advantage entirely.","high"),
  ],false,["blackball"]), visualContract: { cueBall: true }, diagram: { playerGroup: "yellow" as const, balls: [
    { id: "CB",  group: "cue"    as const, x: 80, y: 45 },
    { id: "Y1",  group: "yellow" as const, x: 28, y: 32, trainingLabel: "1", role: "target"  as const },
    { id: "Y2",  group: "yellow" as const, x: 55, y: 40, trainingLabel: "2", role: "target"  as const },
    { id: "OPP", group: "red"    as const, x: 38, y: 18, role: "obstacle" as const },
    { id: "BLK", group: "black"  as const, x: 62, y: 22, role: "black"   as const },
  ], tableMarkings: { showBaulkLine: true, showD: true } } },
  { ...decDrill("tac_int1","tactical",5,"Ball-in-Hand Placement — International","You have ball-in-hand after an opponent foul. Where do you place the cue ball?",[
    opt("Directly behind the easiest pot, clearing the route to the next ball","optimal","Full ball-in-hand is a strong advantage — use it for position as well as the pot.","low"),
    opt("Somewhere central but not specifically planned","acceptable","Central placement is reasonable but leaves accuracy on the table.","medium"),
    opt("Near baulk out of habit","highrisk","Treating ball-in-hand like a Blackball free shot from baulk wastes your full freedom.","high"),
    opt("As close as possible to the nearest ball regardless of route","poor","Ignores position for subsequent balls.","high"),
  ],false,["international"]), visualContract: { cueBall: true }, diagram: { playerGroup: "yellow" as const, balls: [
    { id: "CB",  group: "cue"    as const, x: 48, y: 55 },
    { id: "Y1",  group: "yellow" as const, x: 25, y: 38, trainingLabel: "1", role: "target"  as const },
    { id: "OPP", group: "red"    as const, x: 65, y: 28, role: "obstacle" as const },
    { id: "BLK", group: "black"  as const, x: 45, y: 15, role: "black"   as const },
  ] } },
];

// ─── Clearances ───────────────────────────────────────────────────────────────
// All clearances use ONE player group (yellows) + the 8-ball.
// Opponent reds appear as obstacles only; never offered as targets.

export const CLEARANCES: Clearance[] = [
  {
    id: "clr3", name: "3-Ball Yellow Sequence", type: "combined", difficulty: 4, clearanceStage: 3,
    assessmentEligible: true, planEligible: true, adaptationEligible: false,
    failureMode: "continue_from_position",
    playerGroup: "yellow",
    includesBlack: false,
    objective: "Pot Yellow 1, Yellow 2 and Yellow 3 in any order, maintaining cue-ball control throughout.",
    setup: "Place Yellow 1, Yellow 2 and Yellow 3 as shown. Position the cue ball at the marked starting position. The black is set aside — this exercise focuses on clearing all three yellows.",
    successCriteria: [
      "All three yellows potted.",
      "Cue ball remains in play throughout.",
      "Route adapted where position is lost.",
    ],
    diagram: { playerGroup: "yellow" as const, balls: [
      { id: "CB", group: "cue"    as const, x: 50, y: 78 },
      { id: "Y1", group: "yellow" as const, x: 38, y: 30, trainingLabel: "1", role: "target"   as const },
      { id: "Y2", group: "yellow" as const, x: 63, y: 22, trainingLabel: "2", role: "target"   as const },
      { id: "Y3", group: "yellow" as const, x: 45, y: 54, trainingLabel: "3", role: "target"   as const },
      { id: "R1", group: "red"    as const, x: 55, y: 40, role: "obstacle" as const },
    ] },
    visualContract: { cueBall: true },
    balls: [
      { id: "Y1", group: "yellow", label: "Yellow 1", execSkill: "potting",    owner: "player",   role: "target" },
      { id: "Y2", group: "yellow", label: "Yellow 2", execSkill: "positional", owner: "player",   role: "target" },
      { id: "Y3", group: "yellow", label: "Yellow 3", execSkill: "speed",      owner: "player",   role: "target" },
      { id: "R1", group: "red",    label: "Red 1",    execSkill: "potting",    owner: "opponent", role: "obstacle" },
    ],
    preferredRoute: ["Y1", "Y2", "Y3"],
    acceptableRoutes: [["Y2", "Y1", "Y3"]],
    rulesets: ["blackball", "international"],
  },
  {
    id: "clr4", name: "4-Ball Clearance with 8-Ball", type: "combined", difficulty: 5, clearanceStage: 4,
    planEligible: true, adaptationEligible: false, failureMode: "end_clearance",
    playerGroup: "yellow",
    includesBlack: true,
    objective: "Pot yellows Y1, Y2 and Y3 in any order, then finish on the 8-ball.",
    setup: "Place the balls as shown. The 8-ball is your finishing ball. One opponent red acts as an obstacle.",
    successCriteria: ["All three yellows potted.", "8-ball potted to finish.", "Cue ball remains in play throughout."],
    diagram: { playerGroup: "yellow" as const, balls: [
      { id: "CB", group: "cue"    as const, x: 48, y: 72 },
      { id: "Y1", group: "yellow" as const, x: 28, y: 42, trainingLabel: "1", role: "target"   as const },
      { id: "Y2", group: "yellow" as const, x: 65, y: 35, trainingLabel: "2", role: "target"   as const },
      { id: "Y3", group: "yellow" as const, x: 40, y: 22, trainingLabel: "3", role: "target"   as const },
      { id: "8B", group: "black"  as const, x: 52, y: 12, role: "black"   as const },
      { id: "R1", group: "red"    as const, x: 55, y: 55, role: "obstacle" as const },
    ] },
    visualContract: { cueBall: true },
    balls: [
      { id: "Y1", group: "yellow", label: "Yellow 1", execSkill: "potting",    owner: "player",   role: "target" },
      { id: "Y2", group: "yellow", label: "Yellow 2", execSkill: "positional", owner: "player",   role: "target" },
      { id: "Y3", group: "yellow", label: "Yellow 3", execSkill: "speed",      owner: "player",   role: "target" },
      { id: "8B", group: "black",  label: "8-ball",   execSkill: "eightBall",  owner: "player",   role: "black" },
      { id: "R1", group: "red",    label: "Red 1",    execSkill: "potting",    owner: "opponent", role: "obstacle" },
    ],
    preferredRoute: ["Y1", "Y2", "Y3", "8B"],
    acceptableRoutes: [["Y2", "Y1", "Y3", "8B"]],
    rulesets: ["blackball", "international"],
  },
  {
    id: "clr5", name: "5-Ball Clearance with Obstacles", type: "combined", difficulty: 7, clearanceStage: 7,
    planEligible: true, adaptationEligible: true, failureMode: "end_clearance",
    preferredAdaptation: "Re-plan clearance",
    playerGroup: "yellow",
    includesBlack: true,
    objective: "Pot yellows Y1–Y4 in any order, navigate around the obstacles, then finish on the 8-ball.",
    setup: "Place the balls as shown. Two opponent reds act as obstacles. Route planning is essential.",
    successCriteria: ["All four yellows potted.", "8-ball potted to finish.", "Route adapted where position is lost."],
    diagram: { playerGroup: "yellow" as const, balls: [
      { id: "CB", group: "cue"    as const, x: 52, y: 75 },
      { id: "Y1", group: "yellow" as const, x: 22, y: 35, trainingLabel: "1", role: "target"   as const },
      { id: "Y2", group: "yellow" as const, x: 68, y: 28, trainingLabel: "2", role: "target"   as const },
      { id: "Y3", group: "yellow" as const, x: 42, y: 48, trainingLabel: "3", role: "target"   as const },
      { id: "Y4", group: "yellow" as const, x: 30, y: 22, trainingLabel: "4", role: "target"   as const },
      { id: "8B", group: "black"  as const, x: 55, y: 10, role: "black"   as const },
      { id: "R1", group: "red"    as const, x: 58, y: 62, role: "obstacle" as const },
      { id: "R2", group: "red"    as const, x: 35, y: 55, role: "obstacle" as const },
    ] },
    visualContract: { cueBall: true },
    balls: [
      { id: "Y1", group: "yellow", label: "Yellow 1", execSkill: "potting",         owner: "player",   role: "target" },
      { id: "Y2", group: "yellow", label: "Yellow 2", execSkill: "positional",      owner: "player",   role: "target" },
      { id: "Y3", group: "yellow", label: "Yellow 3", execSkill: "problemBallExec", owner: "player",   role: "target" },
      { id: "Y4", group: "yellow", label: "Yellow 4", execSkill: "speed",           owner: "player",   role: "target" },
      { id: "8B", group: "black",  label: "8-ball",   execSkill: "eightBall",       owner: "player",   role: "black" },
      { id: "R1", group: "red",    label: "Red 1",    execSkill: "potting",         owner: "opponent", role: "obstacle" },
      { id: "R2", group: "red",    label: "Red 2",    execSkill: "potting",         owner: "opponent", role: "obstacle" },
    ],
    preferredRoute: ["Y1", "Y2", "Y3", "Y4", "8B"],
    acceptableRoutes: [["Y2", "Y1", "Y3", "Y4", "8B"]],
    rulesets: ["blackball", "international"],
  },
];

export const ASSESSMENT_ITEMS = DRILLS.filter((d) => d.assessmentEligible);
export const ASSESSMENT_CLEARANCE = CLEARANCES.find((c) => c.assessmentEligible)!;
/** All drills that pass validatePlayableDrillGeometry (have a complete authored diagram). */
export const PLAYABLE_DRILLS = DRILLS.filter((d) => validatePlayableDrillGeometry(d).valid);
/** All clearances that pass validatePlayableDrillGeometry (have a complete authored diagram). */
export const PLAYABLE_CLEARANCES = CLEARANCES.filter((c) => validatePlayableDrillGeometry(c).valid);
export const ERROR_CODES = ["MISS", "POSITION", "SPEED", "SPIN", "PATTERN", "DECISION", "SAFETY", "OTHER"] as const;
export const SESSION_LENGTHS: Record<number, number> = { 15: 3, 30: 5, 45: 7, 60: 9, 90: 13 };

// ─── Math helpers ─────────────────────────────────────────────────────────────

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const emptySkills = (): Record<SkillId, SkillState> =>
  Object.fromEntries(SKILLS.map((s) => [s.id, { rating: 30, attempts: [] }])) as unknown as Record<SkillId, SkillState>;

// ─── Profile lifecycle ────────────────────────────────────────────────────────

export const newProfile = (mode: RulesMode = "blackball"): Profile => ({
  dataVersion: CONFIG.dataVersion,
  ruleset: mode === "mixed" ? "blackball" : mode,
  preferredRulesMode: mode,
  assessmentComplete: false,
  skills: emptySkills(),
  ratingHistory: {},
  rootCauseTally: {},
  rootCauseEvents: [],
  sessions: [],
});

export function migrateProfile(raw: unknown): Profile {
  const candidate = (raw && typeof raw === "object" ? raw : {}) as Partial<Profile> & Record<string, unknown>;
  const existingRuleset = candidate.ruleset === "international" ? "international" : "blackball";
  const existingMode: RulesMode =
    candidate.preferredRulesMode === "mixed" ? "mixed" :
    candidate.preferredRulesMode === "international" ? "international" :
    candidate.preferredRulesMode === "blackball" ? "blackball" :
    existingRuleset;
  const base = newProfile(existingMode);
  const rawSkills = candidate.skills && typeof candidate.skills === "object" ? candidate.skills : {};
  const skills = { ...base.skills };
  for (const skill of SKILLS) {
    const incoming = (rawSkills as Record<string, Partial<SkillState>>)[skill.id];
    if (incoming && typeof incoming === "object") {
      skills[skill.id] = {
        rating: typeof incoming.rating === "number" ? clamp(incoming.rating, 0, 100) : 30,
        attempts: Array.isArray(incoming.attempts) ? incoming.attempts as Attempt[] : [],
      };
    }
  }
  // Migrate legacy rootCauseTally → rootCauseEvents (with ts=0 so they decay away quickly)
  let rootCauseEvents: RootCauseEvent[] = Array.isArray(candidate.rootCauseEvents) ? candidate.rootCauseEvents as RootCauseEvent[] : [];
  if (!rootCauseEvents.length && candidate.rootCauseTally) {
    const tally = candidate.rootCauseTally as Partial<Record<SkillId, number>>;
    for (const [skillId, count] of Object.entries(tally)) {
      if (typeof count === "number" && count > 0) {
        for (let i = 0; i < count; i++) {
          rootCauseEvents.push({ skillId: skillId as SkillId, ts: 0, confidence: 0.3, ruleset: null });
        }
      }
    }
  }
  return {
    ...base, ...candidate,
    dataVersion: CONFIG.dataVersion,
    ruleset: existingRuleset,
    preferredRulesMode: existingMode,
    skills,
    ratingHistory: candidate.ratingHistory ?? {},
    rootCauseTally: candidate.rootCauseTally ?? {},
    rootCauseEvents,
    sessions: Array.isArray(candidate.sessions) ? candidate.sessions : [],
  };
}

// ─── Root-cause decay ─────────────────────────────────────────────────────────

/**
 * Compute a decayed root-cause score for a skill.
 * Events older than one half-life contribute half the weight; this decays exponentially.
 * A weakness fixed months ago will gradually stop dominating the limiting-factor evidence.
 */
export function decayRootCauseScore(events: RootCauseEvent[], skillId: SkillId, now: number): number {
  const relevant = events.filter((e) => e.skillId === skillId);
  if (!relevant.length) return 0;
  const halfLife = CONFIG.rootCause.halfLifeMs;
  let score = 0;
  for (const event of relevant) {
    const age = Math.max(0, now - event.ts);
    const recencyFactor = Math.pow(0.5, age / halfLife);
    score += event.confidence * recencyFactor;
  }
  return Math.min(1, score);
}

/** Numeric confidence map for converting string-tier chain confidence to 0–1 values. */
export const ROOT_CAUSE_CONFIDENCE_MAP = CONFIG.rootCause.numericConfidence;

// ─── Confidence ───────────────────────────────────────────────────────────────

export function computeConfidence(attempts: Attempt[], now = Date.now()): Confidence {
  if (attempts.length === 0) return { score: 0, tier: "Low" };
  const cfg = CONFIG.confidence;
  const weightedN = attempts.reduce((sum, a) => sum + (a.source === "assessment" ? cfg.assessmentWeight : 1), 0);
  const distinctDrills = new Set(attempts.map((a) => a.drillId)).size;
  const recentCount = attempts.filter((a) => now - a.ts < CONFIG.recencyWindowMs).length;
  const volumeScore = Math.min(1, weightedN / cfg.volumeCap);
  const diversityScore = Math.min(1, distinctDrills / cfg.diversityCap);
  const recencyScore = Math.min(1, recentCount / cfg.recentCap);
  const gatedVolume = volumeScore * (cfg.diversityFloor + (1 - cfg.diversityFloor) * diversityScore);
  const score = clamp(gatedVolume * cfg.weights.volumeDiversity + recencyScore * cfg.weights.recency, 0, 1);
  const tier = score >= cfg.tiers.high ? "High" : score >= cfg.tiers.established ? "Established" : score >= cfg.tiers.emerging ? "Emerging" : "Low";
  return { score, tier };
}

export function computeRulesetConfidence(profile: Profile, skillId: SkillId, ruleset: RuleSetId, now = Date.now()): Confidence {
  const rulesetAttempts = profile.skills[skillId].attempts.filter((a) => a.ruleset === ruleset);
  return computeConfidence(rulesetAttempts, now);
}

export function isStale(state: SkillState, now = Date.now()) {
  const last = state.attempts[state.attempts.length - 1];
  return Boolean(last && now - last.ts > CONFIG.recencyWindowMs * 2);
}

export function displayTier(tier: Confidence["tier"], stale: boolean): Confidence["tier"] {
  if (!stale) return tier;
  return ({ High: "Established", Established: "Emerging", Emerging: "Low", Low: "Low" } as const)[tier];
}

export function confidenceLabel(tier: Confidence["tier"], stale: boolean) {
  const visible = displayTier(tier, stale);
  if (visible === "Low") return stale ? "Uncertain — not tested recently" : "Still learning your game";
  if (visible === "Emerging") return "Getting a clearer picture";
  return "Strong evidence";
}

// ─── Skill update / rating engine ────────────────────────────────────────────

export function applySkillUpdate(
  profile: Profile,
  skillId: SkillId,
  value: number,
  meta: Partial<Attempt> = {},
  now = Date.now()
): Profile {
  const state = profile.skills[skillId];
  const confidence = computeConfidence(state.attempts, now);
  const kBase = CONFIG.kMax - (CONFIG.kMax - CONFIG.kMin) * confidence.score;
  const difficulty = meta.difficulty ?? 5;
  const diffOffset = (difficulty - CONFIG.difficultyMidpoint) * CONFIG.difficultySensitivity;
  const directionMultiplier = value >= 0.7 ? 1 + diffOffset : 1 - diffOffset;
  const effectiveK = clamp(kBase * clamp(directionMultiplier, CONFIG.diffMultiplierMin, CONFIG.diffMultiplierMax), CONFIG.kMin * 0.5, CONFIG.kMax * 1.5);
  const rating = clamp(state.rating + effectiveK * (value * 100 - state.rating), 0, 100);
  const attempt: Attempt = { ts: now, value, difficulty, ...meta };
  return { ...profile, skills: { ...profile.skills, [skillId]: { rating, attempts: [...state.attempts, attempt] } } };
}

export const resultValue = (r: "success" | "partial" | "fail") => r === "success" ? 1 : r === "partial" ? 0.5 : 0;
export const decisionValue = (tier: DecisionTier) => ({ optimal: 1, acceptable: 0.7, highrisk: 0.4, poor: 0 } as const)[tier];

// ─── Clearance route evaluation ───────────────────────────────────────────────

/**
 * Evaluate the quality of a player's planned clearance route against authored route metadata.
 * Does NOT automatically award optimal — compares against preferredRoute and acceptableRoutes.
 */
export function evaluatePlannedRoute(route: string[], clearance: Clearance): { tier: DecisionTier; value: number; rationale: string } {
  const eightBallId = clearance.balls.find((b) => b.role === "black")?.id;
  const normalize = (r: string[]) => eightBallId ? r.filter((id) => id !== eightBallId) : r;
  const playerSeq = normalize(route);
  const preferredSeq = normalize(clearance.preferredRoute);
  const acceptableSeqs = clearance.acceptableRoutes.map(normalize);
  if (JSON.stringify(playerSeq) === JSON.stringify(preferredSeq)) {
    return { tier: "optimal", value: decisionValue("optimal"), rationale: "Your planned order matches the recommended sequence." };
  }
  if (acceptableSeqs.some((s) => JSON.stringify(playerSeq) === JSON.stringify(s))) {
    return { tier: "acceptable", value: decisionValue("acceptable"), rationale: "Your planned order is a reasonable alternative to the preferred sequence." };
  }
  if (playerSeq.length > 0 && playerSeq.length === preferredSeq.length) {
    return { tier: "highrisk", value: decisionValue("highrisk"), rationale: "Your planned order is a valid ball count but not a known-effective sequence — it may create difficult positions." };
  }
  return { tier: "poor", value: decisionValue("poor"), rationale: "The planned route is incomplete or does not include all required target balls." };
}

/**
 * Apply the result of a single ball attempt to the clearance route state.
 * Keeps planned/attempted/potted/remaining strictly separated.
 * A failed shot goes to attemptedRoute ONLY — the ball remains available unless failureMode ends the clearance.
 */
export function applyClearanceBallResult(
  state: ClearanceRouteState,
  ballId: string,
  value: number,
  failureMode: Clearance["failureMode"]
): { state: ClearanceRouteState; ended: boolean } {
  const attempted = [...state.attemptedRoute, ballId];
  if (value === 1) {
    // Success: ball is potted, removed from remaining
    return {
      state: {
        ...state,
        attemptedRoute: attempted,
        pottedRoute: [...state.pottedRoute, ballId],
        remaining: state.remaining.filter((id) => id !== ballId),
      },
      ended: false,
    };
  }
  // Failure
  if (failureMode === "end_clearance") {
    return { state: { ...state, attemptedRoute: attempted }, ended: true };
  }
  // continue_from_position or reset_shot: ball stays in remaining
  return { state: { ...state, attemptedRoute: attempted }, ended: false };
}

// ─── Aggregates ───────────────────────────────────────────────────────────────

export function overallMean(profile: Profile) {
  return SKILLS.reduce((sum, s) => sum + profile.skills[s.id].rating, 0) / SKILLS.length;
}

export function composite(profile: Profile, type: SkillType) {
  const skills = SKILLS.filter((s) => s.type === type);
  return skills.reduce((sum, s) => sum + profile.skills[s.id].rating, 0) / skills.length;
}

export function evidenceForSkill(profile: Profile, skillId: SkillId, now = Date.now()): LimitingFactor {
  const state = profile.skills[skillId];
  const mean = overallMean(profile);
  const gap = mean - state.rating;
  const confidence = computeConfidence(state.attempts, now);
  const recent = state.attempts.filter((a) => now - a.ts < CONFIG.recencyWindowMs);
  const recentErrorRate = recent.length ? recent.filter((a) => a.value < 0.5).length / recent.length : 0;
  const clearanceFails = state.attempts.filter((a) => a.clearance && a.value < 0.5).length;
  const rootCauseScore = decayRootCauseScore(profile.rootCauseEvents, skillId, now);
  const weights = CONFIG.evidence.weights;
  const score = clamp(gap / 25, 0, 1) * weights.gap +
    confidence.score * weights.confidence +
    recentErrorRate * weights.recentError +
    Math.min(1, clearanceFails / 3) * weights.clearanceFail +
    rootCauseScore * weights.rootCause;
  const qualifies = confidence.tier !== "Low" && (gap > CONFIG.meanGapThreshold || rootCauseScore >= 0.3);
  const status: LimitingFactor["status"] = !qualifies ? "none" : score >= CONFIG.evidence.confirmedThreshold ? "confirmed" : score >= CONFIG.evidence.provisionalThreshold ? "provisional" : "none";
  return { ...SKILL_MAP[skillId], rating: state.rating, gap, confidence, score, status, rootCauseScore };
}

export function limitingFactor(profile: Profile, now = Date.now()): LimitingFactors {
  const scored = SKILLS.map((s) => evidenceForSkill(profile, s.id, now)).filter((s) => s.status !== "none").sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { primary: null, secondary: null, status: "insufficient" };
  return { primary: scored[0], secondary: scored[1] ?? null, status: scored[0].status === "none" ? "insufficient" : scored[0].status };
}

/**
 * Compute exec/dec session weighting.
 * Base weighting from composite difference + adjustment for confirmed/provisional LF.
 * Clamped to 25–75%.
 */
export function sessionWeighting(profile: Profile, lfOverride?: LimitingFactors, now = Date.now()) {
  const exec = composite(profile, "execution");
  const dec = composite(profile, "decision");
  const baseExecWeight = clamp(50 + (dec - exec) * 0.6, 25, 75);
  const lf = lfOverride ?? limitingFactor(profile, now);
  let lfAdjustment = 0;
  if (lf.primary) {
    const lfType = SKILL_MAP[lf.primary.id].type;
    const magnitude = lf.status === "confirmed"
      ? CONFIG.session.lfConfirmedShift
      : lf.status === "provisional"
        ? CONFIG.session.lfProvisionalShift
        : 0;
    lfAdjustment = lfType === "execution" ? magnitude : -magnitude;
  }
  const execWeight = clamp(Math.round(baseExecWeight + lfAdjustment), 25, 75);
  return { execWeight, decWeight: 100 - execWeight, exec, dec };
}

export function difficultyForSkill(profile: Profile, skillId: SkillId) {
  return clamp(Math.round(profile.skills[skillId].rating / 12), 1, 8);
}

// ─── Maintenance eligibility ──────────────────────────────────────────────────

/**
 * Select a skill genuinely due for a maintenance touch.
 * Requires: rating above threshold, at least Established confidence, trained more than
 * maintenanceMinAgeDays ago. Returns the most stale qualifying skill, or null if none are due.
 */
export function selectMaintenanceSkill(
  profile: Profile,
  now = Date.now(),
  excludeIds: SkillId[] = []
): SkillDefinition | null {
  const cfg = CONFIG.session;
  const candidates = SKILLS.filter((s) => {
    if (excludeIds.includes(s.id)) return false;
    const state = profile.skills[s.id];
    const conf = computeConfidence(state.attempts, now);
    if (conf.tier === "Low" || conf.tier === "Emerging") return false;
    if (state.rating < cfg.maintenanceMinRatingThreshold) return false;
    const lastTs = state.attempts[state.attempts.length - 1]?.ts ?? 0;
    const daysSinceLast = (now - lastTs) / (1000 * 60 * 60 * 24);
    if (daysSinceLast < cfg.maintenanceMinAgeDays) return false;
    return true;
  });
  if (!candidates.length) return null;
  return candidates.sort((a, b) => {
    const aLast = profile.skills[a.id].attempts.slice(-1)[0]?.ts ?? 0;
    const bLast = profile.skills[b.id].attempts.slice(-1)[0]?.ts ?? 0;
    return aLast - bLast; // most stale first
  })[0];
}

// ─── Mixed-mode ruleset split ─────────────────────────────────────────────────

/**
 * Two-phase mixed allocation:
 * Phase 1 (calibration): if either ruleset has insufficient confidence, prioritise it.
 * Phase 2 (performance): once both have adequate confidence, prioritise the weaker performer.
 * Always applies a minimum floor so neither ruleset disappears.
 */
export function mixedRulesetSplit(profile: Profile, now = Date.now()): { blackball: number; international: number } {
  const floor = CONFIG.mixed.minRulesetFloor;
  const adequateThreshold = CONFIG.mixed.adequateConfidenceThreshold;
  const decisionSkills = SKILLS.filter((s) => s.type === "decision");
  const halfLen = Math.ceil(decisionSkills.length / 2);

  let bbConfTotal = 0, intConfTotal = 0;
  let bbAdequateCount = 0, intAdequateCount = 0;
  let bbPerfTotal = 0, bbPerfCount = 0;
  let intPerfTotal = 0, intPerfCount = 0;

  for (const skill of decisionSkills) {
    const bbConf  = computeRulesetConfidence(profile, skill.id, "blackball",     now);
    const intConf = computeRulesetConfidence(profile, skill.id, "international", now);
    bbConfTotal  += bbConf.score;
    intConfTotal += intConf.score;
    if (bbConf.score  >= adequateThreshold) bbAdequateCount++;
    if (intConf.score >= adequateThreshold) intAdequateCount++;

    const bbAttempts  = profile.skills[skill.id].attempts.filter((a) => a.ruleset === "blackball");
    const intAttempts = profile.skills[skill.id].attempts.filter((a) => a.ruleset === "international");
    if (bbAttempts.length)  { bbPerfTotal  += bbAttempts.reduce((s, a)  => s + a.value, 0) / bbAttempts.length;  bbPerfCount++; }
    if (intAttempts.length) { intPerfTotal += intAttempts.reduce((s, a) => s + a.value, 0) / intAttempts.length; intPerfCount++; }
  }

  const total = bbConfTotal + intConfTotal;
  const bothAdequate = bbAdequateCount >= halfLen && intAdequateCount >= halfLen;

  if (!bothAdequate || total === 0) {
    // Phase 1: calibration — give more to the ruleset with lower confidence
    if (total === 0) return { blackball: 0.5, international: 0.5 };
    const intFraction = clamp(1 - intConfTotal / total, floor, 1 - floor);
    const bbFraction  = clamp(1 - bbConfTotal  / total, floor, 1 - floor);
    const sum = intFraction + bbFraction;
    return { blackball: bbFraction / sum, international: intFraction / sum };
  }

  // Phase 2: performance — give more to the weaker ruleset performer
  const bbPerf  = bbPerfCount  ? bbPerfTotal  / bbPerfCount  : 0.5;
  const intPerf = intPerfCount ? intPerfTotal / intPerfCount : 0.5;
  const perfTotal = bbPerf + intPerf;
  if (perfTotal === 0) return { blackball: 0.5, international: 0.5 };
  const intPerfFraction = clamp(1 - intPerf / perfTotal, floor, 1 - floor);
  const bbPerfFraction  = clamp(1 - bbPerf  / perfTotal, floor, 1 - floor);
  const perfSum = intPerfFraction + bbPerfFraction;
  return { blackball: bbPerfFraction / perfSum, international: intPerfFraction / perfSum };
}

// ─── Session generation ───────────────────────────────────────────────────────

const nearestDrill = (pool: Drill[], target: number) =>
  pool.slice().sort((a, b) => Math.abs(a.difficulty - target) - Math.abs(b.difficulty - target))[0];

const sourceForRuleset = (ruleset: RuleSetId) => ({
  drills:     DRILLS.filter((d) => d.rulesets.includes(ruleset)),
  clearances: CLEARANCES.filter((c) => c.rulesets.includes(ruleset)),
});

const supportingLinks: { source: SkillId; target: SkillId }[] = [
  { source: "speed",          target: "positional" },
  { source: "cueBall",        target: "positional" },
  { source: "cueBall",        target: "problemBallExec" },
  { source: "pattern",        target: "eightBall" },
  { source: "problemBallDec", target: "pattern" },
];

export function generateSession(profile: Profile, minutes: number, options?: { lfOverride?: LimitingFactors; splitOverride?: { blackball: number; international: number } }): GeneratedSession {
  const totalCount = SESSION_LENGTHS[minutes] ?? 5;
  const lf = options?.lfOverride ?? limitingFactor(profile);
  const weighting = sessionWeighting(profile, lf);
  const mode = profile.preferredRulesMode;

  // Reserve one slot for the clearance when the session is long enough
  const clearanceSlot = totalCount >= 5;
  const normalCount = clearanceSlot ? totalCount - 1 : totalCount;

  const focusSkillIds = [lf.primary?.id, lf.secondary?.id].filter(Boolean) as SkillId[];
  const execFocus = focusSkillIds.filter((id) => SKILL_MAP[id].type === "execution");
  const decFocus  = focusSkillIds.filter((id) => SKILL_MAP[id].type === "decision");
  const execPool  = execFocus.length ? execFocus : SKILLS.filter((s) => s.type === "execution").map((s) => s.id);
  const decPool   = decFocus.length  ? decFocus  : SKILLS.filter((s) => s.type === "decision").map((s) => s.id);
  const used = new Set<string>();

  const execCount = clamp(Math.round((normalCount * weighting.execWeight) / 100), 1, normalCount - 1);
  const decCount  = normalCount - execCount;

  const selected: SessionItem[] = [];
  const drillRulesets: (RuleSetId | null)[] = [];

  const pickExec = (skillIds: SkillId[], n: number) => {
    const source = DRILLS.filter((d) => d.type === "execution" && d.rulesContext === null && validatePlayableDrillGeometry(d).valid);
    for (let i = 0; i < n; i++) {
      const skillId = skillIds[i % skillIds.length];
      const preferred = source.filter((d) => d.skillId === skillId && !used.has(d.id));
      const pool = preferred.length ? preferred : source.filter((d) => !used.has(d.id));
      const fallback = pool.length ? pool : source;
      if (!fallback.length) continue;
      const drill = nearestDrill(fallback, difficultyForSkill(profile, skillId));
      used.add(drill.id);
      selected.push({ ...drill, reason: focusSkillIds.includes(drill.skillId) ? `Focus area: ${SKILL_MAP[drill.skillId].name}.` : "Rounding out today's session." });
      drillRulesets.push(null);
    }
  };

  const pickDec = (ruleset: RuleSetId, skillIds: SkillId[], n: number) => {
    const source = sourceForRuleset(ruleset).drills.filter((d) => d.type === "decision" && validatePlayableDrillGeometry(d).valid);
    for (let i = 0; i < n; i++) {
      const skillId = skillIds[i % skillIds.length];
      const preferred = source.filter((d) => d.skillId === skillId && !used.has(d.id));
      const pool = preferred.length ? preferred : source.filter((d) => !used.has(d.id));
      const fallback = pool.length ? pool : source;
      if (!fallback.length) continue;
      const drill = nearestDrill(fallback, difficultyForSkill(profile, skillId));
      used.add(drill.id);
      selected.push({ ...drill, reason: focusSkillIds.includes(drill.skillId) ? `Focus area under ${RULESETS[ruleset].name}.` : `Decision work — ${RULESETS[ruleset].name}.` });
      drillRulesets.push(ruleset);
    }
  };

  if (mode === "mixed") {
    pickExec(execPool, execCount);
    const split = options?.splitOverride ?? mixedRulesetSplit(profile);
    const bbDecCount  = Math.max(1, Math.round(decCount * split.blackball));
    const intDecCount = Math.max(1, decCount - bbDecCount);
    pickDec("blackball",     decPool, bbDecCount);
    pickDec("international", decPool, intDecCount);
  } else {
    pickExec(execPool, execCount);
    pickDec(mode, decPool, decCount);
  }

  // Support link injection (replace one slot)
  const support = focusSkillIds.flatMap((id) => supportingLinks.filter((l) => l.target === id).map((l) => l.source))[0];
  if (support && selected.length > 0) {
    const supportDrills = DRILLS.filter((d) => d.skillId === support && d.rulesContext === null);
    const replaceAt = selected.findIndex((item) => item.type === SKILL_MAP[support].type);
    if (supportDrills.length && replaceAt >= 0) {
      selected[replaceAt] = { ...nearestDrill(supportDrills, difficultyForSkill(profile, support)), reason: `Supports your work on ${SKILL_MAP[focusSkillIds[0]]?.name.toLowerCase() ?? "today's focus"}.` };
      drillRulesets[replaceAt] = null;
    }
  }

  // Maintenance slot — only if a skill is genuinely due
  if (normalCount >= 4 && selected.length > 0) {
    const maintenance = selectMaintenanceSkill(profile, Date.now(), focusSkillIds);
    if (maintenance) {
      const pool = DRILLS.filter((d) => d.skillId === maintenance.id && d.rulesContext === null);
      if (pool.length) {
        selected[0] = { ...nearestDrill(pool, difficultyForSkill(profile, maintenance.id)), reason: `Maintenance — your ${maintenance.name.toLowerCase()} has not been touched recently and deserves a warm-up.` };
        drillRulesets[0] = null;
      }
    }
  }

  // Calibration slot — lowest-evidence, non-focus skill.
  // Excludes IDs already in other slots to prevent duplicates that would break the count.
  if (normalCount >= 6 && selected.length > 1) {
    const calibration = SKILLS.filter((s) => computeConfidence(profile.skills[s.id].attempts).tier === "Low" && !focusSkillIds.includes(s.id)).sort((a, b) => profile.skills[a.id].attempts.length - profile.skills[b.id].attempts.length)[0];
    if (calibration) {
      const otherIds = new Set(selected.filter((_, i) => i !== 1).map((d) => d.id));
      const pool = DRILLS.filter((d) => d.skillId === calibration.id && d.rulesContext === null && !otherIds.has(d.id));
      if (pool.length) {
        selected[1] = { ...nearestDrill(pool, difficultyForSkill(profile, calibration.id)), reason: `Calibration — we still need more evidence about ${calibration.name.toLowerCase()}.` };
        drillRulesets[1] = null;
      }
    }
  }

  // Clearance slot — count is already reserved; assign concrete ruleset (never null in mixed mode)
  if (clearanceSlot) {
    const rulesetForClearance: RuleSetId = mode === "mixed"
      ? (drillRulesets.filter((r) => r === "international").length >= drillRulesets.filter((r) => r === "blackball").length ? "international" : "blackball")
      : mode;
    const clearances = sourceForRuleset(rulesetForClearance).clearances;
    const clearance = clearances[weighting.execWeight >= 50 ? 1 : 2] ?? clearances[clearances.length - 1];
    selected.push({ ...clearance, reason: "Clearance work — combines the skills today's session is targeting." });
    drillRulesets.push(rulesetForClearance); // concrete ruleset, never null for clearances
  }

  // ── Final composition validation (post-generation) ──────────────────────────
  // Guarantees: correct count, at least one exec, at least one dec, no duplicate IDs, ruleset integrity.
  const finalDrills = selected.slice(0, totalCount);
  const finalRulesets = drillRulesets.slice(0, totalCount);
  // Ensure no duplicate IDs (keep first occurrence)
  const seenIds = new Set<string>();
  const deduped: SessionItem[] = [];
  const dedupedRulesets: (RuleSetId | null)[] = [];
  for (let i = 0; i < finalDrills.length; i++) {
    const item = finalDrills[i];
    if (!seenIds.has(item.id)) { seenIds.add(item.id); deduped.push(item); dedupedRulesets.push(finalRulesets[i]); }
  }
  // Every rules-sensitive decision drill must have a concrete ruleset
  for (let i = 0; i < deduped.length; i++) {
    const item = deduped[i];
    if (item.type === "decision" && !dedupedRulesets[i]) {
      const dr = (item as Drill);
      dedupedRulesets[i] = dr.rulesContext ?? (mode === "mixed" ? "blackball" : mode);
    }
  }

  // Safety fill: if dedup removed duplicates and count fell below target, top up with unused drills
  if (deduped.length < totalCount) {
    const seenFill = new Set(deduped.map((d) => d.id));
    const fillSource = DRILLS.filter((d) => d.rulesContext === null && !seenFill.has(d.id));
    for (let i = deduped.length; i < totalCount; i++) {
      const fill = fillSource.shift();
      if (!fill) break;
      deduped.push({ ...fill, reason: "Rounding out today's session." });
      dedupedRulesets.push(mode === "mixed" ? "blackball" : mode as RuleSetId);
    }
  }

  return {
    drills: deduped,
    lf,
    weighting,
    focusSkillIds,
    startingRatings: Object.fromEntries(SKILLS.map((s) => [s.id, profile.skills[s.id].rating])) as Record<SkillId, number>,
    drillRulesets: dedupedRulesets,
  };
}

// ─── Root-cause events extraction ────────────────────────────────────────────

/**
 * Extract RootCauseEvent records from a session log.
 * Called at session end; the returned events should be appended to profile.rootCauseEvents.
 */
export function buildRootCauseEvents(
  log: (Attempt & { skillId?: SkillId; observedSkill?: SkillId })[],
  now = Date.now()
): RootCauseEvent[] {
  const chain = classifyErrorChain(log);
  if (!chain || chain.rootSkill === chain.immediateSkill) return [];
  const confidence = ROOT_CAUSE_CONFIDENCE_MAP[chain.rootCauseConfidence] ?? 0.3;
  const ruleset = log.find((e) => e.ruleset && e.skillId === chain.rootSkill)?.ruleset ?? null;
  return [{ skillId: chain.rootSkill, ts: now, confidence, ruleset }];
}

// ─── History & summary ────────────────────────────────────────────────────────

export function appendRatingSnapshots(profile: Profile, now = Date.now()) {
  const history = { ...profile.ratingHistory };
  for (const skill of SKILLS) {
    const snapshots = [...(history[skill.id] ?? [])];
    const current = profile.skills[skill.id].rating;
    if (!snapshots.length || Math.round(snapshots[snapshots.length - 1].rating) !== Math.round(current)) snapshots.push({ ts: now, rating: current });
    history[skill.id] = snapshots.slice(-20);
  }
  return history;
}

export function trendFor(history: Profile["ratingHistory"], skillId: SkillId) {
  const snapshots = history[skillId];
  if (!snapshots || snapshots.length < 2) return "stable";
  const delta = snapshots[snapshots.length - 1].rating - snapshots[snapshots.length - 2].rating;
  return delta > 1.5 ? "up" : delta < -1.5 ? "down" : "stable";
}

export function inferLikelyCause(previous: Attempt[], currentObservedSkill: SkillId, reportedError?: string) {
  const prev1 = previous[previous.length - 1];
  const prev2 = previous[previous.length - 2];
  if (reportedError === "MISS" && prev1?.reportedError === "POSITION" && prev2?.reportedError === "SPEED") {
    return { skill: "speed" as SkillId, pattern: "B", confidence: "Emerging", note: "Traced back to a speed-control error that produced the poor position." };
  }
  if (reportedError === "MISS" && prev1?.reportedError === "POSITION") {
    return { skill: "positional" as SkillId, pattern: "A", confidence: "Emerging", note: "Traced to a poor position left by the previous shot." };
  }
  if (reportedError === "MISS" && (prev1?.reportedError === "PATTERN" || prev1?.reportedError === "DECISION")) {
    return { skill: "pattern" as SkillId, pattern: "C", confidence: "Emerging", note: "Traced to an earlier pattern choice that forced a difficult recovery." };
  }
  return { skill: currentObservedSkill, pattern: "D", confidence: "Low", note: "No clear upstream cause found — treated as a direct execution issue." };
}

export function classifyErrorChain(entries: Attempt[]) {
  const failed = entries.filter((e) => e.value === 0);
  if (!failed.length) return null;
  const last = failed[failed.length - 1];
  const index = entries.indexOf(last);
  const lastObservedSkill = (last as Attempt & { observedSkill?: SkillId }).observedSkill ?? "potting";
  const cause = inferLikelyCause(entries.slice(0, index), lastObservedSkill, last.reportedError);
  const immediateSkill = lastObservedSkill;
  const contributingSkill = cause.skill !== immediateSkill && failed.length > 1 ? ((failed[failed.length - 2] as Attempt & { observedSkill?: SkillId }).observedSkill ?? null) : null;
  return { immediateSkill, contributingSkill, rootSkill: cause.skill, rootCauseConfidence: cause.confidence, pattern: cause.pattern };
}

export function buildErrorChainNarrative(chain: ReturnType<typeof classifyErrorChain>) {
  if (!chain || chain.rootSkill === chain.immediateSkill) return null;
  return `Although the clearance ended on a ${SKILL_MAP[chain.immediateSkill].name.toLowerCase()} failure, the sequence first broke down through ${SKILL_MAP[chain.rootSkill].name.toLowerCase()}.`;
}

export function buildSummary(log: (Attempt & { skillId?: SkillId; chainNarrative?: string; type?: string })[], session: GeneratedSession, finalProfile: Profile): SessionSummary {
  const tally: Partial<Record<SkillId, { good: number; bad: number }>> = {};
  for (const entry of log) {
    if (!entry.skillId) continue;
    tally[entry.skillId] ??= { good: 0, bad: 0 };
    entry.value >= 0.7 ? tally[entry.skillId]!.good++ : tally[entry.skillId]!.bad++;
  }
  const todayWentWell = Object.entries(tally).filter(([, v]) => v.good > v.bad).map(([id]) => SKILL_MAP[id as SkillId].name);
  const todayLimited  = Object.entries(tally).filter(([, v]) => v.bad > v.good).map(([id]) => SKILL_MAP[id as SkillId].name);
  const newLf = limitingFactor(finalProfile);
  const priorId = session.lf.primary?.id;
  const improved = priorId && finalProfile.skills[priorId].rating > session.startingRatings[priorId] + 3;
  const shifted  = priorId && newLf.primary && newLf.primary.id !== priorId;
  const changeNote = improved && shifted
    ? `${SKILL_MAP[priorId].name} improved again today and is no longer your clearest weakness. Your next session shifts toward ${newLf.primary!.name}.`
    : newLf.primary
      ? `Your next session will continue focusing on ${newLf.primary.name}${newLf.secondary ? ` alongside ${newLf.secondary.name}` : ""}.`
      : "Your next session will keep sampling broadly while confidence builds.";
  return {
    todayWentWell, todayLimited,
    chainNarratives: log.flatMap((e) => e.chainNarrative ? [e.chainNarrative] : []),
    adaptations: log.filter((e) => e.type === "adaptation"),
    newLf, changeNote,
  };
}
