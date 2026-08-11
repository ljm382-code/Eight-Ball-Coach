// ─── Core types ───────────────────────────────────────────────────────────────

export type RuleSetId = "blackball" | "international";
/** Training-preference mode. "mixed" is NOT a ruleset — it drives session generation only. */
export type RulesMode = "blackball" | "international" | "mixed";
export type SkillType = "execution" | "decision";
export type SkillId =
  | "potting"
  | "cueBall"
  | "speed"
  | "positional"
  | "problemBallExec"
  | "breakExec"
  | "eightBall"
  | "pattern"
  | "problemBallDec"
  | "tactical";

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
   * null = shared/rule-neutral execution evidence (not counted toward ruleset-specific confidence).
   * "blackball" | "international" = evidence gathered under that ruleset.
   */
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
  rootCauseTally: Partial<Record<SkillId, number>>;
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
  /** "target" = offered as pot; "obstacle" = shown but not selectable as ordinary target; "black" = 8-ball */
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
  rootCauseCount: number;
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
  /** Ruleset assigned to each drill slot (null = shared) */
  drillRulesets: (RuleSetId | null)[];
};

// ─── Config ───────────────────────────────────────────────────────────────────

export const CONFIG = {
  dataVersion: 4,
  kMin: 0.06,
  kMax: 0.35,
  difficultyMidpoint: 5,
  difficultySensitivity: 0.05,
  diffMultiplierMin: 0.6,
  diffMultiplierMax: 1.5,
  recencyWindowMs: 1000 * 60 * 60 * 24 * 21,
  meanGapThreshold: 8,
  mixed: {
    /** Minimum fraction of rules-sensitive slots assigned to each ruleset in Mixed mode */
    minRulesetFloor: 0.25,
    /** Default split when evidence is equal */
    defaultBlackballFraction: 0.5,
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
};

// ─── Skills ───────────────────────────────────────────────────────────────────

export const SKILLS: SkillDefinition[] = [
  { id: "potting",        name: "Potting",                                   shortName: "Potting",    type: "execution", priority: true },
  { id: "cueBall",        name: "Cue-Ball Control",                          shortName: "Cue Ball",   type: "execution" },
  { id: "speed",          name: "Speed / Touch Control",                     shortName: "Speed",      type: "execution", priority: true },
  { id: "positional",     name: "Positional Execution",                      shortName: "Position",   type: "execution", priority: true },
  { id: "problemBallExec",name: "Problem-Ball Execution",                    shortName: "Problem Ball",type: "execution" },
  { id: "breakExec",      name: "Break & Post-Break Execution",              shortName: "Break",      type: "execution" },
  { id: "eightBall",      name: "8-Ball Finishing",                          shortName: "8-Ball",     type: "execution" },
  { id: "pattern",        name: "Pattern Recognition & Clearance Planning",  shortName: "Patterns",   type: "decision", priority: true },
  { id: "problemBallDec", name: "Problem-Ball Identification & Management",  shortName: "Problem ID", type: "decision" },
  { id: "tactical",       name: "Tactical / Safety Decision-Making",         shortName: "Tactics",    type: "decision", priority: true },
];

export const SKILL_MAP = Object.fromEntries(SKILLS.map((s) => [s.id, s])) as Record<SkillId, SkillDefinition>;

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
    unsupportedNote: "Phase 2 models the key foul/free-shot differences. Stalemate procedures, simultaneous foul situations, and detailed tournament administration are not yet modelled.",
  },
  international: {
    id: "international",
    name: "International Rules",
    description: "The internationally recognised 8-ball format with its own tactical rhythm.",
    tacticalNote: "Plan the clearance around the open table and protect your first legal shot. After a foul you receive full ball-in-hand — use the positional freedom.",
    unsupportedNote: "Phase 2 models the key foul/ball-in-hand difference. Push-out rules, stalemate procedures, and referee-call edge cases are not yet modelled.",
  },
};

export const RULES_MODE_INFO: Record<RulesMode, { label: string; description: string }> = {
  blackball:    { label: "Blackball Rules",    description: "Train under WPA Blackball rules." },
  international:{ label: "International Rules", description: "Train under IEPF International rules." },
  mixed:        { label: "Both",               description: "Your training will include both rulesets. Every rules-specific exercise will be clearly labelled." },
};

// ─── Decision option helpers ──────────────────────────────────────────────────

const opt = (label: string, tier: DecisionTier, rationale: string, risk: DecisionOption["risk"]): DecisionOption => ({ key: label, label, tier, rationale, risk });

const execDrill = (id: string, skillId: SkillId, difficulty: number, name: string, desc: string, assessmentEligible = false): Drill => ({
  id, skillId, type: "execution", difficulty, name, desc, familyId: `${skillId}-family`,
  assessmentEligible,
  rulesets: ["blackball", "international"],
  rulesContext: null, // shared — no rules badge needed
});

const decDrill = (id: string, skillId: SkillId, difficulty: number, name: string, desc: string, options: DecisionOption[], assessmentEligible = false, rulesets: RuleSetId[] = ["blackball", "international"], rulesetOptions?: Partial<Record<RuleSetId, DecisionOption[]>>): Drill => ({
  id, skillId, type: "decision", difficulty, name, desc, options, familyId: `${skillId}-family`,
  assessmentEligible, rulesets,
  rulesContext: rulesets.length === 1 ? rulesets[0] : null,
  rulesetOptions,
});

// ─── Drills ───────────────────────────────────────────────────────────────────

export const DRILLS: Drill[] = [
  // Execution — shared across both rulesets
  execDrill("pot1", "potting",        2, "Straight Pot — Middle Pocket",      "Set the object ball one diamond from a middle pocket, straight in.", true),
  execDrill("pot2", "potting",        4, "Angled Pot — 30°",                  "Cut angle pot into a corner pocket."),
  execDrill("pot3", "potting",        6, "Long Pot — Full Length",             "Full-length straight pot, top rail to bottom rail."),
  execDrill("pot4", "potting",        8, "Thin Cut Under Pressure",            "Thin cut with a problem ball nearby restricting the cue-ball path."),
  execDrill("spd1", "speed",          2, "Stop-Ball Speed Gate",               "Stun the cue ball dead in a large marked zone.", true),
  execDrill("spd2", "speed",          4, "Two-Cushion Speed Control",          "Land the cue ball in a target zone after two cushions."),
  execDrill("spd3", "speed",          6, "Soft Touch Safety Roll",             "Roll the cue ball just past the object ball at minimal pace."),
  execDrill("spd4", "speed",          8, "Precision Lag to Baulk",             "Cue ball must finish within a tight zone by the baulk cushion."),
  execDrill("pos1", "positional",     2, "Simple Follow Route",                "Pot and follow the cue ball into an open zone.", true),
  execDrill("pos2", "positional",     4, "Screw Round the Angle",              "Pot and screw the cue ball back around a cluster."),
  execDrill("pos3", "positional",     6, "Side-Spin Route",                    "Use side spin to reach a tucked-away next ball."),
  execDrill("pos4", "positional",     8, "Congested Cluster Route",            "Navigate the cue ball through a tight cluster to the next ball."),
  execDrill("cue1", "cueBall",        2, "Basic Stun",                         "Play a clean stun shot; the cue ball stops on the contact line.", true),
  execDrill("cue2", "cueBall",        4, "Screw Shot",                         "Basic screw back off the object ball."),
  execDrill("cue3", "cueBall",        6, "Swerve Around a Blocker",            "Use swerve to avoid a blocking ball."),
  execDrill("pbe1", "problemBallExec",2, "Simple Nudge",                       "Nudge a problem ball a few inches into open space.", true),
  execDrill("pbe2", "problemBallExec",4, "Cannon Off Two Balls",               "Use a cannon to move two problem balls apart."),
  execDrill("pbe3", "problemBallExec",6, "Break-Out From a Cluster",           "Break out a buried ball from a tight cluster."),
  execDrill("brk1", "breakExec",      2, "Controlled Break",                   "Break with control and aim for a stable spread.", true),
  execDrill("brk2", "breakExec",      4, "Break for a Pot",                    "Break attempting to pot a ball off the break."),
  execDrill("brk3", "breakExec",      6, "Break Under Baulk Restriction",      "Break within tighter baulk-area constraints."),
  execDrill("8b1",  "eightBall",      2, "Straight 8-Ball",                    "Simple straight 8-ball pot.", true),
  execDrill("8b2",  "eightBall",      4, "Angled 8-Ball With Position",        "Angled 8-ball; cue ball must finish clear of cushions."),
  execDrill("8b3",  "eightBall",      6, "8-Ball Under Pressure",              "8-ball pot with a tight pocket angle."),

  // Decision — shared (rules do not change the correct answer)
  decDrill("pat1", "pattern", 2, "Choose the Ball Order", "You have a simple three-ball layout. Which order keeps the pattern easiest?", [
    opt("Take the nearest straight pot first, then reassess",        "optimal",    "Simplifies the table before committing to a full route.", "low"),
    opt("Play the whole sequence exactly as it looks from here",     "acceptable", "Workable, but slightly more speculative than playing one ball at a time.", "low"),
    opt("Attack the farthest ball first for value",                  "highrisk",   "Higher difficulty for no real pattern benefit.", "high"),
    opt("Play in the order the balls happen to be numbered",         "poor",       "Ignores the pattern entirely.", "high"),
  ], true),
  decDrill("pat2", "pattern", 4, "Two Viable Routes", "Two routes look reasonable. Which keeps the 8-ball accessible?", [
    opt("The route that finishes with an open angle on the 8-ball",  "optimal",    "Protects access to the final ball, where clearances are often lost.", "low"),
    opt("The route that's marginally easier on paper",               "acceptable", "Fine technically, but risks an awkward 8-ball angle.", "medium"),
    opt("The route with the most spectacular pots",                  "highrisk",   "Prioritises difficulty over control of the finish.", "high"),
    opt("Whichever route is played first without comparing",         "poor",       "No comparison was actually made.", "high"),
  ]),
  decDrill("pat3", "pattern", 6, "Awkward Layout Planning", "A congested layout needs a clear order.", [
    opt("Clear the loose balls first, leave clusters for last",      "optimal",    "Reduces risk early and buys information before tackling clusters.", "low"),
    opt("Take the clusters early while the table is open",           "acceptable", "Can work, but raises risk earlier than necessary.", "medium"),
    opt("Ignore the clusters and hope they resolve themselves",      "highrisk",   "Defers a problem that will only get harder.", "high"),
    opt("Play purely on which ball looks closest",                   "poor",       "There is no plan behind the order.", "high"),
  ]),
  decDrill("pat4", "pattern", 8, "When to Abandon the Plan", "Your planned route has become unviable. What now?", [
    opt("Reassess the whole table and build a new route",            "optimal",    "Treats the new position as a fresh problem rather than forcing the old plan.", "low"),
    opt("Adjust the next shot only and keep the old plan",           "acceptable", "A reasonable short-term fix, but it may not hold up two shots later.", "medium"),
    opt("Push on with the original plan regardless",                 "poor",       "Ignores that the position has genuinely changed.", "high"),
    opt("Play safe immediately without checking for a route",        "highrisk",   "Safe, but may throw away a clearance that was still available.", "medium"),
  ]),
  decDrill("pbd1", "problemBallDec", 2, "Spot the Problem Ball", "Which ball on this table is the real problem?", [
    opt("The ball tucked against the cushion with no clear angle",   "optimal",    "That ball will get harder the longer it is left.", "low"),
    opt("The ball that's simply farthest away",                      "acceptable", "Distance alone is not the best signal, but it is not unreasonable.", "medium"),
    opt("The ball nearest the cue ball right now",                   "highrisk",   "Proximity does not make a ball a problem.", "high"),
    opt("Whichever ball is a different colour group",                "poor",       "That is not a diagnostic reason.", "high"),
  ], true),
  decDrill("pbd2", "problemBallDec", 4, "When to Develop", "Should you develop this ball now or leave it?", [
    opt("Develop it now while you still have a safe route to it",    "optimal",    "Waiting risks losing the safe angle needed to move it.", "low"),
    opt("Leave it and hope a later shot opens it",                   "acceptable", "Sometimes true, but relies on luck rather than a plan.", "medium"),
    opt("Attack it directly as a full pot attempt",                  "highrisk",   "High difficulty with little reward if it is genuinely awkward.", "high"),
    opt("Ignore it for the rest of the clearance",                   "poor",       "It will still need addressing, likely on worse terms.", "high"),
  ]),

  // Tactical — shared
  decDrill("tac1", "tactical", 2, "Attack or Safety", "A straightforward attack-versus-safety decision.", [
    opt("Attack — the pot is genuinely straightforward",             "optimal",    "When the shot is clearly on, taking it is correct.", "low"),
    opt("Play safe to stay in control of the frame",                 "acceptable", "Reasonable if confidence is low, but gives up value here.", "low"),
    opt("Attack despite it being a low-percentage shot",             "highrisk",   "Risk is not matched by the reward on offer.", "high"),
    opt("Play a random contact with no clear intention",             "poor",       "That is not a real decision.", "high"),
  ], true),
  decDrill("tac2", "tactical", 4, "Create a Snooker", "Is a snooker the stronger option here?", [
    opt("Yes — a clean snooker is available and no pot is realistic","optimal",    "Best use of the position when nothing better is on.", "low"),
    opt("Play a simple safety instead of a full snooker",            "acceptable", "Safer to execute, with slightly lower tactical value.", "low"),
    opt("Attempt the pot even though it is not really on",           "highrisk",   "Low-percentage shot when a stronger option exists.", "high"),
    opt("Hit the cue ball with no plan",                             "poor",       "Wastes the tactical opportunity entirely.", "high"),
  ]),
  decDrill("tac3", "tactical", 6, "Finish Onto the 8-Ball", "Choose the right finishing position for the 8-ball.", [
    opt("Leave a straightforward angle on the 8-ball",               "optimal",    "The whole clearance is only as good as its finish.", "low"),
    opt("Leave it playable but at a tougher angle",                  "acceptable", "Still gives a chance, just harder than it needed to be.", "medium"),
    opt("Prioritise an easier second-to-last pot over 8-ball position","highrisk", "Solves the wrong problem — the 8-ball is what matters most.", "high"),
    opt("Do not think about the 8-ball at all",                      "poor",       "Ignores the actual objective of the clearance.", "high"),
  ]),
  decDrill("tac4", "tactical", 8, "Match-Situation Pressure Call", "Deciding frame — attack or contain?", [
    opt("Take the safe, high-percentage route given the situation",  "optimal",    "Pressure rewards reducing risk, not adding to it.", "low"),
    opt("Attack, since a clearance would end it outright",           "acceptable", "Understandable, but raises risk more than the situation calls for.", "medium"),
    opt("Attack the hardest ball for maximum reward",                "highrisk",   "Needlessly raises risk in a situation that punishes mistakes.", "high"),
    opt("Play without regard for the match situation",               "poor",       "Ignores the context entirely.", "high"),
  ]),

  // Tactical — genuinely different under Blackball vs International (foul recovery)
  // This is the one authored scenario where rules materially change the correct answer.
  decDrill(
    "tac5_foul_recovery",
    "tactical",
    5,
    "Foul Recovery — Using Your Advantage",
    "Your opponent has fouled. You are in a reasonable position with balls still on. What do you do with your advantage?",
    // Base options (shown if no ruleset-specific override — should not occur in practice)
    [
      opt("Attack — pot a ball directly",                              "acceptable", "Taking a pot can be correct, but consider your positional advantage first.", "medium"),
      opt("Play a snooker or safety to extend the advantage",          "acceptable", "A safety compounds the opponent's difficulty.", "low"),
      opt("Hit something without a clear plan",                        "poor",       "Wastes a significant positional advantage.", "high"),
      opt("Roll up safe without taking the free-shot advantage",       "highrisk",   "Surrendering the advantage of the foul is rarely correct.", "high"),
    ],
    false, // not assessment eligible
    ["blackball", "international"],
    {
      blackball: [
        opt("Attack — pot a ball directly",                            "acceptable", "From baulk you have limited angles — a direct attack is workable only if a pot is clearly on from the D.", "medium"),
        opt("Play a snooker or safety to extend the advantage",        "optimal",    "With a free shot from baulk, a nominated snooker is often the strongest play — you keep control and the opponent faces another awkward position.", "low"),
        opt("Hit something without a clear plan",                      "poor",       "Wastes your free-shot advantage entirely.", "high"),
        opt("Roll up safe without taking the free-shot advantage",     "highrisk",   "You have a free shot — wasting it by playing passively gives up a material edge.", "high"),
      ],
      international: [
        opt("Attack — pot a ball directly",                            "optimal",    "Ball in hand anywhere gives full positional freedom. Placing the cue ball for the best pot is strongly correct.", "low"),
        opt("Play a snooker or safety to extend the advantage",        "acceptable", "With ball in hand anywhere you can almost always find a pot. A safety gives up too much value unless the table is very locked up.", "low"),
        opt("Hit something without a clear plan",                      "poor",       "Wastes a ball-in-hand advantage.", "high"),
        opt("Roll up safe without taking the free-shot advantage",     "poor",       "Ball in hand anywhere is too strong an advantage to waste with a passive roll-up.", "high"),
      ],
    }
  ),

  // Blackball-only: snooker/safety tactics specific to baulk free-shot mechanics
  decDrill("tac_bb1", "tactical", 5, "Free-Shot Nomination — Blackball", "You have a free shot from baulk. Which ball should you nominate?", [
    opt("Nominate your own group ball that is closest to a pocket",   "optimal",    "Maximises the pot opportunity from baulk while keeping group continuity.", "low"),
    opt("Nominate any convenient ball for a safety",                  "acceptable", "A safety on a nominated ball is a legitimate free-shot use.", "low"),
    opt("Nominate the 8-ball for an immediate win attempt",           "highrisk",   "Only valid once all your group balls are potted — otherwise illegal.", "high"),
    opt("Play without nominating — treat it as a normal shot",        "poor",       "Ignores the free-shot advantage entirely.", "high"),
  ], false, ["blackball"]),

  // International-only: ball-in-hand positioning
  decDrill("tac_int1", "tactical", 5, "Ball-in-Hand Placement — International", "You have ball-in-hand after an opponent foul. Where do you place the cue ball?", [
    opt("Directly behind the easiest pot, clearing the route to the next ball","optimal", "Full ball-in-hand is a strong advantage — use it for position as well as the pot.", "low"),
    opt("Somewhere central but not specifically planned",             "acceptable", "Central placement is reasonable but leaves accuracy on the table.", "medium"),
    opt("Near baulk out of habit",                                   "highrisk",   "Treating ball-in-hand like a Blackball free shot from baulk wastes your full freedom.", "high"),
    opt("As close as possible to the nearest ball regardless of route","poor",     "Ignores position for subsequent balls.", "high"),
  ], false, ["international"]),
];

// ─── Clearances ───────────────────────────────────────────────────────────────
// All clearances use ONE player group (yellows) + the 8-ball.
// Opponent balls (reds) may appear as obstacles but are never offered as clearance targets.

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
  return {
    ...base,
    ...candidate,
    dataVersion: CONFIG.dataVersion,
    ruleset: existingRuleset,
    preferredRulesMode: existingMode,
    skills,
    ratingHistory: candidate.ratingHistory ?? {},
    rootCauseTally: candidate.rootCauseTally ?? {},
    sessions: Array.isArray(candidate.sessions) ? candidate.sessions : [],
  };
}

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

/**
 * Compute confidence for a decision skill using only attempts tagged with a specific ruleset.
 * Returns Low confidence if no ruleset-specific evidence exists yet.
 */
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
  const rootCauseCount = profile.rootCauseTally[skillId] ?? 0;
  const weights = CONFIG.evidence.weights;
  const score = clamp(gap / 25, 0, 1) * weights.gap +
    confidence.score * weights.confidence +
    recentErrorRate * weights.recentError +
    Math.min(1, clearanceFails / 3) * weights.clearanceFail +
    Math.min(1, rootCauseCount / 3) * weights.rootCause;
  const qualifies = confidence.tier !== "Low" && (gap > CONFIG.meanGapThreshold || rootCauseCount >= 2);
  const status = !qualifies ? "none" : score >= CONFIG.evidence.confirmedThreshold ? "confirmed" : score >= CONFIG.evidence.provisionalThreshold ? "provisional" : "none";
  return { ...SKILL_MAP[skillId], rating: state.rating, gap, confidence, score, status, rootCauseCount };
}

export function limitingFactor(profile: Profile, now = Date.now()): LimitingFactors {
  const scored = SKILLS.map((s) => evidenceForSkill(profile, s.id, now)).filter((s) => s.status !== "none").sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { primary: null, secondary: null, status: "insufficient" };
  return { primary: scored[0], secondary: scored[1] ?? null, status: scored[0].status === "none" ? "insufficient" : scored[0].status };
}

export function sessionWeighting(profile: Profile) {
  const exec = composite(profile, "execution");
  const dec = composite(profile, "decision");
  const execWeight = clamp(50 + (dec - exec) * 0.6, 25, 75);
  return { execWeight: Math.round(execWeight), decWeight: Math.round(100 - execWeight), exec, dec };
}

export function difficultyForSkill(profile: Profile, skillId: SkillId) {
  return clamp(Math.round(profile.skills[skillId].rating / 12), 1, 8);
}

// ─── Mixed-mode ruleset split ─────────────────────────────────────────────────

/**
 * Determine the fraction of rules-sensitive slots that should go to Blackball vs International
 * when preferredRulesMode is "mixed". Adapts based on relative ruleset-specific tactical confidence.
 * Applies a minimum floor so neither ruleset disappears.
 */
export function mixedRulesetSplit(profile: Profile, now = Date.now()): { blackball: number; international: number } {
  const floor = CONFIG.mixed.minRulesetFloor;
  const decisionSkills = SKILLS.filter((s) => s.type === "decision");
  let bbScore = 0;
  let intScore = 0;
  for (const skill of decisionSkills) {
    bbScore  += computeRulesetConfidence(profile, skill.id, "blackball",     now).score;
    intScore += computeRulesetConfidence(profile, skill.id, "international", now).score;
  }
  const total = bbScore + intScore;
  if (total === 0) return { blackball: 0.5, international: 0.5 };
  // Give more weight to the weaker ruleset (inverse confidence)
  const intFraction = clamp(1 - intScore / total, floor, 1 - floor);
  const bbFraction  = clamp(1 - bbScore  / total, floor, 1 - floor);
  const sum = intFraction + bbFraction;
  return { blackball: bbFraction / sum, international: intFraction / sum };
}

// ─── Session generation ───────────────────────────────────────────────────────

const nearestDrill = (pool: Drill[], target: number) =>
  pool.slice().sort((a, b) => Math.abs(a.difficulty - target) - Math.abs(b.difficulty - target))[0];

/** Drills and clearances filtered to a specific ruleset */
const sourceForRuleset = (ruleset: RuleSetId) => ({
  drills:     DRILLS.filter((d) => d.rulesets.includes(ruleset)),
  clearances: CLEARANCES.filter((c) => c.rulesets.includes(ruleset)),
});

const supportingLinks: { source: SkillId; target: SkillId }[] = [
  { source: "speed",         target: "positional" },
  { source: "cueBall",       target: "positional" },
  { source: "cueBall",       target: "problemBallExec" },
  { source: "pattern",       target: "eightBall" },
  { source: "problemBallDec",target: "pattern" },
];

export function generateSession(profile: Profile, minutes: number): GeneratedSession {
  const count = SESSION_LENGTHS[minutes] ?? 5;
  const lf = limitingFactor(profile);
  const weighting = sessionWeighting(profile);
  const focusSkillIds = [lf.primary?.id, lf.secondary?.id].filter(Boolean) as SkillId[];
  const execFocus = focusSkillIds.filter((id) => SKILL_MAP[id].type === "execution");
  const decFocus  = focusSkillIds.filter((id) => SKILL_MAP[id].type === "decision");
  const execPool  = execFocus.length ? execFocus : SKILLS.filter((s) => s.type === "execution").map((s) => s.id);
  const decPool   = decFocus.length  ? decFocus  : SKILLS.filter((s) => s.type === "decision" ).map((s) => s.id);
  const used = new Set<string>();
  const mode = profile.preferredRulesMode;

  const execCount = clamp(Math.round((count * weighting.execWeight) / 100), 1, count - 1);
  const decCount  = count - execCount;

  const selected: SessionItem[] = [];
  const drillRulesets: (RuleSetId | null)[] = [];

  const pickExec = (ruleset: RuleSetId | null, skillIds: SkillId[], n: number) => {
    const source = ruleset ? sourceForRuleset(ruleset).drills : DRILLS.filter((d) => d.rulesContext === null);
    for (let i = 0; i < n; i++) {
      const skillId = skillIds[i % skillIds.length];
      const preferred = source.filter((d) => d.type === "execution" && d.skillId === skillId && !used.has(d.id));
      const pool = preferred.length ? preferred : source.filter((d) => d.type === "execution" && !used.has(d.id));
      const fallback = pool.length ? pool : source.filter((d) => d.type === "execution");
      if (!fallback.length) continue;
      const drill = nearestDrill(fallback, difficultyForSkill(profile, skillId));
      used.add(drill.id);
      selected.push({ ...drill, reason: focusSkillIds.includes(drill.skillId) ? `Focus area: ${SKILL_MAP[drill.skillId].name}.` : "Rounding out today's session." });
      drillRulesets.push(null); // execution drills are always shared
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
    // Execution: always shared (no ruleset tag needed)
    pickExec(null, execPool, execCount);
    // Decision: split between rulesets based on adaptive weighting
    const split = mixedRulesetSplit(profile);
    const bbDecCount  = Math.max(1, Math.round(decCount * split.blackball));
    const intDecCount = Math.max(1, decCount - bbDecCount);
    // Group same-ruleset exercises together where practical
    pickDec("blackball",     decPool, bbDecCount);
    pickDec("international", decPool, intDecCount);
  } else {
    // Single-ruleset mode
    pickExec(null, execPool, execCount);
    pickDec(mode, decPool, decCount);
  }

  // Support link injection
  const support = focusSkillIds.flatMap((id) => supportingLinks.filter((l) => l.target === id).map((l) => l.source))[0];
  if (support) {
    const supportDrills = DRILLS.filter((d) => d.skillId === support && d.rulesContext === null);
    const replaceAt = selected.findIndex((item) => item.type === SKILL_MAP[support].type);
    if (supportDrills.length && replaceAt >= 0) {
      selected[replaceAt] = { ...nearestDrill(supportDrills, difficultyForSkill(profile, support)), reason: `Supports your work on ${SKILL_MAP[focusSkillIds[0]]?.name.toLowerCase() ?? "today's focus"}.` };
      drillRulesets[replaceAt] = null;
    }
  }

  // Maintenance slot (strongest skill)
  if (count >= 4) {
    const strongest = SKILLS.filter((s) => computeConfidence(profile.skills[s.id].attempts).tier !== "Low").sort((a, b) => profile.skills[b.id].rating - profile.skills[a.id].rating)[0];
    if (strongest) {
      const pool = DRILLS.filter((d) => d.skillId === strongest.id && d.rulesContext === null);
      if (pool.length && selected.length > 0) {
        selected[0] = { ...nearestDrill(pool, difficultyForSkill(profile, strongest.id)), reason: `Maintenance — your ${strongest.name.toLowerCase()} is strong but deserves a touch.` };
        drillRulesets[0] = null;
      }
    }
  }

  // Calibration slot (lowest-evidence skill)
  if (count >= 6) {
    const calibration = SKILLS.filter((s) => computeConfidence(profile.skills[s.id].attempts).tier === "Low" && !focusSkillIds.includes(s.id)).sort((a, b) => profile.skills[a.id].attempts.length - profile.skills[b.id].attempts.length)[0];
    if (calibration) {
      const pool = DRILLS.filter((d) => d.skillId === calibration.id && d.rulesContext === null);
      if (pool.length && selected.length > 1) {
        selected[Math.min(1, selected.length - 1)] = { ...nearestDrill(pool, difficultyForSkill(profile, calibration.id)), reason: `Calibration — we still need more evidence about ${calibration.name.toLowerCase()}.` };
        drillRulesets[Math.min(1, selected.length - 1)] = null;
      }
    }
  }

  // Clearance slot
  if (count >= 5) {
    const rulesetForClearance: RuleSetId = mode === "mixed" ? (selected.filter((_, i) => drillRulesets[i] === "international").length >= selected.filter((_, i) => drillRulesets[i] === "blackball").length ? "international" : "blackball") : mode;
    const clearances = sourceForRuleset(rulesetForClearance).clearances;
    const clearance = clearances[weighting.execWeight >= 50 ? 1 : 2] ?? clearances[clearances.length - 1];
    selected.push({ ...clearance, reason: "Clearance work — combines the skills today's session is targeting." });
    drillRulesets.push(null); // clearances are compatible with both rulesets
  }

  return {
    drills: selected,
    lf,
    weighting,
    focusSkillIds,
    startingRatings: Object.fromEntries(SKILLS.map((s) => [s.id, profile.skills[s.id].rating])) as Record<SkillId, number>,
    drillRulesets,
  };
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
