import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from "recharts";
import { Check, ChevronRight, Play, RotateCcw, TrendingDown, TrendingUp, Minus, X } from "lucide-react";
import {
  ADAPTATION_SKILL_MAP, ASSESSMENT_CLEARANCE, ASSESSMENT_ITEMS, CLEARANCES, DRILLS,
  ERROR_CODES, RULESETS, SKILLS, SKILL_MAP,
  applySkillUpdate, appendRatingSnapshots, buildErrorChainNarrative, buildRootCauseEvents,
  buildSummary, classifyErrorChain, confidenceLabel, computeConfidence, computeRulesetConfidence,
  decisionValue, evaluatePlannedRoute, generateSession, isStale, limitingFactor,
  newProfile, sessionWeighting, trendFor,
  type Attempt, type Clearance, type DecisionOption, type Drill, type Profile,
  type RootCauseEvent, type RuleSetId, type RulesMode, type SessionSummary, type SkillId,
} from "./engine";
import { clearProfile, loadProfile, saveProfile, updateRulesMode } from "./persistence/profileStorage";
import { getLegalBalls, isEightBallLegal } from "./rules";

// ─── View types and palette ────────────────────────────────────────────────────
type View = "onboarding" | "assessment" | "provisional" | "dashboard" | "pickTime" | "session" | "summary" | "progress" | "library" | "settings";
const C = { bg: "#0e1a15", panel: "#16261e", panel2: "#1d3025", line: "#2a4436", ink: "#edeae1", dim: "#9fb3a8", brass: "#c9a15a", chalk: "#6fa8c9", rust: "#b5533c", green: "#4e8b6b" };
const fontImport = "@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Mono:wght@400;600&family=Inter:wght@400;500;600;700&display=swap');";
const titles: Record<View, string> = { onboarding: "Welcome", assessment: "Initial Assessment", provisional: "Your Starting Profile", dashboard: "Today", pickTime: "Session Length", session: "Training", summary: "Session Summary", progress: "Progress", library: "Drill Library", settings: "Settings" };

// ─── Shared UI primitives ──────────────────────────────────────────────────────
function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18, ...style }}>{children}</section>;
}
function Label({ children }: { children: ReactNode }) {
  return <div style={{ color: C.dim, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 1, marginBottom: 7, textTransform: "uppercase" }}>{children}</div>;
}
function Button({ children, onClick, variant = "default", disabled = false, style }: { children: ReactNode; onClick?: () => void; variant?: "default" | "primary" | "success" | "danger" | "ghost"; disabled?: boolean; style?: CSSProperties }) {
  const styles: Record<string, CSSProperties> = {
    default: { background: C.panel2, border: `1px solid ${C.line}`, color: C.ink },
    primary: { background: C.brass, color: C.bg },
    success: { background: "#245c3e", color: C.ink },
    danger:  { background: "#5c2f26", color: C.ink },
    ghost:   { background: "transparent", color: C.dim },
  };
  return <button disabled={disabled} onClick={onClick} style={{ alignItems: "center", borderRadius: 10, cursor: disabled ? "not-allowed" : "pointer", display: "flex", fontFamily: "'Inter', sans-serif", fontSize: 14, fontWeight: 600, justifyContent: "center", minHeight: 46, opacity: disabled ? .5 : 1, padding: "12px 15px", width: "100%", ...styles[variant], ...style }}>{children}</button>;
}
function ProgressBar({ value, color = C.brass }: { value: number; color?: string }) {
  return <div style={{ background: C.panel2, borderRadius: 5, height: 7, overflow: "hidden" }}><div style={{ background: color, height: "100%", transition: "width .35s ease", width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}
function TableDiagram({ balls = [], size = 70 }: { balls?: { color?: string }[]; size?: number }) {
  return <svg height={size} viewBox="0 0 170 100" width={size * 1.7}><rect fill={C.panel2} height="92" rx="6" stroke={C.brass} strokeWidth="2" width="162" x="4" y="4" />{[[6,6],[83,3],[160,6],[6,90],[83,96],[160,90]].map(([cx,cy],i) => <circle key={i} cx={cx} cy={cy} fill="#0a1310" r="6" />)}{balls.map((ball,i) => <circle key={i} cx={20+i*22} cy="50" fill={ball.color ?? C.chalk} r="8" stroke="#0a1310" strokeWidth="1.5" />)}</svg>;
}
function TrendIcon({ trend }: { trend: string }) {
  if (trend === "up")   return <TrendingUp   color={C.green} size={14} />;
  if (trend === "down") return <TrendingDown color={C.rust}  size={14} />;
  return <Minus color={C.dim} size={14} />;
}
function WhyThisDrill({ reason }: { reason?: string }) {
  return reason ? <details style={{ marginBottom: 14 }}><summary style={{ color: C.dim, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>Why this drill?</summary><div style={{ color: C.dim, fontSize: 13, lineHeight: 1.5, marginTop: 7 }}>{reason}</div></details> : null;
}
function RulesBadge({ ruleset }: { ruleset: RuleSetId }) {
  return <div style={{ background: ruleset === "blackball" ? C.brass : C.chalk, borderRadius: 4, color: C.bg, display: "inline-block", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1.2, marginBottom: 10, padding: "3px 9px", textTransform: "uppercase" }}>{ruleset === "blackball" ? "BLACKBALL" : "INTERNATIONAL RULES"}</div>;
}

// ─── App shell ─────────────────────────────────────────────────────────────────
function AppShell({ view, children, onNav, profile }: { view: View; children: ReactNode; onNav: (view: View) => void; profile: Profile }) {
  const nav = [{ id: "dashboard" as const, label: "Today" }, { id: "library" as const, label: "Library" }, { id: "progress" as const, label: "Progress" }, { id: "settings" as const, label: "Rules" }];
  const modeLabel = profile.preferredRulesMode === "mixed" ? "Mixed Training" : RULESETS[profile.ruleset].name;
  return <div style={{ background: C.bg, color: C.ink, fontFamily: "'Inter', sans-serif", minHeight: "100vh" }}><style>{fontImport}{`*{box-sizing:border-box}body{margin:0;background:${C.bg}}button:hover:not(:disabled){filter:brightness(1.08)}button:active:not(:disabled){transform:scale(.98)}`}</style><div style={{ display: "flex", flexDirection: "column", margin: "0 auto", maxWidth: 520, minHeight: "100vh" }}><header style={{ borderBottom: `1px solid ${C.line}`, padding: "18px 16px 11px" }}><div style={{ color: C.brass, fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: 1.5 }}>8-BALL COACH</div><div style={{ color: C.dim, fontSize: 13, marginTop: 2 }}>{titles[view]} <span style={{ color: C.line }}>·</span> {modeLabel}</div></header><main style={{ flex: 1, padding: 16, paddingBottom: 92 }}>{children}</main><nav style={{ background: C.panel, borderTop: `1px solid ${C.line}`, bottom: 0, display: "flex", position: "fixed", width: "min(100%, 520px)", zIndex: 5 }}>{nav.map((item) => <button key={item.id} onClick={() => onNav(item.id)} style={{ background: "transparent", border: 0, color: view === item.id ? C.brass : C.dim, cursor: "pointer", flex: 1, fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: view === item.id ? 700 : 500, padding: "15px 4px" }}>{item.label}</button>)}</nav></div></div>;
}

// ─── Onboarding ────────────────────────────────────────────────────────────────
const MODES_FOR_ONBOARDING: { mode: RulesMode; label: string; description: string }[] = [
  { mode: "blackball",     label: "Blackball Rules",     description: "The compact, tactical game built around reds, yellows and the black." },
  { mode: "international", label: "International Rules", description: "The internationally recognised 8-ball format with its own tactical rhythm." },
  { mode: "mixed",         label: "Both",                description: "Your training will include both rulesets. Every rules-specific exercise will be clearly labelled." },
];
function Onboarding({ onChoose }: { onChoose: (mode: RulesMode) => void }) {
  const [mode, setMode] = useState<RulesMode>("blackball");
  return <div style={{ alignItems: "center", display: "flex", justifyContent: "center", minHeight: "100vh", padding: 18 }}><div style={{ maxWidth: 440, width: "100%" }}><div style={{ color: C.brass, fontFamily: "'Bebas Neue', sans-serif", fontSize: 38, letterSpacing: 2, marginBottom: 8 }}>8-BALL COACH</div><h1 style={{ fontSize: 28, lineHeight: 1.1, margin: "0 0 14px" }}>Train the part of your game that is costing frames.</h1><p style={{ color: C.dim, fontSize: 15, lineHeight: 1.65, margin: "0 0 28px" }}>8-Ball Coach learns your game and adapts your training to fix the weaknesses that matter most.</p><Card style={{ marginBottom: 14 }}><Label>Which rules do you usually play?</Label><div style={{ display: "grid", gap: 9 }}>{MODES_FOR_ONBOARDING.map((item) => <button key={item.mode} onClick={() => setMode(item.mode)} style={{ background: mode === item.mode ? "#284735" : C.panel2, border: `1px solid ${mode === item.mode ? C.brass : C.line}`, borderRadius: 10, color: C.ink, cursor: "pointer", padding: 14, textAlign: "left" }}><div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}><strong>{item.label}</strong>{mode === item.mode && <Check color={C.brass} size={18} />}</div><div style={{ color: C.dim, fontSize: 12, lineHeight: 1.45, marginTop: 5 }}>{item.description}</div></button>)}</div></Card><Button variant="primary" onClick={() => onChoose(mode)}>Start a short assessment <ChevronRight size={17} /></Button><div style={{ color: C.dim, fontSize: 12, lineHeight: 1.5, marginTop: 14, textAlign: "center" }}>Your ratings are always shared. You can change your training preference in Settings at any time.</div></div></div>;
}

// ─── Skill radar ───────────────────────────────────────────────────────────────
function SkillRadar({ profile, color = C.chalk }: { profile: Profile; color?: string }) {
  const data = SKILLS.map((s) => ({ skill: s.shortName, value: Math.round(profile.skills[s.id].rating) }));
  return <Card style={{ height: 286, marginBottom: 14 }}><ResponsiveContainer height="100%" width="100%"><RadarChart data={data} outerRadius="69%"><PolarGrid stroke={C.line} /><PolarAngleAxis dataKey="skill" tick={{ fill: C.dim, fontSize: 9 }} /><Radar dataKey="value" fill={color} fillOpacity={.22} stroke={color} /></RadarChart></ResponsiveContainer></Card>;
}

// ─── Assessment ────────────────────────────────────────────────────────────────
function Assessment({ profile, onDone }: { profile: Profile; onDone: (profile: Profile) => void }) {
  const [index, setIndex] = useState(0);
  const profileRef = useRef(profile);
  const total = ASSESSMENT_ITEMS.length + 1;
  const current = index === ASSESSMENT_ITEMS.length ? ASSESSMENT_CLEARANCE : ASSESSMENT_ITEMS[index];
  const activeRuleset: RuleSetId = profile.preferredRulesMode === "international" ? "international" : "blackball";
  const advance = (next: Profile) => { profileRef.current = next; index + 1 >= total ? onDone({ ...next, assessmentComplete: true }) : setIndex((v) => v + 1); };
  return <div><div style={{ marginBottom: 16 }}><Label>Step {index + 1} of {total}</Label><ProgressBar value={index / total * 100} /></div>{current.type === "combined" ? <ClearanceRunner clearance={current} profile={profileRef.current} source="assessment" activeRuleset={activeRuleset} onComplete={advance} /> : <DrillRunner drill={current as Drill} profile={profileRef.current} source="assessment" activeRuleset={activeRuleset} onComplete={advance} />}</div>;
}

function Provisional({ profile, onContinue }: { profile: Profile; onContinue: () => void }) {
  const mean = SKILLS.reduce((sum, s) => sum + profile.skills[s.id].rating, 0) / SKILLS.length;
  const strengths = SKILLS.filter((s) => profile.skills[s.id].rating >= mean + 5).map((s) => s.name);
  const focus = SKILLS.filter((s) => profile.skills[s.id].rating < mean - 5).sort((a, b) => profile.skills[a.id].rating - profile.skills[b.id].rating).map((s) => s.name);
  return <div><Card style={{ marginBottom: 14 }}><p style={{ lineHeight: 1.6, margin: 0 }}>Here's your starting picture. {strengths.length > 0 && <><strong style={{ color: C.brass }}>{strengths.slice(0, 2).join(" and ")}</strong> look like early strengths. </>}{focus.length > 0 && <><strong style={{ color: C.chalk }}>{focus.slice(0, 2).join(" and ")}</strong> are good places to start. </>}This is a rough sketch — confidence sharpens as you train.</p></Card><SkillRadar color={C.brass} profile={profile} /><Button variant="primary" onClick={onContinue}>Start your first training session <Play size={17} /></Button></div>;
}

// ─── Dashboard ─────────────────────────────────────────────────────────────────
function Dashboard({ profile, onStart, onNav }: { profile: Profile; onStart: () => void; onNav: (view: View) => void }) {
  const lf = limitingFactor(profile);
  const weighting = sessionWeighting(profile, lf);
  const recent = profile.sessions.slice(-3).reverse();
  return <div><Card style={{ marginBottom: 14 }}><Label>Today's training</Label><div style={{ fontSize: 21, fontWeight: 700, marginBottom: 5 }}>{lf.primary ? lf.primary.name : "Build a broader picture"}</div><p style={{ color: C.dim, fontSize: 13, lineHeight: 1.5, margin: "0 0 15px" }}>{lf.status === "insufficient" ? "Still gathering evidence — today's session samples across your game." : `${lf.status === "provisional" ? "Early signal: " : ""}${lf.primary?.name} is currently the biggest opportunity.`}</p><Button variant="primary" onClick={onStart}><Play size={17} /> Start training</Button></Card><div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr", marginBottom: 14 }}><Card><Label>Main focus</Label><div style={{ fontSize: 14 }}>{lf.primary?.name ?? "Still learning"}</div><div style={{ color: C.dim, fontSize: 12, marginTop: 6 }}>{lf.primary ? `${Math.round(lf.primary.rating)} / 100` : "More evidence needed"}</div></Card><Card><Label>Session balance</Label><div style={{ fontSize: 14 }}>{weighting.execWeight}% execution</div><div style={{ color: C.dim, fontSize: 12, marginTop: 6 }}>{weighting.decWeight}% decision work</div></Card></div><Card style={{ marginBottom: 14 }}><Label>Recent progress</Label>{!recent.length && <div style={{ color: C.dim, fontSize: 13 }}>No sessions yet. Your first session will start the feedback loop.</div>}{recent.map((s, i) => <div key={`${s.ts}-${i}`} style={{ borderBottom: i === recent.length - 1 ? 0 : `1px solid ${C.line}`, color: C.dim, fontSize: 13, padding: "9px 0" }}>{new Date(s.ts).toLocaleDateString()} — {s.summary.changeNote}</div>)}</Card><Button onClick={() => onNav("progress")}>View full skill profile <ChevronRight size={16} /></Button></div>;
}

function PickTime({ onPick }: { onPick: (minutes: number) => void }) {
  return <Card><Label>How much time do you have?</Label><p style={{ color: C.dim, fontSize: 13, lineHeight: 1.5, margin: "0 0 14px" }}>The session adjusts its balance, difficulty, and variety to fit.</p><div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>{[15, 30, 45, 60, 90].map((m) => <Button key={m} onClick={() => onPick(m)} style={{ fontSize: 17, minHeight: 64 }}>{m} min</Button>)}</div></Card>;
}

// ─── Drill runner ──────────────────────────────────────────────────────────────
function ErrorGrid({ onPick }: { onPick: (code: string) => void }) {
  return <div><Label>What went wrong?</Label><div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>{ERROR_CODES.map((code) => <Button key={code} onClick={() => onPick(code)}>{code}</Button>)}</div></div>;
}

function DrillRunner({ drill, profile, source, activeRuleset, onComplete }: { drill: Drill; profile: Profile; source: "assessment" | "training"; activeRuleset: RuleSetId; onComplete: (profile: Profile, entry: Attempt & { skillId: SkillId }) => void }) {
  const [errorOpen, setErrorOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ option: DecisionOption; updated: Profile; value: number } | null>(null);
  const activeOptions = drill.rulesetOptions?.[activeRuleset] ?? drill.options ?? [];
  const finish = (value: number, reportedError?: string) => {
    const rulesetTag = drill.rulesContext ?? null;
    onComplete(applySkillUpdate(profile, drill.skillId, value, { drillId: drill.id, difficulty: drill.difficulty, source, reportedError, ruleset: rulesetTag }), { skillId: drill.skillId, value, drillId: drill.id, difficulty: drill.difficulty, ts: Date.now(), reportedError, ruleset: rulesetTag });
  };
  if (drill.type === "execution") return <Card><div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}><TableDiagram balls={[{ color: C.chalk }, { color: C.brass }]} /></div>{drill.rulesContext && <RulesBadge ruleset={drill.rulesContext} />}<div style={{ fontSize: 18, fontWeight: 700 }}>{drill.name}</div><div style={{ color: C.dim, fontSize: 13, lineHeight: 1.5, margin: "5px 0" }}>{drill.desc}</div><div style={{ color: C.dim, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, marginBottom: 12 }}>Difficulty {drill.difficulty}/10 · {SKILL_MAP[drill.skillId].name}</div><WhyThisDrill reason={drill.reason} />{!errorOpen ? <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}><Button variant="success" onClick={() => finish(1)}><Check size={19} /> Success</Button><Button variant="danger" onClick={() => setErrorOpen(true)}><X size={19} /> Failed</Button></div> : <ErrorGrid onPick={(code) => finish(0, code)} />}</Card>;
  const rulesetForBadge = drill.rulesContext ?? (drill.rulesetOptions ? activeRuleset : null);
  if (!feedback) return <Card><div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}><TableDiagram balls={[{ color: C.brass }, { color: C.chalk }, { color: C.rust }]} /></div>{rulesetForBadge && <RulesBadge ruleset={rulesetForBadge} />}<div style={{ fontSize: 18, fontWeight: 700 }}>{drill.name}</div><div style={{ color: C.dim, fontSize: 13, lineHeight: 1.5, margin: "5px 0 14px" }}>{drill.desc}</div><WhyThisDrill reason={drill.reason} /><div style={{ display: "grid", gap: 8 }}>{activeOptions.map((option) => <Button key={option.key} onClick={() => { const value = decisionValue(option.tier as DecisionTier); const rulesetTag = drill.rulesContext ?? (drill.rulesetOptions ? activeRuleset : null); setFeedback({ option, updated: applySkillUpdate(profile, drill.skillId, value, { drillId: drill.id, difficulty: drill.difficulty, source, tier: option.tier, ruleset: rulesetTag }), value }); }} style={{ justifyContent: "flex-start", textAlign: "left" }}>{option.label}</Button>)}</div></Card>;
  return <Card><Label>{feedback.option.tier === "optimal" ? "Strong choice" : feedback.option.tier === "acceptable" ? "Reasonable choice" : feedback.option.tier === "highrisk" ? "High risk" : "Not the best option"}</Label><p style={{ lineHeight: 1.6, margin: "0 0 16px" }}>{feedback.option.rationale}</p><Button variant="primary" onClick={() => onComplete(feedback.updated, { skillId: drill.skillId, value: feedback.value, drillId: drill.id, difficulty: drill.difficulty, tier: feedback.option.tier, ts: Date.now(), ruleset: drill.rulesContext ?? (drill.rulesetOptions ? activeRuleset : null) })}>Continue <ChevronRight size={17} /></Button></Card>;
}

// Import DecisionTier for type assertion
type DecisionTier = "optimal" | "acceptable" | "highrisk" | "poor";

// ─── Clearance runner ──────────────────────────────────────────────────────────
const smallButton: CSSProperties = { background: "transparent", border: 0, color: C.brass, cursor: "pointer", fontSize: 16, padding: "2px 7px" };

type ClearanceEntry = Attempt & { skillId?: SkillId; observedSkill?: SkillId; type?: string; chainNarrative?: string };

function ClearanceRunner({
  clearance, profile, source, activeRuleset, onComplete,
}: {
  clearance: Clearance;
  profile: Profile;
  source: "assessment" | "training";
  activeRuleset: RuleSetId;
  onComplete: (profile: Profile, entries: ClearanceEntry[]) => void;
}) {
  const initialRemaining = useMemo(
    () => clearance.balls.filter((b) => b.role === "target" || b.role === "black").map((b) => b.id),
    [clearance]
  );

  // Route tracking: three distinct lists (never infer potted from attempted)
  const [remaining,  setRemaining]  = useState<string[]>(initialRemaining);
  const [attempted,  setAttempted]  = useState<string[]>([]);
  const [potted,     setPotted]     = useState<string[]>([]);

  // Mutable refs for profile and entries so updates don't trigger re-renders
  const profileRef  = useRef(profile);
  const entriesRef  = useRef<ClearanceEntry[]>([]);
  const endedRef    = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const [phase, setPhase]               = useState<"choose" | "plan" | "play">(clearance.planEligible ? "choose" : "play");
  const [planned, setPlanned]           = useState<string[]>(initialRemaining);
  const [current, setCurrent]           = useState<string | null>(null);
  const [errorOpen, setErrorOpen]       = useState(false);
  const [adaptationOpen, setAdaptation] = useState(false);

  const ballMap = useMemo(() => Object.fromEntries(clearance.balls.map((b) => [b.id, b])), [clearance]);

  // Complete the clearance — safe to call multiple times (guarded by endedRef)
  const complete = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    const chain = classifyErrorChain(entriesRef.current);
    const narrative = buildErrorChainNarrative(chain);
    const finalEntries: ClearanceEntry[] = narrative
      ? [...entriesRef.current, { ts: Date.now(), value: 0, difficulty: clearance.difficulty, chainNarrative: narrative }]
      : [...entriesRef.current];
    onCompleteRef.current(profileRef.current, finalEntries);
  }, [clearance.difficulty]);

  // Auto-complete when all balls are potted
  useEffect(() => {
    if (phase === "play" && remaining.length === 0 && !adaptationOpen) {
      complete();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining.length, phase, adaptationOpen]);

  // Legal targets: derived from current remaining + rules module.
  // remaining is in state so this correctly recomputes when balls are potted.
  const legalTargets = useMemo(() => {
    const targetBalls = remaining.filter((id) => ballMap[id]?.role === "target");
    const blackBalls  = remaining.filter((id) => ballMap[id]?.role === "black");
    const tableState = {
      ruleset: activeRuleset,
      groupAssignment: "assigned" as const,
      playerGroup: "yellow" as const,
      opponentGroup: "red" as const,
      balls: clearance.balls.map((b) => ({ ...b })),
      cueBallInHand: false,
      freeShotActive: false,
      playerBallsRemaining: targetBalls.length,
      opponentBallsRemaining: 0,
    };
    const legal = getLegalBalls(tableState);
    const legalIds = new Set(legal.map((b) => b.id));
    const eightBallLegal = isEightBallLegal(tableState);
    return [...targetBalls.filter((id) => legalIds.has(id)), ...(eightBallLegal ? blackBalls : [])];
  }, [remaining, clearance, activeRuleset, ballMap]);

  const selectedId = current ?? (legalTargets.length === 1 ? legalTargets[0] : null);

  const applyResult = (value: number, reportedError?: string) => {
    if (!selectedId) return;
    const ball = ballMap[selectedId];
    const now = Date.now();

    // Record execution evidence — tagged with activeRuleset (clearances are rules-sensitive)
    profileRef.current = applySkillUpdate(
      profileRef.current, ball.execSkill, value,
      { drillId: clearance.id, difficulty: clearance.difficulty, source, clearance: true, ballId: ball.id, reportedError, ruleset: activeRuleset },
      now
    );
    entriesRef.current.push({
      ts: now, value, difficulty: clearance.difficulty, drillId: clearance.id,
      source, clearance: true, ballId: ball.id, reportedError,
      skillId: ball.execSkill, observedSkill: ball.execSkill, ruleset: activeRuleset,
    });

    // Always record in attemptedRoute
    setAttempted((prev) => [...prev, ball.id]);
    setCurrent(null);
    setErrorOpen(false);

    if (value === 1) {
      // SUCCESS: ball is potted — remove from remaining, add to potted
      setPotted((prev) => [...prev, ball.id]);
      setRemaining((prev) => prev.filter((id) => id !== ball.id));
      // Completion detected by useEffect watching remaining.length
    } else {
      // FAILURE: ball stays in remaining (attempted but not potted)
      if (clearance.failureMode === "end_clearance") {
        complete();
        return;
      }
      // continue_from_position: ball remains available for retry
      if (clearance.adaptationEligible && reportedError === "POSITION") {
        setAdaptation(true);
      }
    }
  };

  // ── Phase: choose to plan or play ──────────────────────────────────────────
  if (phase === "choose") {
    return <Card>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{clearance.name}</div>
      <p style={{ color: C.dim, fontSize: 13, lineHeight: 1.5 }}>Would you like to plan your clearance order first, or just play?</p>
      <div style={{ display: "grid", gap: 8 }}>
        <Button variant="primary" onClick={() => setPhase("plan")}>Plan the clearance</Button>
        <Button onClick={() => setPhase("play")}>Just play</Button>
      </div>
    </Card>;
  }

  // ── Phase: plan ───────────────────────────────────────────────────────────
  if (phase === "plan") {
    return <Card>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 5 }}>Plan your order</div>
      <p style={{ color: C.dim, fontSize: 13, marginBottom: 12 }}>Reorder to match your intended route. Your plan is scored against authored route quality — not awarded automatically.</p>
      <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
        {planned.map((id, idx) => (
          <div key={id} style={{ alignItems: "center", background: C.panel2, borderRadius: 8, display: "flex", justifyContent: "space-between", padding: "9px 12px" }}>
            <span>{idx + 1}. {ballMap[id]?.label ?? id}</span>
            <span style={{ display: "flex", gap: 4 }}>
              <button onClick={() => { if (!idx) return; const c = [...planned]; [c[idx-1],c[idx]]=[c[idx],c[idx-1]]; setPlanned(c); }} style={smallButton}>↑</button>
              <button onClick={() => { if (idx === planned.length-1) return; const c = [...planned]; [c[idx+1],c[idx]]=[c[idx],c[idx+1]]; setPlanned(c); }} style={smallButton}>↓</button>
            </span>
          </div>
        ))}
      </div>
      <Button variant="primary" onClick={() => {
        // Evaluate plan quality against authored preferred/acceptable routes
        const planResult = evaluatePlannedRoute(planned, clearance);
        const now = Date.now();
        profileRef.current = applySkillUpdate(
          profileRef.current, "pattern", planResult.value,
          { drillId: clearance.id, source: "planDecision", difficulty: clearance.difficulty, tier: planResult.tier, ruleset: activeRuleset },
          now
        );
        entriesRef.current.push({
          ts: now, value: planResult.value, difficulty: clearance.difficulty,
          drillId: clearance.id, source: "planDecision", tier: planResult.tier,
          skillId: "pattern", ruleset: activeRuleset,
        });
        setPhase("play");
      }}>Confirm plan</Button>
    </Card>;
  }

  // ── Phase: adaptation ─────────────────────────────────────────────────────
  if (adaptationOpen) {
    return <Card>
      <div style={{ fontSize: 18, fontWeight: 700 }}>Position lost</div>
      <p style={{ color: C.dim, fontSize: 13, marginBottom: 12 }}>What's your plan from here?</p>
      <div style={{ display: "grid", gap: 8 }}>
        {["Re-plan clearance", "Continue original route", "Develop a problem ball", "Play safe", "Other"].map((choice) => (
          <Button key={choice} onClick={() => {
            // Route adaptation to the correct decision skill
            const decSkill: SkillId = ADAPTATION_SKILL_MAP[choice] ?? "pattern";
            const tier: DecisionTier = choice === clearance.preferredAdaptation ? "optimal" : choice === "Other" ? "highrisk" : "acceptable";
            const value = decisionValue(tier);
            const now = Date.now();
            // Adaptation decision updates its decision skill; does NOT penalise any execution skill
            profileRef.current = applySkillUpdate(
              profileRef.current, decSkill, value,
              { drillId: clearance.id, source: "adaptation", difficulty: clearance.difficulty, tier, ruleset: activeRuleset },
              now
            );
            entriesRef.current.push({
              ts: now, value, difficulty: clearance.difficulty,
              drillId: clearance.id, source: "adaptation", type: "adaptation",
              skillId: decSkill, tier, ruleset: activeRuleset,
            });
            setAdaptation(false);
            // remaining unchanged — clearance continues from current position
          }}>{choice}</Button>
        ))}
      </div>
    </Card>;
  }

  // ── Phase: play — ball selection ──────────────────────────────────────────
  if (!selectedId) {
    return <Card>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
        <TableDiagram balls={clearance.balls.map((b) => ({
          color: potted.includes(b.id) ? C.green
            : b.role === "obstacle" ? "#444"
            : b.group === "black" ? "#111"
            : b.group === "red" ? C.rust
            : "#d9c089",
        }))} />
      </div>
      <div style={{ color: C.dim, fontSize: 12 }}>{clearance.name} · {potted.length}/{initialRemaining.length} potted</div>
      <div style={{ fontSize: 18, fontWeight: 700, margin: "5px 0 13px" }}>Which ball are you playing?</div>
      <div style={{ display: "grid", gap: 8 }}>
        {legalTargets.map((id) => <Button key={id} onClick={() => setCurrent(id)} style={{ justifyContent: "flex-start" }}>{ballMap[id]?.label ?? id}</Button>)}
      </div>
      {attempted.length > potted.length && (
        <div style={{ color: C.dim, fontSize: 12, marginTop: 10 }}>
          {attempted.length - potted.length} miss{attempted.length - potted.length === 1 ? "" : "es"} so far
        </div>
      )}
    </Card>;
  }

  // ── Phase: play — executing a shot ─────────────────────────────────────────
  const ball = ballMap[selectedId];
  return <Card>
    <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
      <TableDiagram balls={clearance.balls.map((item) => ({
        color: item.id === selectedId ? C.brass
          : potted.includes(item.id) ? C.green
          : item.role === "obstacle" ? "#444"
          : item.group === "red" ? C.rust
          : C.panel2,
      }))} />
    </div>
    <div style={{ color: C.dim, fontSize: 12 }}>{clearance.name}</div>
    <div style={{ fontSize: 18, fontWeight: 700, margin: "5px 0" }}>Pot the {ball?.label ?? selectedId}</div>
    <div style={{ color: C.dim, fontSize: 12, marginBottom: 13 }}>Skill in focus: {ball ? SKILL_MAP[ball.execSkill].name : "—"}</div>
    {!errorOpen
      ? <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
          <Button variant="success" onClick={() => applyResult(1)}><Check size={19} /> Success</Button>
          <Button variant="danger"  onClick={() => setErrorOpen(true)}><X size={19} /> Failed</Button>
        </div>
      : <ErrorGrid onPick={(code) => applyResult(0, code)} />
    }
  </Card>;
}

// ─── Session runner ────────────────────────────────────────────────────────────
function SessionRunner({
  profile, generated, onFinish,
}: {
  profile: Profile;
  generated: ReturnType<typeof generateSession>;
  onFinish: (profile: Profile, summary: SessionSummary, rootCauseEvents: RootCauseEvent[]) => void;
}) {
  const [index, setIndex] = useState(0);
  const profileRef = useRef(profile);
  const logRef = useRef<ClearanceEntry[]>([]);
  const [showTransition, setShowTransition] = useState<string | null>(null);
  const current = generated.drills[index];
  const activeRuleset: RuleSetId = generated.drillRulesets[index] ?? (profile.preferredRulesMode === "international" ? "international" : "blackball");
  const currentRuleset = generated.drillRulesets[index];

  const complete = (updated: Profile, entries: ClearanceEntry[] | (Attempt & { skillId: SkillId })) => {
    profileRef.current = updated;
    logRef.current = [...logRef.current, ...(Array.isArray(entries) ? entries : [entries as ClearanceEntry])];
    if (index + 1 >= generated.drills.length) {
      const newEvents = buildRootCauseEvents(logRef.current, Date.now());
      onFinish(updated, buildSummary(logRef.current, generated, updated), newEvents);
      return;
    }
    const nextRuleset = generated.drillRulesets[index + 1];
    if (profile.preferredRulesMode === "mixed" && nextRuleset && currentRuleset && nextRuleset !== currentRuleset) {
      setShowTransition(`Next: ${nextRuleset === "international" ? "International Rules" : "Blackball Rules"}`);
      setTimeout(() => { setShowTransition(null); setIndex((v) => v + 1); }, 1800);
    } else {
      setIndex((v) => v + 1);
    }
  };

  if (showTransition) {
    return <Card style={{ textAlign: "center" }}><div style={{ color: C.dim, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, marginBottom: 8 }}>SWITCHING RULESETS</div><div style={{ fontSize: 18, fontWeight: 700 }}>{showTransition}</div></Card>;
  }

  return <div>
    <Label>Drill {index + 1} of {generated.drills.length}</Label>
    <ProgressBar color={C.chalk} value={index / generated.drills.length * 100} />
    {current.type === "combined"
      ? <ClearanceRunner key={`${current.id}-${index}`} clearance={current} profile={profileRef.current} source="training" activeRuleset={activeRuleset} onComplete={complete} />
      : <DrillRunner     key={`${current.id}-${index}`} drill={current}     profile={profileRef.current} source="training" activeRuleset={activeRuleset} onComplete={complete} />}
  </div>;
}

// ─── Summary ───────────────────────────────────────────────────────────────────
function Summary({ summary, onDone }: { summary: SessionSummary; onDone: () => void }) {
  return <div><Card style={{ marginBottom: 14 }}><Label>Today's session</Label><p style={{ lineHeight: 1.6, margin: 0 }}>{summary.todayWentWell.length ? `Your ${summary.todayWentWell.join(" and ")} held up well today.` : "A mixed session across several skills."}</p><p style={{ color: C.dim, fontSize: 13, lineHeight: 1.55, margin: "10px 0 0" }}>{summary.todayLimited.length ? `Most of today's difficulty traced back to ${summary.todayLimited.join(" and ")} — today's snapshot, not a rewrite of your profile.` : "Nothing stood out as a clear limiter in today's session."}</p></Card>{summary.chainNarratives.length > 0 && <Card style={{ marginBottom: 14 }}><Label>Error-chain note</Label>{summary.chainNarratives.map((note, i) => <p key={i} style={{ color: C.chalk, lineHeight: 1.55, margin: i ? "9px 0 0" : 0 }}>{note}</p>)}</Card>}{summary.adaptations.length > 0 && <Card style={{ marginBottom: 14 }}><Label>Adaptation</Label><p style={{ color: C.brass, lineHeight: 1.55, margin: 0 }}>You made a decision after position was lost. That choice is credited to the correct decision skill, separately from the execution result.</p></Card>}<Card style={{ marginBottom: 14 }}><Label>What changes next</Label><p style={{ lineHeight: 1.6, margin: 0 }}>{summary.changeNote}</p></Card><Button variant="primary" onClick={onDone}>Back to today</Button></div>;
}

// ─── Progress ──────────────────────────────────────────────────────────────────
function ProgressView({ profile }: { profile: Profile }) {
  const lf = limitingFactor(profile);
  const weighting = sessionWeighting(profile, lf);
  const isMixed = profile.preferredRulesMode === "mixed";
  return <div><SkillRadar profile={profile} /><Card style={{ marginBottom: 14 }}><Label>Execution vs decision</Label><div style={{ display: "grid", gap: 10 }}><div><div style={{ color: C.dim, fontSize: 12, marginBottom: 5 }}>Execution <strong style={{ color: C.ink }}>{Math.round(weighting.exec)}</strong></div><ProgressBar color={C.chalk} value={weighting.exec} /></div><div><div style={{ color: C.dim, fontSize: 12, marginBottom: 5 }}>Decision <strong style={{ color: C.ink }}>{Math.round(weighting.dec)}</strong></div><ProgressBar color={C.brass} value={weighting.dec} /></div></div></Card><Card style={{ marginBottom: 14 }}><Label>Current focus</Label><div style={{ fontSize: 15 }}>{lf.primary ? `${lf.primary.name}${lf.status === "provisional" ? " · early signal" : ""}` : "Still gathering enough evidence for a clear focus"}</div>{lf.secondary && <div style={{ color: C.dim, fontSize: 13, marginTop: 6 }}>Also worth attention: {lf.secondary.name}</div>}</Card><Card><Label>All skills</Label>{SKILLS.map((skill) => { const s = profile.skills[skill.id]; const confidence = computeConfidence(s.attempts); const bbConf = isMixed && skill.type === "decision" ? computeRulesetConfidence(profile, skill.id, "blackball") : null; const intConf = isMixed && skill.type === "decision" ? computeRulesetConfidence(profile, skill.id, "international") : null; return <div key={skill.id} style={{ borderBottom: `1px solid ${C.line}`, padding: "10px 0" }}><div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}><div><div style={{ alignItems: "center", display: "flex", fontSize: 13, gap: 6 }}>{skill.name}<TrendIcon trend={trendFor(profile.ratingHistory, skill.id)} /></div><div style={{ color: C.dim, fontSize: 11, marginTop: 4 }}>{confidenceLabel(confidence.tier, isStale(s))} · {s.attempts.length} attempts</div>{bbConf && <div style={{ color: C.dim, fontSize: 10, marginTop: 2 }}>BB: {bbConf.tier} · INT: {intConf?.tier ?? "Low"}</div>}</div><div style={{ color: C.brass, fontFamily: "'IBM Plex Mono', monospace", fontSize: 15 }}>{Math.round(s.rating)}</div></div></div>; })}</Card></div>;
}

// ─── Library ───────────────────────────────────────────────────────────────────
function LibraryView({ profile }: { profile: Profile }) {
  const mode = profile.preferredRulesMode;
  const rulesets: RuleSetId[] = mode === "mixed" ? ["blackball", "international"] : [mode];
  const groups = SKILLS.map((skill) => ({ skill, drills: DRILLS.filter((d) => d.skillId === skill.id && rulesets.some((r) => d.rulesets.includes(r))) })).filter((g) => g.drills.length);
  return <div>{groups.map(({ skill, drills }) => <Card key={skill.id} style={{ marginBottom: 12 }}><Label>{skill.name} {skill.priority && <span style={{ color: C.brass }}>· priority</span>}</Label>{drills.map((d) => <div key={d.id} style={{ borderBottom: `1px solid ${C.line}`, color: C.dim, fontSize: 13, padding: "8px 0" }}><div style={{ alignItems: "center", display: "flex", gap: 8 }}><span style={{ color: C.ink }}>{d.name}</span>{d.rulesContext && <span style={{ background: d.rulesContext === "blackball" ? C.brass : C.chalk, borderRadius: 3, color: C.bg, fontSize: 9, fontWeight: 700, padding: "1px 5px" }}>{d.rulesContext === "blackball" ? "BB" : "INT"}</span>}</div><div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, marginTop: 3 }}>difficulty {d.difficulty} · {d.type}</div></div>)}</Card>)}<Card><Label>Clearances</Label>{CLEARANCES.filter((c) => rulesets.some((r) => c.rulesets.includes(r))).map((c) => <div key={c.id} style={{ color: C.dim, fontSize: 13, padding: "7px 0" }}>{c.name} <span style={{ color: C.line, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10 }}>· difficulty {c.difficulty} · {c.balls.filter((b) => b.role === "target").length} targets + {c.balls.filter((b) => b.role === "obstacle").length} obstacles</span></div>)}</Card></div>;
}

// ─── Settings ──────────────────────────────────────────────────────────────────
function SettingsView({ profile, onMode, onReset }: { profile: Profile; onMode: (mode: RulesMode) => void; onReset: () => void }) {
  return <div><Card style={{ marginBottom: 14 }}><Label>Preferred rules</Label><p style={{ color: C.dim, fontSize: 13, lineHeight: 1.5, margin: "0 0 13px" }}>Changing your preference keeps all your skill ratings and history. It only changes the content of future sessions.</p>{MODES_FOR_ONBOARDING.map((item) => <button key={item.mode} onClick={() => onMode(item.mode)} style={{ alignItems: "center", background: profile.preferredRulesMode === item.mode ? "#284735" : C.panel2, border: `1px solid ${profile.preferredRulesMode === item.mode ? C.brass : C.line}`, borderRadius: 9, color: C.ink, cursor: "pointer", display: "flex", justifyContent: "space-between", marginBottom: 8, padding: 13, textAlign: "left", width: "100%" }}><span><strong>{item.label}</strong><span style={{ color: C.dim, display: "block", fontSize: 12, marginTop: 4 }}>{item.description}</span></span>{profile.preferredRulesMode === item.mode && <Check color={C.brass} size={18} />}</button>)}</Card>{profile.preferredRulesMode !== "mixed" && <Card style={{ marginBottom: 14 }}><Label>Rules notes</Label><p style={{ color: C.dim, fontSize: 13, lineHeight: 1.55, margin: 0 }}>{RULESETS[profile.ruleset].unsupportedNote}</p></Card>}<Card><Label>Local profile</Label><p style={{ color: C.dim, fontSize: 13, lineHeight: 1.5, margin: "0 0 13px" }}>Your profile is stored on this device.</p><Button variant="danger" onClick={onReset}><RotateCcw size={16} /> Reset profile</Button></Card></div>;
}

// ─── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [profile, setProfile] = useState<Profile>(() => loadProfile());
  const [view, setView]       = useState<View>(() => { const p = loadProfile(); return p.assessmentComplete ? "dashboard" : "onboarding"; });
  const [generated, setGenerated] = useState<ReturnType<typeof generateSession> | null>(null);
  const [summary,   setSummary]   = useState<SessionSummary | null>(null);

  useEffect(() => { saveProfile(profile); }, [profile]);

  const chooseMode    = (mode: RulesMode) => { setProfile(newProfile(mode)); setView("assessment"); };
  const startSession  = (minutes: number) => { setGenerated(generateSession(profile, minutes)); setView("session"); };

  const finishSession = (updated: Profile, sessionSummary: SessionSummary, newRcEvents: RootCauseEvent[]) => {
    const withHistory: Profile = {
      ...updated,
      ratingHistory: appendRatingSnapshots(updated),
      rootCauseEvents: [...updated.rootCauseEvents, ...newRcEvents],
      sessions: [...updated.sessions, { ts: Date.now(), minutes: generated?.drills.length ?? 0, summary: sessionSummary }],
    };
    setProfile(withHistory);
    setSummary(sessionSummary);
    setView("summary");
  };

  const nav = (next: View) => { if (!["session", "assessment", "onboarding"].includes(next)) setView(next); };

  if (view === "onboarding") return <Onboarding onChoose={chooseMode} />;
  if (view === "assessment") return <AppShell view={view} onNav={nav} profile={profile}><Assessment profile={profile} onDone={(next) => { setProfile(next); setView("provisional"); }} /></AppShell>;
  if (view === "provisional") return <AppShell view={view} onNav={nav} profile={profile}><Provisional profile={profile} onContinue={() => setView("dashboard")} /></AppShell>;
  if (view === "pickTime")   return <AppShell view={view} onNav={nav} profile={profile}><PickTime onPick={startSession} /></AppShell>;
  if (view === "session" && generated) return <AppShell view={view} onNav={nav} profile={profile}><SessionRunner profile={profile} generated={generated} onFinish={finishSession} /></AppShell>;
  if (view === "summary" && summary)   return <AppShell view={view} onNav={nav} profile={profile}><Summary summary={summary} onDone={() => setView("dashboard")} /></AppShell>;
  return <AppShell view={view} onNav={nav} profile={profile}>
    {view === "dashboard" && <Dashboard profile={profile} onStart={() => setView("pickTime")} onNav={nav} />}
    {view === "progress"  && <ProgressView profile={profile} />}
    {view === "library"   && <LibraryView profile={profile} />}
    {view === "settings"  && <SettingsView profile={profile} onMode={(mode) => setProfile(updateRulesMode(profile, mode))} onReset={() => { clearProfile(); setProfile(newProfile()); setView("onboarding"); }} />}
  </AppShell>;
}
