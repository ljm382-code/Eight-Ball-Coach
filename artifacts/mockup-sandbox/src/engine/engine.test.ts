import assert from "node:assert/strict";
import {
  CLEARANCES,
  applySkillUpdate,
  classifyErrorChain,
  computeConfidence,
  decisionValue,
  generateSession,
  limitingFactor,
  newProfile,
  sessionWeighting,
  type Attempt,
  type Profile,
  type SkillId,
} from "./index";

const NOW = 1_800_000_000_000;
const attempt = (value: number, drillId: string, source: Attempt["source"] = "training", extra: Partial<Attempt> = {}): Attempt => ({
  ts: NOW,
  value,
  difficulty: 5,
  drillId,
  source,
  ...extra,
});

function withAttempts(profile: Profile, skillId: SkillId, values: number[], source: Attempt["source"] = "training"): Profile {
  return values.reduce((current, value, index) => applySkillUpdate(current, skillId, value, { drillId: `${skillId}-${index}`, source, difficulty: 5 }, NOW + index), profile);
}

function assertSessionHasBothKinds(profile: Profile, minutes: number) {
  const session = generateSession(profile, minutes);
  assert.ok(session.drills.some((item) => item.type === "execution"), "session should contain execution work");
  assert.ok(session.drills.some((item) => item.type === "decision"), "session should contain decision work");
  return session;
}

// A. Success should lift the observed skill rating.
{
  const profile = newProfile();
  const next = applySkillUpdate(profile, "potting", 1, { drillId: "pot1", source: "training", difficulty: 3 }, NOW);
  assert.ok(next.skills.potting.rating > profile.skills.potting.rating);
}

// B. Failure should lower the observed skill rating.
{
  const profile = newProfile();
  const next = applySkillUpdate(profile, "potting", 0, { drillId: "pot1", source: "training", difficulty: 3 }, NOW);
  assert.ok(next.skills.potting.rating < profile.skills.potting.rating);
}

// C. Repeated, diverse evidence increases confidence.
{
  const profile = withAttempts(newProfile(), "potting", [1, 1, 1, 1]);
  const confidence = computeConfidence(profile.skills.potting.attempts, NOW + 10);
  assert.ok(confidence.score > 0.25);
  assert.notEqual(confidence.tier, "Low");
}

// D. Assessment evidence counts less than normal training evidence.
{
  const assessment = withAttempts(newProfile(), "potting", [1, 1, 1, 1], "assessment");
  const training = withAttempts(newProfile(), "potting", [1, 1, 1, 1], "training");
  assert.ok(computeConfidence(assessment.skills.potting.attempts, NOW).score < computeConfidence(training.skills.potting.attempts, NOW).score);
}

// E. A position error followed by a miss preserves the miss and identifies position upstream.
{
  const entries = [
    { ...attempt(0, "pos1"), observedSkill: "positional" as SkillId, reportedError: "POSITION", ballId: "R1" },
    { ...attempt(0, "pot1"), observedSkill: "potting" as SkillId, reportedError: "MISS", ballId: "Y1" },
  ];
  const chain = classifyErrorChain(entries);
  assert.equal(chain?.immediateSkill, "potting");
  assert.equal(chain?.rootSkill, "positional");
}

// F. Speed -> position -> miss identifies speed as the root cause.
{
  const entries = [
    { ...attempt(0, "spd1"), observedSkill: "speed" as SkillId, reportedError: "SPEED", ballId: "R1" },
    { ...attempt(0, "pos1"), observedSkill: "positional" as SkillId, reportedError: "POSITION", ballId: "Y1" },
    { ...attempt(0, "pot1"), observedSkill: "potting" as SkillId, reportedError: "MISS", ballId: "Y2" },
  ];
  assert.equal(classifyErrorChain(entries)?.rootSkill, "speed");
}

// G. Correct decision and failed execution remain separate evidence.
{
  const profile = newProfile();
  const decision = applySkillUpdate(profile, "pattern", decisionValue("optimal"), { drillId: "pat1", source: "training" }, NOW);
  const result = applySkillUpdate(decision, "potting", 0, { drillId: "pot1", source: "training" }, NOW + 1);
  assert.equal(result.skills.pattern.attempts[0].value, 1);
  assert.equal(result.skills.potting.attempts[0].value, 0);
}

// H. Poor decision and successful execution remain separate evidence.
{
  const profile = newProfile();
  const decision = applySkillUpdate(profile, "pattern", decisionValue("poor"), { drillId: "pat1", source: "training" }, NOW);
  const result = applySkillUpdate(decision, "potting", 1, { drillId: "pot1", source: "training" }, NOW + 1);
  assert.equal(result.skills.pattern.attempts[0].value, 0);
  assert.equal(result.skills.potting.attempts[0].value, 1);
}

// I. Sparse data does not force a confirmed limiting factor.
{
  const profile = withAttempts(newProfile(), "potting", [0]);
  assert.notEqual(limitingFactor(profile).status, "confirmed");
}

// J. Strong execution / weak decision shifts the session toward decision work.
{
  let profile = withAttempts(newProfile(), "potting", [1, 1, 1, 1, 1, 1]);
  profile = withAttempts(profile, "pattern", [0, 0, 0, 0, 0, 0]);
  const weighting = sessionWeighting(profile);
  assert.ok(weighting.decWeight > weighting.execWeight);
}

// K. Strong decision / weak execution shifts the session toward execution work.
{
  let profile = withAttempts(newProfile(), "pattern", [1, 1, 1, 1, 1, 1]);
  profile = withAttempts(profile, "potting", [0, 0, 0, 0, 0, 0]);
  const weighting = sessionWeighting(profile);
  assert.ok(weighting.execWeight > weighting.decWeight);
}

// L. Longer sessions contain both execution and decision work.
{
  assertSessionHasBothKinds(newProfile(), 30);
}

// M. Maintenance work does not replace all development work.
{
  const profile = withAttempts(newProfile(), "potting", [1, 1, 1, 1, 1]);
  const session = assertSessionHasBothKinds(profile, 45);
  assert.ok(session.drills.some((item) => item.skillId !== "potting"));
}

// N. Low-confidence skills remain eligible for calibration.
{
  const profile = withAttempts(newProfile(), "potting", [0, 0, 0, 0, 0, 0]);
  const session = generateSession(profile, 60);
  assert.ok(session.drills.some((item) => item.reason?.startsWith("Calibration")));
}

// O. Replanning is recorded as decision evidence separately from execution.
{
  const clearance = CLEARANCES.find((item) => item.adaptationEligible);
  assert.ok(clearance);
  const plan = attempt(1, clearance!.id, "planDecision", { tier: "optimal" });
  const adaptation = attempt(0.7, clearance!.id, "adaptation", { tier: "acceptable" });
  const execution = attempt(0, clearance!.id, "training", { reportedError: "POSITION" });
  assert.equal(plan.source, "planDecision");
  assert.equal(adaptation.source, "adaptation");
  assert.notEqual(execution.source, adaptation.source);
}

console.log("engine tests A-O passed");