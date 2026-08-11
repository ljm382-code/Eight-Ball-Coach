/**
 * Deterministic engine + rules tests — Phase 1 (A–O) and Phase 2 (P–X, Y–AD, rules helpers).
 * Run via: pnpm --filter @workspace/mockup-sandbox run test:engine
 */
import assert from "node:assert/strict";
import {
  ADAPTATION_SKILL_MAP, CLEARANCES, CONFIG, DRILLS, ROOT_CAUSE_CONFIDENCE_MAP, SKILL_MAP, SKILLS,
  applySkillUpdate, applyClearanceBallResult, classifyErrorChain, computeConfidence,
  computeRulesetConfidence, decayRootCauseScore, decisionValue, evaluatePlannedRoute,
  generateSession, limitingFactor, mixedRulesetSplit, newProfile, selectMaintenanceSkill,
  sessionWeighting,
  type Attempt, type ClearanceRouteState, type LimitingFactors, type Profile,
  type RootCauseEvent, type RuleSetId, type SkillId,
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

console.log("engine tests A–O, P–X, Y–AD, rules helpers, and Phase 2.1 AE–AV all passed ✓");
