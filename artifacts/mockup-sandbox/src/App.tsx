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
  type Attempt, type Clearance, type DecisionOption, type Drill, type GeneratedSession,
  type Profile, type RootCauseEvent, type RuleSetId, type RulesMode, type SessionSummary, type SkillId,
} from "./engine";
import { clearProfile, loadProfile, saveProfile, updateRulesMode } from "./persistence/profileStorage";
import { loadMatches, saveMatches } from "./persistence/matchStorage";
import {
  generateAdaptiveSession, matchAwareLimitingFactor, buildMatchSummary,
  frameScore, createMatch, addFrame, buildFrameEvent, editFrame, deleteFrameFromMatch, completeMatch, deleteMatch,
  FRAME_LOSS_CATEGORIES, POSITIVE_EVENT_TYPES,
  type Match, type MatchSummary, type MatchEnvironment, type FrameImpact, type FrameResult,
} from "./match";
import { getLegalBalls, isEightBallLegal } from "./rules";

// ─── View types and palette ────────────────────────────────────────────────────
type View = "onboarding" | "assessment" | "provisional" | "dashboard" | "pickTime" | "session" | "summary" | "progress" | "library" | "settings" | "matches" | "matchSetup" | "matchActive" | "matchLogFrame" | "matchComplete" | "matchDetail";
const C = { bg: "#0e1a15", panel: "#16261e", panel2: "#1d3025", line: "#2a4436", ink: "#edeae1", dim: "#9fb3a8", brass: "#c9a15a", chalk: "#6fa8c9", rust: "#b5533c", green: "#4e8b6b" };
const fontImport = "@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Mono:wght@400;600&family=Inter:wght@400;500;600;700&display=swap');";
const titles: Record<View, string> = { onboarding: "Welcome", assessment: "Initial Assessment", provisional: "Your Starting Profile", dashboard: "Today", pickTime: "Session Length", session: "Training", summary: "Session Summary", progress: "Progress", library: "Drill Library", settings: "Settings", matches: "Match History", matchSetup: "New Match", matchActive: "Match in Progress", matchLogFrame: "Log Frame", matchComplete: "Match Summary", matchDetail: "Match Detail" };
/** Map a view to its parent nav tab so sub-views highlight the right nav item. */
function navTab(view: View): string {
  if (["matchSetup", "matchActive", "matchLogFrame", "matchComplete", "matchDetail"].includes(view)) return "matches";
  return view;
}

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
  const nav = [{ id: "dashboard" as const, label: "Today" }, { id: "matches" as const, label: "Matches" }, { id: "library" as const, label: "Library" }, { id: "progress" as const, label: "Progress" }, { id: "settings" as const, label: "Rules" }];
  const modeLabel = profile.preferredRulesMode === "mixed" ? "Mixed Training" : RULESETS[profile.ruleset].name;
  return <div style={{ background: C.bg, color: C.ink, fontFamily: "'Inter', sans-serif", minHeight: "100vh" }}><style>{fontImport}{`*{box-sizing:border-box}body{margin:0;background:${C.bg}}button:hover:not(:disabled){filter:brightness(1.08)}button:active:not(:disabled){transform:scale(.98)}`}</style><div style={{ display: "flex", flexDirection: "column", margin: "0 auto", maxWidth: 520, minHeight: "100vh" }}><header style={{ borderBottom: `1px solid ${C.line}`, padding: "18px 16px 11px" }}><div style={{ color: C.brass, fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: 1.5 }}>8-BALL COACH</div><div style={{ color: C.dim, fontSize: 13, marginTop: 2 }}>{titles[view]} <span style={{ color: C.line }}>·</span> {modeLabel}</div></header><main style={{ flex: 1, padding: 16, paddingBottom: 92 }}>{children}</main><nav style={{ background: C.panel, borderTop: `1px solid ${C.line}`, bottom: 0, display: "flex", position: "fixed", width: "min(100%, 520px)", zIndex: 5 }}>{nav.map((item) => <button key={item.id} onClick={() => onNav(item.id)} style={{ background: "transparent", border: 0, color: navTab(view) === item.id ? C.brass : C.dim, cursor: "pointer", flex: 1, fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: navTab(view) === item.id ? 700 : 500, padding: "15px 4px" }}>{item.label}</button>)}</nav></div></div>;
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
function Dashboard({ profile, matches, onStart, onNav }: { profile: Profile; matches: Match[]; onStart: () => void; onNav: (view: View) => void }) {
  const lf = matchAwareLimitingFactor(profile, matches);
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

// ─── Match view components ─────────────────────────────────────────────────────

function MatchHistoryView({ matches, activeMatchId, onNew, onContinue, onDetail }: {
  matches: Match[]; activeMatchId: string | null; onNew: () => void; onContinue: () => void; onDetail: (id: string) => void;
}) {
  const activeMatch = matches.find(m => m.id === activeMatchId) ?? null;
  const completed   = matches.filter(m => m.completedAt != null).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  return <div>
    {activeMatch && <Card style={{ marginBottom: 14, border: `1px solid ${C.brass}` }}>
      <Label>Active match</Label>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
        {RULESETS[activeMatch.ruleset].name.split(" ")[0]} · {frameScore(activeMatch).player}–{frameScore(activeMatch).opponent}
        {activeMatch.opponent && <span style={{ color: C.dim, fontWeight: 400 }}> vs {activeMatch.opponent}</span>}
      </div>
      <Button variant="primary" onClick={onContinue}>Continue match</Button>
    </Card>}
    <Button variant={activeMatch ? "default" : "primary"} onClick={onNew} style={{ marginBottom: 14 }}>+ New Match</Button>
    {!completed.length && !activeMatch && <Card><div style={{ color: C.dim, fontSize: 13, lineHeight: 1.6 }}>No completed matches yet. Log your first match to see how real play shapes your training focus.</div></Card>}
    {completed.map(m => {
      const sc = frameScore(m); const won = sc.player > sc.opponent;
      return <button key={m.id} onClick={() => onDetail(m.id)} style={{ background: "transparent", border: 0, cursor: "pointer", marginBottom: 10, padding: 0, textAlign: "left", width: "100%" }}>
        <Card><div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
          <div style={{ color: C.dim, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>{new Date(m.completedAt!).toLocaleDateString()} · {RULESETS[m.ruleset].name.split(" ")[0]}{m.opponent && ` · vs ${m.opponent}`}</div>
          <div style={{ color: won ? C.green : C.rust, fontSize: 11, fontWeight: 700 }}>{won ? "WON" : "LOST"}</div>
        </div><div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: 1 }}>{sc.player}–{sc.opponent}</div></Card>
      </button>;
    })}
  </div>;
}

function MatchSetupView({ onStart, onCancel }: {
  onStart: (setup: { ruleset: RuleSetId; competitionType: MatchEnvironment; opponent?: string; format?: string; eventName?: string }) => void;
  onCancel: () => void;
}) {
  const [ruleset,         setRuleset]         = useState<RuleSetId>("blackball");
  const [competitionType, setCompetitionType] = useState<MatchEnvironment>("competition");
  const [opponent,  setOpponent]  = useState("");
  const [format,    setFormat]    = useState("");
  const [eventName, setEventName] = useState("");
  const inpStyle: CSSProperties = { background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8, color: C.ink, fontFamily: "'Inter', sans-serif", fontSize: 14, outline: "none", padding: "10px 12px", width: "100%" };
  return <div>
    <Card style={{ marginBottom: 12 }}><Label>Ruleset</Label>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
        {(["blackball", "international"] as RuleSetId[]).map(r => <button key={r} onClick={() => setRuleset(r)} style={{ alignItems: "center", background: ruleset === r ? "#284735" : C.panel2, border: `1px solid ${ruleset === r ? C.brass : C.line}`, borderRadius: 9, color: C.ink, cursor: "pointer", display: "flex", justifyContent: "space-between", padding: "12px 10px" }}><span style={{ fontSize: 13 }}>{r === "blackball" ? "Blackball" : "International"}</span>{ruleset === r && <Check color={C.brass} size={16} />}</button>)}
      </div>
    </Card>
    <Card style={{ marginBottom: 12 }}><Label>Context</Label>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
        {(["competition", "practice"] as MatchEnvironment[]).map(ct => <button key={ct} onClick={() => setCompetitionType(ct)} style={{ alignItems: "center", background: competitionType === ct ? "#284735" : C.panel2, border: `1px solid ${competitionType === ct ? C.brass : C.line}`, borderRadius: 9, color: C.ink, cursor: "pointer", display: "flex", justifyContent: "space-between", padding: "12px 10px" }}><span style={{ fontSize: 13 }}>{ct === "competition" ? "Competition" : "Practice"}</span>{competitionType === ct && <Check color={C.brass} size={16} />}</button>)}
      </div>
    </Card>
    <Card style={{ marginBottom: 14 }}><Label>Optional details</Label>
      <div style={{ display: "grid", gap: 8 }}>
        <input value={opponent}  onChange={e => setOpponent(e.target.value)}  placeholder="Opponent name"        style={inpStyle} />
        <input value={format}    onChange={e => setFormat(e.target.value)}    placeholder="Format (e.g. best of 7)" style={inpStyle} />
        <input value={eventName} onChange={e => setEventName(e.target.value)} placeholder="Event / venue"         style={inpStyle} />
      </div>
    </Card>
    <Button variant="primary" onClick={() => onStart({ ruleset, competitionType, opponent: opponent || undefined, format: format || undefined, eventName: eventName || undefined })} style={{ marginBottom: 10 }}>Start Match</Button>
    <Button variant="ghost" onClick={onCancel}>Cancel</Button>
  </div>;
}

function MatchActiveView({ match, onLog, onEditLast, onEnd }: {
  match: Match; onLog: () => void; onEditLast: () => void; onEnd: () => void;
}) {
  const sc = frameScore(match); const frames = [...match.frames].reverse();
  return <div>
    <Card style={{ marginBottom: 14, textAlign: "center" }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 56, letterSpacing: 2, color: C.brass, lineHeight: 1 }}>{sc.player} – {sc.opponent}</div>
      <div style={{ color: C.dim, fontSize: 12, marginTop: 4 }}>{RULESETS[match.ruleset].name} · {match.competitionType}{match.opponent && ` · vs ${match.opponent}`}</div>
    </Card>
    <Button variant="primary" onClick={onLog} style={{ marginBottom: 10 }}>+ Log Frame</Button>
    {match.frames.length > 0 && <Button onClick={onEditLast} style={{ marginBottom: 14 }}>Edit last frame</Button>}
    {frames.length > 0 && <Card style={{ marginBottom: 14 }}><Label>Frames played</Label>
      {frames.map(f => { const ev = f.keyEvents[0]; const catLabel = ev && (FRAME_LOSS_CATEGORIES.find(c => c.key === ev.category)?.label ?? POSITIVE_EVENT_TYPES.find(c => c.key === ev.category)?.label ?? ev.category);
        return <div key={f.id} style={{ borderBottom: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", padding: "8px 0" }}>
          <div><span style={{ color: f.result === "won" ? C.green : C.rust, fontWeight: 700 }}>{f.result === "won" ? "W" : "L"}</span><span style={{ color: C.dim, fontSize: 13 }}> · Frame {f.frameNumber}{ev && ` · ${catLabel}`}</span></div>
          {ev && <div style={{ color: C.dim, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>{ev.impact}</div>}
        </div>;
      })}
    </Card>}
    <Button variant="danger" onClick={onEnd}>End Match</Button>
  </div>;
}

function LogFrameView({ match, onDone, onCancel }: {
  match: Match;
  onDone: (result: FrameResult, event?: { category: string; impact: FrameImpact; type: "error" | "positive" }) => void;
  onCancel: () => void;
}) {
  const [result,   setResult]   = useState<FrameResult | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [impact,   setImpact]   = useState<FrameImpact | null>(null);
  const catLabel = category ? (FRAME_LOSS_CATEGORIES.find(c => c.key === category)?.label ?? POSITIVE_EVENT_TYPES.find(c => c.key === category)?.label ?? category) : "";

  if (!result) return <div>
    <Card style={{ marginBottom: 14 }}><Label>Frame result</Label>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
        <Button variant="success" onClick={() => setResult("won")}  style={{ minHeight: 80, fontSize: 18 }}><Check size={22} /> Won</Button>
        <Button variant="danger"  onClick={() => setResult("lost")} style={{ minHeight: 80, fontSize: 18 }}><X    size={22} /> Lost</Button>
      </div>
    </Card>
    <Button variant="ghost" onClick={onCancel}>Cancel</Button>
  </div>;

  if (result === "lost" && category === null) return <div>
    <Card style={{ marginBottom: 10 }}><Label>What cost you the frame? (optional)</Label>
      <div style={{ display: "grid", gap: 7, gridTemplateColumns: "1fr 1fr" }}>
        {FRAME_LOSS_CATEGORIES.map(cat => <button key={cat.key} onClick={() => { setCategory(cat.key); setImpact(cat.defaultImpact); }} style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 9, color: C.ink, cursor: "pointer", fontSize: 13, padding: "10px 8px", textAlign: "left" }}>{cat.label}</button>)}
      </div>
    </Card>
    <Button onClick={() => onDone("lost")} style={{ marginBottom: 8 }}>Skip — log result only</Button>
    <Button variant="ghost" onClick={() => setResult(null)}>Back</Button>
  </div>;

  if (result === "won" && category === null) return <div>
    <Card style={{ marginBottom: 10 }}><Label>Any standout moments? (optional)</Label>
      <div style={{ display: "grid", gap: 8 }}>
        {POSITIVE_EVENT_TYPES.map(ev => <button key={ev.key} onClick={() => { setCategory(ev.key); setImpact(ev.defaultImpact); }} style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 9, color: C.ink, cursor: "pointer", fontSize: 13, padding: "11px 12px", textAlign: "left" }}>{ev.label}</button>)}
      </div>
    </Card>
    <Button onClick={() => onDone("won")} style={{ marginBottom: 8 }}>Skip — log win only</Button>
    <Button variant="ghost" onClick={() => setResult(null)}>Back</Button>
  </div>;

  return <div>
    <Card style={{ marginBottom: 12 }}>
      <Label>Confirm</Label>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>{result === "won" ? "Won" : "Lost"} · {catLabel}</div>
      <Label>Impact level</Label>
      <div style={{ display: "grid", gap: 6, gridTemplateColumns: "1fr 1fr" }}>
        {(["low", "medium", "high", "decisive"] as FrameImpact[]).map(imp => <button key={imp} onClick={() => setImpact(imp)} style={{ alignItems: "center", background: impact === imp ? "#284735" : C.panel2, border: `1px solid ${impact === imp ? C.brass : C.line}`, borderRadius: 8, color: C.ink, cursor: "pointer", display: "flex", fontSize: 12, justifyContent: "space-between", padding: "9px 10px", textTransform: "capitalize" }}>{imp}{impact === imp && <Check size={13} color={C.brass} />}</button>)}
      </div>
    </Card>
    <Button variant="primary" onClick={() => { if (category && impact) onDone(result, { category, impact, type: result === "lost" ? "error" : "positive" }); }} style={{ marginBottom: 8 }}>Done</Button>
    <Button variant="ghost" onClick={() => setCategory(null)}>Back</Button>
  </div>;
}

function MatchCompleteView({ summary, onDone }: { summary: MatchSummary; onDone: () => void }) {
  const won = summary.playerFrames > summary.opponentFrames;
  return <div>
    <Card style={{ marginBottom: 14 }}>
      <Label>Match result</Label>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 48, letterSpacing: 1.5, color: won ? C.brass : C.rust, marginBottom: 10 }}>{summary.playerFrames} – {summary.opponentFrames}</div>
      <p style={{ color: C.ink, fontSize: 14, lineHeight: 1.65, margin: 0 }}>{summary.matchNarrative}</p>
    </Card>
    {summary.matchWeaknesses.length > 0 && <Card style={{ marginBottom: 14 }}><Label>Key issues today</Label>
      {summary.matchWeaknesses.map((w, i) => <div key={i} style={{ borderBottom: i < summary.matchWeaknesses.length - 1 ? `1px solid ${C.line}` : 0, display: "flex", justifyContent: "space-between", padding: "8px 0" }}>
        <div style={{ fontSize: 13 }}>{w.label}</div>
        <div style={{ color: C.dim, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>{w.count}× · {w.avgImpact}</div>
      </div>)}
    </Card>}
    {summary.matchVsTrainingNote && <Card style={{ marginBottom: 14, border: `1px solid ${C.chalk}` }}><Label>Training vs match</Label><p style={{ color: C.chalk, fontSize: 13, lineHeight: 1.55, margin: 0 }}>{summary.matchVsTrainingNote}</p></Card>}
    <Card style={{ marginBottom: 14 }}><Label>Updated training focus</Label><p style={{ lineHeight: 1.6, margin: 0 }}>{summary.lfChange}</p></Card>
    <Button variant="primary" onClick={onDone}>Done</Button>
  </div>;
}

function MatchDetailView({ match, onDelete, onBack }: { match: Match; onDelete: () => void; onBack: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const sc = frameScore(match); const won = sc.player > sc.opponent;
  return <div>
    <button onClick={onBack} style={{ background: "transparent", border: 0, color: C.brass, cursor: "pointer", fontSize: 14, marginBottom: 14, padding: 0 }}>← Back to matches</button>
    <Card style={{ marginBottom: 14 }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 40, letterSpacing: 1.5, color: won ? C.brass : C.rust, marginBottom: 6 }}>{sc.player} – {sc.opponent}</div>
      <div style={{ color: C.dim, fontSize: 12 }}>{match.completedAt ? new Date(match.completedAt).toLocaleDateString() : "In progress"} · {RULESETS[match.ruleset].name} · {match.competitionType}</div>
      {match.opponent && <div style={{ color: C.dim, fontSize: 12, marginTop: 2 }}>vs {match.opponent}{match.format && ` · ${match.format}`}{match.eventName && ` · ${match.eventName}`}</div>}
    </Card>
    {match.frames.length > 0 && <Card style={{ marginBottom: 14 }}><Label>Frames</Label>
      {match.frames.map(f => { const ev = f.keyEvents[0]; const catLabel = ev && (FRAME_LOSS_CATEGORIES.find(c => c.key === ev.category)?.label ?? POSITIVE_EVENT_TYPES.find(c => c.key === ev.category)?.label ?? ev.category);
        return <div key={f.id} style={{ borderBottom: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", padding: "9px 0" }}>
          <div><span style={{ color: f.result === "won" ? C.green : C.rust, fontWeight: 700, fontSize: 13 }}>Frame {f.frameNumber} {f.result === "won" ? "W" : "L"}</span>{ev && <div style={{ color: C.dim, fontSize: 12, marginTop: 2 }}>{catLabel}</div>}</div>
          {ev && <div style={{ color: C.dim, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, alignSelf: "center" }}>{ev.impact}</div>}
        </div>;
      })}
    </Card>}
    {!confirmDelete
      ? <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete match</Button>
      : <Card style={{ border: `1px solid ${C.rust}` }}><div style={{ color: C.ink, fontSize: 13, marginBottom: 12 }}>Delete this match? Its coaching influence disappears immediately.</div>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}><Button variant="danger" onClick={onDelete}>Delete</Button><Button onClick={() => setConfirmDelete(false)}>Cancel</Button></div>
        </Card>}
  </div>;
}

// ─── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [profile, setProfile]       = useState<Profile>(() => loadProfile());
  const [view, setView]             = useState<View>(() => { const p = loadProfile(); return p.assessmentComplete ? "dashboard" : "onboarding"; });
  const [generated, setGenerated]   = useState<GeneratedSession | null>(null);
  const [summary,   setSummary]     = useState<SessionSummary | null>(null);

  // ── Match state ────────────────────────────────────────────────────────────
  const [matches,       setMatches]       = useState<Match[]>(() => loadMatches());
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [detailMatchId, setDetailMatchId] = useState<string | null>(null);
  const [matchSummary,  setMatchSummary]  = useState<MatchSummary | null>(null);

  useEffect(() => { saveProfile(profile); }, [profile]);
  useEffect(() => { saveMatches(matches); }, [matches]);

  const chooseMode   = (mode: RulesMode) => { setProfile(newProfile(mode)); setView("assessment"); };
  // Session generation now flows through match-aware limiting factor
  const startSession = (minutes: number) => { setGenerated(generateAdaptiveSession(profile, matches, minutes)); setView("session"); };

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

  // ── Match actions ──────────────────────────────────────────────────────────
  const startNewMatch = (setup: { ruleset: RuleSetId; competitionType: MatchEnvironment; opponent?: string; format?: string; eventName?: string }) => {
    const m = createMatch(setup);
    setMatches(prev => [...prev, m]);
    setActiveMatchId(m.id);
    setView("matchActive");
  };

  const logFrame = (result: FrameResult, event?: { category: string; impact: FrameImpact; type: "error" | "positive" }) => {
    if (!activeMatchId) return;
    setMatches(prev => prev.map(m => {
      if (m.id !== activeMatchId) return m;
      const now = Date.now();
      if (event) {
        const fe = buildFrameEvent({ type: event.type, category: event.category, impact: event.impact, ruleset: m.ruleset, environment: m.competitionType }, now);
        return addFrame(m, { result, keyEvents: [fe] }, now);
      }
      return addFrame(m, { result }, now);
    }));
    setView("matchActive");
  };

  const editLastFrame = () => {
    if (!activeMatchId) return;
    setMatches(prev => prev.map(m => {
      if (m.id !== activeMatchId || m.frames.length === 0) return m;
      return deleteFrameFromMatch(m, m.frames[m.frames.length - 1].id);
    }));
    setView("matchLogFrame");
  };

  const endMatch = () => {
    if (!activeMatchId) return;
    const now = Date.now();
    const updatedMatches = matches.map(m => m.id === activeMatchId ? completeMatch(m, now) : m);
    const completedMatch = updatedMatches.find(m => m.id === activeMatchId);
    if (completedMatch) {
      const lf = matchAwareLimitingFactor(profile, updatedMatches, now);
      setMatchSummary(buildMatchSummary(completedMatch, profile, lf, now));
    }
    setMatches(updatedMatches);
    setActiveMatchId(null);
    setView("matchComplete");
  };

  const deleteMatchEntry = (matchId: string) => {
    setMatches(prev => deleteMatch(prev, matchId));
    setDetailMatchId(null);
    setView("matches");
  };

  const nav = (next: View) => { if (!["session", "assessment", "onboarding"].includes(next)) setView(next); };

  // ── Routing ────────────────────────────────────────────────────────────────
  if (view === "onboarding") return <Onboarding onChoose={chooseMode} />;
  if (view === "assessment")  return <AppShell view={view} onNav={nav} profile={profile}><Assessment  profile={profile} onDone={(next) => { setProfile(next); setView("provisional"); }} /></AppShell>;
  if (view === "provisional") return <AppShell view={view} onNav={nav} profile={profile}><Provisional profile={profile} onContinue={() => setView("dashboard")} /></AppShell>;
  if (view === "pickTime")    return <AppShell view={view} onNav={nav} profile={profile}><PickTime onPick={startSession} /></AppShell>;
  if (view === "session" && generated)   return <AppShell view={view} onNav={nav} profile={profile}><SessionRunner profile={profile} generated={generated} onFinish={finishSession} /></AppShell>;
  if (view === "summary" && summary)     return <AppShell view={view} onNav={nav} profile={profile}><Summary summary={summary} onDone={() => setView("dashboard")} /></AppShell>;

  // Match sub-views
  if (view === "matchSetup")  return <AppShell view={view} onNav={nav} profile={profile}><MatchSetupView  onStart={startNewMatch} onCancel={() => setView("matches")} /></AppShell>;
  if (view === "matchLogFrame" && activeMatchId) {
    const m = matches.find(mx => mx.id === activeMatchId);
    if (m) return <AppShell view={view} onNav={nav} profile={profile}><LogFrameView match={m} onDone={logFrame} onCancel={() => setView("matchActive")} /></AppShell>;
  }
  if (view === "matchActive" && activeMatchId) {
    const m = matches.find(mx => mx.id === activeMatchId);
    if (m) return <AppShell view={view} onNav={nav} profile={profile}><MatchActiveView match={m} onLog={() => setView("matchLogFrame")} onEditLast={editLastFrame} onEnd={endMatch} /></AppShell>;
  }
  if (view === "matchComplete" && matchSummary) return <AppShell view={view} onNav={nav} profile={profile}><MatchCompleteView summary={matchSummary} onDone={() => setView("matches")} /></AppShell>;
  if (view === "matchDetail" && detailMatchId) {
    const m = matches.find(mx => mx.id === detailMatchId);
    if (m) return <AppShell view={view} onNav={nav} profile={profile}><MatchDetailView match={m} onDelete={() => deleteMatchEntry(detailMatchId)} onBack={() => { setDetailMatchId(null); setView("matches"); }} /></AppShell>;
  }

  return <AppShell view={view} onNav={nav} profile={profile}>
    {view === "dashboard" && <Dashboard profile={profile} matches={matches} onStart={() => setView("pickTime")} onNav={nav} />}
    {view === "matches"   && <MatchHistoryView matches={matches} activeMatchId={activeMatchId} onNew={() => setView("matchSetup")} onContinue={() => setView("matchActive")} onDetail={(id) => { setDetailMatchId(id); setView("matchDetail"); }} />}
    {view === "progress"  && <ProgressView profile={profile} />}
    {view === "library"   && <LibraryView  profile={profile} />}
    {view === "settings"  && <SettingsView profile={profile} onMode={(mode) => setProfile(updateRulesMode(profile, mode))} onReset={() => { clearProfile(); setProfile(newProfile()); setView("onboarding"); }} />}
  </AppShell>;
}
