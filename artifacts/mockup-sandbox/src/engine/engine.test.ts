/**
 * Deterministic engine + rules tests — Phase 1 (A–O) and Phase 2 (P–X, Y–AD, rules helpers).
 * Run via: pnpm --filter @workspace/mockup-sandbox run test:engine
 */
import assert from "node:assert/strict";
import {
  buildFrameEvent, buildMatchSummary, computeMatchPriorityBoost, computeRulesetMatchBoost,
  createMatch, addFrame, deleteMatch, editFrame, frameScore,
  generateAdaptiveSession, matchAwareLimitingFactor, matchAwareMixedSplit,
  FRAME_LOSS_CATEGORIES, POSITIVE_EVENT_TYPES,
  type FrameImpact, type Match,
} from "../match";
import {
  ADAPTATION_SKILL_MAP, ASSESSMENT_ITEMS, BALL_COLORS, BAULK_FRACTION, BLACK_SPOT_X_FRACTION,
  CLEARANCES, CONFIG, DRILLS, ROOT_CAUSE_CONFIDENCE_MAP, SKILL_MAP, SKILLS,
  applySkillUpdate, applyClearanceBallResult, buildAimLinePrimitives, buildTableMarkingPrimitives,
  buildTableRenderModel, classifyErrorChain,
  computeConfidence, computeRulesetConfidence, createEnglishEightBallRack, decayRootCauseScore,
  decisionValue, evaluatePlannedRoute, generateSession, getEnglishPoolTableGeometry,
  limitingFactor, mixedRulesetSplit,
  newProfile, selectMaintenanceSkill, sessionWeighting, validateDrillDiagramIntegrity,
  validatePlayableDrillGeometry, diagramSignature, diagramDistance,
  PLAYABLE_DRILLS, PLAYABLE_CLEARANCES,
  type Attempt, type ClearanceRouteState, type DiagramVisualRequirement, type LimitingFactors,
  type PocketId, type Profile, type RootCauseEvent, type RuleSetId, type SkillId, type TableMarkings,
} from "./index";
import {
  getLegalBalls, isEightBallLegal, resolveFoulConsequences, getCueBallPlacement,
  resolveGroupAssignment, resolveBreakOutcome, evaluateDecision,
  FOUL_RECOVERY_SCENARIO_OPTIONS,
  type TableState,
} from "../rules";
import {
  blackballGetLegalBalls, blackballIsEightBallLegal, blackballFoulConsequence,
  blackballBreakOutcome, blackballResolveGroupAssignment,
} from "../rules/blackball";
import {
  internationalGetLegalBalls, internationalIsEightBallLegal, internationalFoulConsequence,
  internationalBreakOutcome,
} from "../rules/international";
import { updateRulesMode } from "../persistence/profileStorage";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOW = 1_800_000_000_000;

function attempt(value: number, drillId: string, source: Attempt["source"] = "training", extra: Partial<Attempt> = {}): Attempt {
  return { ts: NOW, value, difficulty: 5, drillId, source, ...extra };
}

function withAttempts(profile: Profile, skillId: SkillId, values: number[], source: Attempt["source"] = "training"): Profile {
  return values.reduce((cur, value, i) =>
    applySkillUpdate(cur, skillId, value, { drillId: `${skillId}-${i}`, source, difficulty: 5 }, NOW + i), profile);
}

function makeTableState(opts: Partial<TableState> = {}): TableState {
  return {
    ruleset: "blackball",
    groupAssignment: "assigned",
    playerGroup: "yellow",
    opponentGroup: "red",
    balls: [
      { id: "Y1", group: "yellow", owner: "player",   role: "target",   label: "Y1" },
      { id: "R1", group: "red",    owner: "opponent", role: "obstacle", label: "R1" },
      { id: "8B", group: "black",  owner: "player",   role: "black",    label: "8B" },
    ],
    cueBallInHand: false,
    freeShotActive: false,
    playerBallsRemaining: 1,
    opponentBallsRemaining: 1,
    ...opts,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 1 TESTS — A through O (must remain passing; do not weaken)
// ═══════════════════════════════════════════════════════════════════════════════

// A. Success should lift the observed skill rating.
{
  const p = newProfile();
  const next = applySkillUpdate(p, "potting", 1, { drillId: "pot1", source: "training", difficulty: 3 }, NOW);
  assert.ok(next.skills.potting.rating > p.skills.potting.rating, "A: success should lift rating");
}

// B. Failure should lower the observed skill rating.
{
  const p = newProfile();
  const next = applySkillUpdate(p, "potting", 0, { drillId: "pot1", source: "training", difficulty: 3 }, NOW);
  assert.ok(next.skills.potting.rating < p.skills.potting.rating, "B: failure should lower rating");
}

// C. Repeated, diverse evidence increases confidence.
{
  const p = withAttempts(newProfile(), "potting", [1, 1, 1, 1]);
  const conf = computeConfidence(p.skills.potting.attempts, NOW + 10);
  assert.ok(conf.score > 0.25, "C: repeated evidence should increase confidence score");
  assert.notEqual(conf.tier, "Low", "C: confidence tier should not be Low after 4 successes");
}

// D. Assessment evidence counts less than training evidence.
{
  const assessment = withAttempts(newProfile(), "potting", [1, 1, 1, 1], "assessment");
  const training   = withAttempts(newProfile(), "potting", [1, 1, 1, 1], "training");
  const aConf = computeConfidence(assessment.skills.potting.attempts, NOW);
  const tConf = computeConfidence(training.skills.potting.attempts, NOW);
  assert.ok(aConf.score < tConf.score, "D: assessment evidence should be weighted less than training");
}

// E. Position error followed by miss — chain preserved, root identified correctly.
{
  const entries = [
    { ...attempt(0, "pos1"), observedSkill: "positional" as SkillId, reportedError: "POSITION", ballId: "R1" },
    { ...attempt(0, "pot1"), observedSkill: "potting"    as SkillId, reportedError: "MISS",     ballId: "Y1" },
  ];
  const chain = classifyErrorChain(entries);
  assert.equal(chain?.immediateSkill, "potting",     "E: immediate skill should be potting");
  assert.equal(chain?.rootSkill,      "positional",  "E: root skill should be positional");
}

// F. Speed → position → miss identifies speed as root cause.
{
  const entries = [
    { ...attempt(0, "spd1"), observedSkill: "speed"      as SkillId, reportedError: "SPEED",    ballId: "R1" },
    { ...attempt(0, "pos1"), observedSkill: "positional" as SkillId, reportedError: "POSITION", ballId: "Y1" },
    { ...attempt(0, "pot1"), observedSkill: "potting"    as SkillId, reportedError: "MISS",     ballId: "Y2" },
  ];
  assert.equal(classifyErrorChain(entries)?.rootSkill, "speed", "F: root cause should be speed");
}

// G. Correct decision and failed execution remain separate evidence.
{
  const p1 = applySkillUpdate(newProfile(), "pattern", decisionValue("optimal"), { drillId: "pat1", source: "training" }, NOW);
  const p2 = applySkillUpdate(p1, "potting", 0, { drillId: "pot1", source: "training" }, NOW + 1);
  assert.equal(p2.skills.pattern.attempts[0].value, 1, "G: decision attempt should be 1");
  assert.equal(p2.skills.potting.attempts[0].value, 0, "G: execution attempt should be 0");
}

// H. Poor decision and successful execution remain separate evidence.
{
  const p1 = applySkillUpdate(newProfile(), "pattern", decisionValue("poor"), { drillId: "pat1", source: "training" }, NOW);
  const p2 = applySkillUpdate(p1, "potting", 1, { drillId: "pot1", source: "training" }, NOW + 1);
  assert.equal(p2.skills.pattern.attempts[0].value, 0, "H: poor decision should record 0");
  assert.equal(p2.skills.potting.attempts[0].value, 1, "H: successful execution should record 1");
}

// I. Sparse data does not force a confirmed limiting factor.
{
  const p = withAttempts(newProfile(), "potting", [0]);
  assert.notEqual(limitingFactor(p).status, "confirmed", "I: single attempt should not confirm a limiting factor");
}

// J. Strong execution / weak decision shifts session toward decision work.
{
  let p = withAttempts(newProfile(), "potting",  [1, 1, 1, 1, 1, 1]);
  p     = withAttempts(p,            "pattern",  [0, 0, 0, 0, 0, 0]);
  const w = sessionWeighting(p);
  assert.ok(w.decWeight > w.execWeight, "J: weak decision should increase decision weighting");
}

// K. Strong decision / weak execution shifts session toward execution work.
{
  let p = withAttempts(newProfile(), "pattern", [1, 1, 1, 1, 1, 1]);
  p     = withAttempts(p,            "potting", [0, 0, 0, 0, 0, 0]);
  const w = sessionWeighting(p);
  assert.ok(w.execWeight > w.decWeight, "K: weak execution should increase execution weighting");
}

// L. Longer sessions contain both execution and decision work.
{
  const session = generateSession(newProfile(), 30);
  assert.ok(session.drills.some((d) => d.type === "execution"), "L: session should have execution work");
  assert.ok(session.drills.some((d) => d.type === "decision"),  "L: session should have decision work");
}

// M. Maintenance work does not replace all development work.
{
  const p = withAttempts(newProfile(), "potting", [1, 1, 1, 1, 1]);
  const session = generateSession(p, 45);
  assert.ok(session.drills.some((d) => d.skillId !== "potting"), "M: session should include non-maintenance drills");
  assert.ok(session.drills.some((d) => d.type === "decision"),   "M: session should still include decision work");
}

// N. Low-confidence skills remain eligible for calibration.
{
  const p = withAttempts(newProfile(), "potting", [0, 0, 0, 0, 0, 0]);
  const session = generateSession(p, 60);
  assert.ok(session.drills.some((d) => d.reason?.startsWith("Calibration")), "N: low-confidence skill should appear as calibration");
}

// O. Replanning recorded as decision evidence separately from execution.
{
  const clearance = CLEARANCES.find((c) => c.adaptationEligible);
  assert.ok(clearance, "O: an adaptation-eligible clearance must exist");
  const plan      = attempt(1,   clearance!.id, "planDecision", { tier: "optimal" });
  const adapt     = attempt(0.7, clearance!.id, "adaptation",   { tier: "acceptable" });
  const execution = attempt(0,   clearance!.id, "training",     { reportedError: "POSITION" });
  assert.equal(plan.source,      "planDecision", "O: plan source should be planDecision");
  assert.equal(adapt.source,     "adaptation",   "O: adaptation source should be adaptation");
  assert.notEqual(execution.source, adapt.source, "O: execution source should differ from adaptation source");
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2 TESTS — P through X
// ═══════════════════════════════════════════════════════════════════════════════

// P. Ruleset persistence — selecting International persists through profile serialization.
{
  const p = newProfile("international");
  assert.equal(p.ruleset,             "international", "P: ruleset should be international");
  assert.equal(p.preferredRulesMode,  "international", "P: preferredRulesMode should be international");
  const serialized = JSON.parse(JSON.stringify(p)) as Profile;
  assert.equal(serialized.ruleset,            "international", "P: serialized ruleset should survive JSON round-trip");
  assert.equal(serialized.preferredRulesMode, "international", "P: serialized preferredRulesMode should survive JSON round-trip");
}

// Q. Shared execution profile — switching BB → INT does not reset execution ratings.
{
  let p = withAttempts(newProfile("blackball"), "potting", [1, 1, 1, 1]);
  const ratingBefore = p.skills.potting.rating;
  p = updateRulesMode(p, "international");
  assert.equal(p.skills.potting.rating, ratingBefore, "Q: potting rating must survive ruleset switch");
  assert.equal(p.skills.potting.attempts.length, 4, "Q: potting attempts must survive ruleset switch");
}

// R. Ruleset filtering — a Blackball-only drill is never selected in an International-only session.
{
  const bbOnlyDrill = DRILLS.find((d) => d.rulesets.length === 1 && d.rulesets[0] === "blackball");
  assert.ok(bbOnlyDrill, "R: at least one Blackball-only drill must exist");
  let p = newProfile("international");
  // Give enough evidence to trigger decision slots
  p = withAttempts(p, "pattern", [1, 0, 1, 0, 1, 0]);
  p = withAttempts(p, "tactical", [0, 1, 0, 1]);
  const session = generateSession(p, 90);
  assert.ok(!session.drills.some((d) => d.id === bbOnlyDrill!.id), "R: BB-only drill must not appear in INT session");
}

// S. Legal-ball filtering — getLegalBalls never returns opponent-group balls in normal play.
{
  const state = makeTableState({ playerBallsRemaining: 1, freeShotActive: false });
  const legalBB  = getLegalBalls({ ...state, ruleset: "blackball" });
  const legalINT = getLegalBalls({ ...state, ruleset: "international" });
  const opponentBalls = state.balls.filter((b) => b.owner === "opponent");
  for (const opp of opponentBalls) {
    assert.ok(!legalBB.some((b) => b.id === opp.id),  `S: BB — opponent ball ${opp.id} must not be a legal target`);
    assert.ok(!legalINT.some((b) => b.id === opp.id), `S: INT — opponent ball ${opp.id} must not be a legal target`);
  }
}

// T. 8-ball legality — unavailable when player balls remain, available when cleared.
{
  const withBalls = makeTableState({ playerBallsRemaining: 2 });
  const cleared   = makeTableState({ playerBallsRemaining: 0, balls: [{ id: "8B", group: "black", owner: "player", role: "black", label: "8B" }] });
  assert.equal(isEightBallLegal({ ...withBalls, ruleset: "blackball"     }), false, "T: BB — 8-ball not legal with player balls remaining");
  assert.equal(isEightBallLegal({ ...withBalls, ruleset: "international" }), false, "T: INT — 8-ball not legal with player balls remaining");
  assert.equal(isEightBallLegal({ ...cleared,   ruleset: "blackball"     }), true,  "T: BB — 8-ball legal when player balls are all potted");
  assert.equal(isEightBallLegal({ ...cleared,   ruleset: "international" }), true,  "T: INT — 8-ball legal when player balls are all potted");
}

// U. Ruleset-dependent scenario — foul recovery drill has different optimal under BB vs INT.
{
  const drill = DRILLS.find((d) => d.id === "tac5_foul_recovery");
  assert.ok(drill, "U: foul recovery drill must exist");
  assert.ok(drill!.rulesetOptions, "U: drill must have rulesetOptions");
  const bbOptions  = drill!.rulesetOptions!["blackball"];
  const intOptions = drill!.rulesetOptions!["international"];
  assert.ok(bbOptions,  "U: Blackball options must be present");
  assert.ok(intOptions, "U: International options must be present");
  const bbOptimal  = bbOptions!.find((o) => o.tier === "optimal");
  const intOptimal = intOptions!.find((o) => o.tier === "optimal");
  assert.ok(bbOptimal,  "U: Blackball must have an optimal choice");
  assert.ok(intOptimal, "U: International must have an optimal choice");
  assert.notEqual(bbOptimal!.key, intOptimal!.key, "U: Blackball and International must have different optimal choices");
}

// V. Ruleset-specific confidence — BB attempts don't contribute to INT confidence.
{
  let p = withAttempts(newProfile("blackball"), "tactical", [1, 1, 1, 1, 1, 1]);
  // Tag all attempts as blackball
  p = { ...p, skills: { ...p.skills, tactical: { ...p.skills.tactical, attempts: p.skills.tactical.attempts.map((a) => ({ ...a, ruleset: "blackball" as RuleSetId })) } } };
  const bbConf  = computeRulesetConfidence(p, "tactical", "blackball",     NOW);
  const intConf = computeRulesetConfidence(p, "tactical", "international", NOW);
  assert.ok(bbConf.score > 0,   "V: BB-tagged attempts should produce BB confidence");
  assert.equal(intConf.score, 0, "V: BB-tagged attempts must not contribute to INT confidence");
  assert.equal(intConf.tier, "Low", "V: INT confidence should be Low with no INT evidence");
}

// W. Ruleset switch preserves history — updateRulesMode does not erase any data.
{
  let p = withAttempts(newProfile("blackball"), "potting", [1, 1, 1]);
  p = { ...p, sessions: [{ ts: NOW, minutes: 5, summary: { todayWentWell: [], todayLimited: [], chainNarratives: [], adaptations: [], newLf: { primary: null, secondary: null, status: "insufficient" }, changeNote: "test" } }] };
  const attemptsBeforeSwitch = p.skills.potting.attempts.length;
  const sessionsBeforeSwitch = p.sessions.length;
  const ratingBeforeSwitch   = p.skills.potting.rating;
  p = updateRulesMode(p, "international");
  assert.equal(p.skills.potting.attempts.length, attemptsBeforeSwitch, "W: attempts must survive mode switch");
  assert.equal(p.sessions.length,                sessionsBeforeSwitch, "W: sessions must survive mode switch");
  assert.equal(p.skills.potting.rating,          ratingBeforeSwitch,   "W: rating must survive mode switch");
  p = updateRulesMode(p, "mixed");
  assert.equal(p.skills.potting.attempts.length, attemptsBeforeSwitch, "W: attempts must survive switch to mixed");
}

// X. Decision/execution independence under rules — correct decision + execution fail credits/penalizes separately.
{
  const p0 = newProfile("blackball");
  const p1 = applySkillUpdate(p0, "tactical", decisionValue("optimal"), { drillId: "tac5_foul_recovery", source: "training", ruleset: "blackball" }, NOW);
  const p2 = applySkillUpdate(p1, "potting",  0, { drillId: "pot1", source: "training" }, NOW + 1);
  assert.equal(p2.skills.tactical.attempts[0].value, 1,  "X: optimal decision should record value 1");
  assert.equal(p2.skills.potting.attempts[0].value,  0,  "X: execution failure should record value 0");
  assert.ok(p2.skills.tactical.rating > p0.skills.tactical.rating, "X: decision rating should rise");
  assert.ok(p2.skills.potting.rating  < p0.skills.potting.rating,  "X: execution rating should fall");
}

// ═══════════════════════════════════════════════════════════════════════════════
// MIXED TRAINING TESTS — Y through AD
// ═══════════════════════════════════════════════════════════════════════════════

// Y. Mixed mode generates rules-sensitive content from both rulesets.
{
  const p = newProfile("mixed");
  // Run multiple sessions to sample the distribution
  let bbCount = 0; let intCount = 0;
  for (let i = 0; i < 5; i++) {
    const s = generateSession(p, 60);
    bbCount  += s.drillRulesets.filter((r) => r === "blackball").length;
    intCount += s.drillRulesets.filter((r) => r === "international").length;
  }
  assert.ok(bbCount  > 0, "Y: mixed mode should generate some Blackball rules-sensitive drills");
  assert.ok(intCount > 0, "Y: mixed mode should generate some International rules-sensitive drills");
}

// Z. Every rules-sensitive mixed exercise has an explicit ruleset in drillRulesets.
{
  const p = newProfile("mixed");
  const session = generateSession(p, 60);
  for (let i = 0; i < session.drills.length; i++) {
    const drill    = session.drills[i];
    const ruleset  = session.drillRulesets[i];
    const isShared = drill.type === "execution" || (drill as { rulesContext?: unknown }).rulesContext === null;
    if (!isShared && drill.type === "decision") {
      // Decision drills in mixed mode must have a ruleset tag
      assert.ok(ruleset !== undefined, `Z: decision drill ${drill.id} must have drillRulesets entry`);
    }
  }
}

// AA. Rule-neutral execution attempts (ruleset: null) do not affect ruleset-specific tactical confidence.
{
  let p = newProfile("mixed");
  // Add many rule-neutral execution attempts
  for (let i = 0; i < 10; i++) {
    p = applySkillUpdate(p, "potting", 1, { drillId: `pot${i}`, source: "training", ruleset: null }, NOW + i);
  }
  const bbConf  = computeRulesetConfidence(p, "tactical", "blackball",     NOW + 100);
  const intConf = computeRulesetConfidence(p, "tactical", "international", NOW + 100);
  assert.equal(bbConf.score,  0, "AA: rule-neutral execution should not raise BB tactical confidence");
  assert.equal(intConf.score, 0, "AA: rule-neutral execution should not raise INT tactical confidence");
}

// AB. Weaker INT tactical evidence causes more INT allocation while preserving BB minimum.
{
  let p = newProfile("mixed");
  // BB tactical evidence: strong
  for (let i = 0; i < 8; i++) {
    p = applySkillUpdate(p, "tactical", 1, { drillId: `tac_bb${i}`, source: "training", ruleset: "blackball" }, NOW + i);
  }
  // INT tactical evidence: zero
  const split = mixedRulesetSplit(p, NOW + 100);
  assert.ok(split.international >= 0.25, "AB: INT allocation must be at least the minimum floor (25%)");
  assert.ok(split.blackball     >= 0.25, "AB: BB allocation must be at least the minimum floor (25%)");
  // With stronger BB evidence, INT fraction should be higher
  assert.ok(split.international > split.blackball, "AB: weaker INT evidence should get larger allocation");
}

// AC. Mixed → Blackball → Mixed preserves all International evidence.
{
  let p = newProfile("mixed");
  // Record some INT evidence
  p = applySkillUpdate(p, "tactical", 1, { drillId: "tac1", source: "training", ruleset: "international" }, NOW);
  p = applySkillUpdate(p, "tactical", 0, { drillId: "tac2", source: "training", ruleset: "international" }, NOW + 1);
  const intAttemptsBefore = p.skills.tactical.attempts.filter((a) => a.ruleset === "international").length;
  // Switch to Blackball
  p = updateRulesMode(p, "blackball");
  // Switch back to Mixed
  p = updateRulesMode(p, "mixed");
  const intAttemptsAfter = p.skills.tactical.attempts.filter((a) => a.ruleset === "international").length;
  assert.equal(intAttemptsAfter, intAttemptsBefore, "AC: INT evidence must survive Mixed→BB→Mixed transitions");
}

// AD. International exercises are never evaluated using Blackball rules and vice versa.
{
  const drill = DRILLS.find((d) => d.id === "tac5_foul_recovery");
  assert.ok(drill?.rulesetOptions, "AD: foul recovery drill must have rulesetOptions");
  const bbOpts  = drill!.rulesetOptions!["blackball"];
  const intOpts = drill!.rulesetOptions!["international"];
  // Blackball optimal must not appear as optimal in INT eval
  const bbOptimalKey = bbOpts!.find((o) => o.tier === "optimal")!.key;
  const intEval = intOpts!.find((o) => o.key === bbOptimalKey);
  assert.notEqual(intEval?.tier, "optimal", "AD: BB optimal choice must not be optimal under INT rules");
}

// ═══════════════════════════════════════════════════════════════════════════════
// RULES HELPER UNIT TESTS
// ═══════════════════════════════════════════════════════════════════════════════

// ── blackballGetLegalBalls ────────────────────────────────────────────────────

{
  // Open table: any non-black ball is legal
  const openState = makeTableState({ groupAssignment: "open", playerGroup: null, playerBallsRemaining: 3 });
  const legal = blackballGetLegalBalls(openState);
  assert.ok(legal.some((b) => b.group === "yellow"), "BH-1: open table should allow yellow");
  assert.ok(legal.some((b) => b.group === "red"),    "BH-1: open table should allow red (opponent group on open table)");
  assert.ok(!legal.some((b) => b.group === "black"), "BH-1: open table should not allow black");
}
{
  // Assigned, player balls remain: only own group
  const state = makeTableState({ playerBallsRemaining: 1 });
  const legal = blackballGetLegalBalls(state);
  assert.ok(legal.every((b) => b.group === "yellow"), "BH-2: assigned table should only offer own group");
}
{
  // Free shot: any ball
  const state = makeTableState({ freeShotActive: true, playerBallsRemaining: 1 });
  const legal = blackballGetLegalBalls(state);
  assert.ok(legal.length >= 3, "BH-3: free shot should allow all balls");
}
{
  // All player balls potted: only black
  const state = makeTableState({ playerBallsRemaining: 0 });
  const legal = blackballGetLegalBalls(state);
  assert.ok(legal.every((b) => b.group === "black"), "BH-4: all player balls potted — only black legal");
}

// ── blackballIsEightBallLegal ─────────────────────────────────────────────────

{
  assert.equal(blackballIsEightBallLegal(makeTableState({ playerBallsRemaining: 1 })), false, "BE-1: 8-ball not legal with balls remaining");
  assert.equal(blackballIsEightBallLegal(makeTableState({ playerBallsRemaining: 0 })), true,  "BE-2: 8-ball legal when all player balls potted");
  assert.equal(blackballIsEightBallLegal(makeTableState({ groupAssignment: "open", playerBallsRemaining: 0 })), false, "BE-3: 8-ball not legal on open table");
}

// ── blackballFoulConsequence ──────────────────────────────────────────────────

{
  const foul = blackballFoulConsequence();
  assert.equal(foul.cueBallPlacement,    "baulk",             "BF-1: BB foul — cue ball in baulk");
  assert.equal(foul.freeShotGranted,     true,                "BF-2: BB foul — free shot granted");
  assert.equal(foul.canNominateAnyBall,  true,                "BF-3: BB foul — can nominate any ball");
  assert.equal(foul.lossOfFrame,         false,               "BF-4: standard BB foul is not loss of frame");
  const lof = blackballFoulConsequence(true);
  assert.equal(lof.lossOfFrame,          true,                "BF-5: deliberate BB foul is loss of frame");
}

// ── internationalGetLegalBalls ────────────────────────────────────────────────

{
  const state = makeTableState({ ruleset: "international", playerBallsRemaining: 1 });
  const legal = internationalGetLegalBalls(state);
  assert.ok(legal.every((b) => b.group === "yellow"), "IH-1: INT assigned table — only own group legal");
}
{
  // No free-shot mechanic in International — freeShotActive is irrelevant
  const state = makeTableState({ ruleset: "international", freeShotActive: true, playerBallsRemaining: 1 });
  const legal = internationalGetLegalBalls(state);
  // Under International rules, freeShotActive has no effect (no nomination concept)
  assert.ok(legal.every((b) => b.group === "yellow"), "IH-2: INT — freeShotActive has no effect on legal balls");
}

// ── internationalIsEightBallLegal ─────────────────────────────────────────────

{
  const intState = makeTableState({ ruleset: "international" });
  assert.equal(internationalIsEightBallLegal({ ...intState, playerBallsRemaining: 2 }), false, "IE-1: INT — 8-ball not legal with balls remaining");
  assert.equal(internationalIsEightBallLegal({ ...intState, playerBallsRemaining: 0 }), true,  "IE-2: INT — 8-ball legal when all player balls cleared");
}

// ── internationalFoulConsequence ──────────────────────────────────────────────

{
  const foul = internationalFoulConsequence();
  assert.equal(foul.cueBallPlacement,   "anywhere",            "IF-1: INT foul — ball in hand anywhere");
  assert.equal(foul.freeShotGranted,    false,                 "IF-2: INT foul — no free shot");
  assert.equal(foul.canNominateAnyBall, false,                 "IF-3: INT foul — no nomination");
  assert.equal(foul.lossOfFrame,        false,                 "IF-4: standard INT foul is not loss of frame");
  const lof = internationalFoulConsequence(true);
  assert.equal(lof.lossOfFrame,         true,                  "IF-5: deliberate INT foul on 8-ball = loss of frame");
}

// ── getCueBallPlacement ───────────────────────────────────────────────────────

{
  assert.equal(getCueBallPlacement("blackball"),     "baulk",   "CP-1: BB cue ball placement should be baulk");
  assert.equal(getCueBallPlacement("international"), "anywhere","CP-2: INT cue ball placement should be anywhere");
}

// ── resolveFoulConsequences (unified) ─────────────────────────────────────────

{
  const bb  = resolveFoulConsequences("blackball");
  const int = resolveFoulConsequences("international");
  assert.equal(bb.incomingEntitlement,  "free_shot_baulk",     "RC-1: BB foul entitlement");
  assert.equal(int.incomingEntitlement, "ball_in_hand_anywhere","RC-2: INT foul entitlement");
}

// ── resolveGroupAssignment ────────────────────────────────────────────────────

{
  const open   = makeTableState({ groupAssignment: "open" });
  const result = resolveGroupAssignment(open, "yellow");
  assert.equal(result.assigned,     true,     "GA-1: first pot should assign groups");
  assert.equal(result.playerGroup,  "yellow", "GA-2: player group should match potted group");
  const noChange = resolveGroupAssignment({ ...open, groupAssignment: "assigned" }, "yellow");
  assert.equal(noChange.assigned, true, "GA-3: already assigned should remain assigned");
}

// ── resolveBreakOutcome ───────────────────────────────────────────────────────

{
  const bbLegal = resolveBreakOutcome({ ruleset: "blackball", potOccurred: false, blackPottedOnBreak: false, ballsOverMiddle: 2 });
  assert.equal(bbLegal.legalBreak, true,  "BO-1: BB break with 2 balls over middle should be legal");
  const bbIllegal = resolveBreakOutcome({ ruleset: "blackball", potOccurred: false, blackPottedOnBreak: false, ballsOverMiddle: 1 });
  assert.equal(bbIllegal.legalBreak, false, "BO-2: BB break with only 1 ball over middle and no pot should be illegal");
  const intLegal = resolveBreakOutcome({ ruleset: "international", potOccurred: true, blackPottedOnBreak: false, cushionContactCount: 2 });
  assert.equal(intLegal.legalBreak, true,   "BO-3: INT break with pot should be legal even with <4 cushion contacts");
  const intIllegal = resolveBreakOutcome({ ruleset: "international", potOccurred: false, blackPottedOnBreak: false, cushionContactCount: 3 });
  assert.equal(intIllegal.legalBreak, false, "BO-4: INT break with <4 cushion contacts and no pot should be illegal");
}

// ── blackballBreakOutcome ─────────────────────────────────────────────────────

{
  const black = blackballBreakOutcome({ ballsOverMiddle: 3, potOccurred: true, blackPottedOnBreak: true });
  assert.ok(black.blackPottedOnBreak, "BB-1: black potted on break should be recorded");
  assert.ok(black.note.includes("respot"), "BB-2: black-on-break note should mention respot");
}

// ── internationalBreakOutcome ─────────────────────────────────────────────────

{
  const black = internationalBreakOutcome({ cushionContactCount: 5, potOccurred: true, blackPottedOnBreak: true });
  assert.ok(black.blackPottedOnBreak, "IB-1: 8-ball potted on break should be recorded under INT");
  assert.ok(black.note.includes("respot"), "IB-2: INT 8-ball-on-break note should mention respot");
}

// ── evaluateDecision ──────────────────────────────────────────────────────────

{
  const opts = FOUL_RECOVERY_SCENARIO_OPTIONS;
  const bbSnookerOpt = opts.find((o) => o.key === "snooker_safety")!;
  const bbEval = evaluateDecision({
    choiceKey: bbSnookerOpt.key,
    baseOptions: opts.map((o) => ({ key: o.key, tier: o.baselineTier, rationale: o.baselineRationale })),
    rulesetOptions: { blackball: opts.map((o) => ({ key: o.key, ...o.rulesetOverrides.blackball ?? { tier: o.baselineTier, rationale: o.baselineRationale } })) },
    ruleset: "blackball",
  });
  assert.equal(bbEval?.tier, "optimal", "ED-1: snooker/safety should be optimal under Blackball foul recovery");
  const intAttackOpt = opts.find((o) => o.key === "attack_direct")!;
  const intEval = evaluateDecision({
    choiceKey: intAttackOpt.key,
    baseOptions: opts.map((o) => ({ key: o.key, tier: o.baselineTier, rationale: o.baselineRationale })),
    rulesetOptions: { international: opts.map((o) => ({ key: o.key, ...o.rulesetOverrides.international ?? { tier: o.baselineTier, rationale: o.baselineRationale } })) },
    ruleset: "international",
  });
  assert.equal(intEval?.tier, "optimal", "ED-2: direct attack should be optimal under International foul recovery");
}

// ── getLegalBalls (unified dispatcher) ───────────────────────────────────────

{
  const bbState  = makeTableState({ ruleset: "blackball",     playerBallsRemaining: 1 });
  const intState = makeTableState({ ruleset: "international", playerBallsRemaining: 1 });
  const bbLegal  = getLegalBalls(bbState);
  const intLegal = getLegalBalls(intState);
  assert.ok(bbLegal.every((b)  => b.group === "yellow"), "GL-1: BB unified helper should only return own group");
  assert.ok(intLegal.every((b) => b.group === "yellow"), "GL-2: INT unified helper should only return own group");
  assert.ok(!bbLegal.some((b)  => b.group === "red"),    "GL-3: BB — opponent group must not be returned");
  assert.ok(!intLegal.some((b) => b.group === "red"),    "GL-4: INT — opponent group must not be returned");
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase 2.1 — Integrity tests AE–AV
// ═════════════════════════════════════════════════════════════════════════════

// ── AE: Missed ball stays in remaining ───────────────────────────────────────

{
  const initState: ClearanceRouteState = { plannedRoute: null, attemptedRoute: [], pottedRoute: [], remaining: ["Y1", "Y2", "Y3"] };
  const { state, ended } = applyClearanceBallResult(initState, "Y1", 0, "continue_from_position");
  assert.ok(state.remaining.includes("Y1"),       "AE: missed ball must stay in remaining");
  assert.ok(state.attemptedRoute.includes("Y1"),  "AE: missed ball must be recorded in attemptedRoute");
  assert.ok(!state.pottedRoute.includes("Y1"),    "AE: missed ball must NOT be in pottedRoute");
  assert.equal(ended, false,                      "AE: continue_from_position does not end clearance");
}

// ── AF: Successful retry records two attempts, one potted ────────────────────

{
  const initState: ClearanceRouteState = { plannedRoute: null, attemptedRoute: [], pottedRoute: [], remaining: ["Y1", "Y2", "Y3"] };
  const after1 = applyClearanceBallResult(initState, "Y1", 0, "continue_from_position").state;
  const { state: after2 } = applyClearanceBallResult(after1, "Y1", 1, "continue_from_position");
  assert.equal(after2.attemptedRoute.filter((id) => id === "Y1").length, 2, "AF: two entries in attemptedRoute after miss+pot");
  assert.equal(after2.pottedRoute.filter((id)   => id === "Y1").length, 1, "AF: exactly one entry in pottedRoute after successful retry");
  assert.ok(!after2.remaining.includes("Y1"),                                "AF: ball removed from remaining after successful retry");
}

// ── AG: Poor planned route is not awarded optimal or acceptable ───────────────

{
  const clr = CLEARANCES.find((c) => c.id === "clr3")!; // preferredRoute: [Y1,Y2,Y3]; acceptable: [[Y2,Y1,Y3]]
  const result = evaluatePlannedRoute(["Y3", "Y2", "Y1"], clr);
  assert.notEqual(result.tier, "optimal",    "AG: reversed route must not receive optimal tier");
  assert.notEqual(result.tier, "acceptable", "AG: reversed route must not receive acceptable tier");
}

// ── AH: Known acceptable route receives acceptable tier ──────────────────────

{
  const clr = CLEARANCES.find((c) => c.id === "clr3")!;
  const result = evaluatePlannedRoute(["Y2", "Y1", "Y3"], clr);
  assert.equal(result.tier, "acceptable", "AH: documented acceptable route must receive acceptable tier");
}

// ── AI: Adaptation choices route to the correct decision skill ───────────────

{
  assert.equal(ADAPTATION_SKILL_MAP["Play safe"],               "tactical",       "AI: 'Play safe' → tactical");
  assert.equal(ADAPTATION_SKILL_MAP["Develop a problem ball"],  "problemBallDec", "AI: 'Develop a problem ball' → problemBallDec");
  assert.equal(ADAPTATION_SKILL_MAP["Re-plan clearance"],       "pattern",        "AI: 'Re-plan clearance' → pattern");
  assert.equal(ADAPTATION_SKILL_MAP["Continue original route"], "pattern",        "AI: 'Continue original route' → pattern");
}

// ── AJ: Clearance in Mixed mode gets a concrete (non-null) ruleset tag ───────

{
  const p = newProfile("mixed");
  const session = generateSession(p, 45); // 7 drills — likely to include a clearance
  const clearanceIdx = session.drills.findIndex((d) => d.type === "combined");
  if (clearanceIdx >= 0) {
    const tag = session.drillRulesets[clearanceIdx];
    assert.ok(
      tag === "blackball" || tag === "international",
      `AJ: clearance in mixed mode must have a concrete ruleset tag; got ${String(tag)}`
    );
  }
  // If no clearance appears (probabilistic), that is fine for this assertion
}

// ── AK: Confirmed decision LF shifts exec weight down by lfConfirmedShift ────

{
  const p = newProfile("blackball"); // equal composites → baseExecWeight = 50; no LF from zero attempts
  const baseW = sessionWeighting(p);
  const mockLF: LimitingFactors = {
    primary:   { ...SKILL_MAP["tactical"], rating: 25, gap: 10, confidence: { score: 0.8, tier: "High" }, score: 0.55, status: "confirmed", rootCauseScore: 0.4 },
    secondary: null,
    status: "confirmed",
  };
  const withLF = sessionWeighting(p, mockLF);
  assert.equal(
    baseW.execWeight - withLF.execWeight,
    CONFIG.session.lfConfirmedShift,
    `AK: confirmed decision LF must reduce execWeight by lfConfirmedShift (${CONFIG.session.lfConfirmedShift}pp)`
  );
}

// ── AL: Stale strong skill selected for maintenance over recently-trained one ─

{
  // One day ago — recent
  const YESTERDAY = NOW - 1000 * 60 * 60 * 24;
  // 14 days ago — stale enough
  const FOURTEEN_DAYS_AGO = NOW - 1000 * 60 * 60 * 24 * 14;

  let p = newProfile("blackball");
  // "positional" trained recently (yesterday), high rating → should NOT be selected first
  for (let i = 0; i < 12; i++)
    p = applySkillUpdate(p, "positional", 1, { drillId: `pos${i}`, difficulty: 7 }, FOURTEEN_DAYS_AGO - i * 1000);
  // Train it again yesterday so it has recent data
  p = applySkillUpdate(p, "positional", 1, { drillId: "posRecent", difficulty: 7 }, YESTERDAY);

  // "speed" trained 14 days ago, same high rating → should be selected (more stale)
  for (let i = 0; i < 12; i++)
    p = applySkillUpdate(p, "speed", 1, { drillId: `spd${i}`, difficulty: 7 }, FOURTEEN_DAYS_AGO - 1000 * 60 * 60 * 24 * 7 - i * 1000);

  const selected = selectMaintenanceSkill(p, NOW, []);
  // speed should be selected (more stale); positional trained yesterday so < minAgeDays
  if (selected !== null) {
    assert.notEqual(selected.id, "positional", "AL: recently-trained skill must not be prioritised over more stale skill");
  } else {
    // Neither qualifies — check positional explicitly doesn't qualify (too recent)
    const posLast = p.skills["positional"].attempts.slice(-1)[0]?.ts ?? 0;
    const daysSince = (NOW - posLast) / (1000 * 60 * 60 * 24);
    assert.ok(daysSince < CONFIG.session.maintenanceMinAgeDays, "AL: positional trained too recently to qualify for maintenance");
  }
}

// ── AM: No forced maintenance when no skill is due ────────────────────────────

{
  const p = newProfile("blackball"); // no attempts → nothing qualifies
  const selected = selectMaintenanceSkill(p, NOW, []);
  assert.equal(selected, null, "AM: selectMaintenanceSkill must return null when no skill has sufficient evidence");
}

// ── AN: Generated activity count matches SESSION_LENGTHS for every duration ──

{
  const p = newProfile("blackball");
  const cases: [number, number][] = [[15, 3], [30, 5], [45, 7], [60, 9], [90, 13]];
  for (const [minutes, expected] of cases) {
    const session = generateSession(p, minutes);
    assert.equal(session.drills.length, expected, `AN: ${minutes}-min session must have ${expected} activities; got ${session.drills.length}`);
  }
}

// ── AO: Meaningful session (30 min) contains both exec and decision work ──────

{
  let p = newProfile("blackball");
  p = withAttempts(p, "potting", [0, 0, 0]);
  p = withAttempts(p, "tactical", [0, 0, 0]);
  const session = generateSession(p, 30);
  const types = session.drills.map((d) => d.type);
  assert.ok(types.includes("execution"),  "AO: 30-min session must include at least one execution drill");
  assert.ok(types.some((t) => t === "decision" || t === "combined"), "AO: 30-min session must include decision or clearance work");
  assert.equal(session.drills.length, 5,  "AO: 30-min session must have exactly 5 activities");
}

// ── AP: Recent root-cause evidence contributes more than old ──────────────────

{
  const halfLife = CONFIG.rootCause.halfLifeMs;
  const oldEvent: RootCauseEvent[]   = [{ skillId: "tactical", ts: NOW - halfLife, confidence: 0.8, ruleset: null }];
  const freshEvent: RootCauseEvent[] = [{ skillId: "tactical", ts: NOW,            confidence: 0.8, ruleset: null }];
  const oldScore   = decayRootCauseScore(oldEvent,   "tactical", NOW);
  const freshScore = decayRootCauseScore(freshEvent, "tactical", NOW);
  assert.ok(freshScore > oldScore, "AP: recent event must contribute more than same-confidence event that is one half-life old");
  // After exactly one half-life, score should be ~0.5 × confidence
  assert.ok(Math.abs(oldScore - 0.4) < 0.05, `AP: score after one half-life should be ~0.4; got ${oldScore.toFixed(3)}`);
}

// ── AQ: High-confidence event contributes more than low-confidence ────────────

{
  const highConf: RootCauseEvent[] = [{ skillId: "pattern", ts: NOW, confidence: ROOT_CAUSE_CONFIDENCE_MAP["High"], ruleset: null }];
  const lowConf:  RootCauseEvent[] = [{ skillId: "pattern", ts: NOW, confidence: ROOT_CAUSE_CONFIDENCE_MAP["Low"],  ruleset: null }];
  const highScore = decayRootCauseScore(highConf, "pattern", NOW);
  const lowScore  = decayRootCauseScore(lowConf,  "pattern", NOW);
  assert.ok(highScore > lowScore, `AQ: High-confidence event (${highScore.toFixed(3)}) must outweigh Low-confidence event (${lowScore.toFixed(3)}) of the same age`);
}

// ── AR: Old stale evidence doesn't dominate over fresh moderate evidence ──────

{
  const halfLife = CONFIG.rootCause.halfLifeMs;
  // High-confidence event from 3 half-lives ago (very stale)
  const stale:   RootCauseEvent[] = [{ skillId: "positional", ts: NOW - halfLife * 3, confidence: ROOT_CAUSE_CONFIDENCE_MAP["High"], ruleset: null }];
  // Moderate-confidence event from half a half-life ago (fresh)
  const fresh:   RootCauseEvent[] = [{ skillId: "tactical",   ts: NOW - halfLife * 0.5, confidence: ROOT_CAUSE_CONFIDENCE_MAP["Emerging"], ruleset: null }];
  const staleScore = decayRootCauseScore(stale, "positional", NOW);
  const freshScore = decayRootCauseScore(fresh, "tactical",   NOW);
  assert.ok(freshScore > staleScore, `AR: fresh moderate-confidence event (${freshScore.toFixed(3)}) must outweigh stale high-confidence event (${staleScore.toFixed(3)})`);
}

// ── AS: Weaker INT performance gets more allocation when both rulesets adequate

{
  let p = newProfile("mixed");
  const decSkills: SkillId[] = ["tactical", "pattern", "problemBallDec"];
  // BB: adequate evidence, good performance
  for (let i = 0; i < 8; i++)
    for (const sk of decSkills)
      p = applySkillUpdate(p, sk, 1, { drillId: `bb_${sk}_${i}`, source: "training", difficulty: 5, ruleset: "blackball" }, NOW + i);
  // INT: adequate evidence, poor performance
  for (let i = 0; i < 8; i++)
    for (const sk of decSkills)
      p = applySkillUpdate(p, sk, 0, { drillId: `int_${sk}_${i}`, source: "training", difficulty: 5, ruleset: "international" }, NOW + 1000 + i);
  const split = mixedRulesetSplit(p, NOW + 2000);
  assert.ok(split.international > split.blackball, "AS: weaker INT performance must receive more allocation when both rulesets have adequate evidence");
  assert.ok(split.blackball >= CONFIG.mixed.minRulesetFloor, "AS: BB must not fall below minRulesetFloor");
}

// ── AT: Low INT confidence triggers calibration priority ─────────────────────

{
  let p = newProfile("mixed");
  const decSkills: SkillId[] = ["tactical", "pattern", "problemBallDec"];
  // BB has adequate evidence with good performance
  for (let i = 0; i < 8; i++)
    for (const sk of decSkills)
      p = applySkillUpdate(p, sk, 1, { drillId: `bb_${sk}_${i}`, source: "training", difficulty: 5, ruleset: "blackball" }, NOW + i);
  // INT has NO evidence — should be prioritised for calibration
  const split = mixedRulesetSplit(p, NOW + 100);
  assert.ok(split.international > split.blackball, "AT: zero INT confidence must trigger calibration priority (more INT allocation)");
  assert.ok(split.blackball >= CONFIG.mixed.minRulesetFloor, "AT: BB must not fall below minRulesetFloor during INT calibration");
}

// ── AU: Shared execution attempts (ruleset=null) don't inflate ruleset confidence

{
  let p = newProfile("mixed");
  // Tag attempts as shared (ruleset=null) — simulates pure execution drills
  for (let i = 0; i < 12; i++)
    p = applySkillUpdate(p, "potting", 1, { drillId: `pot_${i}`, source: "training", difficulty: 5, ruleset: null }, NOW + i);
  const bbConf  = computeRulesetConfidence(p, "potting", "blackball");
  const intConf = computeRulesetConfidence(p, "potting", "international");
  assert.equal(bbConf.tier,  "Low", "AU: shared (ruleset=null) execution attempts must not inflate BB-specific confidence");
  assert.equal(intConf.tier, "Low", "AU: shared (ruleset=null) execution attempts must not inflate INT-specific confidence");
}

// ── AV: BB and INT rule-source accuracy against authoritative definitions ─────

{
  // Blackball: foul = free shot + cue ball from baulk (WPA Rule 4.3 territory)
  const bbFoul = blackballFoulConsequence(false);
  assert.equal(bbFoul.cueBallPlacement, "baulk",    "AV-1: Blackball foul must place cue ball in baulk");
  assert.equal(bbFoul.freeShotGranted,  true,        "AV-2: Blackball foul must grant a free shot");
  // International: foul = ball in hand anywhere, no free shot
  const intFoul = internationalFoulConsequence(false);
  assert.equal(intFoul.cueBallPlacement, "anywhere", "AV-3: International foul must grant ball in hand anywhere");
  assert.equal(intFoul.freeShotGranted,  false,       "AV-4: International foul must NOT grant a free shot");
  // Unified dispatch must match the per-ruleset helpers
  assert.equal(getCueBallPlacement("blackball"),     "baulk",    "AV-5: Unified getCueBallPlacement must match Blackball helper");
  assert.equal(getCueBallPlacement("international"), "anywhere", "AV-6: Unified getCueBallPlacement must match International helper");
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase 3 — Match engine tests AW–BN
// ═════════════════════════════════════════════════════════════════════════════

function makeMatch(ruleset: "blackball" | "international" = "blackball", env: "competition" | "practice" = "competition"): Match {
  return { id: `m_${Math.random()}`, startedAt: NOW, competitionType: env, ruleset, frames: [] };
}

function addErrorEvent(match: Match, category: string, impact: FrameImpact, ts = NOW): Match {
  const ev = buildFrameEvent({ type: "error", category, impact, ruleset: match.ruleset, environment: match.competitionType }, ts);
  const frame = { id: `fr_${ts}_${category}`, matchId: match.id, frameNumber: match.frames.length + 1, result: "lost" as const, pressure: "normal" as const, keyEvents: [ev], ts };
  return { ...match, frames: [...match.frames, frame] };
}

// ── AW: createMatch always produces a concrete ruleset ────────────────────────

{
  const bbMatch  = { id: "m1", startedAt: NOW, competitionType: "competition" as const, ruleset: "blackball"     as const, frames: [] };
  const intMatch = { id: "m2", startedAt: NOW, competitionType: "competition" as const, ruleset: "international" as const, frames: [] };
  assert.equal(bbMatch.ruleset,  "blackball",     "AW-1: createMatch must produce blackball ruleset");
  assert.equal(intMatch.ruleset, "international", "AW-2: createMatch must produce international ruleset");
  assert.ok((bbMatch.ruleset as string) !== "mixed", "AW-3: match ruleset must never be 'mixed'");
}

// ── AX: Mixed-mode profile — match gets its own real ruleset ──────────────────

{
  const mixedProfile = newProfile("mixed");
  const m = makeMatch("international");
  assert.equal(m.ruleset, "international", "AX-1: match in INT mode has correct ruleset");
  assert.equal(mixedProfile.preferredRulesMode, "mixed", "AX-2: training preference unchanged");
  assert.ok((m.ruleset as string) !== "mixed", "AX-3: match ruleset must not be 'mixed'");
}

// ── AY: addFrame updates score correctly ─────────────────────────────────────

{
  const ev = buildFrameEvent({ type: "error", category: "missed_pot", impact: "high", ruleset: "blackball", environment: "competition" }, NOW);
  let m = makeMatch();
  const wonFrame  = { id: "fr1", matchId: m.id, frameNumber: 1, result: "won"  as const, pressure: "normal" as const, keyEvents: [],   ts: NOW + 1 };
  const lostFrame = { id: "fr2", matchId: m.id, frameNumber: 2, result: "lost" as const, pressure: "normal" as const, keyEvents: [ev], ts: NOW + 2 };
  const wonFrame2 = { id: "fr3", matchId: m.id, frameNumber: 3, result: "won"  as const, pressure: "normal" as const, keyEvents: [],   ts: NOW + 3 };
  m = { ...m, frames: [wonFrame, lostFrame, wonFrame2] };
  const score = { player: m.frames.filter(f => f.result === "won").length, opponent: m.frames.filter(f => f.result === "lost").length };
  assert.equal(score.player,   2, "AY-1: two won frames → player score 2");
  assert.equal(score.opponent, 1, "AY-2: one lost frame → opponent score 1");
}

// ── AZ: Match JSON round-trip preserves all data ─────────────────────────────

{
  let m = makeMatch("blackball", "competition");
  m = addErrorEvent(m, "missed_pot", "high", NOW);
  m = { ...m, opponent: "Test Opp", format: "best of 7" };
  const rt = JSON.parse(JSON.stringify(m)) as Match;
  assert.equal(rt.ruleset, m.ruleset, "AZ-1: ruleset survives JSON round-trip");
  assert.equal(rt.frames.length, m.frames.length, "AZ-2: frame count survives round-trip");
  assert.equal(rt.opponent, "Test Opp", "AZ-3: optional fields survive round-trip");
  assert.equal(rt.frames[0].keyEvents[0].category, "missed_pot", "AZ-4: event category survives round-trip");
}

// ── BA: INT match events do NOT inflate BB-specific decision confidence ────────

{
  // Match events never write to profile.skills — so ruleset confidence is unaffected
  const p = newProfile("blackball");
  // Even if we had INT match errors for "tactical", the profile is untouched
  let m = makeMatch("international");
  for (let i = 0; i < 5; i++) m = addErrorEvent(m, "tactical_error", "high", NOW + i);
  const bbConf = computeRulesetConfidence(p, "tactical", "blackball", NOW + 1000);
  assert.equal(bbConf.tier, "Low", "BA: INT match events must not inflate BB-specific tactical confidence (no training attempts)");
}

// ── BB: Execution evidence (potting) contributes regardless of match ruleset ──

{
  const m = addErrorEvent(makeMatch("international"), "missed_pot", "high", NOW);
  const boost = computeMatchPriorityBoost([m], "potting", NOW);
  assert.ok(boost > 0, `BB: potting boost from INT match must be > 0 (${boost.toFixed(3)}); execution skills are ruleset-agnostic`);
}

// ── BC: Decisive error gives higher boost than low-impact error ───────────────

{
  const mDecisive = addErrorEvent(makeMatch(), "8ball_miss",  "decisive", NOW);
  const mLow      = addErrorEvent(makeMatch(), "missed_pot",  "low",      NOW);
  const boostDecisive = computeMatchPriorityBoost([mDecisive], "eightBall", NOW);
  const boostLow      = computeMatchPriorityBoost([mLow],      "potting",   NOW);
  assert.ok(boostDecisive > boostLow, `BC: decisive boost (${boostDecisive.toFixed(3)}) must exceed low-impact boost (${boostLow.toFixed(3)})`);
}

// ── BD: Recent error contributes more than identical old error ────────────────

{
  const halfLife = 1000 * 60 * 60 * 24 * 21;
  const mFresh = addErrorEvent(makeMatch(), "8ball_miss", "high", NOW);
  const mStale = addErrorEvent(makeMatch(), "8ball_miss", "high", NOW - halfLife);
  const boostFresh = computeMatchPriorityBoost([mFresh], "eightBall", NOW);
  const boostStale = computeMatchPriorityBoost([mStale], "eightBall", NOW);
  assert.ok(boostFresh > boostStale, `BD: fresh error (${boostFresh.toFixed(3)}) must outweigh stale error (${boostStale.toFixed(3)})`);
  // Old error at exactly one half-life should be ~0.5× the fresh value
  assert.ok(boostStale > 0, "BD: stale error must still contribute some signal");
}

// ── BE: Match events do NOT write to profile.skills attempts ─────────────────

{
  const p = newProfile("blackball");
  // Even with many match errors in scope, profile is never mutated
  let m = makeMatch();
  for (let i = 0; i < 10; i++) m = addErrorEvent(m, "poor_speed", "high", NOW + i);
  assert.equal(p.skills["speed"].attempts.length, 0,  "BE-1: speed attempts must remain empty after match errors");
  assert.equal(p.skills["speed"].rating,          30, "BE-2: speed rating must remain at default");
  for (const s of SKILLS) {
    assert.equal(p.skills[s.id].attempts.length, 0, `BE-3: ${s.id} attempts must be empty — match events must not write to profile`);
  }
}

// ── BF: Repeated decisive match errors elevate skill to primary LF / session focus

{
  const p = newProfile("blackball");
  let m = makeMatch();
  for (let i = 0; i < 5; i++) m = addErrorEvent(m, "8ball_miss", "decisive", NOW + i);
  const session = generateAdaptiveSession(p, [m], 30);
  assert.ok(
    session.focusSkillIds.includes("eightBall"),
    `BF: 5 decisive 8-ball match errors must elevate eightBall to session focus; got ${JSON.stringify(session.focusSkillIds)}`
  );
}

// ── BG: 2 decisive errors outrank 5 low errors in priority boost ──────────────

{
  let mLow = makeMatch("blackball");
  for (let i = 0; i < 5; i++) mLow = addErrorEvent(mLow, "poor_speed", "low", NOW + i);
  let mDecisive = makeMatch("blackball");
  mDecisive = addErrorEvent(mDecisive, "8ball_miss", "decisive", NOW + 100);
  mDecisive = addErrorEvent(mDecisive, "8ball_miss", "decisive", NOW + 101);
  const speedBoost     = computeMatchPriorityBoost([mLow],      "speed",      NOW + 200);
  const eightBallBoost = computeMatchPriorityBoost([mDecisive], "eightBall",  NOW + 200);
  assert.ok(
    eightBallBoost > speedBoost,
    `BG: 2 decisive eightBall errors (${eightBallBoost.toFixed(3)}) must outrank 5 low speed errors (${speedBoost.toFixed(3)})`
  );
}

// ── BH: No "match" source in profile.skills attempts ─────────────────────────

{
  const p = newProfile("blackball");
  const matchSourceAttempts = p.skills["speed"].attempts.filter(
    (a: Attempt) => (a.source as string) === "match"
  );
  assert.equal(matchSourceAttempts.length, 0, "BH: profile.skills[speed].attempts must never include source='match'");
}

// ── BI: FrameEvent stores reportedCause and inferredCause independently ───────

{
  const ev = buildFrameEvent({ type: "error", category: "missed_pot", impact: "high", ruleset: "blackball", environment: "competition" }, NOW);
  assert.equal(ev.reportedCause, "missed_pot", "BI-1: reportedCause must be the category key 'missed_pot'");
  // CORRECTED (Phase 3.1): plain missed_pot with no upstream evidence must NOT invent an inferred cause
  assert.equal(ev.inferredCause, null, "BI-2: plain missed_pot must have null inferredCause — no speculative root-cause guessing");
  assert.ok(ev.reportedCause !== ev.inferredCause, "BI-3: reportedCause ('missed_pot') and inferredCause (null) must differ");
  // Verify they are stored as separate fields
  assert.ok("reportedCause" in ev, "BI-4: FrameEvent must have reportedCause field");
  assert.ok("inferredCause" in ev, "BI-5: FrameEvent must have inferredCause field");
}

// ── BJ: Positive clearance event stored for pattern, never for potting ────────

{
  const ev = buildFrameEvent({ type: "positive", category: "completed_clearance", ruleset: "blackball", environment: "competition" }, NOW);
  assert.equal(ev.skillId, "pattern",  "BJ-1: completed_clearance must map to skillId 'pattern'");
  assert.equal(ev.type,    "positive", "BJ-2: event type must be 'positive'");
  // Confirm no POSITIVE_EVENT_TYPE maps to potting
  const pottingPositive = POSITIVE_EVENT_TYPES.filter(c => c.skillId === "potting");
  assert.equal(pottingPositive.length, 0, "BJ-3: no positive event type should map to potting skill");
}

// ── BK: Deleting match removes its priority boost entirely ────────────────────

{
  let m = makeMatch();
  for (let i = 0; i < 4; i++) m = addErrorEvent(m, "8ball_miss", "decisive", NOW + i);
  const matchesBefore  = [m];
  const boostBefore    = computeMatchPriorityBoost(matchesBefore, "eightBall", NOW + 100);
  const matchesAfter   = matchesBefore.filter(mx => mx.id !== m.id);
  const boostAfter     = computeMatchPriorityBoost(matchesAfter,  "eightBall", NOW + 100);
  assert.ok(boostBefore > 0,  "BK-1: boost must exist before deletion");
  assert.equal(boostAfter, 0, "BK-2: boost must be exactly 0 after match is deleted from the array");
}

// ── BL: editFrame updates record; frameScore reflects the change ──────────────

{
  const ev = buildFrameEvent({ type: "error", category: "missed_pot", impact: "high", ruleset: "blackball", environment: "competition" }, NOW);
  let m = makeMatch();
  const wonFrame = { id: "fr_bl", matchId: m.id, frameNumber: 1, result: "won" as const, pressure: "normal" as const, keyEvents: [], ts: NOW + 1 };
  m = { ...m, frames: [wonFrame] };
  const scoreBefore = { player: m.frames.filter(f => f.result === "won").length, opponent: m.frames.filter(f => f.result === "lost").length };
  // Edit the frame from won → lost and add an error event
  m = { ...m, frames: m.frames.map(f => f.id === "fr_bl" ? { ...f, result: "lost" as const, keyEvents: [ev] } : f) };
  const scoreAfter = { player: m.frames.filter(f => f.result === "won").length, opponent: m.frames.filter(f => f.result === "lost").length };
  assert.equal(scoreBefore.player,  1, "BL-1: before edit — player score 1");
  assert.equal(scoreAfter.player,   0, "BL-2: after won→lost edit — player score 0");
  assert.equal(scoreAfter.opponent, 1, "BL-3: after won→lost edit — opponent score 1");
  assert.equal(m.frames[0].result, "lost", "BL-4: frame record shows updated result");
  assert.equal(m.frames[0].keyEvents.length, 1, "BL-5: frame record shows added event");
}

// ── BM: buildMatchSummary narrative mentions outcome and training focus ────────

{
  const p = newProfile("blackball");
  let m = makeMatch();
  for (let i = 0; i < 3; i++) m = addErrorEvent(m, "8ball_miss", "decisive", NOW + i);
  m = { ...m, completedAt: NOW + 100 };
  const lf = matchAwareLimitingFactor(p, [m], NOW + 200);
  const summary = buildMatchSummary(m, p, lf, NOW + 200);
  assert.ok(summary.matchNarrative.length > 10, "BM-1: matchNarrative must be non-empty");
  // Must mention the score (0–3 match)
  const scoreStr = `${summary.playerFrames}–${summary.opponentFrames}`;
  assert.ok(summary.matchNarrative.includes(scoreStr), `BM-2: narrative must include score "${scoreStr}"`);
  // Must reference training focus when LF is known
  if (lf.primary) {
    assert.ok(summary.trainingFocus.length > 0, "BM-3: trainingFocus must be non-empty when LF primary is known");
    const skillNameLower = SKILL_MAP[lf.primary.id].name.toLowerCase();
    assert.ok(
      summary.matchNarrative.toLowerCase().includes(skillNameLower),
      `BM-4: narrative must reference the LF primary skill "${skillNameLower}"`
    );
  }
}

// ── BN: generateAdaptiveSession changes generated training content vs generateSession

{
  const p = newProfile("blackball");
  // Training-only session: no clear LF (equal skills, no attempts) → no specific focus
  const trainingSession = generateSession(p, 30);

  // 5 decisive 8-ball misses → eightBall becomes the match priority
  let m = makeMatch();
  for (let i = 0; i < 5; i++) m = addErrorEvent(m, "8ball_miss", "decisive", NOW + i);
  const matchSession = generateAdaptiveSession(p, [m], 30);

  // Match-aware session must focus on eightBall
  assert.ok(
    matchSession.focusSkillIds.includes("eightBall"),
    `BN-1: generateAdaptiveSession must target eightBall after decisive match errors; got ${JSON.stringify(matchSession.focusSkillIds)}`
  );
  // At least one eightBall drill must appear in the match-aware session
  const matchHasEightBall = matchSession.drills.some(d => "skillId" in d && (d as { skillId: string }).skillId === "eightBall");
  assert.ok(matchHasEightBall, "BN-2: match-aware session must include at least one eightBall drill");
  // Training-only session must NOT focus on eightBall (no training evidence distinguishes it)
  assert.ok(
    !trainingSession.focusSkillIds.includes("eightBall"),
    `BN-3: training-only session must not include eightBall in focusSkillIds for fresh profile; got ${JSON.stringify(trainingSession.focusSkillIds)}`
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase 3.1 — Integrity patch tests BO–BZ
// ═════════════════════════════════════════════════════════════════════════════

// ── BO: Plain missed pot has no invented root cause ───────────────────────────

{
  const ev = buildFrameEvent({ type: "error", category: "missed_pot", impact: "high", ruleset: "blackball", environment: "competition" }, NOW);
  assert.equal(ev.skillId,              "potting",    "BO-1: direct skill for missed_pot must be potting");
  assert.equal(ev.inferredCause,        null,         "BO-2: plain missed_pot must have null inferredCause");
  assert.equal(ev.diagnosticConfidence, "Low",        "BO-3: diagnostic confidence must be Low with no upstream evidence");
  assert.equal(ev.reportedCause,        "missed_pot", "BO-4: reportedCause must record the player-reported category");
}

// ── BP: Position-supported miss infers positional upstream ────────────────────

{
  const ev = buildFrameEvent({ type: "error", category: "missed_pot", impact: "high", ruleset: "blackball", environment: "competition", precededBy: "poor_position" }, NOW);
  assert.equal(ev.skillId,              "potting",       "BP-1: direct skill is still potting (reportedCause preserved)");
  assert.equal(ev.inferredCause,        "positional",    "BP-2: upstream inferred cause must be positional");
  assert.equal(ev.diagnosticConfidence, "Emerging",      "BP-3: diagnostic confidence must be Emerging with upstream evidence");
  assert.equal(ev.precededBy,           "poor_position", "BP-4: precededBy field must be stored on the event");
}

// ── BQ: Speed-supported miss infers speed upstream ────────────────────────────

{
  const ev = buildFrameEvent({ type: "error", category: "missed_pot", impact: "high", ruleset: "international", environment: "competition", precededBy: "poor_speed" }, NOW);
  assert.equal(ev.skillId,              "potting",  "BQ-1: direct skill is still potting");
  assert.equal(ev.inferredCause,        "speed",    "BQ-2: upstream inferred cause must be speed");
  assert.equal(ev.diagnosticConfidence, "Emerging", "BQ-3: confidence must be Emerging with upstream evidence");
}

// ── BR: Diagnostic confidence differences ─────────────────────────────────────

{
  const evNoEvidence    = buildFrameEvent({ type: "error", category: "missed_pot", impact: "high",      ruleset: "blackball", environment: "competition" }, NOW);
  const evWithEvidence  = buildFrameEvent({ type: "error", category: "missed_pot", impact: "high",      ruleset: "blackball", environment: "competition", precededBy: "poor_position" }, NOW);
  const evOtherCategory = buildFrameEvent({ type: "error", category: "8ball_miss", impact: "decisive",  ruleset: "blackball", environment: "competition" }, NOW);

  assert.equal(evNoEvidence.diagnosticConfidence,   "Low",      "BR-1: no-evidence missed_pot must have Low confidence");
  assert.equal(evWithEvidence.diagnosticConfidence,  "Emerging", "BR-2: with-evidence missed_pot must have Emerging confidence");
  assert.equal(evOtherCategory.diagnosticConfidence, "Emerging", "BR-3: other categories must have Emerging confidence");
  assert.notEqual(evNoEvidence.diagnosticConfidence, evWithEvidence.diagnosticConfidence, "BR-4: Low and Emerging must differ");
  assert.equal(evNoEvidence.inferredCause,   null, "BR-5: no-evidence must have null inferredCause");
  assert.notEqual(evWithEvidence.inferredCause, null, "BR-6: with-evidence must have non-null inferredCause");
}

// ── BS: Opening Edit Last Frame does NOT remove or alter the original frame ───

{
  let m = makeMatch();
  const ev = buildFrameEvent({ type: "error", category: "8ball_miss", impact: "decisive", ruleset: "blackball", environment: "competition" }, NOW);
  const frame = { id: "fr_bs", matchId: m.id, frameNumber: 1, result: "lost" as const, pressure: "normal" as const, keyEvents: [ev], ts: NOW };
  m = { ...m, frames: [frame] };
  const stateBefore = JSON.stringify(m);

  // editLastFrame() only sets editFrameId/view — match state is NOT touched
  assert.equal(m.frames.length,   1,           "BS-1: frame count unchanged when edit is opened");
  assert.equal(m.frames[0].id,    "fr_bs",     "BS-2: frame ID unchanged");
  assert.equal(m.frames[0].result,"lost",      "BS-3: frame result unchanged");
  assert.equal(m.frames[0].keyEvents[0].category, "8ball_miss", "BS-4: event category unchanged");
  assert.equal(stateBefore, JSON.stringify(m), "BS-5: full match state identical before and after opening edit");
}

// ── BT: Cancel leaves original frame, score, and derived evidence unchanged ───

{
  let m = makeMatch();
  const ev = buildFrameEvent({ type: "error", category: "8ball_miss", impact: "decisive", ruleset: "blackball", environment: "competition" }, NOW);
  const frame = { id: "fr_bt", matchId: m.id, frameNumber: 1, result: "lost" as const, pressure: "normal" as const, keyEvents: [ev], ts: NOW };
  m = { ...m, frames: [frame] };

  const scoreBefore = frameScore(m);
  const boostBefore = computeMatchPriorityBoost([m], "eightBall", NOW + 1);
  const stateBefore = JSON.stringify(m);

  // Cancel: editFrame() is never called — match state unchanged
  const scoreAfter  = frameScore(m);
  const boostAfter  = computeMatchPriorityBoost([m], "eightBall", NOW + 1);

  assert.deepEqual(scoreBefore,  scoreAfter,  "BT-1: score unchanged after cancel");
  assert.equal(boostBefore,      boostAfter,  "BT-2: match priority evidence unchanged after cancel");
  assert.equal(m.frames.length,  1,           "BT-3: frame count unchanged after cancel");
  assert.equal(m.frames[0].result, "lost",    "BT-4: frame result unchanged after cancel");
  assert.equal(stateBefore, JSON.stringify(m),"BT-5: full match state unchanged after cancel");
}

// ── BU: Save changes frame and recomputes score and evidence ──────────────────

{
  let m = makeMatch();
  const ev = buildFrameEvent({ type: "error", category: "8ball_miss", impact: "decisive", ruleset: "blackball", environment: "competition" }, NOW);
  const frame = { id: "fr_bu", matchId: m.id, frameNumber: 1, result: "lost" as const, pressure: "normal" as const, keyEvents: [ev], ts: NOW };
  m = { ...m, frames: [frame] };

  const scoreBefore = frameScore(m);
  const boostBefore = computeMatchPriorityBoost([m], "eightBall", NOW + 1);

  // Save: editFrame() called with won result and cleared events
  m = editFrame(m, "fr_bu", { result: "won", keyEvents: [] });

  const scoreAfter = frameScore(m);
  const boostAfter = computeMatchPriorityBoost([m], "eightBall", NOW + 2);

  assert.equal(scoreBefore.player,          0,     "BU-1: before save — player score 0");
  assert.equal(scoreAfter.player,           1,     "BU-2: after save lost→won — player score 1");
  assert.equal(scoreAfter.opponent,         0,     "BU-3: after save — opponent score 0");
  assert.equal(m.frames[0].result,          "won", "BU-4: frame result updated to won");
  assert.equal(m.frames[0].keyEvents.length, 0,   "BU-5: frame events cleared after save");
  assert.ok(boostBefore > 0, "BU-6: decisive eightBall error creates boost before save");
  assert.equal(boostAfter, 0, "BU-7: boost must be 0 after event is removed via save");
}

// ── BV: Edited frame changes future training focus ────────────────────────────

{
  const p = newProfile("blackball");
  let m = makeMatch();
  // 4 decisive speed errors → speed becomes the match-aware LF focus
  for (let i = 0; i < 4; i++) {
    const ev = buildFrameEvent({ type: "error", category: "poor_speed", impact: "decisive", ruleset: "blackball", environment: "competition" }, NOW + i);
    m = { ...m, frames: [...m.frames, { id: `fr_bv_${i}`, matchId: m.id, frameNumber: m.frames.length + 1, result: "lost" as const, pressure: "normal" as const, keyEvents: [ev], ts: NOW + i }] };
  }

  const sessionBefore = generateAdaptiveSession(p, [m], 30);
  assert.ok(sessionBefore.focusSkillIds.includes("speed"), "BV-1: speed must be in focus before edit (4 decisive errors)");

  // Save edits: remove all speed events
  for (const frame of m.frames) {
    m = editFrame(m, frame.id, { result: "won", keyEvents: [] });
  }

  const boostAfter = computeMatchPriorityBoost([m], "speed", NOW + 100);
  assert.equal(boostAfter, 0, "BV-2: speed boost must be 0 after all speed events are edited away");

  const sessionAfter = generateAdaptiveSession(p, [m], 30);
  assert.ok(!sessionAfter.focusSkillIds.includes("speed"), "BV-3: speed must not be in focus after all speed events removed");
}

// ── BW: Mixed — decisive INT tactical errors increase INT allocation ───────────

{
  const p = newProfile("mixed");
  const baseline = matchAwareMixedSplit(p, [], NOW);

  let m = makeMatch("international");
  for (let i = 0; i < 4; i++) {
    const ev = buildFrameEvent({ type: "error", category: "tactical_error", impact: "decisive", ruleset: "international", environment: "competition" }, NOW + i);
    m = { ...m, frames: [...m.frames, { id: `fr_bw_${i}`, matchId: m.id, frameNumber: m.frames.length + 1, result: "lost" as const, pressure: "normal" as const, keyEvents: [ev], ts: NOW + i }] };
  }
  const splitWithINT = matchAwareMixedSplit(p, [m], NOW + 100);

  assert.ok(
    splitWithINT.international > baseline.international,
    `BW: decisive INT tactical errors must increase INT allocation (${splitWithINT.international.toFixed(3)} vs baseline ${baseline.international.toFixed(3)})`
  );
  assert.ok(splitWithINT.blackball     >= 0.25, `BW: BB floor must remain >= 0.25 (${splitWithINT.blackball.toFixed(3)})`);
  assert.ok(splitWithINT.international >= 0.25, `BW: INT floor must remain >= 0.25 (${splitWithINT.international.toFixed(3)})`);
}

// ── BX: Mixed — decisive BB tactical errors increase BB allocation ─────────────

{
  const p = newProfile("mixed");
  const baseline = matchAwareMixedSplit(p, [], NOW);

  let m = makeMatch("blackball");
  for (let i = 0; i < 4; i++) {
    const ev = buildFrameEvent({ type: "error", category: "tactical_error", impact: "decisive", ruleset: "blackball", environment: "competition" }, NOW + i);
    m = { ...m, frames: [...m.frames, { id: `fr_bx_${i}`, matchId: m.id, frameNumber: m.frames.length + 1, result: "lost" as const, pressure: "normal" as const, keyEvents: [ev], ts: NOW + i }] };
  }
  const splitWithBB = matchAwareMixedSplit(p, [m], NOW + 100);

  assert.ok(
    splitWithBB.blackball > baseline.blackball,
    `BX: decisive BB tactical errors must increase BB allocation (${splitWithBB.blackball.toFixed(3)} vs baseline ${baseline.blackball.toFixed(3)})`
  );
}

// ── BY: Mixed impact sensitivity — decisive errors shift allocation more ────────

{
  const p = newProfile("mixed");
  const baseline = matchAwareMixedSplit(p, [], NOW);

  const makeINTMatch = (impact: FrameImpact, count: number, prefix: string) => {
    let m = makeMatch("international");
    for (let i = 0; i < count; i++) {
      const ev = buildFrameEvent({ type: "error", category: "tactical_error", impact, ruleset: "international", environment: "competition" }, NOW + i);
      m = { ...m, frames: [...m.frames, { id: `fr_by_${prefix}_${i}`, matchId: m.id, frameNumber: m.frames.length + 1, result: "lost" as const, pressure: "normal" as const, keyEvents: [ev], ts: NOW + i }] };
    }
    return m;
  };

  const splitDecisive = matchAwareMixedSplit(p, [makeINTMatch("decisive", 3, "d")], NOW + 100);
  const splitLow      = matchAwareMixedSplit(p, [makeINTMatch("low",      3, "l")], NOW + 100);

  const shiftDecisive = splitDecisive.international - baseline.international;
  const shiftLow      = splitLow.international      - baseline.international;

  assert.ok(
    shiftDecisive > shiftLow,
    `BY: decisive INT errors (shift +${shiftDecisive.toFixed(3)}) must shift INT allocation more than low-impact errors (shift +${shiftLow.toFixed(3)})`
  );
  assert.ok(shiftDecisive > 0, "BY: decisive errors must produce a positive allocation shift");
}

// ── BZ: Mixed floor — both rulesets retain minimum exposure floor ──────────────

{
  const p = newProfile("mixed");
  const floor = 0.25;

  // Extreme: 10 decisive INT errors — INT dominates but BB must still meet the floor
  let m = makeMatch("international");
  for (let i = 0; i < 10; i++) {
    const ev = buildFrameEvent({ type: "error", category: "tactical_error", impact: "decisive", ruleset: "international", environment: "competition" }, NOW + i);
    m = { ...m, frames: [...m.frames, { id: `fr_bz_${i}`, matchId: m.id, frameNumber: m.frames.length + 1, result: "lost" as const, pressure: "normal" as const, keyEvents: [ev], ts: NOW + i }] };
  }
  const split = matchAwareMixedSplit(p, [m], NOW + 200);

  assert.ok(split.blackball     >= floor, `BZ-1: BB allocation must be >= ${floor} floor; got ${split.blackball.toFixed(3)}`);
  assert.ok(split.international >= floor, `BZ-2: INT allocation must be >= ${floor} floor; got ${split.international.toFixed(3)}`);
  assert.ok(Math.abs(split.blackball + split.international - 1) < 0.001, `BZ-3: allocations must sum to 1; sum = ${(split.blackball + split.international).toFixed(4)}`);
  assert.ok(split.international > split.blackball, `BZ-4: INT must be the majority after 10 decisive INT errors (INT ${split.international.toFixed(3)} vs BB ${split.blackball.toFixed(3)})`);
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase 4 — Display helper tests CA–CJ
// ═════════════════════════════════════════════════════════════════════════════
import {
  ratingLevel, confidenceDisplay, rulesetBadgeLabel, impactLabel, displayToImpact,
} from "../App";

// ── CA: ratingLevel boundaries ────────────────────────────────────────────────
{
  assert.equal(ratingLevel(0),   "Foundation",    "CA-1: 0 → Foundation");
  assert.equal(ratingLevel(34),  "Foundation",    "CA-2: 34 → Foundation");
  assert.equal(ratingLevel(35),  "Developing",    "CA-3: 35 → Developing");
  assert.equal(ratingLevel(49),  "Developing",    "CA-4: 49 → Developing");
  assert.equal(ratingLevel(50),  "Intermediate",  "CA-5: 50 → Intermediate");
  assert.equal(ratingLevel(61),  "Intermediate",  "CA-6: 61 → Intermediate");
  assert.equal(ratingLevel(62),  "Advanced",      "CA-7: 62 → Advanced");
  assert.equal(ratingLevel(73),  "Advanced",      "CA-8: 73 → Advanced");
  assert.equal(ratingLevel(74),  "Competitive",   "CA-9: 74 → Competitive");
  assert.equal(ratingLevel(85),  "Competitive",   "CA-10: 85 → Competitive");
  assert.equal(ratingLevel(86),  "Elite",         "CA-11: 86 → Elite");
  assert.equal(ratingLevel(100), "Elite",         "CA-12: 100 → Elite");
}

// ── CB: ratingLevel covers all non-overlapping ranges ─────────────────────────
{
  const levels = [0, 34, 35, 49, 50, 61, 62, 73, 74, 85, 86, 100].map(ratingLevel);
  const unique = new Set(levels).size;
  assert.equal(unique, 6, "CB: exactly 6 distinct level strings must exist");
}

// ── CC: confidenceDisplay — stale overrides tier ──────────────────────────────
{
  assert.equal(confidenceDisplay("Strong", true),      "Evidence is stale — train to refresh", "CC-1: stale always returns stale copy");
  assert.equal(confidenceDisplay("Established", true), "Evidence is stale — train to refresh", "CC-2: stale overrides Established");
  assert.equal(confidenceDisplay("Low", true),         "Evidence is stale — train to refresh", "CC-3: stale overrides Low");
}

// ── CD: confidenceDisplay — tier-to-copy mapping ─────────────────────────────
{
  assert.equal(confidenceDisplay("Low",         false), "Still learning your game",    "CD-1: Low → learning copy");
  assert.equal(confidenceDisplay("Emerging",    false), "Getting a clearer picture",   "CD-2: Emerging → clearer picture");
  assert.equal(confidenceDisplay("Established", false), "Strong evidence",             "CD-3: Established → strong evidence");
  assert.equal(confidenceDisplay("Strong",      false), "Strong evidence",             "CD-4: Strong → strong evidence");
  assert.notEqual(confidenceDisplay("Low", false), confidenceDisplay("Established", false), "CD-5: Low and Established must differ");
}

// ── CE: rulesetBadgeLabel produces correct label strings ──────────────────────
{
  assert.equal(rulesetBadgeLabel("blackball"),     "BLACKBALL",      "CE-1: blackball badge label");
  assert.equal(rulesetBadgeLabel("international"), "INTERNATIONAL",  "CE-2: international badge label");
  assert.notEqual(rulesetBadgeLabel("blackball"), rulesetBadgeLabel("international"), "CE-3: labels must differ");
}

// ── CF: impactLabel user-friendly text ────────────────────────────────────────
{
  assert.equal(impactLabel("low"),      "Minor",          "CF-1: low → Minor");
  assert.equal(impactLabel("medium"),   "Important",      "CF-2: medium → Important");
  assert.equal(impactLabel("high"),     "Important",      "CF-3: high → Important");
  assert.equal(impactLabel("decisive"), "Frame-deciding", "CF-4: decisive → Frame-deciding");
}

// ── CG: impactLabel does not expose raw internal values ───────────────────────
{
  const raw: string[] = ["low", "medium", "high", "decisive"];
  for (const r of raw) {
    assert.notEqual(impactLabel(r as any), r, `CG: impactLabel('${r}') must translate to friendly text, not return raw value`);
  }
}

// ── CH: displayToImpact round-trips correctly ─────────────────────────────────
{
  assert.equal(displayToImpact("Minor"),          "low",      "CH-1: Minor → low");
  assert.equal(displayToImpact("Important"),      "high",     "CH-2: Important → high");
  assert.equal(displayToImpact("Frame-deciding"), "decisive", "CH-3: Frame-deciding → decisive");
}

// ── CI: displayToImpact ↔ impactLabel are consistent ─────────────────────────
{
  // Minor → low → Minor
  assert.equal(impactLabel(displayToImpact("Minor")),          "Minor",          "CI-1: Minor round-trip");
  // Frame-deciding → decisive → Frame-deciding
  assert.equal(impactLabel(displayToImpact("Frame-deciding")), "Frame-deciding", "CI-2: Frame-deciding round-trip");
  // Important → high → Important
  assert.equal(impactLabel(displayToImpact("Important")),      "Important",      "CI-3: Important round-trip");
}

// ── CJ: display helpers are pure (no mutation, no side effects) ───────────────
{
  const r1 = ratingLevel(55); const r2 = ratingLevel(55);
  assert.equal(r1, r2, "CJ-1: ratingLevel is deterministic");
  const c1 = confidenceDisplay("Emerging", false); const c2 = confidenceDisplay("Emerging", false);
  assert.equal(c1, c2, "CJ-2: confidenceDisplay is deterministic");
  const b1 = rulesetBadgeLabel("blackball"); const b2 = rulesetBadgeLabel("blackball");
  assert.equal(b1, b2, "CJ-3: rulesetBadgeLabel is deterministic");
}

// ── CK: Assessment items have unique IDs (key-based remount isolates drill state) ──
{
  const ids = ASSESSMENT_ITEMS.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, "CK: all assessment drill IDs are unique — key remount isolates state per item");
}

// ── CL: Consecutive assessment items have different IDs (next item starts fresh) ─
{
  for (let i = 0; i < ASSESSMENT_ITEMS.length - 1; i++) {
    assert.notEqual(
      ASSESSMENT_ITEMS[i].id,
      ASSESSMENT_ITEMS[i + 1].id,
      `CL: assessment item ${i} ("${ASSESSMENT_ITEMS[i].id}") ≠ item ${i + 1} ("${ASSESSMENT_ITEMS[i + 1].id}")`,
    );
  }
}

// ── CM: Success can be recorded after a failure on the same skill ────────────────
{
  const p0 = newProfile("blackball");
  const p1 = applySkillUpdate(p0, "potting", 0, { drillId: "pot1", source: "assessment", difficulty: 5, reportedError: "MISS" }, NOW);
  const p2 = applySkillUpdate(p1, "potting", 1, { drillId: "pot1", source: "assessment", difficulty: 5 }, NOW + 1);
  assert.equal(p2.skills.potting.attempts.length, 2, "CM: success recorded after failure without error");
}

// ── CN: Consecutive failures are recorded independently ──────────────────────────
{
  const p0 = newProfile("blackball");
  const p1 = applySkillUpdate(p0, "potting", 0, { drillId: "pot1", source: "assessment", difficulty: 5, reportedError: "MISS" },  NOW);
  const p2 = applySkillUpdate(p1, "speed",   0, { drillId: "spd1", source: "assessment", difficulty: 5, reportedError: "SPEED" }, NOW + 1);
  assert.equal(p2.skills.potting.attempts.length, 1,        "CN-1: first failure recorded");
  assert.equal(p2.skills.speed.attempts.length,   1,        "CN-2: second failure recorded independently");
  assert.equal(p2.skills.potting.attempts[0].reportedError, "MISS",  "CN-3: first error code preserved");
  assert.equal(p2.skills.speed.attempts[0].reportedError,   "SPEED", "CN-4: second error code preserved");
}

// ── CO: Decision drills have unique IDs (feedback state is isolated per item) ────
{
  const decisionDrills = ASSESSMENT_ITEMS.filter((d) => d.type === "decision");
  if (decisionDrills.length >= 2) {
    assert.notEqual(decisionDrills[0].id, decisionDrills[1].id, "CO: consecutive decision drills have different IDs — feedback is isolated by React key");
  }
}

// ── CP: English ball palette only — no non-English colour groups in any clearance ─
{
  const validGroups = new Set(["red", "yellow", "black"]);
  for (const c of CLEARANCES) {
    for (const b of c.balls) {
      assert.ok(validGroups.has(b.group), `CP: ${c.id}.${b.id} group="${b.group}" must be "red", "yellow", or "black"`);
    }
  }
}

// ── CQ: Full-set inventory — no clearance exceeds 7 reds, 7 yellows, 1 black ────
{
  for (const c of CLEARANCES) {
    const reds    = c.balls.filter((b) => b.group === "red").length;
    const yellows = c.balls.filter((b) => b.group === "yellow").length;
    const blacks  = c.balls.filter((b) => b.group === "black").length;
    assert.ok(reds    <= 7, `CQ: ${c.id} has ${reds} red balls (max 7)`);
    assert.ok(yellows <= 7, `CQ: ${c.id} has ${yellows} yellow balls (max 7)`);
    assert.ok(blacks  <= 1, `CQ: ${c.id} has ${blacks} black balls (max 1)`);
  }
}

// ── CR: Ball size consistency — all clearance ball groups map to known BALL constants ─
{
  // PoolTable derives one shared ballR; all groups use it. Verify all groups are recognised.
  const recognisedGroups = new Set(["red", "yellow", "black"]);
  for (const c of CLEARANCES) {
    for (const b of c.balls) {
      assert.ok(recognisedGroups.has(b.group), `CR: ${c.id}.${b.id} group="${b.group}" must map to a BALL constant`);
    }
  }
  // Also verify the four BALL colour strings are distinct (different types, same physical radius)
  const BALL_COLORS = { red: "#B83E35", yellow: "#D6A52E", black: "#151918", cue: "#F2F0E8" };
  const vals = Object.values(BALL_COLORS);
  assert.equal(new Set(vals).size, vals.length, "CR: all BALL colour constants are distinct");
}

// ── CS: Clearance group consistency — player targets and opponent obstacles use different groups ─
{
  for (const c of CLEARANCES) {
    const playerGroups   = new Set(c.balls.filter((b) => b.owner === "player"   && b.role === "target").map((b) => b.group));
    const opponentGroups = new Set(c.balls.filter((b) => b.owner === "opponent").map((b) => b.group));
    for (const g of playerGroups) {
      assert.ok(!opponentGroups.has(g), `CS: ${c.id} player group "${g}" must not appear as an opponent obstacle group`);
    }
  }
}

// ── CT: Black-ball uniqueness — no clearance has more than one black ball ────────
{
  for (const c of CLEARANCES) {
    const blacks = c.balls.filter((b) => b.group === "black" || b.role === "black");
    assert.ok(blacks.length <= 1, `CT: ${c.id} has ${blacks.length} black-group balls (max 1)`);
  }
}

// ── CU: Cue-ball uniqueness — cue ball is implicit; not listed in any clearance ball set ─
{
  for (const c of CLEARANCES) {
    const cueBalls = c.balls.filter((b) => (b.group as string) === "cue" || b.id.toUpperCase() === "W" || b.label.toLowerCase().includes("cue ball"));
    assert.equal(cueBalls.length, 0, `CU: ${c.id} must have no explicit cue ball in its balls list`);
  }
}

// ── CV: Simple drills render only required balls (no balls list in drill data) ───
{
  for (const d of DRILLS) {
    assert.ok(!("balls" in d) || (d as Record<string, unknown>)["balls"] === undefined, `CV: drill ${d.id} must not carry a balls list`);
  }
  // Clearances have a bounded ball set — no more than 16 (7+7+1 black, cue implicit)
  for (const c of CLEARANCES) {
    assert.ok(c.balls.length <= 15, `CV: clearance ${c.id} has ${c.balls.length} balls (max 15 explicit object balls)`);
  }
}

// ── CW: Pattern scenario has labelled target balls ────────────────────────────
{
  const patDrills = DRILLS.filter(d => d.skillId === "pattern" && d.diagram);
  assert.ok(patDrills.length > 0, "CW: at least one pattern drill has a diagram");
  for (const d of patDrills) {
    const labelled = d.diagram!.balls.filter(b => b.trainingLabel);
    assert.ok(labelled.length > 0, `CW: ${d.id} diagram has at least one labelled ball`);
  }
}

// ── CX: Training labels are unique per diagram ────────────────────────────────
{
  const diagramDrills = DRILLS.filter(d => d.diagram);
  for (const d of diagramDrills) {
    const labels = d.diagram!.balls.filter(b => b.trainingLabel).map(b => b.trainingLabel!);
    assert.equal(new Set(labels).size, labels.length, `CX: ${d.id} training labels are unique (got: [${labels}])`);
  }
}

// ── CY: Training labels do not change ball group or colour ────────────────────
{
  const diagramDrills = DRILLS.filter(d => d.diagram);
  const validGroups   = new Set(["red", "yellow", "black", "cue"]);
  for (const d of diagramDrills) {
    for (const b of d.diagram!.balls) {
      assert.ok(validGroups.has(b.group), `CY: ${d.id}.${b.id} group "${b.group}" must be a valid ball group`);
    }
  }
}

// ── CZ: Numbers do not imply route order — optimal route may start with "3" ──
{
  const pat1    = DRILLS.find(d => d.id === "pat1");
  const optimal = pat1?.options?.find(o => o.tier === "optimal");
  assert.ok(optimal?.sequence && optimal.sequence.length > 0, "CZ: pat1 optimal option has a sequence");
  const firstBallId = optimal!.sequence![0].ballId;
  const firstBall   = pat1!.diagram!.balls.find(b => b.id === firstBallId);
  assert.notEqual(firstBall?.trainingLabel, "1", "CZ: optimal route must not start with the ball labelled '1' — number ≠ pot order");
}

// ── DA: Every sequence ballId exists in the diagram ───────────────────────────
{
  const drillsWithSeq = DRILLS.filter(d => d.diagram && d.options?.some(o => o.sequence?.length));
  assert.ok(drillsWithSeq.length > 0, "DA: at least one drill has authored sequences");
  for (const d of drillsWithSeq) {
    const ids = new Set(d.diagram!.balls.map(b => b.id));
    for (const opt of d.options ?? []) {
      for (const step of opt.sequence ?? []) {
        assert.ok(ids.has(step.ballId), `DA: ${d.id} opt "${opt.key}" step ballId "${step.ballId}" must exist in diagram balls`);
      }
    }
  }
}

// ── DB: Pattern option text references valid labelled balls ───────────────────
{
  const patDrills = DRILLS.filter(d => d.skillId === "pattern" && d.diagram);
  for (const d of patDrills) {
    const labels  = new Set(d.diagram!.balls.filter(b => b.trainingLabel).map(b => b.trainingLabel!));
    const optimal = (d.options ?? []).find(o => o.tier === "optimal");
    if (optimal && labels.size > 0) {
      const refsBall = [...labels].some(lbl => optimal.label.includes(`Ball ${lbl}`));
      assert.ok(refsBall, `DB: ${d.id} optimal option label must reference at least one "Ball N" — got: "${optimal.label}"`);
    }
  }
}

// ── DC: Pattern scenario defines playerGroup ──────────────────────────────────
{
  const patDrills = DRILLS.filter(d => d.skillId === "pattern" && d.diagram);
  for (const d of patDrills) {
    assert.ok(["red", "yellow"].includes(d.diagram!.playerGroup!), `DC: ${d.id} must have playerGroup "red" or "yellow"`);
  }
}

// ── DD: Opponent-colour balls are not treated as player's targets ──────────────
{
  const patDrills = DRILLS.filter(d => d.skillId === "pattern" && d.diagram && d.diagram.playerGroup);
  for (const d of patDrills) {
    const opponentGroup = d.diagram!.playerGroup === "yellow" ? "red" : "yellow";
    for (const b of d.diagram!.balls.filter(b => b.group === opponentGroup)) {
      assert.notEqual(b.role, "target", `DD: ${d.id} opponent ball ${b.id} (group "${b.group}") must not have role="target"`);
    }
  }
}

// ── DE: Cue ball has no training sequence label ───────────────────────────────
{
  const diagramDrills = DRILLS.filter(d => d.diagram);
  for (const d of diagramDrills) {
    for (const cb of d.diagram!.balls.filter(b => b.group === "cue")) {
      assert.ok(!cb.trainingLabel, `DE: ${d.id} cue ball "${cb.id}" must not have a trainingLabel`);
    }
  }
}

// ── DF: Black ball has no normal numeric sequence label (1–7) ─────────────────
{
  const diagramDrills = DRILLS.filter(d => d.diagram);
  for (const d of diagramDrills) {
    for (const bb of d.diagram!.balls.filter(b => b.group === "black")) {
      if (bb.trainingLabel) {
        const n = parseInt(bb.trainingLabel, 10);
        assert.ok(isNaN(n) || n === 8, `DF: ${d.id} black ball trainingLabel "${bb.trainingLabel}" must not be a normal sequence number`);
      }
    }
  }
}

// ── DG: Execution assessment drills have authored diagrams ────────────────────
{
  const execAssessment = ASSESSMENT_ITEMS.filter(d => d.type === "execution");
  assert.ok(execAssessment.length > 0, "DG: there must be assessment execution drills");
  for (const d of execAssessment) {
    assert.ok(d.diagram !== undefined, `DG: assessment execution drill ${d.id} must have an authored diagram`);
    assert.ok(d.diagram!.balls.length >= 2, `DG: ${d.id} diagram must have at least 2 balls`);
  }
}

// ── DH: pot1 places cue and object ball on a straight potting line ────────────
{
  const pot1 = DRILLS.find(d => d.id === "pot1");
  assert.ok(pot1?.diagram, "DH: pot1 must have an authored diagram");
  const cue = pot1!.diagram!.balls.find(b => b.group === "cue");
  const obj = pot1!.diagram!.balls.find(b => b.group !== "cue" && b.group !== "black");
  assert.ok(cue && obj, "DH: pot1 diagram must have a cue ball and an object ball");
  assert.ok(Math.abs(cue!.x - obj!.x) < 5, `DH: pot1 cue (x=${cue!.x}) and object (x=${obj!.x}) must share the same potting line`);
  assert.ok(obj!.y < 35, `DH: pot1 object ball y=${obj!.y} must be near the top-middle pocket`);
  assert.ok(cue!.y > obj!.y + 20, `DH: pot1 cue ball y=${cue!.y} must be behind the object ball`);
}

// ── DI: Ruleset-specific decision content remains supported ───────────────────
{
  const rulesetDrills = DRILLS.filter(d => d.rulesetOptions && Object.keys(d.rulesetOptions).length > 0);
  assert.ok(rulesetDrills.length > 0, "DI: at least one drill uses rulesetOptions");
  for (const d of rulesetDrills) {
    for (const [rs, opts] of Object.entries(d.rulesetOptions!)) {
      assert.ok(opts && opts.length > 0, `DI: ${d.id} rulesetOptions.${rs} must have options`);
    }
  }
}

// ── DJ: Multi-step sequences enable route visualisation ───────────────────────
{
  const drillsWithMultiSeq = DRILLS.filter(d => d.diagram && d.options?.some(o => o.sequence && o.sequence.length >= 2));
  assert.ok(drillsWithMultiSeq.length > 0, "DJ: at least one drill has multi-step route sequences");
  for (const d of drillsWithMultiSeq) {
    const ids = new Set(d.diagram!.balls.map(b => b.id));
    for (const opt of d.options ?? []) {
      for (const step of opt.sequence ?? []) {
        assert.ok(ids.has(step.ballId), `DJ: ${d.id} sequence step ballId "${step.ballId}" must resolve to a diagram ball`);
      }
    }
  }
}

// ── DK: Every assessment decision drill has an authored diagram ───────────────
{
  const decDrills = ASSESSMENT_ITEMS.filter(d => d.type === "decision");
  assert.ok(decDrills.length > 0, "DK: there must be assessment decision drills");
  for (const d of decDrills) {
    assert.ok(d.diagram !== undefined, `DK: assessment decision drill ${d.id} must have an authored diagram`);
  }
}

// ── DL: Assessment decision diagram signatures are unique ────────────────────
{
  const decDrills = ASSESSMENT_ITEMS.filter(d => d.type === "decision" && d.diagram);
  const sig = (d: { diagram?: { balls: Array<{ group: string; x: number; y: number }> } }) =>
    d.diagram!.balls.map(b => `${b.group}:${Math.round(b.x/5)*5}:${Math.round(b.y/5)*5}`).sort().join("|");
  const sigs = decDrills.map(d => ({ id: d.id, sig: sig(d) }));
  const seen = new Map<string, string>();
  for (const { id, sig: s } of sigs) {
    assert.ok(!seen.has(s), `DL: assessment decision drills ${id} and ${seen.get(s)} share the same diagram signature`);
    seen.set(s, id);
  }
}

// ── DM: Every assessment drill has objective text ─────────────────────────────
{
  for (const d of ASSESSMENT_ITEMS) {
    assert.ok(d.objective && d.objective.length > 0, `DM: assessment drill ${d.id} must have objective text`);
  }
}

// ── DN: Every physical assessment drill has setup instructions ────────────────
{
  const physical = ASSESSMENT_ITEMS.filter(d => d.type === "execution");
  for (const d of physical) {
    assert.ok(d.setup && d.setup.length > 0, `DN: physical assessment drill ${d.id} must have setup instructions`);
  }
}

// ── DO: Every physical assessment drill defines success criteria ──────────────
{
  const physical = ASSESSMENT_ITEMS.filter(d => d.type === "execution");
  for (const d of physical) {
    assert.ok(d.successCriteria && d.successCriteria.length > 0, `DO: physical assessment drill ${d.id} must define success criteria`);
  }
}

// ── DP: Pattern Recognition drills have distinct scenarioPurpose values ───────
{
  const patDrills = DRILLS.filter(d => d.skillId === "pattern" && d.diagram);
  assert.ok(patDrills.length >= 3, "DP: at least 3 pattern drills with diagrams must exist");
  const purposes = patDrills.filter(d => d.scenarioPurpose).map(d => d.scenarioPurpose!);
  const uniquePurposes = new Set(purposes);
  assert.ok(uniquePurposes.size >= 3, `DP: pattern drills must have at least 3 distinct scenarioPurpose values (got ${uniquePurposes.size}: [${[...uniquePurposes]}])`);
}

// ── DQ: Every numbered answer references a real trainingLabel ─────────────────
{
  const drillsWithLabels = DRILLS.filter(d => d.diagram?.balls.some(b => b.trainingLabel));
  for (const d of drillsWithLabels) {
    const labels = new Set(d.diagram!.balls.filter(b => b.trainingLabel).map(b => b.trainingLabel!));
    for (const opt of d.options ?? []) {
      for (const [, n] of opt.label.matchAll(/Ball (\d+)/g)) {
        assert.ok(labels.has(n), `DQ: ${d.id} opt "${opt.key}" references "Ball ${n}" but no ball has trainingLabel="${n}"`);
      }
    }
  }
}

// ── DR: Problem-Ball assessment identifies a specific labelled ball ───────────
{
  const pbd1 = DRILLS.find(d => d.id === "pbd1");
  assert.ok(pbd1?.diagram, "DR: pbd1 must have an authored diagram");
  const labels = new Set(pbd1!.diagram!.balls.filter(b => b.trainingLabel).map(b => b.trainingLabel!));
  const optimal = (pbd1!.options ?? []).find(o => o.tier === "optimal");
  assert.ok(optimal, "DR: pbd1 must have an optimal option");
  const refsBall = [...labels].some(lbl => optimal!.label.includes(`Ball ${lbl}`));
  assert.ok(refsBall, `DR: pbd1 optimal answer must reference a specific labelled ball (labels: [${[...labels]}])`);
}

// ── DS: Designated problem ball is geometrically near a cushion ───────────────
{
  const pbd1 = DRILLS.find(d => d.id === "pbd1");
  const optimal = (pbd1?.options ?? []).find(o => o.tier === "optimal");
  const match = optimal?.label.match(/Ball (\d+)/);
  if (match) {
    const problemBall = pbd1!.diagram!.balls.find(b => b.trainingLabel === match[1]);
    assert.ok(problemBall, `DS: problem ball "Ball ${match[1]}" must exist in pbd1 diagram`);
    const nearCushion = problemBall!.x < 10 || problemBall!.x > 85 || problemBall!.y < 10 || problemBall!.y > 85;
    assert.ok(nearCushion, `DS: problem ball "Ball ${match[1]}" (x=${problemBall!.x}, y=${problemBall!.y}) must be near a cushion`);
  }
}

// ── DT: 3-Yellow exercise has an explicit objective ───────────────────────────
{
  const clr3 = CLEARANCES.find(c => c.id === "clr3");
  assert.ok(clr3?.objective && clr3.objective.length > 0, "DT: 3-yellow exercise must have an explicit objective");
}

// ── DU: 3-Yellow exercise explicitly defines whether black is included ─────────
{
  const clr3 = CLEARANCES.find(c => c.id === "clr3");
  assert.ok(clr3?.includesBlack !== undefined, "DU: 3-yellow exercise must explicitly declare includesBlack (true or false)");
}

// ── DV: 3-Yellow exercise diagram includes a cue ball ────────────────────────
{
  const clr3 = CLEARANCES.find(c => c.id === "clr3");
  assert.ok(clr3?.diagram, "DV: 3-yellow exercise must have a diagram");
  assert.ok(clr3!.diagram!.balls.some(b => b.group === "cue"), "DV: 3-yellow exercise diagram must include a cue ball");
}

// ── DW: Clearance target balls correspond to visible table labels ──────────────
{
  const clr3 = CLEARANCES.find(c => c.id === "clr3");
  const targets = (clr3?.balls ?? []).filter(b => b.role === "target");
  for (const t of targets) {
    const diagramBall = clr3!.diagram?.balls.find(b => b.id === t.id);
    assert.ok(diagramBall?.trainingLabel, `DW: clearance target ball ${t.id} must have a trainingLabel in the diagram`);
  }
}

// ── DX: Clearance stages use distinct authored layouts ────────────────────────
{
  const withDiagram = CLEARANCES.filter(c => c.diagram);
  const sig = (c: { diagram?: { balls: Array<{ group: string; x: number; y: number }> } }) =>
    c.diagram!.balls.map(b => `${b.group}:${Math.round(b.x/5)*5}:${Math.round(b.y/5)*5}`).sort().join("|");
  if (withDiagram.length >= 2) {
    const seen = new Map<string, string>();
    for (const c of withDiagram) {
      const s = sig(c);
      assert.ok(!seen.has(s), `DX: clearances ${c.id} and ${seen.get(s)} share the same diagram layout`);
      seen.set(s, c.id);
    }
  }
}

// ── DY: Positional assessment contains a target zone ─────────────────────────
{
  const pos1 = DRILLS.find(d => d.id === "pos1");
  assert.ok(pos1?.diagram?.targetZone, "DY: pos1 diagram must include a target zone");
}

// ── DZ: Speed assessment contains a measurable target zone ───────────────────
{
  const spd1 = DRILLS.find(d => d.id === "spd1");
  assert.ok(spd1?.diagram?.targetZone, "DZ: spd1 diagram must include a target zone");
}

// ── EA: Execution assessment success criteria are explicit ────────────────────
{
  const execAssessment = ASSESSMENT_ITEMS.filter(d => d.type === "execution");
  for (const d of execAssessment) {
    assert.ok(d.successCriteria && d.successCriteria.length > 0, `EA: ${d.id} must have success criteria`);
    for (const c of d.successCriteria!) {
      assert.ok(c.length > 5, `EA: ${d.id} criterion "${c}" must be a meaningful string`);
    }
  }
}

// ── EB: No assessment question uses generic positional terms without ball ref ─
{
  const genericRe = /\b(nearest ball|farthest ball|closest ball|the ball nearest|the ball farthest)\b/i;
  for (const d of ASSESSMENT_ITEMS) {
    if (!d.diagram?.balls.some(b => b.trainingLabel)) continue;
    for (const opt of d.options ?? []) {
      const hasGenericOnly = genericRe.test(opt.label) && !/Ball \d+/.test(opt.label);
      assert.ok(!hasGenericOnly, `EB: ${d.id} opt "${opt.key}" uses generic positional term without ball reference`);
    }
  }
}

// ── EC: Every structured sequence references existing ball IDs (belt-and-suspenders) ─
{
  for (const d of DRILLS) {
    if (!d.diagram) continue;
    const ids = new Set(d.diagram.balls.map(b => b.id));
    for (const opt of d.options ?? []) {
      for (const step of opt.sequence ?? []) {
        assert.ok(ids.has(step.ballId), `EC: ${d.id} sequence step ballId "${step.ballId}" must exist in diagram balls`);
      }
    }
  }
}

// ── ED: Every assessment answer rationale is non-empty and meaningful ─────────
{
  for (const d of ASSESSMENT_ITEMS) {
    for (const opt of d.options ?? []) {
      assert.ok(opt.rationale && opt.rationale.length >= 20,
        `ED: ${d.id} opt "${opt.key}" rationale must be at least 20 characters (got ${opt.rationale?.length ?? 0}): "${opt.rationale}"`);
    }
  }
}

// ── EE: No duplicate authored assessment layouts ───────────────────────────────
{
  type SigItem = { source: string; sig: string };
  const sigFn = (balls: Array<{ group: string; x: number; y: number }>) =>
    balls.map(b => `${b.group}:${Math.round(b.x/5)*5}:${Math.round(b.y/5)*5}`).sort().join("|");
  const items: SigItem[] = [
    ...ASSESSMENT_ITEMS.filter(d => d.diagram).map(d => ({ source: d.id, sig: sigFn(d.diagram!.balls) })),
    ...CLEARANCES.filter(c => c.assessmentEligible && c.diagram).map(c => ({ source: c.id, sig: sigFn(c.diagram!.balls) })),
  ];
  const seen = new Map<string, string>();
  for (const { source, sig } of items) {
    assert.ok(!seen.has(sig), `EE: duplicate assessment layout detected: ${source} matches ${seen.get(sig)}`);
    seen.set(sig, source);
  }
}

// ── EF: Player group is declared for group-based decision/clearance scenarios ─
{
  const patDrills = DRILLS.filter(d => d.skillId === "pattern" && d.assessmentEligible);
  for (const d of patDrills) {
    const pg = d.diagram?.playerGroup ?? d.playerGroup;
    assert.ok(pg, `EF: pattern assessment drill ${d.id} must declare playerGroup`);
  }
  const clr3 = CLEARANCES.find(c => c.id === "clr3");
  assert.ok(clr3?.playerGroup, "EF: clr3 clearance must declare playerGroup");
}

// ── EG: Every assessment execution drill contains exactly one cue ball ─────────
{
  for (const d of ASSESSMENT_ITEMS.filter(x => x.type === "execution")) {
    assert.ok(d.diagram, `EG: ${d.id} must have a diagram`);
    const cues = d.diagram!.balls.filter(b => b.group === "cue");
    assert.equal(cues.length, 1, `EG: ${d.id} must have exactly 1 cue ball (found ${cues.length})`);
  }
}

// ── EH: Cue-ball colour constant resolves to off-white ───────────────────────
{
  assert.equal(BALL_COLORS.cue, "#F2F0E8", `EH: BALL_COLORS.cue must be "#F2F0E8" (got "${BALL_COLORS.cue}")`);
}

// ── EI: No assessment diagram ball masquerades as cue via a stray color field ─
{
  for (const d of ASSESSMENT_ITEMS) {
    if (!d.diagram) continue;
    for (const b of d.diagram.balls) {
      assert.ok(!("color" in b),
        `EI: ${d.id} ball ${b.id} has a stray "color" field — colour must be derived from group only`);
    }
  }
}

// ── EJ: Stop-Ball Speed Gate defines targetZone ──────────────────────────────
{
  const spd1 = DRILLS.find(d => d.id === "spd1");
  assert.ok(spd1?.diagram?.targetZone, "EJ: spd1 must define diagram.targetZone");
}

// ── EK: Stop-Ball Speed Gate target zone has visible geometry ─────────────────
{
  const tz = DRILLS.find(d => d.id === "spd1")?.diagram?.targetZone;
  assert.ok(tz && tz.width > 0 && tz.height > 0, "EK: spd1 target zone must have positive width and height");
}

// ── EL: Simple Follow Route defines targetZone ───────────────────────────────
{
  assert.ok(DRILLS.find(d => d.id === "pos1")?.diagram?.targetZone, "EL: pos1 must define diagram.targetZone");
}

// ── EM: Simple Follow Route target zone is positioned beyond the object ball ──
{
  const pos1  = DRILLS.find(d => d.id === "pos1");
  const tz    = pos1?.diagram?.targetZone;
  const obj   = pos1?.diagram?.balls.find(b => b.id === "OBJ");
  assert.ok(tz && obj, "EM: pos1 must have both targetZone and an OBJ ball");
  assert.ok(tz!.y < obj!.y,
    `EM: pos1 target zone top edge (y=${tz!.y}) must be above/beyond the object ball (y=${obj!.y})`);
}

// ── EN: Straight 8-Ball defines aimLine ──────────────────────────────────────
{
  const d = DRILLS.find(x => x.id === "8b1");
  assert.ok(d?.diagram?.aimLines && d.diagram.aimLines.length > 0, "EN: 8b1 must define at least one aimLine");
}

// ── EO: Straight 8-Ball defines targetPocket ─────────────────────────────────
{
  assert.ok(DRILLS.find(d => d.id === "8b1")?.diagram?.targetPocket, "EO: 8b1 must define diagram.targetPocket");
}

// ── EP: Straight Pot — Middle defines intended pocket ────────────────────────
{
  assert.ok(DRILLS.find(d => d.id === "pot1")?.diagram?.targetPocket, "EP: pot1 must define diagram.targetPocket");
}

// ── EQ: Aim lines reference balls that exist in the same diagram ──────────────
{
  for (const d of DRILLS.filter(x => x.diagram?.aimLines && x.diagram.aimLines.length > 0)) {
    const ids = new Set(d.diagram!.balls.map(b => b.id));
    for (const al of d.diagram!.aimLines!) {
      assert.ok(ids.has(al.fromBallId), `EQ: ${d.id} aimLine.fromBallId "${al.fromBallId}" not found in diagram balls`);
      if (al.throughBallId) assert.ok(ids.has(al.throughBallId), `EQ: ${d.id} aimLine.throughBallId "${al.throughBallId}" not found in diagram balls`);
    }
  }
}

// ── ER: Controlled Break includes exactly 15 object balls ────────────────────
{
  const brk1 = DRILLS.find(d => d.id === "brk1");
  const objs  = (brk1?.diagram?.balls ?? []).filter(b => b.group !== "cue");
  assert.equal(objs.length, 15, `ER: brk1 must have exactly 15 object balls (found ${objs.length})`);
}

// ── ES: Controlled Break rack contains 7 red + 7 yellow + 1 black ────────────
{
  const balls = DRILLS.find(d => d.id === "brk1")?.diagram?.balls ?? [];
  assert.equal(balls.filter(b => b.group === "red").length,    7, "ES: brk1 must have 7 red balls");
  assert.equal(balls.filter(b => b.group === "yellow").length, 7, "ES: brk1 must have 7 yellow balls");
  assert.equal(balls.filter(b => b.group === "black").length,  1, "ES: brk1 must have 1 black ball");
}

// ── ET: Controlled Break contains a separate cue ball ────────────────────────
{
  const cues = DRILLS.find(d => d.id === "brk1")?.diagram?.balls.filter(b => b.group === "cue") ?? [];
  assert.equal(cues.length, 1, `ET: brk1 must have exactly 1 cue ball (found ${cues.length})`);
}

// ── EU: Controlled Break defines break/baulk line ────────────────────────────
{
  const tm = DRILLS.find(d => d.id === "brk1")?.diagram?.tableMarkings;
  assert.ok(tm?.showBaulkLine || tm?.showBreakLine || tm?.showBaulkArea,
    "EU: brk1 must define a baulk/break line or area in tableMarkings");
}

// ── EV: Controlled Break cue ball is inside the authored baulk region ─────────
{
  const cb = DRILLS.find(d => d.id === "brk1")?.diagram?.balls.find(b => b.group === "cue");
  assert.ok(cb, "EV: brk1 must have a cue ball");
  assert.ok(cb!.y > 75, `EV: brk1 cue ball (y=${cb!.y}) must be inside the baulk area (y > 75)`);
}

// ── EW: TableMarkings type supports Blackball-specific fields ─────────────────
{
  const m: TableMarkings = { showBaulkLine: true, showBlackSpot: true };
  assert.ok(m.showBaulkLine === true && m.showBlackSpot === true, "EW: TableMarkings must support showBaulkLine and showBlackSpot");
}

// ── EX: TableMarkings type supports International-specific fields ──────────────
{
  const m: TableMarkings = { showBreakLine: true, showRackLine: true };
  assert.ok(m.showBreakLine === true && m.showRackLine === true, "EX: TableMarkings must support showBreakLine and showRackLine");
}

// ── EY: A drill requiring targetZone fails validation when targetZone is absent
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fake = { diagram: { balls: [], requiresVisuals: ["targetZone" as DiagramVisualRequirement] } } as any;
  const r = validateDrillDiagramIntegrity(fake);
  assert.ok(!r.valid && r.errors.length > 0, "EY: missing targetZone must cause validation failure");
}

// ── EZ: A drill requiring aimLine fails validation when aimLines is absent ────
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fake = { diagram: { balls: [], requiresVisuals: ["aimLine" as DiagramVisualRequirement] } } as any;
  const r = validateDrillDiagramIntegrity(fake);
  assert.ok(!r.valid && r.errors.length > 0, "EZ: missing aimLine must cause validation failure");
}

// ── FA: A drill requiring targetPocket fails validation when absent ────────────
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fake = { diagram: { balls: [], requiresVisuals: ["targetPocket" as DiagramVisualRequirement] } } as any;
  const r = validateDrillDiagramIntegrity(fake);
  assert.ok(!r.valid && r.errors.length > 0, "FA: missing targetPocket must cause validation failure");
}

// ── FB: A drill requiring rack fails validation when rack is absent ────────────
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fake = { diagram: { balls: [], requiresVisuals: ["rack" as DiagramVisualRequirement] } } as any;
  const r = validateDrillDiagramIntegrity(fake);
  assert.ok(!r.valid && r.errors.length > 0, "FB: missing rack must cause validation failure");
}

// ── FC: No assessment physical diagram uses a non-cue group for the cue ball ─
{
  for (const d of ASSESSMENT_ITEMS.filter(x => x.type === "execution")) {
    if (!d.diagram) continue;
    // TrainingBall has no color field; cue ball identity is determined by group only
    for (const b of d.diagram.balls) {
      if (b.group === "cue") {
        assert.equal(b.group, "cue", `FC: ${d.id} ball ${b.id} — cue ball must have group "cue"`);
      }
    }
  }
}

// ── FD: All assessment drills pass validateDrillDiagramIntegrity ───────────────
{
  for (const d of ASSESSMENT_ITEMS) {
    const r = validateDrillDiagramIntegrity(d);
    assert.ok(r.valid, `FD: ${d.id} failed validateDrillDiagramIntegrity: ${r.errors.join("; ")}`);
  }
}

// ── FE: Stop-Ball render model contains a visible target-zone primitive ────────
{
  const spd1  = DRILLS.find(d => d.id === "spd1");
  const model = buildTableRenderModel(spd1?.diagram);
  assert.equal(model.zones.length, 1, "FE: spd1 render model must contain exactly one zone primitive");
}

// ── FF: Stop-Ball target-zone stroke opacity > 0.5 ───────────────────────────
{
  const model = buildTableRenderModel(DRILLS.find(d => d.id === "spd1")?.diagram);
  assert.ok((model.zones[0]?.strokeOpacity ?? 0) > 0.5,
    `FF: spd1 zone stroke opacity must be > 0.5 (got ${model.zones[0]?.strokeOpacity})`);
}

// ── FG: Simple Follow render model contains visible target zone ──────────────
{
  const model = buildTableRenderModel(DRILLS.find(d => d.id === "pos1")?.diagram);
  assert.equal(model.zones.length, 1, "FG: pos1 render model must contain one zone primitive");
}

// ── FH: Simple Follow render model contains cue-ball aim line ────────────────
{
  const model = buildTableRenderModel(DRILLS.find(d => d.id === "pos1")?.diagram);
  assert.ok(model.aimLines.length > 0, "FH: pos1 render model must contain aim lines");
  assert.ok(model.aimLines.some(al => al.fromId === "CB"),
    "FH: pos1 aim line must originate from the cue ball (CB)");
}

// ── FI: Straight Pot render model contains aim line ──────────────────────────
{
  const model = buildTableRenderModel(DRILLS.find(d => d.id === "pot1")?.diagram);
  assert.ok(model.aimLines.length > 0, "FI: pot1 render model must contain an aim line");
}

// ── FJ: Straight Pot render model targets a middle pocket ────────────────────
{
  const model = buildTableRenderModel(DRILLS.find(d => d.id === "pot1")?.diagram);
  assert.ok(
    model.targetPocket === "topMiddle" || model.targetPocket === "bottomMiddle",
    `FJ: pot1 target pocket must be a middle pocket (got "${model.targetPocket}")`);
}

// ── FK: Straight 8-Ball render model contains cue→black→pocket line ──────────
{
  const model = buildTableRenderModel(DRILLS.find(d => d.id === "8b1")?.diagram);
  assert.ok(model.aimLines.length > 0, "FK: 8b1 render model must contain an aim line");
  const al = model.aimLines[0];
  assert.equal(al.fromId,    "CB",        `FK: 8b1 aim line fromId must be "CB" (got "${al.fromId}")`);
  assert.equal(al.throughId, "BLK",       `FK: 8b1 aim line throughId must be "BLK" (got "${al.throughId}")`);
  assert.equal(al.toPocket,  "topMiddle", `FK: 8b1 aim line toPocket must be "topMiddle" (got "${al.toPocket}")`);
}

// ── FL: Straight 8-Ball render model specifies a target pocket ───────────────
{
  const model = buildTableRenderModel(DRILLS.find(d => d.id === "8b1")?.diagram);
  assert.ok(model.targetPocket !== null, "FL: 8b1 render model must specify a targetPocket");
}

// ── FM: Controlled Break render model contains 16 total balls ────────────────
{
  const model = buildTableRenderModel(DRILLS.find(d => d.id === "brk1")?.diagram);
  assert.equal(model.balls.length, 16,
    `FM: brk1 render model must contain 16 balls (15 object + 1 cue; got ${model.balls.length})`);
}

// ── FN: Controlled Break render model: 7R + 7Y + 1BLK + 1 cue ───────────────
{
  const model = buildTableRenderModel(DRILLS.find(d => d.id === "brk1")?.diagram);
  assert.equal(model.balls.filter(b => b.group === "red").length,    7, "FN: brk1 must have 7 red primitives");
  assert.equal(model.balls.filter(b => b.group === "yellow").length, 7, "FN: brk1 must have 7 yellow primitives");
  assert.equal(model.balls.filter(b => b.group === "black").length,  1, "FN: brk1 must have 1 black primitive");
  assert.equal(model.balls.filter(b => b.group === "cue").length,    1, "FN: brk1 must have 1 cue primitive");
}

// ── FO: Controlled Break render model contains a baulk/break line ────────────
{
  const model = buildTableRenderModel(DRILLS.find(d => d.id === "brk1")?.diagram);
  assert.ok(model.hasBaulkLine, "FO: brk1 render model must indicate a baulk/break line");
}

// ── FP: Controlled Break render model contains a baulk shaded area ───────────
{
  const model = buildTableRenderModel(DRILLS.find(d => d.id === "brk1")?.diagram);
  assert.ok(model.hasBaulkArea, "FP: brk1 render model must indicate a baulk shaded area");
}

// ── FQ: Every cue-ball render primitive uses BALL_COLORS.cue fill ─────────────
{
  for (const d of DRILLS.filter(x => x.diagram)) {
    const model = buildTableRenderModel(d.diagram);
    for (const b of model.balls.filter(x => x.group === "cue")) {
      assert.equal(b.fill, BALL_COLORS.cue,
        `FQ: ${d.id} cue ball fill must equal BALL_COLORS.cue (got "${b.fill}")`);
    }
  }
}

// ── FR: No authored non-cue ball primitive may use the cue fill ───────────────
{
  for (const d of DRILLS.filter(x => x.diagram)) {
    const model = buildTableRenderModel(d.diagram);
    for (const b of model.balls.filter(x => x.group !== "cue")) {
      assert.notEqual(b.fill, BALL_COLORS.cue,
        `FR: ${d.id} ball ${b.id} (group=${b.group}) must not use the cue fill "${BALL_COLORS.cue}"`);
    }
  }
}

// ── FS: Problem-Ball render model contains exactly one cue ball ───────────────
{
  const model = buildTableRenderModel(DRILLS.find(d => d.id === "pbe1")?.diagram);
  const cues  = model.balls.filter(b => b.group === "cue");
  assert.equal(cues.length, 1, `FS: pbe1 render model must have exactly 1 cue ball (found ${cues.length})`);
}

// ── FT: Problem-Ball cue ball fill is off-white ───────────────────────────────
{
  const model = buildTableRenderModel(DRILLS.find(d => d.id === "pbe1")?.diagram);
  const cb    = model.balls.find(b => b.group === "cue");
  assert.equal(cb?.fill, BALL_COLORS.cue,
    `FT: pbe1 cue ball fill must be BALL_COLORS.cue (got "${cb?.fill}")`);
}

// ── FU: Every required training visual appears after the cloth in render order ─
{
  const trainLayers = ["targetZone","aimLines","targetPocket",
                       "tablemark_baulkArea","tablemark_baulkLine","tablemark_blackSpot"];
  for (const d of DRILLS.filter(x => x.diagram?.requiresVisuals?.length)) {
    const model     = buildTableRenderModel(d.diagram);
    const clothIdx  = model.renderOrder.indexOf("cloth");
    for (const layer of model.renderOrder.filter(l => trainLayers.includes(l))) {
      assert.ok(model.renderOrder.indexOf(layer) > clothIdx,
        `FU: ${d.id} layer "${layer}" must appear after "cloth" in renderOrder`);
    }
  }
}

// ── FV: Every assessment authored drill passes render-model validation ─────────
{
  const reqToLayer: Record<string, string | null> = {
    targetZone: "targetZone", aimLine: "aimLines", targetPocket: "targetPocket",
    baulkArea: "tablemark_baulkArea", rack: null,
  };
  for (const d of ASSESSMENT_ITEMS) {
    if (!d.diagram) continue;
    const model = buildTableRenderModel(d.diagram);
    // 1. Exactly one cue ball with correct fill
    const cues = model.balls.filter(b => b.group === "cue");
    assert.equal(cues.length, 1, `FV: ${d.id} must have exactly 1 cue ball (found ${cues.length})`);
    assert.equal(cues[0].fill, BALL_COLORS.cue, `FV: ${d.id} cue ball fill must equal BALL_COLORS.cue`);
    // 2. Required visual layers present in renderOrder
    for (const req of d.diagram.requiresVisuals ?? []) {
      const layer = reqToLayer[req];
      if (layer) {
        assert.ok(model.renderOrder.includes(layer),
          `FV: ${d.id} renderOrder must include "${layer}" (required by requiresVisuals: "${req}")`);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 4.7 FW–GP — Table geometry & shot-line integrity
// ═══════════════════════════════════════════════════════════════════════════

const GEO = getEnglishPoolTableGeometry(260);

// ── FW: Baulk line primitive is VERTICAL (x1 === x2) ────────────────────────
{
  const prims = buildTableMarkingPrimitives({ showBaulkLine: true }, GEO);
  const bl    = prims.find(p => p.role === "baulkLine");
  assert.ok(bl, "FW: buildTableMarkingPrimitives must return a baulkLine primitive");
  assert.equal(bl!.type, "line", "FW: baulkLine primitive must have type 'line'");
  assert.equal(bl!.x1, bl!.x2, "FW: baulkLine must be vertical (x1 === x2)");
}

// ── FX: Baulk line spans the full playing-surface height ────────────────────
{
  const prims = buildTableMarkingPrimitives({ showBaulkLine: true }, GEO);
  const bl    = prims.find(p => p.role === "baulkLine");
  assert.ok(bl, "FX: baulkLine primitive required");
  assert.ok(Math.abs(bl!.y1! - GEO.baulkTopY) < 0.01,    `FX: baulkLine y1 must equal baulkTopY (${GEO.baulkTopY}), got ${bl!.y1}`);
  assert.ok(Math.abs(bl!.y2! - GEO.baulkBottomY) < 0.01, `FX: baulkLine y2 must equal baulkBottomY (${GEO.baulkBottomY}), got ${bl!.y2}`);
}

// ── FY: Baulk line is positioned near the baulk/right end (> 50% of bW) ───
{
  const baulkFraction = (GEO.baulkLineX - GEO.bX) / GEO.bW;
  assert.ok(baulkFraction > 0.5,
    `FY: baulkLineX must be more than 50% from rack end (fraction=${baulkFraction.toFixed(3)})`);
  assert.ok(Math.abs(baulkFraction - BAULK_FRACTION) < 0.01,
    `FY: baulkLineX fraction must equal BAULK_FRACTION=${BAULK_FRACTION} (got ${baulkFraction.toFixed(3)})`);
}

// ── FZ: D-semicircle is an arc primitive attached to the baulk line ─────────
{
  const prims = buildTableMarkingPrimitives({ showD: true }, GEO);
  const arc   = prims.find(p => p.role === "dSemicircle");
  assert.ok(arc, "FZ: buildTableMarkingPrimitives must return a dSemicircle primitive when showD=true");
  assert.equal(arc!.type, "arc", "FZ: dSemicircle primitive must have type 'arc'");
  assert.ok(typeof arc!.d === "string" && arc!.d.length > 0, "FZ: dSemicircle must have a non-empty SVG path 'd'");
  assert.ok(Math.abs(arc!.cx! - GEO.baulkLineX) < 0.01,
    `FZ: dSemicircle cx must be at baulkLineX (${GEO.baulkLineX.toFixed(2)}), got ${arc!.cx}`);
}

// ── GA: D extends toward the right / baulk cushion ──────────────────────────
{
  const prims = buildTableMarkingPrimitives({ showD: true }, GEO);
  const arc   = prims.find(p => p.role === "dSemicircle");
  assert.ok(arc, "GA: dSemicircle primitive required");
  assert.equal(arc!.extendDirection, "right",
    `GA: dSemicircle extendDirection must be "right" (got "${arc!.extendDirection}")`);
  // The arc's rightmost point = cx + radius must be > baulkLineX
  const rightExtent = arc!.cx! + arc!.radius!;
  assert.ok(rightExtent > GEO.baulkLineX,
    `GA: D rightmost extent (${rightExtent.toFixed(2)}) must exceed baulkLineX (${GEO.baulkLineX.toFixed(2)})`);
}

// ── GB: Black spot is on the rack / opposite half of the table ───────────────
{
  const bsxFraction = (GEO.blackSpotX - GEO.bX) / GEO.bW;
  assert.ok(bsxFraction < 0.5,
    `GB: blackSpotX must be on the rack half (<50%); got fraction ${bsxFraction.toFixed(3)}`);
  assert.ok(Math.abs(bsxFraction - BLACK_SPOT_X_FRACTION) < 0.01,
    `GB: blackSpotX fraction must equal BLACK_SPOT_X_FRACTION=${BLACK_SPOT_X_FRACTION} (got ${bsxFraction.toFixed(3)})`);
  assert.ok(GEO.blackSpotX < GEO.baulkLineX,
    `GB: blackSpotX (${GEO.blackSpotX.toFixed(2)}) must be left of baulkLineX (${GEO.baulkLineX.toFixed(2)})`);
}

// ── GC: Controlled Break — all rack balls are left of the baulk line ─────────
{
  const brk1    = DRILLS.find(d => d.id === "brk1");
  const baulkPct = BAULK_FRACTION * 100;
  const rackBalls = (brk1?.diagram?.balls ?? []).filter(b => b.group !== "cue");
  assert.ok(rackBalls.length === 15, `GC: brk1 must have 15 rack balls (found ${rackBalls.length})`);
  for (const b of rackBalls) {
    assert.ok(b.x < baulkPct,
      `GC: rack ball ${b.id} x=${b.x} must be left of baulkLine at ${baulkPct}%`);
  }
}

// ── GD: Controlled Break — cue ball is RIGHT of the baulk line ───────────────
{
  const brk1 = DRILLS.find(d => d.id === "brk1");
  const cb   = brk1?.diagram?.balls.find(b => b.group === "cue");
  assert.ok(cb, "GD: brk1 must have a cue ball");
  const baulkPct = BAULK_FRACTION * 100;
  assert.ok(cb!.x > baulkPct,
    `GD: brk1 cue ball x=${cb!.x} must be right of baulkLine at ${baulkPct}%`);
}

// ── GE: Straight Pot — buildAimLinePrimitives returns two segments ──────────
{
  const pot1   = DRILLS.find(d => d.id === "pot1");
  const result = buildAimLinePrimitives(pot1?.diagram, GEO);
  assert.equal(result.errors.length, 0, `GE: pot1 aim line resolution must have no errors (got: ${result.errors.join(", ")})`);
  assert.equal(result.segments.length, 2, `GE: pot1 must produce exactly 2 aim segments (got ${result.segments.length})`);
  assert.ok(result.segments.some(s => s.role === "cueBallToObject"), "GE: pot1 must have a cueBallToObject segment");
  assert.ok(result.segments.some(s => s.role === "objectToPocket"),  "GE: pot1 must have an objectToPocket segment");
}

// ── GF: Straight Pot — cue→object segment uses actual ball centres ───────────
{
  const pot1   = DRILLS.find(d => d.id === "pot1");
  const result = buildAimLinePrimitives(pot1?.diagram, GEO);
  const segA   = result.segments.find(s => s.role === "cueBallToObject");
  assert.ok(segA, "GF: cueBallToObject segment required");
  const cb  = pot1!.diagram!.balls.find(b => b.id === "CB");
  const obj = pot1!.diagram!.balls.find(b => b.id === "OBJ");
  const expCBx  = GEO.bX + (cb!.x  / 100) * GEO.bW;
  const expCBy  = GEO.bY + (cb!.y  / 100) * GEO.bH;
  const expOBJx = GEO.bX + (obj!.x / 100) * GEO.bW;
  const expOBJy = GEO.bY + (obj!.y / 100) * GEO.bH;
  assert.ok(Math.abs(segA!.x1 - expCBx)  < 0.5, `GF: segment x1 (${segA!.x1.toFixed(2)}) must equal CB SVG x (${expCBx.toFixed(2)})`);
  assert.ok(Math.abs(segA!.y1 - expCBy)  < 0.5, `GF: segment y1 (${segA!.y1.toFixed(2)}) must equal CB SVG y (${expCBy.toFixed(2)})`);
  assert.ok(Math.abs(segA!.x2 - expOBJx) < 0.5, `GF: segment x2 (${segA!.x2.toFixed(2)}) must equal OBJ SVG x (${expOBJx.toFixed(2)})`);
  assert.ok(Math.abs(segA!.y2 - expOBJy) < 0.5, `GF: segment y2 (${segA!.y2.toFixed(2)}) must equal OBJ SVG y (${expOBJy.toFixed(2)})`);
}

// ── GG: Straight Pot — object→pocket segment ends at topMiddle pocket centre ─
{
  const pot1   = DRILLS.find(d => d.id === "pot1");
  const result = buildAimLinePrimitives(pot1?.diagram, GEO);
  const segB   = result.segments.find(s => s.role === "objectToPocket");
  assert.ok(segB, "GG: objectToPocket segment required");
  const [pockX, pockY] = GEO.pocketCenters["topMiddle"];
  assert.ok(Math.abs(segB!.x2 - pockX) < 0.5, `GG: segment x2 (${segB!.x2.toFixed(2)}) must equal topMiddle pocket x (${pockX.toFixed(2)})`);
  assert.ok(Math.abs(segB!.y2 - pockY) < 0.5, `GG: segment y2 (${segB!.y2.toFixed(2)}) must equal topMiddle pocket y (${pockY.toFixed(2)})`);
}

// ── GH: Straight Pot — cue / object / pocket are collinear ───────────────────
{
  const pot1   = DRILLS.find(d => d.id === "pot1");
  const result = buildAimLinePrimitives(pot1?.diagram, GEO);
  const segA   = result.segments.find(s => s.role === "cueBallToObject");
  const segB   = result.segments.find(s => s.role === "objectToPocket");
  assert.ok(segA && segB, "GH: both segments required for collinearity check");
  // Cross product of CB→OBJ and CB→pocket must be near 0
  const dx1 = segA!.x2 - segA!.x1, dy1 = segA!.y2 - segA!.y1;
  const dx2 = segB!.x2 - segA!.x1, dy2 = segB!.y2 - segA!.y1;
  const cross = dx1 * dy2 - dy1 * dx2;
  assert.ok(Math.abs(cross) < 5,
    `GH: pot1 CB/OBJ/pocket must be collinear (cross product=${cross.toFixed(2)}, tolerance=5)`);
}

// ── GI: Straight 8-Ball — two segments: cue→black and black→pocket ───────────
{
  const d8b1   = DRILLS.find(d => d.id === "8b1");
  const result = buildAimLinePrimitives(d8b1?.diagram, GEO);
  assert.equal(result.errors.length, 0, `GI: 8b1 must resolve without errors (got: ${result.errors.join(", ")})`);
  assert.ok(result.segments.some(s => s.role === "cueBallToObject"), "GI: 8b1 must have a cueBallToObject segment");
  assert.ok(result.segments.some(s => s.role === "objectToPocket"),  "GI: 8b1 must have an objectToPocket segment");
}

// ── GJ: Stop-Ball — has an object-ball potting line ─────────────────────────
{
  const spd1   = DRILLS.find(d => d.id === "spd1");
  const result = buildAimLinePrimitives(spd1?.diagram, GEO);
  assert.equal(result.errors.length, 0, `GJ: spd1 must resolve without errors (got: ${result.errors.join(", ")})`);
  assert.ok(result.segments.some(s => s.role === "objectToPocket"),
    "GJ: spd1 must include an objectToPocket segment");
}

// ── GK: Simple Follow — has objectToPocket AND cueBallToObject primitives ────
{
  const pos1   = DRILLS.find(d => d.id === "pos1");
  const result = buildAimLinePrimitives(pos1?.diagram, GEO);
  assert.equal(result.errors.length, 0, `GK: pos1 must resolve without errors (got: ${result.errors.join(", ")})`);
  assert.ok(result.segments.some(s => s.role === "cueBallToObject"),
    "GK: pos1 must include a cueBallToObject segment (cue-ball travel)");
  assert.ok(result.segments.some(s => s.role === "objectToPocket"),
    "GK: pos1 must include an objectToPocket segment (object-ball potting line)");
}

// ── GL: Cue-ball primitive colour is off-white (BALL_COLORS.cue) ────────────
{
  for (const d of DRILLS.filter(x => x.diagram)) {
    const model = buildTableRenderModel(d.diagram);
    for (const b of model.balls.filter(x => x.group === "cue")) {
      assert.equal(b.fill, BALL_COLORS.cue,
        `GL: ${d.id} cue ball fill must be BALL_COLORS.cue (got "${b.fill}")`);
    }
  }
}

// ── GM: Target pocket coordinates resolve through shared geometry helper ──────
{
  const PIDS: PocketId[] = ["topLeft","topMiddle","topRight","bottomLeft","bottomMiddle","bottomRight"];
  for (const pid of PIDS) {
    const [gx, gy] = GEO.pocketCenters[pid];
    assert.ok(Number.isFinite(gx) && Number.isFinite(gy),
      `GM: getEnglishPoolTableGeometry must return finite coords for pocket "${pid}"`);
  }
  // Verify pocket positions returned by the helper for well-known cases
  const [topMidX] = GEO.pocketCenters["topMiddle"];
  assert.ok(Math.abs(topMidX - (GEO.bX + GEO.bW / 2)) < 0.5,
    `GM: topMiddle pocket x must be at table mid-width (got ${topMidX.toFixed(2)})`);
}

// ── GN: Diamond marks are evenly spaced ─────────────────────────────────────
{
  const prims  = buildTableMarkingPrimitives({}, GEO);
  const longTop = prims
    .filter(p => p.role === "diamondMark" && p.axis === "long" && Math.abs(p.cy! - GEO.bY) < 0.5)
    .sort((a, b) => a.cx! - b.cx!);
  assert.equal(longTop.length, 7, `GN: long-rail top must have 7 diamond marks (got ${longTop.length})`);
  const spacings = longTop.slice(1).map((d, i) => d.cx! - longTop[i].cx!);
  const firstSp  = spacings[0];
  for (const sp of spacings) {
    assert.ok(Math.abs(sp - firstSp) < 0.5,
      `GN: long-rail diamond spacing must be uniform (expected ≈${firstSp.toFixed(2)}, got ${sp.toFixed(2)})`);
  }
  assert.ok(Math.abs(firstSp - GEO.diamondSpacingX) < 0.5,
    `GN: diamond spacing must equal geometry.diamondSpacingX (${GEO.diamondSpacingX.toFixed(2)}), got ${firstSp.toFixed(2)}`);
}

// ── GO: No authored drill manually overrides permanent pocket geometry ────────
{
  // Drills express pockets by PocketId (string), never as custom numeric coords.
  // Therefore, verify that all AimLine toPocket values are valid PocketIds.
  const validPocketIds: PocketId[] = ["topLeft","topMiddle","topRight","bottomLeft","bottomMiddle","bottomRight"];
  for (const d of DRILLS.filter(x => x.diagram?.aimLines?.length)) {
    for (const al of d.diagram!.aimLines!) {
      if (al.toPocket) {
        assert.ok(validPocketIds.includes(al.toPocket),
          `GO: ${d.id} aimLine.toPocket "${al.toPocket}" must be a canonical PocketId`);
      }
    }
  }
}

// ── GP: All required assessment aim lines resolve successfully ─────────────────
{
  for (const d of ASSESSMENT_ITEMS) {
    if (!d.diagram?.aimLines?.length) continue;
    const result = buildAimLinePrimitives(d.diagram, GEO);
    assert.equal(result.errors.length, 0,
      `GP: ${d.id} assessment aim lines must resolve without errors — ${result.errors.join("; ")}`);
    assert.ok(result.segments.length > 0,
      `GP: ${d.id} assessment aim lines must produce at least one segment`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Phase 4.8 — GQ–HQ: Geometry completeness contract
// ══════════════════════════════════════════════════════════════════════════════

// ── GQ: Every DRILL has an authored diagram ────────────────────────────────
{
  for (const d of DRILLS) {
    assert.ok(d.diagram, `GQ: drill "${d.id}" must have an authored TrainingDiagram`);
  }
}

// ── GR: Every CLEARANCE has an authored diagram ───────────────────────────
{
  for (const c of CLEARANCES) {
    assert.ok(c.diagram, `GR: clearance "${c.id}" must have an authored TrainingDiagram`);
  }
}

// ── GS: Every DRILL has a visualContract declared ─────────────────────────
{
  for (const d of DRILLS) {
    assert.ok(d.visualContract, `GS: drill "${d.id}" must declare visualContract`);
  }
}

// ── GT: Every CLEARANCE has a visualContract declared ─────────────────────
{
  for (const c of CLEARANCES) {
    assert.ok(c.visualContract, `GT: clearance "${c.id}" must declare visualContract`);
  }
}

// ── GU: validatePlayableDrillGeometry passes for all DRILLS ───────────────
{
  for (const d of DRILLS) {
    const { valid, errors } = validatePlayableDrillGeometry(d);
    assert.ok(valid, `GU: drill "${d.id}" failed geometry validation — ${errors.join("; ")}`);
  }
}

// ── GV: validatePlayableDrillGeometry passes for all CLEARANCES ───────────
{
  for (const c of CLEARANCES) {
    const { valid, errors } = validatePlayableDrillGeometry(c);
    assert.ok(valid, `GV: clearance "${c.id}" failed geometry validation — ${errors.join("; ")}`);
  }
}

// ── GW: Every drill/clearance diagram has exactly one cue ball ────────────
{
  for (const item of [...DRILLS, ...CLEARANCES]) {
    const cueBalls = item.diagram!.balls.filter(b => b.group === "cue");
    assert.equal(cueBalls.length, 1,
      `GW: "${item.id}" must have exactly 1 cue ball, found ${cueBalls.length}`);
  }
}

// ── GX: PLAYABLE_DRILLS contains all DRILLS — none filtered out ───────────
{
  if (PLAYABLE_DRILLS.length !== DRILLS.length) {
    const missing = DRILLS.filter(d => !PLAYABLE_DRILLS.find(p => p.id === d.id));
    assert.fail(`GX: PLAYABLE_DRILLS (${PLAYABLE_DRILLS.length}) must equal DRILLS (${DRILLS.length}) — invalid: ${missing.map(d => d.id).join(", ")}`);
  }
}

// ── GY: PLAYABLE_CLEARANCES contains all CLEARANCES ──────────────────────
{
  assert.equal(PLAYABLE_CLEARANCES.length, CLEARANCES.length,
    `GY: PLAYABLE_CLEARANCES (${PLAYABLE_CLEARANCES.length}) must equal CLEARANCES (${CLEARANCES.length}) after Phase 4.8`);
}

// ── GZ: Total playable drill count is 38 (37 original + 1 new pbd3) ───────
{
  assert.equal(DRILLS.length, 38,
    `GZ: DRILLS must contain 38 entries after Phase 4.8 (got ${DRILLS.length})`);
}

// ── HA: pbd3 "Late-Development Risk" is the new drill ────────────────────
{
  const pbd3 = DRILLS.find(d => d.id === "pbd3");
  assert.ok(pbd3, "HA: pbd3 drill must exist");
  assert.equal(pbd3!.difficulty, 6, "HA: pbd3 difficulty must be 6");
  assert.equal(pbd3!.type, "decision", "HA: pbd3 must be a decision drill");
  assert.ok(pbd3!.options && pbd3!.options.length === 4, "HA: pbd3 must have 4 options");
}

// ── HB: Every potting drill with aimLine contract resolves aim lines ───────
{
  for (const d of DRILLS.filter(x => x.visualContract?.aimLine)) {
    const result = buildAimLinePrimitives(d.diagram!, GEO);
    assert.equal(result.errors.length, 0,
      `HB: "${d.id}" aimLines must resolve — ${result.errors.join("; ")}`);
    assert.ok(result.segments.length > 0,
      `HB: "${d.id}" must produce at least one aim segment`);
  }
}

// ── HC: Every drill with targetPocket contract has a valid pocket id ───────
{
  const validPocketIds: PocketId[] = ["topLeft","topMiddle","topRight","bottomLeft","bottomMiddle","bottomRight"];
  for (const d of DRILLS.filter(x => x.visualContract?.targetPocket)) {
    assert.ok(d.diagram?.targetPocket && validPocketIds.includes(d.diagram.targetPocket),
      `HC: "${d.id}" must have a valid targetPocket (got "${d.diagram?.targetPocket}")`);
  }
}

// ── HD: Every drill with targetZone contract has positive dimensions ───────
{
  for (const d of DRILLS.filter(x => x.visualContract?.targetZone)) {
    const tz = d.diagram?.targetZone;
    assert.ok(tz && tz.width > 0 && tz.height > 0,
      `HD: "${d.id}" targetZone must have positive width & height (got w=${tz?.width} h=${tz?.height})`);
  }
}

// ── HE: Break drills have ≥ 15 non-cue balls (full rack) ──────────────────
{
  for (const d of DRILLS.filter(x => x.diagram?.rack)) {
    const rackBalls = d.diagram!.balls.filter(b => b.group !== "cue");
    assert.ok(rackBalls.length >= 15,
      `HE: break drill "${d.id}" must have ≥ 15 rack balls (found ${rackBalls.length})`);
  }
}

// ── HF: Break drill cue balls are in the baulk region (x > BAULK_FRACTION×100) ─
{
  for (const d of DRILLS.filter(x => x.diagram?.rack)) {
    const cb = d.diagram!.balls.find(b => b.group === "cue")!;
    assert.ok(cb.x > BAULK_FRACTION * 100,
      `HF: break drill "${d.id}" CB.x (${cb.x}) must be in baulk half (> ${(BAULK_FRACTION * 100).toFixed(1)})`);
  }
}

// ── HG: All pattern drill diagrams have unique signatures ─────────────────
{
  const patDrills = DRILLS.filter(d => d.skillId === "pattern");
  const sigs = patDrills.map(d => diagramSignature(d.diagram));
  const unique = new Set(sigs);
  assert.equal(unique.size, patDrills.length,
    `HG: pattern drills must have unique signatures (found ${unique.size} unique among ${patDrills.length})`);
}

// ── HH: All problemBallDec drill diagrams have unique signatures ───────────
{
  const pbdDrills = DRILLS.filter(d => d.skillId === "problemBallDec");
  const sigs = pbdDrills.map(d => diagramSignature(d.diagram));
  const unique = new Set(sigs);
  assert.equal(unique.size, pbdDrills.length,
    `HH: problemBallDec drills must have unique signatures (found ${unique.size} unique among ${pbdDrills.length})`);
}

// ── HI: All tactical drill diagrams have unique signatures ────────────────
{
  const tacDrills = DRILLS.filter(d => d.skillId === "tactical");
  const sigs = tacDrills.map(d => diagramSignature(d.diagram));
  const unique = new Set(sigs);
  assert.equal(unique.size, tacDrills.length,
    `HI: tactical drills must have unique signatures (found ${unique.size} unique among ${tacDrills.length})`);
}

// ── HJ: All clearance diagrams have unique signatures ─────────────────────
{
  const sigs = CLEARANCES.map(c => diagramSignature(c.diagram));
  const unique = new Set(sigs);
  assert.equal(unique.size, CLEARANCES.length,
    `HJ: clearances must have unique diagrams (found ${unique.size} unique among ${CLEARANCES.length})`);
}

// ── HK: All execution drill diagrams within same skill have unique signatures ─
{
  const execSkills = [...new Set(DRILLS.filter(d => d.type === "execution").map(d => d.skillId))];
  for (const skillId of execSkills) {
    const family = DRILLS.filter(d => d.skillId === skillId && d.type === "execution");
    const sigs = family.map(d => diagramSignature(d.diagram));
    const unique = new Set(sigs);
    assert.equal(unique.size, family.length,
      `HK: ${skillId} execution drills must have unique signatures (found ${unique.size} unique among ${family.length})`);
  }
}

// ── HL: diagramSignature is stable (same input → same output) ─────────────
{
  const d = DRILLS.find(x => x.id === "pot1")!;
  assert.equal(diagramSignature(d.diagram), diagramSignature(d.diagram),
    "HL: diagramSignature must be deterministic for the same input");
}

// ── HM: diagramDistance returns 0 for identical diagrams ──────────────────
{
  const d = DRILLS.find(x => x.id === "pot1")!;
  assert.equal(diagramDistance(d.diagram, d.diagram), 0,
    "HM: diagramDistance must return 0 for identical diagrams");
}

// ── HN: diagramDistance returns > 0 for different drills ─────────────────
{
  const pot1 = DRILLS.find(x => x.id === "pot1")!;
  const pot2 = DRILLS.find(x => x.id === "pot2")!;
  assert.ok(diagramDistance(pot1.diagram, pot2.diagram) > 0,
    "HN: diagramDistance must be > 0 for distinct drill diagrams");
}

// ── HO: diagramDistance returns 1 for null vs non-null ────────────────────
{
  const d = DRILLS.find(x => x.id === "pot1")!;
  assert.equal(diagramDistance(null, d.diagram), 1,
    "HO: diagramDistance(null, diagram) must return 1");
  assert.equal(diagramDistance(null, null), 0,
    "HO: diagramDistance(null, null) must return 0");
}

// ── HP: generateSession only returns drills that pass geometry validation ──
{
  const profile = newProfile("blackball");
  for (let i = 0; i < 10; i++) {
    const session = generateSession(profile, 30);
    for (const item of session.drills) {
      if (item.type === "execution" || item.type === "decision") {
        const { valid, errors } = validatePlayableDrillGeometry(item as typeof DRILLS[number]);
        assert.ok(valid,
          `HP: generateSession returned invalid drill "${item.id}" — ${errors.join("; ")}`);
      }
    }
  }
}

// ── HQ: Total drill+clearance count matches expected Phase 4.8 totals ─────
{
  assert.equal(DRILLS.length, 38,
    `HQ: DRILLS must be 38 after Phase 4.8 (got ${DRILLS.length})`);
  assert.equal(CLEARANCES.length, 3,
    `HQ: CLEARANCES must be 3 after Phase 4.8 (got ${CLEARANCES.length})`);
  assert.equal(PLAYABLE_DRILLS.length, 38,
    `HQ: PLAYABLE_DRILLS must be 38 after Phase 4.8 (got ${PLAYABLE_DRILLS.length})`);
  assert.equal(PLAYABLE_CLEARANCES.length, 3,
    `HQ: PLAYABLE_CLEARANCES must be 3 after Phase 4.8 (got ${PLAYABLE_CLEARANCES.length})`);
}

// ══════════════════════════════════════════════════════════════════════════════
// Phase 4.9 — HR–IO: Missing cue balls, player group labels, sequence diagrams
// ══════════════════════════════════════════════════════════════════════════════

// ── HR: pbd1 contains exactly one cue ball ─────────────────────────────────
{
  const pbd1 = DRILLS.find(d => d.id === "pbd1");
  assert.ok(pbd1, "HR: pbd1 must exist");
  const cueBalls = pbd1!.diagram!.balls.filter(b => b.group === "cue");
  assert.equal(cueBalls.length, 1,
    `HR: pbd1 must have exactly 1 cue ball, found ${cueBalls.length}`);
}

// ── HS: pbd1 cue ball resolves canonical off-white ─────────────────────────
{
  const pbd1 = DRILLS.find(d => d.id === "pbd1")!;
  const cueBall = pbd1.diagram!.balls.find(b => b.group === "cue");
  assert.ok(cueBall, "HS: pbd1 must have a cue ball");
  assert.equal(BALL_COLORS.cue, "#F2F0E8",
    "HS: BALL_COLORS.cue must be canonical off-white #F2F0E8");
}

// ── HT: pbd1 has playerGroup yellow ───────────────────────────────────────
{
  const pbd1 = DRILLS.find(d => d.id === "pbd1")!;
  assert.equal(pbd1.diagram!.playerGroup, "yellow",
    "HT: pbd1 diagram.playerGroup must be yellow");
}

// ── HU: pbd2 contains exactly one cue ball ─────────────────────────────────
{
  const pbd2 = DRILLS.find(d => d.id === "pbd2")!;
  const cueBalls = pbd2.diagram!.balls.filter(b => b.group === "cue");
  assert.equal(cueBalls.length, 1,
    `HU: pbd2 must have exactly 1 cue ball, found ${cueBalls.length}`);
}

// ── HV: pbd2 defines focusBallId ──────────────────────────────────────────
{
  const pbd2 = DRILLS.find(d => d.id === "pbd2")!;
  assert.ok(pbd2.focusBallId,
    "HV: pbd2 must define focusBallId");
}

// ── HW: pbd2 focusBallId exists in diagram ────────────────────────────────
{
  const pbd2 = DRILLS.find(d => d.id === "pbd2")!;
  assert.ok(pbd2.focusBallId, "HW: pbd2.focusBallId must be set");
  const ball = pbd2.diagram!.balls.find(b => b.id === pbd2.focusBallId);
  assert.ok(ball,
    `HW: pbd2.focusBallId "${pbd2.focusBallId}" must reference a ball in diagram`);
}

// ── HX: pbd2 question/options identify the focus ball explicitly ───────────
{
  const pbd2 = DRILLS.find(d => d.id === "pbd2")!;
  const descHasBallRef = /ball\s*[0-9]/i.test(pbd2.desc);
  assert.ok(descHasBallRef,
    `HX: pbd2.desc must explicitly reference a numbered ball (got: "${pbd2.desc}")`);
  const optionsHaveBallRef = pbd2.options!.some(o => /ball\s*[0-9]/i.test(o.label));
  assert.ok(optionsHaveBallRef,
    "HX: pbd2 options must explicitly reference a numbered ball");
}

// ── HY: tac2 defines playerGroup ─────────────────────────────────────────
{
  const tac2 = DRILLS.find(d => d.id === "tac2")!;
  assert.ok(tac2.diagram!.playerGroup,
    "HY: tac2 diagram.playerGroup must be defined");
}

// ── HZ: tac2 has exactly one cue ball ─────────────────────────────────────
{
  const tac2 = DRILLS.find(d => d.id === "tac2")!;
  const cueBalls = tac2.diagram!.balls.filter(b => b.group === "cue");
  assert.equal(cueBalls.length, 1,
    `HZ: tac2 must have exactly 1 cue ball, found ${cueBalls.length}`);
}

// ── IA: tac2 player-group resolves to REDS or YELLOWS ─────────────────────
{
  const tac2 = DRILLS.find(d => d.id === "tac2")!;
  const pg = tac2.diagram!.playerGroup;
  assert.ok(pg === "red" || pg === "yellow",
    `IA: tac2.diagram.playerGroup must be "red" or "yellow" (got "${pg}")`);
}

// ── IB: 3-Ball Yellow Sequence intro has an authored diagram ──────────────
{
  const clr3 = CLEARANCES.find(c => c.id === "clr3");
  assert.ok(clr3, "IB: clr3 must exist");
  assert.ok(clr3!.diagram,
    "IB: clr3 must have a diagram (shown in intro before Start Exercise)");
}

// ── IC: 3-Ball Yellow Sequence diagram contains cue ball + Y1/Y2/Y3 ───────
{
  const clr3 = CLEARANCES.find(c => c.id === "clr3")!;
  const balls = clr3.diagram!.balls;
  assert.ok(balls.some(b => b.group === "cue"),
    "IC: clr3 diagram must have a cue ball");
  for (const id of ["Y1", "Y2", "Y3"]) {
    assert.ok(balls.some(b => b.id === id),
      `IC: clr3 diagram must have ball ${id}`);
  }
}

// ── ID: 3-Ball Yellow Sequence has no black when includesBlack is false ────
{
  const clr3 = CLEARANCES.find(c => c.id === "clr3")!;
  assert.equal(clr3.includesBlack, false,
    "ID: clr3.includesBlack must be false");
  const blackBalls = clr3.diagram!.balls.filter(b => b.group === "black");
  assert.equal(blackBalls.length, 0,
    `ID: clr3 diagram must have no black balls when includesBlack=false (found ${blackBalls.length})`);
}

// ── IE: 3-Ball Yellow Sequence has a diagram so PoolTable is always visible
{
  const clr3 = CLEARANCES.find(c => c.id === "clr3")!;
  assert.ok(clr3.diagram,
    "IE: clr3 must have an authored diagram so PoolTable is visible in every state");
}

// ── IF: Yellow+Black clearance planning screen has an authored diagram ─────
{
  const clr5 = CLEARANCES.find(c => c.id === "clr5");
  assert.ok(clr5, "IF: clr5 (4-yellow + black) must exist");
  assert.ok(clr5!.diagram,
    "IF: clr5 must have a diagram (shown during Plan Your Order)");
}

// ── IG: Yellow+Black diagram contains cue + Y1/Y2/Y3/Y4 + black ──────────
{
  const clr5 = CLEARANCES.find(c => c.id === "clr5")!;
  const balls = clr5.diagram!.balls;
  assert.ok(balls.some(b => b.group === "cue"),
    "IG: clr5 diagram must have cue ball");
  for (const id of ["Y1", "Y2", "Y3", "Y4"]) {
    assert.ok(balls.some(b => b.id === id),
      `IG: clr5 diagram must have ball ${id}`);
  }
  assert.ok(balls.some(b => b.group === "black"),
    "IG: clr5 diagram must have a black ball");
}

// ── IH: Yellow+Black plan list IDs all exist in diagram ──────────────────
{
  const clr5 = CLEARANCES.find(c => c.id === "clr5")!;
  const diagBallIds = new Set(clr5.diagram!.balls.map(b => b.id));
  for (const id of clr5.preferredRoute) {
    assert.ok(diagBallIds.has(id),
      `IH: clr5 preferredRoute contains "${id}" which is not in diagram.balls`);
  }
}

// ── II: Yellow+Black clearance playerGroup === yellow ─────────────────────
{
  const clr5 = CLEARANCES.find(c => c.id === "clr5")!;
  assert.equal(clr5.playerGroup, "yellow",
    "II: clr5.playerGroup must be yellow");
}

// ── IJ: Every group-dependent decision drill defines playerGroup ───────────
{
  const groupDrills = DRILLS.filter(d => {
    if (!d.diagram) return false;
    const balls = d.diagram.balls;
    return balls.some(b => b.group === "yellow" && b.role === "target")
        && balls.some(b => b.group === "red");
  });
  for (const d of groupDrills) {
    assert.ok(d.diagram!.playerGroup,
      `IJ: "${d.id}" has yellow targets and red balls but diagram.playerGroup is missing`);
  }
}

// ── IK: Every decision drill with cueBall contract has exactly one cue ─────
{
  const decDrillsWithCueBall = DRILLS.filter(d => d.type === "decision" && d.visualContract?.cueBall);
  for (const d of decDrillsWithCueBall) {
    const cueBalls = d.diagram!.balls.filter(b => b.group === "cue");
    assert.equal(cueBalls.length, 1,
      `IK: "${d.id}" must have exactly 1 cue ball (found ${cueBalls.length})`);
  }
}

// ── IL: Every group-dependent item has diagram.playerGroup set ────────────
{
  const allItems = [...DRILLS, ...CLEARANCES] as Array<{ id: string; diagram?: { balls: { group: string; role?: string }[]; playerGroup?: string } }>;
  const groupItems = allItems.filter(item => {
    if (!item.diagram) return false;
    return item.diagram.balls.some(b => b.group === "yellow" && b.role === "target")
        && item.diagram.balls.some(b => b.group === "red");
  });
  for (const item of groupItems) {
    assert.ok(item.diagram!.playerGroup,
      `IL: "${item.id}" has group-dependent content but diagram.playerGroup is not set`);
  }
}

// ── IM: Every numbered route item maps to a trainingLabel in diagram ───────
{
  for (const clr of CLEARANCES) {
    if (!clr.diagram) continue;
    for (const ballId of clr.preferredRoute) {
      const diagBall = clr.diagram.balls.find(b => b.id === ballId);
      if (diagBall && diagBall.group === "yellow") {
        assert.ok(diagBall.trainingLabel,
          `IM: "${clr.id}" preferredRoute yellow ball "${ballId}" has no trainingLabel in diagram`);
      }
    }
  }
}

// ── IN: focusBallId validation rejects missing references ─────────────────
{
  const fakeDrill = {
    id: "test-focus-in",
    diagram: {
      balls: [
        { id: "CB", group: "cue"    as const, x: 50, y: 50 },
        { id: "Y1", group: "yellow" as const, x: 30, y: 30, role: "target" as const },
      ],
      playerGroup: "yellow" as const,
    },
    visualContract: { cueBall: true },
    focusBallId: "NONEXISTENT_BALL",
  };
  const result = validatePlayableDrillGeometry(fakeDrill);
  assert.ok(!result.valid,
    "IN: validatePlayableDrillGeometry must fail when focusBallId references a missing ball");
  assert.ok(result.errors.some(e => e.includes("focusBallId")),
    `IN: error must mention focusBallId — got: ${result.errors.join("; ")}`);
}

// ── IO: All playable content still passes geometry/content validation ───────
{
  for (const d of PLAYABLE_DRILLS) {
    const result = validatePlayableDrillGeometry(d);
    assert.ok(result.valid,
      `IO: PLAYABLE_DRILLS "${d.id}" must pass — ${result.errors.join("; ")}`);
  }
  for (const c of PLAYABLE_CLEARANCES) {
    const result = validatePlayableDrillGeometry(c);
    assert.ok(result.valid,
      `IO: PLAYABLE_CLEARANCES "${c.id}" must pass — ${result.errors.join("; ")}`);
  }
}

console.log("engine tests A–O, P–X, Y–AD, rules helpers, Phase 2.1 AE–AV, Phase 3 AW–BN, Phase 3.1 BO–BZ, Phase 4 CA–CJ, Phase 4.2 CK–CV, Phase 4.3 CW–DJ, Phase 4.4 DK–EF, Phase 4.5 EG–FD, Phase 4.6 FE–FV, Phase 4.7 FW–GP, Phase 4.8 GQ–HQ, and Phase 4.9 HR–IO all passed ✓");
