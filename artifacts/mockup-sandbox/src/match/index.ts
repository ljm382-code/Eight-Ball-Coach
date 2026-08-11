/**
 * Phase 3 — Match engine
 * Pure functions only. No side-effects, no localStorage, no React.
 * Match events do NOT write to profile skill ratings.
 * They influence coaching priority via computeMatchPriorityBoost → matchAwareLimitingFactor → generateAdaptiveSession.
 */
import {
  CONFIG, SKILL_MAP, SKILLS, evidenceForSkill, generateSession, mixedRulesetSplit,
  type GeneratedSession, type LimitingFactor, type LimitingFactors,
  type Profile, type RuleSetId, type SkillId,
} from "../engine";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FrameImpact     = "low" | "medium" | "high" | "decisive";
export type MatchEnvironment = "practice" | "competition";
export type FrameResult     = "won" | "lost";
export type FramePressure   = "normal" | "deciding" | "hill_hill" | "high_pressure";

export type FrameEvent = {
  id: string;
  type: "error" | "positive";
  /** Category key from FRAME_LOSS_CATEGORIES or POSITIVE_EVENT_TYPES */
  category: string;
  /** Direct skill from category mapping (null for foul/other/opp_cleared) */
  skillId: SkillId | null;
  /** Same as category key — preserves what the player reported */
  reportedCause: string;
  /**
   * Inferred upstream cause — only set when structured contextual evidence supports it.
   * A plain missed_pot with no upstream evidence stays null; no guessing.
   */
  inferredCause: SkillId | null;
  diagnosticConfidence: "Low" | "Emerging" | "Established" | "High";
  impact: FrameImpact;
  ruleset: RuleSetId;
  environment: MatchEnvironment;
  ts: number;
  notes?: string;
  /**
   * Optional structured upstream context for missed_pot.
   * When provided, supports a conservative inferred root cause.
   * E.g. "poor_position" → inferredCause: "positional" (Emerging).
   */
  precededBy?: string;
};

export type Frame = {
  id: string;
  matchId: string;
  frameNumber: number;
  result: FrameResult;
  pressure: FramePressure;
  keyEvents: FrameEvent[];
  ts: number;
  breakPlayer?: "player" | "opponent";
  clearanceOpportunity?: "none" | "partial" | "realistic" | "strong";
  clearanceOutcome?: "completed" | "broke_down" | "never_attempted";
  frameLossReason?: string;
};

export type Match = {
  id: string;
  startedAt: number;
  completedAt?: number;
  competitionType: MatchEnvironment;
  /** Always a concrete ruleset (never "mixed") */
  ruleset: RuleSetId;
  frames: Frame[];
  opponent?: string;
  format?: string;
  eventName?: string;
  notes?: string;
};

export type MatchWeakness = {
  skillId: SkillId | null;
  label: string;
  count: number;
  avgImpact: FrameImpact;
};

export type MatchSummary = {
  matchId: string;
  playerFrames: number;
  opponentFrames: number;
  matchNarrative: string;
  matchWeaknesses: MatchWeakness[];
  todayStrengths: SkillId[];
  lfChange: string;
  trainingFocus: SkillId[];
  matchVsTrainingNote?: string;
};

// ─── Config ───────────────────────────────────────────────────────────────────

export const MATCH_CONFIG = {
  /** Raw impact weight per event type */
  impact: { low: 0.15, medium: 0.35, high: 0.65, decisive: 0.9 } as Record<FrameImpact, number>,
  /** Fraction by which the raw match boost is scaled when added to the LF evidence score */
  matchWeightInLF: 0.3,
  /** Same 21-day half-life as root-cause event decay */
  halfLifeMs: CONFIG.rootCause.halfLifeMs,
  /** Raw boost >= this qualifies a skill for LF status from match evidence alone */
  qualifyingBoostThreshold: 0.3,
  /** Positive evidence reduces the error boost by this fraction */
  positiveDiscountFactor: 0.3,
};

// ─── Category definitions ─────────────────────────────────────────────────────

type CategoryDef = { key: string; label: string; skillId: SkillId | null; defaultImpact: FrameImpact };

export const FRAME_LOSS_CATEGORIES: CategoryDef[] = [
  { key: "missed_pot",     label: "Missed pot",             skillId: "potting",      defaultImpact: "high"     },
  { key: "lost_position",  label: "Lost position",          skillId: "positional",   defaultImpact: "medium"   },
  { key: "poor_speed",     label: "Speed control",          skillId: "speed",        defaultImpact: "medium"   },
  { key: "poor_pattern",   label: "Pattern error",          skillId: "pattern",      defaultImpact: "high"     },
  { key: "tactical_error", label: "Tactical error",         skillId: "tactical",     defaultImpact: "high"     },
  { key: "safety_error",   label: "Safety went wrong",      skillId: "tactical",     defaultImpact: "medium"   },
  { key: "break_problem",  label: "Break issue",            skillId: "breakExec",    defaultImpact: "medium"   },
  { key: "8ball_miss",     label: "8-ball miss",            skillId: "eightBall",    defaultImpact: "decisive" },
  { key: "spin_error",     label: "Spin / cue ball error",  skillId: "cueBall",      defaultImpact: "medium"   },
  { key: "opp_cleared",    label: "Opponent clearance",     skillId: null,           defaultImpact: "high"     },
  { key: "foul",           label: "Foul committed",         skillId: null,           defaultImpact: "medium"   },
  { key: "other",          label: "Other",                  skillId: null,           defaultImpact: "medium"   },
];

export const POSITIVE_EVENT_TYPES: CategoryDef[] = [
  { key: "completed_clearance", label: "Completed clearance",  skillId: "pattern",   defaultImpact: "high"   },
  { key: "strong_safety",       label: "Strong safety",        skillId: "tactical",  defaultImpact: "medium" },
  { key: "tactical_recovery",   label: "Tactical recovery",    skillId: "tactical",  defaultImpact: "medium" },
  { key: "8ball_finish",        label: "8-ball finish",        skillId: "eightBall", defaultImpact: "high"   },
  { key: "strong_break",        label: "Strong break",         skillId: "breakExec", defaultImpact: "medium" },
  { key: "correct_replan",      label: "Correct re-plan",      skillId: "pattern",   defaultImpact: "medium" },
];

// ─── ID generation ────────────────────────────────────────────────────────────

let _seq = 0;
function uid(prefix: string, now: number): string {
  return `${prefix}_${now}_${(++_seq).toString(36)}`;
}

// ─── Cause inference ──────────────────────────────────────────────────────────

/**
 * Maps optional structured upstream context keys to their corresponding upstream skill.
 * Only valid entries produce an inferred cause — everything else stays null.
 */
const PRECEDED_BY_SKILL: Record<string, SkillId> = {
  poor_position:  "positional",
  poor_speed:     "speed",
  poor_pattern:   "pattern",
  tactical_error: "tactical",
};

/**
 * Conservative cause inference. Never invents an upstream cause from thin air.
 *
 * - plain missed_pot            → direct skill: potting, inferredCause: null
 * - missed_pot + precededBy     → direct skill: potting, inferredCause: upstream skill (Emerging)
 * - positive events             → inferredCause: null
 * - all other loss categories   → inferredCause = the category's own skill (Emerging)
 */
function inferMatchCause(
  category: string,
  skillId: SkillId | null,
  precededBy?: string
): { cause: SkillId | null; confidence: "Low" | "Emerging" } {
  // Positive events have no upstream cause
  if (POSITIVE_EVENT_TYPES.some(e => e.key === category)) return { cause: null, confidence: "Low" };

  // missed_pot: only infer upstream when structured evidence is provided
  if (category === "missed_pot") {
    const upstreamSkill = precededBy ? (PRECEDED_BY_SKILL[precededBy] ?? null) : null;
    if (upstreamSkill) return { cause: upstreamSkill, confidence: "Emerging" };
    // No upstream evidence — report as a direct potting issue, inferredCause stays null
    return { cause: null, confidence: "Low" };
  }

  // All other loss categories map directly to their own skill
  if (skillId !== null) return { cause: skillId, confidence: "Emerging" };
  return { cause: null, confidence: "Low" };
}

// ─── Pure constructors ────────────────────────────────────────────────────────

export function buildFrameEvent(
  partial: {
    type: "error" | "positive";
    category: string;
    impact?: FrameImpact;
    ruleset: RuleSetId;
    environment: MatchEnvironment;
    notes?: string;
    /**
     * Optional structured upstream context for missed_pot.
     * Supported values: "poor_position" | "poor_speed" | "poor_pattern" | "tactical_error"
     * When provided, enables a conservative upstream cause inference.
     */
    precededBy?: string;
  },
  now = Date.now()
): FrameEvent {
  const allCats = [...FRAME_LOSS_CATEGORIES, ...POSITIVE_EVENT_TYPES];
  const catDef = allCats.find(c => c.key === partial.category);
  const skillId = catDef?.skillId ?? null;
  const impact = partial.impact ?? catDef?.defaultImpact ?? "medium";
  const { cause: inferredCause, confidence } = inferMatchCause(partial.category, skillId, partial.precededBy);
  return {
    id: uid("fe", now),
    type: partial.type,
    category: partial.category,
    skillId,
    reportedCause: partial.category,
    inferredCause,
    diagnosticConfidence: confidence === "Low" ? "Low" : "Emerging",
    impact,
    ruleset: partial.ruleset,
    environment: partial.environment,
    ts: now,
    notes: partial.notes,
    precededBy: partial.precededBy,
  };
}

export function createMatch(
  setup: {
    ruleset: RuleSetId;
    competitionType: MatchEnvironment;
    opponent?: string;
    format?: string;
    eventName?: string;
    notes?: string;
  },
  now = Date.now()
): Match {
  return {
    id: uid("m", now),
    startedAt: now,
    completedAt: undefined,
    competitionType: setup.competitionType,
    ruleset: setup.ruleset,
    frames: [],
    opponent: setup.opponent,
    format: setup.format,
    eventName: setup.eventName,
    notes: setup.notes,
  };
}

export function addFrame(
  match: Match,
  partial: { result: FrameResult; keyEvents?: FrameEvent[]; pressure?: FramePressure },
  now = Date.now()
): Match {
  const frame: Frame = {
    id: uid("fr", now),
    matchId: match.id,
    frameNumber: match.frames.length + 1,
    result: partial.result,
    pressure: partial.pressure ?? "normal",
    keyEvents: partial.keyEvents ?? [],
    ts: now,
  };
  return { ...match, frames: [...match.frames, frame] };
}

export function editFrame(
  match: Match,
  frameId: string,
  updates: Partial<Pick<Frame, "result" | "keyEvents" | "pressure" | "frameLossReason">>
): Match {
  return {
    ...match,
    frames: match.frames.map(f => f.id === frameId ? { ...f, ...updates } : f),
  };
}

/** Remove a frame and renumber the remaining ones. */
export function deleteFrameFromMatch(match: Match, frameId: string): Match {
  const remaining = match.frames.filter(f => f.id !== frameId);
  return { ...match, frames: remaining.map((f, i) => ({ ...f, frameNumber: i + 1 })) };
}

export function completeMatch(match: Match, now = Date.now()): Match {
  return { ...match, completedAt: now };
}

export function deleteMatch(matches: Match[], matchId: string): Match[] {
  return matches.filter(m => m.id !== matchId);
}

// ─── Scoring helpers ──────────────────────────────────────────────────────────

export function frameScore(match: Match): { player: number; opponent: number } {
  return {
    player:   match.frames.filter(f => f.result === "won").length,
    opponent: match.frames.filter(f => f.result === "lost").length,
  };
}

export function impactScore(impact: FrameImpact): number {
  return MATCH_CONFIG.impact[impact];
}

// ─── Match evidence / priority boost ──────────────────────────────────────────

/**
 * Compute the decayed evidence score for a given skill from a set of FrameEvents.
 * Decision skills respect the optional ruleset filter; execution skills do not.
 */
export function decayMatchEventScore(
  events: FrameEvent[],
  skillId: SkillId,
  now: number,
  ruleset?: RuleSetId
): number {
  const isDecision = SKILL_MAP[skillId]?.type === "decision";
  const relevant = events.filter(e => {
    if (e.skillId !== skillId) return false;
    // Decision skills: filter to this ruleset's events when a ruleset is specified
    if (isDecision && ruleset) return e.ruleset === ruleset;
    // Execution skills: all match events contribute regardless of ruleset
    return true;
  });
  if (!relevant.length) return 0;
  const halfLife = MATCH_CONFIG.halfLifeMs;
  let score = 0;
  for (const ev of relevant) {
    const age = Math.max(0, now - ev.ts);
    const recency = Math.pow(0.5, age / halfLife);
    score += MATCH_CONFIG.impact[ev.impact] * recency;
  }
  return score;
}

/**
 * Compute the net priority boost for a skill from all match data.
 * Error evidence raises the boost; positive evidence partially discounts it.
 * Execution skills aggregate across rulesets; decision skills can be filtered.
 */
export function computeMatchPriorityBoost(
  matches: Match[],
  skillId: SkillId,
  now: number,
  ruleset?: RuleSetId
): number {
  const allEvents = matches.flatMap(m => m.frames.flatMap(f => f.keyEvents));
  const errorEvents    = allEvents.filter(e => e.type === "error");
  const positiveEvents = allEvents.filter(e => e.type === "positive");
  const errorScore    = decayMatchEventScore(errorEvents,    skillId, now, ruleset);
  const positiveScore = decayMatchEventScore(positiveEvents, skillId, now, ruleset);
  return Math.max(0, errorScore - positiveScore * MATCH_CONFIG.positiveDiscountFactor);
}

/** Compute the net boost for every skill. Useful for summary display. */
export function recomputeMatchPrioritySignals(
  matches: Match[],
  now = Date.now()
): Partial<Record<SkillId, number>> {
  return Object.fromEntries(
    SKILLS.map(s => [s.id, computeMatchPriorityBoost(matches, s.id as SkillId, now)])
  ) as Partial<Record<SkillId, number>>;
}

// ─── Match-aware limiting factor ──────────────────────────────────────────────

/**
 * Augments the training-derived limiting factor evidence with match-impact boosts.
 * Skill ratings are NOT modified — match evidence only shifts priority rankings.
 * One poor match cannot collapse a stable profile; repeated decisive errors can change the focus.
 */
export function matchAwareLimitingFactor(
  profile: Profile,
  matches: Match[],
  now = Date.now()
): LimitingFactors {
  const ruleset: RuleSetId | undefined =
    profile.preferredRulesMode !== "mixed" ? profile.ruleset : undefined;

  const augmented = SKILLS
    .map(s => {
      const base = evidenceForSkill(profile, s.id as SkillId, now);
      const boost = computeMatchPriorityBoost(matches, s.id as SkillId, now, ruleset);
      const matchContribution = boost * MATCH_CONFIG.matchWeightInLF;
      const augScore = Math.min(1, base.score + matchContribution);

      // A skill qualifies for LF status if training evidence qualifies it
      // OR if match evidence is significant (repeated high-impact errors).
      const qualifiedByMatch = boost >= MATCH_CONFIG.qualifyingBoostThreshold;
      const baseQualifies = base.status !== "none";

      let status: LimitingFactor["status"];
      if (!baseQualifies && !qualifiedByMatch) {
        status = "none";
      } else if (augScore >= CONFIG.evidence.confirmedThreshold) {
        status = "confirmed";
      } else if (augScore >= CONFIG.evidence.provisionalThreshold) {
        status = "provisional";
      } else if (qualifiedByMatch) {
        // Significant match evidence qualifies even if below normal provisional threshold
        status = "provisional";
      } else {
        status = "none";
      }

      return { ...base, score: augScore, status } as LimitingFactor & { status: LimitingFactor["status"] };
    })
    .filter(s => s.status !== "none")
    .sort((a, b) => b.score - a.score);

  if (augmented.length === 0) return { primary: null, secondary: null, status: "insufficient" };
  return {
    primary: augmented[0],
    secondary: augmented[1] ?? null,
    status: augmented[0].status === "none" ? "insufficient" : augmented[0].status,
  };
}

// ─── Match-aware mixed ruleset allocation ─────────────────────────────────────

/**
 * Aggregate decayed match evidence for decision skills under a specific ruleset.
 * Used to determine how much rules-sensitive match trouble exists per ruleset.
 * Higher score → more errors in that ruleset's decision play → more training for it.
 */
export function computeRulesetMatchBoost(matches: Match[], ruleset: RuleSetId, now: number): number {
  const decisionSkillIds = SKILLS.filter(s => s.type === "decision").map(s => s.id as SkillId);
  return decisionSkillIds.reduce(
    (sum, skillId) => sum + computeMatchPriorityBoost(matches, skillId, now, ruleset),
    0
  );
}

/**
 * Compute a match-aware mixed-ruleset split by blending the training-derived split
 * with ruleset-specific match error evidence.
 *
 * - No match data → returns training-only split unchanged.
 * - More errors in a ruleset → more training allocated to address that weakness.
 * - Impact and recency are respected via computeMatchPriorityBoost's decay weighting.
 * - Minimum floor (CONFIG.mixed.minRulesetFloor) is always preserved for both rulesets.
 */
export function matchAwareMixedSplit(
  profile: Profile,
  matches: Match[],
  now = Date.now()
): { blackball: number; international: number } {
  const training = mixedRulesetSplit(profile, now);
  const bbBoost  = computeRulesetMatchBoost(matches, "blackball",     now);
  const intBoost = computeRulesetMatchBoost(matches, "international", now);
  const totalBoost = bbBoost + intBoost;

  // No meaningful match evidence → training split unchanged
  if (totalBoost < 0.05) return training;

  // Normalise match error fractions (more errors → more allocation for that ruleset)
  const matchBbFrac  = bbBoost  / totalBoost;
  const matchIntFrac = intBoost / totalBoost;

  // Scale influence by evidence volume: each unit of boost adds ~12% influence, capped at 30%
  const influence = Math.min(0.30, totalBoost * 0.12);

  let bb  = training.blackball     * (1 - influence) + matchBbFrac  * influence;
  let int = training.international * (1 - influence) + matchIntFrac * influence;

  // Apply floor and normalise so fractions sum to 1
  const floor = CONFIG.mixed.minRulesetFloor;
  bb  = Math.max(floor, Math.min(1 - floor, bb));
  int = 1 - bb;

  return { blackball: bb, international: int };
}

// ─── Match-aware session generation ──────────────────────────────────────────

/**
 * Thin orchestration layer that feeds match evidence into generateSession.
 * This is the primary integration point between match data and training content.
 *
 * Flow: Match records
 *   → matchAwareLimitingFactor  (which skill to focus on)
 *   → matchAwareMixedSplit      (how to split BB/INT decision content in mixed mode)
 *   → generateSession(profile, minutes, { lfOverride, splitOverride })
 *   → adaptive training session
 */
export function generateAdaptiveSession(
  profile: Profile,
  matches: Match[],
  minutes: number
): GeneratedSession {
  const now = Date.now();
  const lf = matchAwareLimitingFactor(profile, matches, now);
  const splitOverride = profile.preferredRulesMode === "mixed"
    ? matchAwareMixedSplit(profile, matches, now)
    : undefined;
  return generateSession(profile, minutes, { lfOverride: lf, splitOverride });
}

// ─── Match summary ────────────────────────────────────────────────────────────

export function buildMatchSummary(
  match: Match,
  profile: Profile,
  lf: LimitingFactors,
  now = Date.now()
): MatchSummary {
  const score = frameScore(match);
  const won  = score.player > score.opponent;
  const tied = score.player === score.opponent;

  const errorEvents    = match.frames.flatMap(f => f.keyEvents.filter(e => e.type === "error"));
  const positiveEvents = match.frames.flatMap(f => f.keyEvents.filter(e => e.type === "positive"));

  // Group errors by skillId (or category for nulls)
  const weaknessMap = new Map<string, { count: number; label: string; impactSum: number; skillId: SkillId | null }>();
  for (const ev of errorEvents) {
    const key = ev.skillId ?? `cat:${ev.category}`;
    const label = FRAME_LOSS_CATEGORIES.find(c => c.key === ev.category)?.label ?? ev.category;
    const existing = weaknessMap.get(key);
    if (existing) {
      existing.count++;
      existing.impactSum += impactScore(ev.impact);
    } else {
      weaknessMap.set(key, { count: 1, label, impactSum: impactScore(ev.impact), skillId: ev.skillId });
    }
  }

  const matchWeaknesses: MatchWeakness[] = Array.from(weaknessMap.values())
    .sort((a, b) => (b.impactSum / b.count) - (a.impactSum / a.count))
    .slice(0, 4)
    .map(w => {
      const avg = w.impactSum / w.count;
      const avgImpact: FrameImpact =
        avg >= 0.9 ? "decisive" :
        avg >= 0.65 ? "high" :
        avg >= 0.35 ? "medium" : "low";
      return { skillId: w.skillId, label: w.label, count: w.count, avgImpact };
    });

  const todayStrengths: SkillId[] = positiveEvents
    .map(e => e.skillId)
    .filter((id): id is SkillId => id !== null)
    .filter((id, idx, arr) => arr.indexOf(id) === idx);

  const trainingFocus: SkillId[] =
    [lf.primary?.id, lf.secondary?.id].filter((id): id is SkillId => id != null);

  const lfChange = lf.primary
    ? `Match data points to ${SKILL_MAP[lf.primary.id].name} as your priority focus.`
    : "No single clear focus yet — keep building the picture.";

  // Narrative
  const resultWord = won ? "won" : tied ? "drew" : "lost";
  const topWeakness = matchWeaknesses[0];
  let matchNarrative = `You ${resultWord} ${score.player}–${score.opponent}.`;
  if (topWeakness && !won) {
    matchNarrative += ` ${topWeakness.label} was the biggest issue today`;
    if (topWeakness.count > 1) matchNarrative += ` (${topWeakness.count} times)`;
    matchNarrative += ".";
  } else if (won && todayStrengths.length > 0) {
    matchNarrative += ` Your ${SKILL_MAP[todayStrengths[0]].name.toLowerCase()} was strong.`;
  }
  if (lf.primary) {
    matchNarrative += ` Your next training session focuses on ${SKILL_MAP[lf.primary.id].name.toLowerCase()}.`;
  }

  // Match-vs-training note: high training rating but repeated match errors
  let matchVsTrainingNote: string | undefined;
  if (topWeakness?.skillId) {
    const trainingRating = profile.skills[topWeakness.skillId].rating;
    if (trainingRating >= 55 && topWeakness.count >= 2) {
      matchVsTrainingNote =
        `Your ${SKILL_MAP[topWeakness.skillId].name.toLowerCase()} rates well in training ` +
        `(${Math.round(trainingRating)}/100) but caused issues in today's match. ` +
        `Match conditions often reveal gaps that practice doesn't.`;
    }
  }

  void now; // consumed by uid; keep parameter for API consistency

  return {
    matchId: match.id,
    playerFrames: score.player,
    opponentFrames: score.opponent,
    matchNarrative,
    matchWeaknesses,
    todayStrengths,
    lfChange,
    trainingFocus,
    matchVsTrainingNote,
  };
}
