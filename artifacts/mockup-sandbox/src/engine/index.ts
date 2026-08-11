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
export type DecisionOption = {
  key: string;
  label: string;
  tier: DecisionTier;
  rationale: string;
  risk: "low" | "medium" | "high";
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
  execDrill("pot1","potting",2,"Straight Pot — Middle Pocket","Set the object ball one diamond from a middle pocket, straight in.",true),
  execDrill("pot2","potting",4,"Angled Pot — 30°","Cut angle pot into a corner pocket."),
  execDrill("pot3","potting",6,"Long Pot — Full Length","Full-length straight pot, top rail to bottom rail."),
  execDrill("pot4","potting",8,"Thin Cut Under Pressure","Thin cut with a problem ball nearby restricting the cue-ball path."),
  execDrill("spd1","speed",2,"Stop-Ball Speed Gate","Stun the cue ball dead in a large marked zone.",true),
  execDrill("spd2","speed",4,"Two-Cushion Speed Control","Land the cue ball in a target zone after two cushions."),
  execDrill("spd3","speed",6,"Soft Touch Safety Roll","Roll the cue ball just past the object ball at minimal pace."),
  execDrill("spd4","speed",8,"Precision Lag to Baulk","Cue ball must finish within a tight zone by the baulk cushion."),
  execDrill("pos1","positional",2,"Simple Follow Route","Pot and follow the cue ball into an open zone.",true),
  execDrill("pos2","positional",4,"Screw Round the Angle","Pot and screw the cue ball back around a cluster."),
  execDrill("pos3","positional",6,"Side-Spin Route","Use side spin to reach a tucked-away next ball."),
  execDrill("pos4","positional",8,"Congested Cluster Route","Navigate the cue ball through a tight cluster to the next ball."),
  execDrill("cue1","cueBall",2,"Basic Stun","Play a clean stun shot; the cue ball stops on the contact line.",true),
  execDrill("cue2","cueBall",4,"Screw Shot","Basic screw back off the object ball."),
  execDrill("cue3","cueBall",6,"Swerve Around a Blocker","Use swerve to avoid a blocking ball."),
  execDrill("pbe1","problemBallExec",2,"Simple Nudge","Nudge a problem ball a few inches into open space.",true),
  execDrill("pbe2","problemBallExec",4,"Cannon Off Two Balls","Use a cannon to move two problem balls apart."),
  execDrill("pbe3","problemBallExec",6,"Break-Out From a Cluster","Break out a buried ball from a tight cluster."),
  execDrill("brk1","breakExec",2,"Controlled Break","Break with control and aim for a stable spread.",true),
  execDrill("brk2","breakExec",4,"Break for a Pot","Break attempting to pot a ball off the break."),
  execDrill("brk3","breakExec",6,"Break Under Baulk Restriction","Break within tighter baulk-area constraints."),
  execDrill("8b1","eightBall",2,"Straight 8-Ball","Simple straight 8-ball pot.",true),
  execDrill("8b2","eightBall",4,"Angled 8-Ball With Position","Angled 8-ball; cue ball must finish clear of cushions."),
  execDrill("8b3","eightBall",6,"8-Ball Under Pressure","8-ball pot with a tight pocket angle."),

  decDrill("pat1","pattern",2,"Choose the Ball Order","You have a simple three-ball layout. Which order keeps the pattern easiest?",[
    opt("Take the nearest straight pot first, then reassess","optimal","Simplifies the table before committing to a full route.","low"),
    opt("Play the whole sequence exactly as it looks from here","acceptable","Workable, but slightly more speculative than playing one ball at a time.","low"),
    opt("Attack the farthest ball first for value","highrisk","Higher difficulty for no real pattern benefit.","high"),
    opt("Play in the order the balls happen to be numbered","poor","Ignores the pattern entirely.","high"),
  ],true),
  decDrill("pat2","pattern",4,"Two Viable Routes","Two routes look reasonable. Which keeps the 8-ball accessible?",[
    opt("The route that finishes with an open angle on the 8-ball","optimal","Protects access to the final ball, where clearances are often lost.","low"),
    opt("The route that's marginally easier on paper","acceptable","Fine technically, but risks an awkward 8-ball angle.","medium"),
    opt("The route with the most spectacular pots","highrisk","Prioritises difficulty over control of the finish.","high"),
    opt("Whichever route is played first without comparing","poor","No comparison was actually made.","high"),
  ]),
  decDrill("pat3","pattern",6,"Awkward Layout Planning","A congested layout needs a clear order.",[
    opt("Clear the loose balls first, leave clusters for last","optimal","Reduces risk early and buys information before tackling clusters.","low"),
    opt("Take the clusters early while the table is open","acceptable","Can work, but raises risk earlier than necessary.","medium"),
    opt("Ignore the clusters and hope they resolve themselves","highrisk","Defers a problem that will only get harder.","high"),
    opt("Play purely on which ball looks closest","poor","There is no plan behind the order.","high"),
  ]),
  decDrill("pat4","pattern",8,"When to Abandon the Plan","Your planned route has become unviable. What now?",[
    opt("Reassess the whole table and build a new route","optimal","Treats the new position as a fresh problem rather than forcing the old plan.","low"),
    opt("Adjust the next shot only and keep the old plan","acceptable","A reasonable short-term fix, but it may not hold up two shots later.","medium"),
    opt("Push on with the original plan regardless","poor","Ignores that the position has genuinely changed.","high"),
    opt("Play safe immediately without checking for a route","highrisk","Safe, but may throw away a clearance that was still available.","medium"),
  ]),
  decDrill("pbd1","problemBallDec",2,"Spot the Problem Ball","Which ball on this table is the real problem?",[
    opt("The ball tucked against the cushion with no clear angle","optimal","That ball will get harder the longer it is left.","low"),
    opt("The ball that's simply farthest away","acceptable","Distance alone is not the best signal, but it is not unreasonable.","medium"),
    opt("The ball nearest the cue ball right now","highrisk","Proximity does not make a ball a problem.","high"),
    opt("Whichever ball is a different colour group","poor","That is not a diagnostic reason.","high"),
  ],true),
  decDrill("pbd2","problemBallDec",4,"When to Develop","Should you develop this ball now or leave it?",[
    opt("Develop it now while you still have a safe route to it","optimal","Waiting risks losing the safe angle needed to move it.","low"),
    opt("Leave it and hope a later shot opens it","acceptable","Sometimes true, but relies on luck rather than a plan.","medium"),
    opt("Attack it directly as a full pot attempt","highrisk","High difficulty with little reward if it is genuinely awkward.","high"),
    opt("Ignore it for the rest of the clearance","poor","It will still need addressing, likely on worse terms.","high"),
  ]),
  decDrill("tac1","tactical",2,"Attack or Safety","A straightforward attack-versus-safety decision.",[
    opt("Attack — the pot is genuinely straightforward","optimal","When the shot is clearly on, taking it is correct.","low"),
    opt("Play safe to stay in control of the frame","acceptable","Reasonable if confidence is low, but gives up value here.","low"),
    opt("Attack despite it being a low-percentage shot","highrisk","Risk is not matched by the reward on offer.","high"),
    opt("Play a random contact with no clear intention","poor","That is not a real decision.","high"),
  ],true),
  decDrill("tac2","tactical",4,"Create a Snooker","Is a snooker the stronger option here?",[
    opt("Yes — a clean snooker is available and no pot is realistic","optimal","Best use of the position when nothing better is on.","low"),
    opt("Play a simple safety instead of a full snooker","acceptable","Safer to execute, with slightly lower tactical value.","low"),
    opt("Attempt the pot even though it is not really on","highrisk","Low-percentage shot when a stronger option exists.","high"),
    opt("Hit the cue ball with no plan","poor","Wastes the tactical opportunity entirely.","high"),
  ]),
  decDrill("tac3","tactical",6,"Finish Onto the 8-Ball","Choose the right finishing position for the 8-ball.",[
    opt("Leave a straightforward angle on the 8-ball","optimal","The whole clearance is only as good as its finish.","low"),
    opt("Leave it playable but at a tougher angle","acceptable","Still gives a chance, just harder than it needed to be.","medium"),
    opt("Prioritise an easier second-to-last pot over 8-ball position","highrisk","Solves the wrong problem — the 8-ball is what matters most.","high"),
    opt("Do not think about the 8-ball at all","poor","Ignores the actual objective of the clearance.","high"),
  ]),
  decDrill("tac4","tactical",8,"Match-Situation Pressure Call","Deciding frame — attack or contain?",[
    opt("Take the safe, high-percentage route given the situation","optimal","Pressure rewards reducing risk, not adding to it.","low"),
    opt("Attack, since a clearance would end it outright","acceptable","Understandable, but raises risk more than the situation calls for.","medium"),
    opt("Attack the hardest ball for maximum reward","highrisk","Needlessly raises risk in a situation that punishes mistakes.","high"),
    opt("Play without regard for the match situation","poor","Ignores the context entirely.","high"),
  ]),
  decDrill(
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
  ),
  decDrill("tac_bb1","tactical",5,"Free-Shot Nomination — Blackball","You have a free shot from baulk. Which ball should you nominate?",[
    opt("Nominate your own group ball that is closest to a pocket","optimal","Maximises the pot opportunity from baulk while keeping group continuity.","low"),
    opt("Nominate any convenient ball for a safety","acceptable","A safety on a nominated ball is a legitimate free-shot use.","low"),
    opt("Nominate the 8-ball for an immediate win attempt","highrisk","Only valid once all your group balls are potted — otherwise illegal.","high"),
    opt("Play without nominating — treat it as a normal shot","poor","Ignores the free-shot advantage entirely.","high"),
  ],false,["blackball"]),
  decDrill("tac_int1","tactical",5,"Ball-in-Hand Placement — International","You have ball-in-hand after an opponent foul. Where do you place the cue ball?",[
    opt("Directly behind the easiest pot, clearing the route to the next ball","optimal","Full ball-in-hand is a strong advantage — use it for position as well as the pot.","low"),
    opt("Somewhere central but not specifically planned","acceptable","Central placement is reasonable but leaves accuracy on the table.","medium"),
    opt("Near baulk out of habit","highrisk","Treating ball-in-hand like a Blackball free shot from baulk wastes your full freedom.","high"),
    opt("As close as possible to the nearest ball regardless of route","poor","Ignores position for subsequent balls.","high"),
  ],false,["international"]),
];

// ─── Clearances ───────────────────────────────────────────────────────────────
// All clearances use ONE player group (yellows) + the 8-ball.
// Opponent reds appear as obstacles only; never offered as targets.

export const CLEARANCES: Clearance[] = [
  {
    id: "clr3", name: "3-Ball Yellow Clearance", type: "combined", difficulty: 4, clearanceStage: 3,
    assessmentEligible: true, planEligible: true, adaptationEligible: false,
    failureMode: "continue_from_position",
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
    const source = DRILLS.filter((d) => d.type === "execution" && d.rulesContext === null);
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
    const source = sourceForRuleset(ruleset).drills.filter((d) => d.type === "decision");
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
