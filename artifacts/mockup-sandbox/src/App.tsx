import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from "recharts";
import { Check, ChevronRight, Play, RotateCcw, TrendingDown, TrendingUp, Minus, X, BookOpen, Settings, Dumbbell, Trophy } from "lucide-react";
import {
  ADAPTATION_SKILL_MAP, ASSESSMENT_CLEARANCE, ASSESSMENT_ITEMS, BALL_COLORS, CLEARANCES, DRILLS,
  ERROR_CODES, RULESETS, SKILLS, SKILL_MAP,
  applySkillUpdate, appendRatingSnapshots, buildErrorChainNarrative, buildRootCauseEvents,
  buildSummary, classifyErrorChain, confidenceLabel, computeConfidence, computeRulesetConfidence,
  decisionValue, evaluatePlannedRoute, generateSession, isStale, limitingFactor,
  newProfile, sessionWeighting, trendFor,
  type AimLine, type Attempt, type Clearance, type DecisionOption, type Drill, type GeneratedSession,
  type PocketId, type Profile, type RootCauseEvent, type RuleSetId, type RulesMode, type SessionSummary, type SkillId,
  type TableMarkings, type TrainingDiagram,
} from "./engine";
import { clearProfile, loadProfile, saveProfile, updateRulesMode } from "./persistence/profileStorage";
import { loadMatches, saveMatches } from "./persistence/matchStorage";
import {
  generateAdaptiveSession, matchAwareLimitingFactor, buildMatchSummary,
  frameScore, createMatch, addFrame, buildFrameEvent, editFrame, deleteFrameFromMatch, completeMatch, deleteMatch,
  FRAME_LOSS_CATEGORIES, POSITIVE_EVENT_TYPES,
  type Match, type MatchSummary, type MatchEnvironment, type FrameImpact, type FrameResult, type FrameEvent, type Frame,
} from "./match";
import { getLegalBalls, isEightBallLegal } from "./rules";

// ─── View types ────────────────────────────────────────────────────────────────
type View = "onboarding" | "assessment" | "provisional" | "dashboard" | "pickTime" | "session" | "summary" | "progress" | "library" | "settings" | "matches" | "matchSetup" | "matchActive" | "matchLogFrame" | "matchEditFrame" | "matchComplete" | "matchDetail";

// ─── Design tokens — Sage-Teal Balanced ───────────────────────────────────────
const COLORS = {
  background:    "#F2F5F1",
  surface:       "#FFFFFF",
  surfaceTeal:   "#EAF3F1",
  surfaceSage:   "#EEF3EF",
  primary:       "#2E7F7C",
  primaryDark:   "#1F4F4C",
  sage:          "#86A695",
  slateBlue:     "#527A8E",
  gold:          "#C79A38",
  text:          "#1E2B25",
  textSecondary: "#6B7874",
  border:        "#DDE4E0",
  success:       "#2F7D4C",
  danger:        "#B84A3A",
} as const;

// Shorthand alias — keeps all existing C.xxx component references working
const C = {
  bg:     COLORS.background,
  panel:  COLORS.surface,
  panel2: COLORS.surfaceTeal,
  panel3: COLORS.surfaceSage,
  line:   COLORS.border,
  ink:    COLORS.text,
  dim:    COLORS.textSecondary,
  muted:  COLORS.textSecondary,
  brass:  COLORS.primary,
  brassD: COLORS.primaryDark,
  chalk:  COLORS.slateBlue,
  rust:   COLORS.danger,
  green:  COLORS.success,
  greenD: "#1F5C35",
};
const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
const R  = { sm: 8, md: 12, lg: 16, xl: 24 } as const;

// ─── English pool ball colours ─────────────────────────────────────────────────
// Sourced from engine BALL_COLORS — renderer always maps group → colour deterministically
const BALL = BALL_COLORS;

const fontImport = "@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Mono:wght@400;600&family=Inter:wght@400;500;600;700&display=swap');";

// ─── Display helpers (pure, UI-only) ──────────────────────────────────────────
/** Map a numeric rating to a readable skill level label. */
export function ratingLevel(rating: number): string {
  if (rating < 35) return "Foundation";
  if (rating < 50) return "Developing";
  if (rating < 62) return "Intermediate";
  if (rating < 74) return "Advanced";
  if (rating < 86) return "Competitive";
  return "Elite";
}

/** Map a confidence tier + stale flag to coaching-friendly copy. */
export function confidenceDisplay(tier: string, stale: boolean): string {
  if (stale) return "Evidence is stale — train to refresh";
  if (tier === "Low")         return "Still learning your game";
  if (tier === "Emerging")    return "Getting a clearer picture";
  if (tier === "Established") return "Strong evidence";
  if (tier === "Strong")      return "Strong evidence";
  return "Still learning your game";
}

/** Map a ruleset ID to its badge label. */
export function rulesetBadgeLabel(ruleset: RuleSetId): string {
  return ruleset === "blackball" ? "BLACKBALL" : "INTERNATIONAL";
}

/** Map FrameImpact to user-friendly language. */
export function impactLabel(impact: FrameImpact): string {
  if (impact === "low")      return "Minor";
  if (impact === "medium")   return "Important";
  if (impact === "high")     return "Important";
  if (impact === "decisive") return "Frame-deciding";
  return impact;
}

/** Map simplified user choice back to FrameImpact. */
export function displayToImpact(display: "Minor" | "Important" | "Frame-deciding"): FrameImpact {
  if (display === "Minor")          return "low";
  if (display === "Frame-deciding") return "decisive";
  return "high";
}

/** Generate a one-line coaching takeaway for a completed match card. */
export function matchCoachingLine(match: Match): string {
  const lostEvents = match.frames.flatMap(f => f.keyEvents).filter(e => e.type === "error");
  if (!lostEvents.length) return "Clean match — no significant errors logged.";
  const bySkill = lostEvents.reduce<Record<string, number>>((acc, e) => {
    if (e.skillId) { acc[e.skillId] = (acc[e.skillId] ?? 0) + 1; } return acc;
  }, {});
  const [topId] = Object.entries(bySkill).sort((a, b) => b[1] - a[1])[0] ?? [];
  const name = topId ? SKILL_MAP[topId as SkillId]?.name ?? topId : null;
  const count = topId ? bySkill[topId] : 0;
  if (!name) return "Errors logged — see match detail.";
  const lostFrames = match.frames.filter(f => f.result === "lost").length;
  if (count >= 2 && lostFrames > 0) return `${name} was involved in ${count} of your lost frames.`;
  return `${name} was the main challenge this match.`;
}

// ─── Nav structure ─────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: "today",    label: "Today",    icon: "◈", target: "dashboard" as View },
  { id: "matches",  label: "Matches",  icon: "◉", target: "matches"   as View },
  { id: "train",    label: "Train",    icon: "◆", target: "pickTime"  as View },
  { id: "progress", label: "Progress", icon: "◇", target: "progress"  as View },
  { id: "more",     label: "More",     icon: "…",  target: "settings"  as View },
] as const;

/** Map a view to its parent nav tab ID. */
function navTab(view: View): string {
  if (["matchSetup","matchActive","matchLogFrame","matchEditFrame","matchComplete","matchDetail"].includes(view)) return "matches";
  if (["library","pickTime"].includes(view)) return "train";
  if (view === "settings") return "more";
  if (["dashboard","provisional","summary"].includes(view)) return "today";
  if (view === "progress") return "progress";
  return view;
}

/** Views where bottom nav is hidden (full-focus flows). */
const HIDE_NAV: View[] = ["session", "assessment"];

// ─── Shared UI primitives ──────────────────────────────────────────────────────
function Card({ children, style, onClick }: { children: ReactNode; style?: CSSProperties; onClick?: () => void }) {
  const base: CSSProperties = {
    background: C.panel, border: `1px solid ${C.line}`, borderRadius: R.lg,
    boxShadow: "0 1px 4px rgba(30,43,37,0.07)", padding: SP.lg, transition: "border-color .15s",
  };
  return onClick
    ? <button onClick={onClick} style={{ ...base, cursor: "pointer", textAlign: "left", width: "100%", ...style }}>{children}</button>
    : <section style={{ ...base, ...style }}>{children}</section>;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: 1.4, marginBottom: SP.sm, textTransform: "uppercase" }}>{children}</div>;
}

type ButtonVariant = "primary" | "success" | "danger" | "default" | "ghost" | "outline";
function Btn({ children, onClick, variant = "default", disabled = false, style, type = "button" }:
  { children: ReactNode; onClick?: () => void; variant?: ButtonVariant; disabled?: boolean; style?: CSSProperties; type?: "button" | "submit" }) {
  const variantStyles: Record<ButtonVariant, CSSProperties> = {
    primary: { background: C.brass,  color: "#FFFFFF", border: "none" },
    success: { background: C.green,  color: "#FFFFFF", border: "none" },
    danger:  { background: C.rust,   color: "#FFFFFF", border: "none" },
    default: { background: C.panel2, color: C.ink, border: `1px solid ${C.line}` },
    ghost:   { background: "transparent", color: C.dim, border: "none" },
    outline: { background: "transparent", color: C.brass, border: `1px solid ${C.brass}` },
  };
  return <button type={type} disabled={disabled} onClick={onClick} style={{
    alignItems: "center", borderRadius: R.md, cursor: disabled ? "not-allowed" : "pointer",
    display: "flex", fontFamily: "'Inter', sans-serif", fontSize: 15, fontWeight: 600,
    justifyContent: "center", gap: SP.sm, minHeight: 50, opacity: disabled ? .45 : 1,
    padding: "13px 18px", transition: "filter .12s, transform .1s", width: "100%",
    ...variantStyles[variant], ...style,
  }}>{children}</button>;
}

function ProgressBar({ value, color = C.brass, height = 6 }: { value: number; color?: string; height?: number }) {
  return <div style={{ background: C.panel2, borderRadius: height, height, overflow: "hidden" }}>
    <div style={{ background: color, borderRadius: height, height: "100%", transition: "width .4s ease", width: `${Math.max(0, Math.min(100, value))}%` }} />
  </div>;
}

function RulesBadge({ ruleset, style }: { ruleset: RuleSetId; style?: CSSProperties }) {
  const bbColor  = COLORS.gold;
  const intColor = COLORS.slateBlue;
  const col = ruleset === "blackball" ? bbColor : intColor;
  return <span style={{
    background: `${col}22`,
    border: `1px solid ${col}`,
    borderRadius: R.sm, color: col,
    display: "inline-block", fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 9, fontWeight: 700, letterSpacing: 1.5, padding: "2px 8px", textTransform: "uppercase", ...style,
  }}>{rulesetBadgeLabel(ruleset)}</span>;
}

function TrendIcon({ trend }: { trend: string }) {
  if (trend === "up")   return <TrendingUp   color={C.green} size={13} />;
  if (trend === "down") return <TrendingDown color={C.rust}  size={13} />;
  return <Minus color={C.muted} size={13} />;
}

function MetricPill({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: R.md, padding: "10px 14px" }}>
    <div style={{ color: C.muted, fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
    <div style={{ color: color ?? C.ink, fontSize: 15, fontWeight: 600 }}>{value}</div>
  </div>;
}

function EmptyState({ icon, title, body }: { icon?: string; title: string; body: string }) {
  return <div style={{ padding: "SP.xxl 0", textAlign: "center" }}>
    {icon && <div style={{ fontSize: 36, marginBottom: SP.lg }}>{icon}</div>}
    <div style={{ color: C.ink, fontWeight: 600, marginBottom: SP.sm }}>{title}</div>
    <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.6, maxWidth: 280, margin: "0 auto" }}>{body}</div>
  </div>;
}

// ─── Pool table SVG ────────────────────────────────────────────────────────────
type BallSpec = { x: number; y: number; color: string; highlight?: boolean; label?: string; opacity?: number; trainingLabel?: string };

function PoolTable({
  width = 280,
  balls = [],
  targetBalls = [],
  selectedBall = null,
  routeSegments = [],
  targetZone,
  tableMarkings,
  targetPocket,
  aimLines = [],
}: {
  width?: number;
  balls?: BallSpec[];
  targetBalls?: string[];
  selectedBall?: string | null;
  routeSegments?: Array<{ fromBallId: string; toBallId: string; type: "cueBallRoute" | "objectBallRoute" }>;
  targetZone?: { x: number; y: number; width: number; height: number };
  tableMarkings?: TableMarkings;
  targetPocket?: PocketId;
  aimLines?: AimLine[];
}) {
  const h   = width * 0.56;
  const pW  = width * 0.08;
  const bX  = pW, bY = pW * 0.85;
  const bW  = width - pW * 2, bH = h - bY * 2;
  const pR  = pW * 0.42;
  const ballR = bW * 0.017;

  // Pocket positions — order matches PocketId keys
  const pockets: [number, number][] = [
    [bX,          bY],                         // topLeft
    [bX + bW / 2, bY - pR * 0.3],              // topMiddle
    [bX + bW,     bY],                         // topRight
    [bX,          bY + bH],                    // bottomLeft
    [bX + bW / 2, bY + bH + pR * 0.3],         // bottomMiddle
    [bX + bW,     bY + bH],                    // bottomRight
  ];
  const pocketMap: Record<PocketId, [number, number]> = {
    topLeft: pockets[0], topMiddle: pockets[1], topRight: pockets[2],
    bottomLeft: pockets[3], bottomMiddle: pockets[4], bottomRight: pockets[5],
  };

  // Baulk line: 1/5 of playing length from the baulk cushion (bottom of diagram)
  const baulkLineY  = bY + 0.80 * bH;
  // Black spot: row-2 centre of a rack with apex at y=22%
  const blackSpotX  = bX + 0.50 * bW;
  const blackSpotY  = bY + 0.338 * bH;

  return <svg viewBox={`0 0 ${width} ${h}`} width={width} height={h} style={{ display: "block", borderRadius: R.md }}>
    <defs>
      <radialGradient id="ballShade" cx="38%" cy="32%" r="72%">
        <stop offset="0%"   stopColor="#ffffff" stopOpacity={0.20} />
        <stop offset="55%"  stopColor="#000000" stopOpacity={0} />
        <stop offset="100%" stopColor="#000000" stopOpacity={0.30} />
      </radialGradient>
      <marker id="routeArrow" markerWidth="5" markerHeight="5" refX="4.5" refY="2.5" orient="auto">
        <polygon points="0 0, 5 2.5, 0 5" fill={COLORS.primaryDark} opacity={0.65} />
      </marker>
    </defs>

    {/* ── 1. Table shell ── */}
    <rect x={0} y={0} width={width} height={h} rx={pW * 0.7} fill="#2a1a0a" />
    <rect x={pW * 0.35} y={pW * 0.35} width={width - pW * 0.7} height={h - pW * 0.7} rx={pW * 0.5} fill="#3d2510" />
    <rect x={bX} y={bY} width={bW} height={bH} rx={R.sm * 0.4} fill="#2A8790" />
    <line x1={bX + bW / 2} y1={bY + 4} x2={bX + bW / 2} y2={bY + bH - 4} stroke="#ffffff" strokeOpacity={0.04} strokeWidth={1} />

    {/* ── 2. Table markings (baulk area, baulk/break line, black spot, rack line) ── */}
    {tableMarkings?.showBaulkArea && <rect
      x={bX} y={baulkLineY} width={bW} height={bY + bH - baulkLineY}
      fill="#FFFFFF" fillOpacity={0.08}
    />}
    {(tableMarkings?.showBaulkLine || tableMarkings?.showBreakLine) && <line
      x1={bX} y1={baulkLineY} x2={bX + bW} y2={baulkLineY}
      stroke="#F2F0E8" strokeOpacity={0.50} strokeWidth={1.6} strokeDasharray="5,3"
    />}
    {tableMarkings?.baulkLabel && <text
      x={bX + 5} y={baulkLineY + 9}
      fontSize={6.5} fill="#F2F0E8" fillOpacity={0.58}
      fontFamily="'IBM Plex Mono', monospace" letterSpacing={0.5}
    >{tableMarkings.baulkLabel}</text>}
    {tableMarkings?.showBlackSpot && <>
      <line x1={blackSpotX - 4} y1={blackSpotY} x2={blackSpotX + 4} y2={blackSpotY}
        stroke="#F2F0E8" strokeOpacity={0.55} strokeWidth={1.3} />
      <line x1={blackSpotX} y1={blackSpotY - 4} x2={blackSpotX} y2={blackSpotY + 4}
        stroke="#F2F0E8" strokeOpacity={0.55} strokeWidth={1.3} />
      <circle cx={blackSpotX} cy={blackSpotY} r={1.8} fill="#F2F0E8" fillOpacity={0.60} />
    </>}
    {tableMarkings?.showRackLine && <line
      x1={bX + bW / 2} y1={bY + 2} x2={bX + bW / 2} y2={baulkLineY}
      stroke="#F2F0E8" strokeOpacity={0.16} strokeWidth={1}
    />}

    {/* ── 3. Target zone (coaching area — visibly shaded + bordered) ── */}
    {targetZone && <>
      <rect
        x={bX + (targetZone.x / 100) * bW}
        y={bY + (targetZone.y / 100) * bH}
        width={(targetZone.width / 100) * bW}
        height={(targetZone.height / 100) * bH}
        fill="rgba(255,255,255,0.18)"
        stroke="#F2F0E8"
        strokeWidth={1.8}
        strokeDasharray="4,3"
        strokeOpacity={0.75}
        rx={2}
      />
      <text
        x={bX + (targetZone.x / 100) * bW + ((targetZone.width / 100) * bW) / 2}
        y={bY + (targetZone.y / 100) * bH + ((targetZone.height / 100) * bH) / 2}
        textAnchor="middle" dominantBaseline="central"
        fontSize={6} fill="#F2F0E8" fillOpacity={0.65}
        fontFamily="'IBM Plex Mono', monospace" letterSpacing={0.5}
      >TARGET</text>
    </>}

    {/* ── 4. Aim / potting lines (instructional shot geometry) ── */}
    {aimLines.map((al, i) => {
      const fromB = balls.find(b => b.label === al.fromBallId);
      const thruB = al.throughBallId ? balls.find(b => b.label === al.throughBallId) : null;
      const pPos  = al.toPocket ? pocketMap[al.toPocket] : null;
      if (!fromB) return null;
      const dash  = al.style !== "solid";
      const fx = fromB.x * width, fy = fromB.y * h;
      const segs: [number, number, number, number][] = [];
      if (thruB) {
        const tx = thruB.x * width, ty = thruB.y * h;
        segs.push([fx, fy, tx, ty]);
        if (pPos) segs.push([tx, ty, pPos[0], pPos[1]]);
      } else if (pPos) {
        segs.push([fx, fy, pPos[0], pPos[1]]);
      }
      return segs.map(([x1, y1, x2, y2], j) => <line
        key={`al-${i}-${j}`} x1={x1} y1={y1} x2={x2} y2={y2}
        stroke="#F2F0E8" strokeOpacity={0.42} strokeWidth={1.4}
        strokeDasharray={dash ? "5,3" : undefined}
      />);
    })}

    {/* ── 5. Pockets ── */}
    {pockets.map(([px, py], i) => (
      <g key={i}>
        <circle cx={px} cy={py} r={pR * 1.15} fill="#0d1a14" />
        <circle cx={px} cy={py} r={pR * 0.75} fill="#060e0a" />
      </g>
    ))}

    {/* ── 6. Balls ── */}
    {balls.map((b, i) => {
      const sel = selectedBall === b.label;
      const bx  = b.x * width, by = b.y * h;
      return <g key={i} opacity={b.opacity ?? 1}>
        <ellipse cx={bx} cy={by + ballR * 0.90} rx={ballR * 0.88} ry={ballR * 0.26} fill="#000000" opacity={0.14} />
        {sel && <>
          <circle cx={bx} cy={by} r={ballR + 3.5} fill={COLORS.primary} opacity={0.10} />
          <circle cx={bx} cy={by} r={ballR + 2.5} fill="none" stroke={COLORS.primary} strokeWidth={1.5} opacity={0.85} />
        </>}
        <circle cx={bx} cy={by} r={ballR} fill={b.color} stroke="#00000030" strokeWidth={0.5} />
        <circle cx={bx} cy={by} r={ballR} fill="url(#ballShade)" />
        {b.highlight && <circle cx={bx - ballR * 0.26} cy={by - ballR * 0.30} r={ballR * 0.21} fill="#ffffff" opacity={0.40} />}
        {b.trainingLabel && <g>
          <circle cx={bx + ballR + 5.5} cy={by - ballR - 5.5} r={5} fill="#FFFFFF" stroke={COLORS.primaryDark} strokeWidth={0.8} opacity={0.93} />
          <text x={bx + ballR + 5.5} y={by - ballR - 5.5} textAnchor="middle" dominantBaseline="central" fontSize={5.5} fontFamily="'IBM Plex Mono', monospace" fontWeight="700" fill={COLORS.primaryDark}>{b.trainingLabel}</text>
        </g>}
      </g>;
    })}

    {/* ── 7. Route segments ── */}
    {routeSegments.map((seg, i) => {
      const fromSpec = balls.find(b => b.label === seg.fromBallId);
      const toSpec   = balls.find(b => b.label === seg.toBallId);
      if (!fromSpec || !toSpec) return null;
      const fx = fromSpec.x * width, fy = fromSpec.y * h;
      const tx = toSpec.x   * width, ty = toSpec.y   * h;
      const dx = tx - fx, dy = ty - fy, dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) return null;
      const nx = dx / dist, ny = dy / dist;
      return <line key={`seg-${i}`}
        x1={fx + nx * (ballR + 2)}   y1={fy + ny * (ballR + 2)}
        x2={tx - nx * (ballR + 6.5)} y2={ty - ny * (ballR + 6.5)}
        stroke={COLORS.primaryDark} strokeWidth={1.1}
        strokeDasharray={seg.type === "cueBallRoute" ? "4,2.5" : undefined}
        strokeOpacity={0.55} markerEnd="url(#routeArrow)"
      />;
    })}

    {/* ── 8. Target pocket emphasis (gold ring — rendered last, on top of pocket) ── */}
    {targetPocket && (() => {
      const [px, py] = pocketMap[targetPocket];
      return <>
        <circle cx={px} cy={py} r={pR * 1.65} fill="none" stroke={COLORS.gold} strokeWidth={2.0} strokeOpacity={0.82} />
        <circle cx={px} cy={py} r={pR * 1.95} fill="none" stroke={COLORS.gold} strokeWidth={0.9} strokeOpacity={0.38} />
      </>;
    })()}
  </svg>;
}

/** Convert simple ball-color specs into BallSpec grid layout. */
function simpleBalls(specs: { color?: string }[], tableWidth = 280): BallSpec[] {
  const tableH = tableWidth * 0.56;
  const pW = tableWidth * 0.08;
  const bX = pW, bY = pW * 0.85;
  const bW = tableWidth - pW * 2, bH = tableH - bY * 2;
  const startX = (bX + 18) / tableWidth;
  const stepX  = 22 / tableWidth;
  const centerY = (bY + bH / 2) / tableH;
  return specs.map((s, i) => ({ x: startX + stepX * i, y: centerY, color: s.color ?? BALL.red, highlight: true }));
}

/** Fallback diagram for execution drills without authored layout */
function ExecDrillDiagram() {
  const w = 260;
  return <PoolTable width={w} balls={[
    { x: 0.35, y: 0.50, color: BALL.cue, highlight: true },
    { x: 0.62, y: 0.44, color: BALL.red, highlight: true },
  ]} />;
}

/** Fallback diagram for decision drills without authored layout */
function DecisionDrillDiagram() {
  const w = 260;
  return <PoolTable width={w} balls={[
    { x: 0.30, y: 0.50, color: BALL.cue,    highlight: true },
    { x: 0.52, y: 0.37, color: BALL.yellow, highlight: true },
    { x: 0.55, y: 0.63, color: BALL.red,    highlight: true },
    { x: 0.72, y: 0.46, color: BALL.black,  highlight: true },
  ]} />;
}

/** Convert an authored TrainingDiagram (0–100 % coordinates) to PoolTable BallSpec[].
 *  tableWidth must match the PoolTable width prop (default 260). */
function diagramToBalls(diagram: TrainingDiagram, tableWidth = 260): BallSpec[] {
  const tableH = tableWidth * 0.56;
  const pW     = tableWidth * 0.08;
  const bX     = pW, bY = pW * 0.85;
  const bW     = tableWidth - pW * 2, bH = tableH - bY * 2;
  return diagram.balls.map((b) => {
    const svgX  = (bX + (b.x / 100) * bW) / tableWidth;
    const svgY  = (bY + (b.y / 100) * bH) / tableH;
    const color = b.group === "cue"   ? BALL.cue
                : b.group === "black" ? BALL.black
                : b.group === "red"   ? BALL.red
                : BALL.yellow;
    const opacity = b.role === "obstacle" ? 0.55 : 1;
    return { x: svgX, y: svgY, color, highlight: true, label: b.id, trainingLabel: b.trainingLabel, opacity };
  });
}

function WhyThisDrill({ reason }: { reason?: string }) {
  if (!reason) return null;
  return <details style={{ marginBottom: SP.md }}>
    <summary style={{ color: C.muted, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, userSelect: "none" }}>Why this drill?</summary>
    <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.6, marginTop: SP.sm, paddingLeft: SP.md }}>{reason}</div>
  </details>;
}

// ─── App shell ─────────────────────────────────────────────────────────────────
function AppShell({ view, children, onNav, profile }: {
  view: View; children: ReactNode; onNav: (view: View) => void; profile: Profile;
}) {
  const hideNav  = HIDE_NAV.includes(view);
  const modeLabel = profile.preferredRulesMode === "mixed"
    ? "Mixed Training"
    : RULESETS[profile.ruleset].name;
  const activeTab = navTab(view);

  // Session / drill progress — compact top bar only
  if (view === "session") {
    return <div style={{ background: C.bg, color: C.ink, fontFamily: "'Inter', sans-serif", minHeight: "100dvh" }}>
      <style>{fontImport}{`*{box-sizing:border-box}body{margin:0;background:${C.bg}}button{font-family:inherit}button:hover:not(:disabled){filter:brightness(1.1)}button:active:not(:disabled){transform:scale(.97)}`}</style>
      <div style={{ display: "flex", flexDirection: "column", margin: "0 auto", maxWidth: 520, minHeight: "100dvh" }}>
        <header style={{ borderBottom: `1px solid ${C.line}`, padding: "14px 16px 10px", display: "flex", alignItems: "center", gap: SP.md }}>
          <div style={{ color: C.brass, fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: 1.5, flex: 1 }}>TRAINING</div>
          <div style={{ color: C.muted, fontSize: 12 }}>{modeLabel}</div>
        </header>
        <main style={{ flex: 1, padding: "16px 16px 32px" }}>{children}</main>
      </div>
    </div>;
  }

  return <div style={{ background: C.bg, color: C.ink, fontFamily: "'Inter', sans-serif", minHeight: "100dvh" }}>
    <style>{fontImport}{`*{box-sizing:border-box}body{margin:0;background:${C.bg}}button{font-family:inherit}button:hover:not(:disabled){filter:brightness(1.08)}button:active:not(:disabled){transform:scale(.97)}`}</style>
    <div style={{ display: "flex", flexDirection: "column", margin: "0 auto", maxWidth: 520, minHeight: "100dvh" }}>
      {/* Top header */}
      {view !== "onboarding" && <header style={{ borderBottom: `1px solid ${C.line}`, padding: "16px 16px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ color: C.brass, fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1.8 }}>8-BALL COACH</div>
        <div style={{ background: `${C.panel2}`, border: `1px solid ${C.line}`, borderRadius: R.sm, color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: 1, padding: "3px 10px", textTransform: "uppercase" }}>{modeLabel}</div>
      </header>}

      {/* Main content */}
      <main style={{ flex: 1, padding: hideNav ? "16px 16px 32px" : "16px 16px 80px" }}>
        {children}
      </main>

      {/* Bottom nav */}
      {!hideNav && <nav style={{
        background: C.panel, borderTop: `1px solid ${C.line}`, bottom: 0,
        display: "flex", left: 0, position: "fixed",
        width: "min(100vw, 520px)", zIndex: 10,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}>
        {NAV_ITEMS.map((item) => {
          const active = activeTab === item.id;
          return <button key={item.id} onClick={() => onNav(item.target)} style={{
            background: "transparent", border: 0, color: active ? C.brass : C.muted,
            cursor: "pointer", flex: 1, padding: "11px 4px 12px", display: "flex",
            flexDirection: "column", alignItems: "center", gap: 4,
            borderTop: active ? `2px solid ${C.brass}` : "2px solid transparent",
            transition: "color .15s, border-color .15s",
          }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>{
              item.id === "today"    ? <span style={{ fontFamily: "'Bebas Neue'", fontSize: 14 }}>TODAY</span>
              : item.id === "matches"  ? <Trophy size={18} />
              : item.id === "train"    ? <Dumbbell size={18} />
              : item.id === "progress" ? <TrendingUp size={18} />
              : <Settings size={18} />
            }</span>
            <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: active ? 700 : 500, letterSpacing: 0.3 }}>{item.label}</span>
          </button>;
        })}
      </nav>}
    </div>
  </div>;
}

// ─── Onboarding (3 screens) ────────────────────────────────────────────────────
const MODES_FOR_ONBOARDING: { mode: RulesMode; label: string; description: string }[] = [
  { mode: "blackball",     label: "Blackball",     description: "The compact, tactical game built around reds, yellows, and the black." },
  { mode: "international", label: "International", description: "The internationally recognised 8-ball format with its own tactical rhythm." },
  { mode: "mixed",         label: "Both",          description: "Train both rulesets. Every rules-specific exercise will be clearly labelled." },
];

function Onboarding({ onChoose }: { onChoose: (mode: RulesMode) => void }) {
  const [screen, setScreen] = useState<0 | 1 | 2>(0);
  const [mode,   setMode]   = useState<RulesMode>("blackball");

  const baseWrap: CSSProperties = {
    alignItems: "center", background: C.bg, display: "flex", flexDirection: "column",
    fontFamily: "'Inter', sans-serif", justifyContent: "center",
    minHeight: "100dvh", padding: "32px 20px",
  };

  if (screen === 0) return <div style={baseWrap}>
    <style>{fontImport}{`*{box-sizing:border-box}body{margin:0;background:${C.bg}}button{font-family:inherit}button:hover:not(:disabled){filter:brightness(1.1)}button:active:not(:disabled){transform:scale(.97)}`}</style>
    <div style={{ maxWidth: 420, width: "100%" }}>
      {/* Wordmark */}
      <div style={{ marginBottom: SP.xl }}>
        <div style={{ color: C.brass, fontFamily: "'Bebas Neue', sans-serif", fontSize: 52, letterSpacing: 3, lineHeight: 1 }}>8-BALL</div>
        <div style={{ color: C.brass, fontFamily: "'Bebas Neue', sans-serif", fontSize: 52, letterSpacing: 3, lineHeight: 1, marginBottom: SP.sm }}>COACH</div>
        <div style={{ background: C.brass, height: 2, width: 48, borderRadius: 1 }} />
      </div>
      <h1 style={{ color: C.ink, fontSize: 26, fontWeight: 700, lineHeight: 1.2, margin: "0 0 12px" }}>
        Train what actually<br />costs you frames.
      </h1>
      <p style={{ color: C.dim, fontSize: 15, lineHeight: 1.65, margin: "0 0 40px" }}>
        8-Ball Coach learns your game, identifies the skills costing you the most, and adapts every training session to fix them.
      </p>
      <Btn variant="primary" onClick={() => setScreen(1)} style={{ fontSize: 16, minHeight: 56 }}>
        Get Started <ChevronRight size={18} />
      </Btn>
    </div>
  </div>;

  if (screen === 1) return <div style={baseWrap}>
    <style>{fontImport}{`*{box-sizing:border-box}body{margin:0;background:${C.bg}}button{font-family:inherit}button:hover:not(:disabled){filter:brightness(1.1)}button:active:not(:disabled){transform:scale(.97)}`}</style>
    <div style={{ maxWidth: 420, width: "100%" }}>
      <div style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 1.4, marginBottom: SP.lg, textTransform: "uppercase" }}>How it works</div>
      <h2 style={{ color: C.ink, fontSize: 24, fontWeight: 700, margin: "0 0 32px" }}>Simple cycle.<br />Real improvement.</h2>
      {[
        ["1", "Play", "Compete or practise matches."],
        ["2", "Log",  "Record what decided the frame."],
        ["3", "Train","8-Ball Coach builds sessions from your real weaknesses."],
        ["4", "Improve", "Your profile sharpens as evidence builds."],
        ["5", "Repeat",  "The cycle adapts as you improve."],
      ].map(([n, title, body]) => <div key={n} style={{ display: "flex", gap: SP.lg, marginBottom: SP.xl }}>
        <div style={{ background: C.brass, borderRadius: "50%", color: "#FFFFFF", flexShrink: 0, fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, height: 32, letterSpacing: 0.5, width: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>{n}</div>
        <div>
          <div style={{ color: C.ink, fontWeight: 600, marginBottom: 2 }}>{title}</div>
          <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.55 }}>{body}</div>
        </div>
      </div>)}
      <Btn variant="primary" onClick={() => setScreen(2)} style={{ marginTop: SP.sm, minHeight: 56 }}>
        Choose my rules <ChevronRight size={18} />
      </Btn>
    </div>
  </div>;

  // Screen 2: rules picker
  return <div style={baseWrap}>
    <style>{fontImport}{`*{box-sizing:border-box}body{margin:0;background:${C.bg}}button{font-family:inherit}button:hover:not(:disabled){filter:brightness(1.1)}button:active:not(:disabled){transform:scale(.97)}`}</style>
    <div style={{ maxWidth: 420, width: "100%" }}>
      <div style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 1.4, marginBottom: SP.lg, textTransform: "uppercase" }}>Step 3 of 3</div>
      <h2 style={{ color: C.ink, fontSize: 24, fontWeight: 700, margin: "0 0 8px" }}>Which rules do you play?</h2>
      <p style={{ color: C.dim, fontSize: 14, lineHeight: 1.55, margin: "0 0 24px" }}>Your ratings are always shared. You can change this preference later in More.</p>
      <div style={{ display: "grid", gap: SP.sm, marginBottom: SP.xl }}>
        {MODES_FOR_ONBOARDING.map((item) => <button key={item.mode} onClick={() => setMode(item.mode)} style={{
          background: mode === item.mode ? C.panel3 : C.panel,
          border: `1px solid ${mode === item.mode ? C.brass : C.line}`,
          borderRadius: R.lg, color: C.ink, cursor: "pointer", padding: "16px 18px", textAlign: "left",
        }}>
          <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <strong style={{ fontSize: 15 }}>{item.label}</strong>
            {mode === item.mode && <Check color={C.brass} size={17} />}
          </div>
          <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.45 }}>{item.description}</div>
        </button>)}
      </div>
      <Btn variant="primary" onClick={() => onChoose(mode)} style={{ minHeight: 56, fontSize: 16 }}>
        Start short assessment <Play size={17} />
      </Btn>
      <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.5, marginTop: SP.lg, textAlign: "center" }}>
        A quick 10-question check builds your starting profile.
      </div>
    </div>
  </div>;
}

// ─── Skill radar ───────────────────────────────────────────────────────────────
function SkillRadar({ profile, color = C.chalk }: { profile: Profile; color?: string }) {
  const data = SKILLS.map((s) => ({ skill: s.shortName, value: Math.round(profile.skills[s.id].rating) }));
  return <Card style={{ height: 260, marginBottom: SP.lg }}>
    <ResponsiveContainer height="100%" width="100%">
      <RadarChart data={data} outerRadius="68%">
        <PolarGrid stroke={C.line} />
        <PolarAngleAxis dataKey="skill" tick={{ fill: C.muted, fontSize: 9 }} />
        <Radar dataKey="value" fill={color} fillOpacity={.18} stroke={color} strokeWidth={1.5} />
      </RadarChart>
    </ResponsiveContainer>
  </Card>;
}

// ─── Assessment ────────────────────────────────────────────────────────────────
function Assessment({ profile, onDone }: { profile: Profile; onDone: (profile: Profile) => void }) {
  const [index, setIndex] = useState(0);
  const profileRef = useRef(profile);
  const total = ASSESSMENT_ITEMS.length + 1;
  const current = index === ASSESSMENT_ITEMS.length ? ASSESSMENT_CLEARANCE : ASSESSMENT_ITEMS[index];
  const activeRuleset: RuleSetId = profile.preferredRulesMode === "international" ? "international" : "blackball";
  const advance = (next: Profile) => { profileRef.current = next; index + 1 >= total ? onDone({ ...next, assessmentComplete: true }) : setIndex((v) => v + 1); };
  return <div>
    <div style={{ marginBottom: SP.lg }}>
      <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: SP.sm }}>
        <SectionLabel>Assessment · {index + 1} of {total}</SectionLabel>
        <span style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>{Math.round(index / total * 100)}%</span>
      </div>
      <ProgressBar value={index / total * 100} color={C.brass} />
    </div>
    {current.type === "combined"
      ? <ClearanceRunner key={`assess-${index}`} clearance={current} profile={profileRef.current} source="assessment" activeRuleset={activeRuleset} onComplete={advance} />
      : <DrillRunner     key={`assess-${index}`} drill={current as Drill} profile={profileRef.current} source="assessment" activeRuleset={activeRuleset} onComplete={advance} />}
  </div>;
}

function Provisional({ profile, onContinue }: { profile: Profile; onContinue: () => void }) {
  const mean = SKILLS.reduce((sum, s) => sum + profile.skills[s.id].rating, 0) / SKILLS.length;
  const strengths = SKILLS.filter((s) => profile.skills[s.id].rating >= mean + 5).map((s) => s.name);
  const focus = SKILLS.filter((s) => profile.skills[s.id].rating < mean - 5).sort((a, b) => profile.skills[a.id].rating - profile.skills[b.id].rating).map((s) => s.name);
  return <div>
    <Card style={{ marginBottom: SP.lg }}>
      <SectionLabel>Your starting profile</SectionLabel>
      <p style={{ color: C.ink, lineHeight: 1.65, margin: "0 0 12px", fontSize: 15 }}>
        {strengths.length > 0 && <><strong style={{ color: C.brass }}>{strengths.slice(0, 2).join(" and ")}</strong> look like early strengths. </>}
        {focus.length > 0 && <><strong style={{ color: C.chalk }}>{focus.slice(0, 2).join(" and ")}</strong> are your first priority. </>}
        This sharpens as you train.
      </p>
    </Card>
    <SkillRadar color={C.brass} profile={profile} />
    <Btn variant="primary" onClick={onContinue} style={{ minHeight: 56, fontSize: 16 }}>
      Start your first session <Play size={17} />
    </Btn>
  </div>;
}

// ─── Dashboard ─────────────────────────────────────────────────────────────────
function Dashboard({ profile, matches, onStart, onNav }: {
  profile: Profile; matches: Match[]; onStart: () => void; onNav: (view: View) => void;
}) {
  const lf      = matchAwareLimitingFactor(profile, matches);
  const weighting = sessionWeighting(profile, lf);
  const modeLabel = profile.preferredRulesMode === "mixed" ? "Mixed Training" : RULESETS[profile.ruleset].name;
  const recent  = profile.sessions.slice(-3).reverse();
  const recentMatch = matches.filter(m => m.completedAt != null).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0] ?? null;

  const focusCopy = lf.status === "insufficient"
    ? "Building your profile — today's session samples across your game."
    : lf.status === "provisional"
    ? `Early signal: ${lf.primary?.name} looks like your biggest opportunity.`
    : `${lf.primary?.name} is your current priority.`;

  const coachReason = lf.status === "insufficient"
    ? "Answer a few more sessions and your focus will sharpen."
    : matches.filter(m => m.completedAt != null).length >= 2
    ? `Recent match evidence points to ${lf.primary?.name ?? "execution"} as today's biggest lever.`
    : lf.primary
    ? `Your ${lf.primary.name} rating has the most room to lift your game right now.`
    : "Session will sample broadly to build your profile.";

  return <div>
    {/* Hero training card */}
    <Card style={{ marginBottom: SP.lg, border: `1px solid ${C.brassD}` }}>
      <SectionLabel>Today's Training</SectionLabel>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2, marginBottom: SP.sm }}>
        {lf.primary ? lf.primary.name : "Build a broader picture"}
        {lf.secondary && <span style={{ color: C.dim, fontSize: 15, fontWeight: 400 }}> + {lf.secondary.name}</span>}
      </div>
      <div style={{ alignItems: "center", color: C.muted, display: "flex", fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", gap: SP.sm, marginBottom: SP.md }}>
        <span>30 min</span><span style={{ color: C.line }}>·</span><span>{modeLabel}</span>
      </div>
      <p style={{ color: C.dim, fontSize: 13, lineHeight: 1.6, margin: `0 0 ${SP.lg}px`, fontStyle: "italic" }}>"{coachReason}"</p>
      <Btn variant="primary" onClick={onStart} style={{ minHeight: 54, fontSize: 16 }}>
        <Play size={17} /> Start Training
      </Btn>
    </Card>

    {/* Secondary cards grid */}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: SP.md, marginBottom: SP.lg }}>
      <Card><SectionLabel>Current Focus</SectionLabel>
        <div style={{ color: C.ink, fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{lf.primary?.name ?? "Gathering evidence"}</div>
        <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.45 }}>{focusCopy}</div>
      </Card>
      <Card><SectionLabel>Session Mix</SectionLabel>
        <div style={{ color: C.ink, fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{weighting.execWeight}% execution</div>
        <div style={{ color: C.muted, fontSize: 12 }}>{weighting.decWeight}% decision</div>
      </Card>
    </div>

    {/* Recent match */}
    {recentMatch && (() => {
      const sc = frameScore(recentMatch);
      const won = sc.player > sc.opponent;
      return <Card style={{ marginBottom: SP.lg }} onClick={() => onNav("matches")}>
        <SectionLabel>Recent Match</SectionLabel>
        <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: 1, color: won ? C.green : C.rust }}>{sc.player} – {sc.opponent}</div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <RulesBadge ruleset={recentMatch.ruleset} />
            <span style={{ color: won ? C.green : C.rust, fontSize: 11, fontWeight: 700 }}>{won ? "WON" : "LOST"}</span>
          </div>
        </div>
        <div style={{ color: C.muted, fontSize: 12, fontStyle: "italic" }}>"{matchCoachingLine(recentMatch)}"</div>
      </Card>;
    })()}

    {/* Recent sessions */}
    <Card style={{ marginBottom: SP.lg }}>
      <SectionLabel>Recent Progress</SectionLabel>
      {!recent.length
        ? <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.6 }}>No sessions yet — your first session starts the feedback loop.</div>
        : recent.map((s, i) => <div key={`${s.ts}-${i}`} style={{
            borderBottom: i < recent.length - 1 ? `1px solid ${C.line}` : "none",
            color: C.dim, fontSize: 13, padding: "9px 0", lineHeight: 1.45,
          }}>
            <span style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>{new Date(s.ts).toLocaleDateString()}</span>
            <div style={{ marginTop: 2 }}>{s.summary.changeNote}</div>
          </div>)
      }
    </Card>
    <Btn variant="ghost" onClick={() => onNav("progress")} style={{ color: C.brass, justifyContent: "center" }}>
      View full skill profile <ChevronRight size={16} />
    </Btn>
  </div>;
}

// ─── Pick time / session setup ─────────────────────────────────────────────────
function PickTime({ profile, matches, onPick, onBrowseLibrary }: {
  profile: Profile; matches: Match[]; onPick: (minutes: number) => void; onBrowseLibrary: () => void;
}) {
  const lf = matchAwareLimitingFactor(profile, matches);
  const modeLabel = profile.preferredRulesMode === "mixed" ? "Mixed Training" : RULESETS[profile.ruleset].name;
  return <div>
    {/* Priority summary */}
    <Card style={{ marginBottom: SP.lg, border: `1px solid ${C.panel3}` }}>
      <SectionLabel>Your current priority</SectionLabel>
      {lf.primary
        ? <>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: SP.xs }}>{lf.primary.name}</div>
            {lf.secondary && <div style={{ color: C.dim, fontSize: 13 }}>Also: {lf.secondary.name}</div>}
          </>
        : <div style={{ color: C.dim, fontSize: 14 }}>Building evidence — session will sample broadly.</div>}
      <div style={{ marginTop: SP.md }}>
        <div style={{ background: `${C.panel2}`, border: `1px solid ${C.line}`, borderRadius: R.sm, color: C.muted, display: "inline-block", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: 1, padding: "3px 10px", textTransform: "uppercase" }}>{modeLabel}</div>
      </div>
    </Card>

    {/* Duration picker */}
    <Card style={{ marginBottom: SP.lg }}>
      <SectionLabel>How much time?</SectionLabel>
      <p style={{ color: C.dim, fontSize: 13, lineHeight: 1.55, margin: `0 0 ${SP.md}px` }}>The session adjusts its balance and variety to fit your available time.</p>
      <div style={{ display: "grid", gap: SP.sm, gridTemplateColumns: "repeat(5, 1fr)" }}>
        {[15, 30, 45, 60, 90].map((m) => <button key={m} onClick={() => onPick(m)} style={{
          background: C.panel2, border: `1px solid ${C.line}`, borderRadius: R.md,
          color: C.ink, cursor: "pointer", fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 20, letterSpacing: 0.5, minHeight: 64, padding: "8px 4px",
          transition: "border-color .12s, background .12s",
        }}>
          {m}<span style={{ display: "block", fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: C.muted, letterSpacing: 1 }}>MIN</span>
        </button>)}
      </div>
    </Card>

    <Btn variant="ghost" onClick={onBrowseLibrary} style={{ color: C.dim, justifyContent: "center", fontSize: 13 }}>
      <BookOpen size={15} /> Browse drill library
    </Btn>
  </div>;
}

// ─── Drill runner ──────────────────────────────────────────────────────────────
type DecisionTier = "optimal" | "acceptable" | "highrisk" | "poor";

function ErrorGrid({ onPick }: { onPick: (code: string) => void }) {
  const labels: Record<string, string> = {
    MISS: "Missed pot", POSITION: "Lost position", SPEED: "Poor speed",
    SPIN: "Spin/control", PATTERN: "Pattern play", DECISION: "Decision",
    SAFETY: "Safety", OTHER: "Other",
  };
  return <div>
    <SectionLabel>What went wrong?</SectionLabel>
    <div style={{ display: "grid", gap: SP.sm, gridTemplateColumns: "1fr 1fr" }}>
      {ERROR_CODES.map((code) => <button key={code} onClick={() => onPick(code)} style={{
        background: C.panel2, border: `1px solid ${C.line}`, borderRadius: R.md,
        color: C.ink, cursor: "pointer", fontSize: 13, fontFamily: "'Inter', sans-serif",
        padding: "12px 10px", textAlign: "center", fontWeight: 500,
      }}>{labels[code] ?? code}</button>)}
    </div>
  </div>;
}

const TIER_LABELS: Record<string, { label: string; color: string }> = {
  optimal:    { label: "Strong Choice",   color: C.green },
  acceptable: { label: "Reasonable",      color: C.chalk },
  highrisk:   { label: "High Risk",       color: COLORS.gold },
  poor:       { label: "Poor Choice",     color: C.rust },
};

function DrillRunner({ drill, profile, source, activeRuleset, onComplete }: {
  drill: Drill; profile: Profile; source: "assessment" | "training"; activeRuleset: RuleSetId;
  onComplete: (profile: Profile, entry: Attempt & { skillId: SkillId }) => void;
}) {
  const [errorOpen, setErrorOpen] = useState(false);
  const [feedback, setFeedback]   = useState<{ option: DecisionOption; updated: Profile; value: number } | null>(null);
  // Reset transient state whenever the active drill changes (belt-and-suspenders: key prop is the primary guard)
  useEffect(() => { setErrorOpen(false); setFeedback(null); }, [drill.id]);
  const activeOptions = drill.rulesetOptions?.[activeRuleset] ?? drill.options ?? [];
  const rulesetForBadge = drill.rulesContext ?? (drill.rulesetOptions ? activeRuleset : null);

  const finish = (value: number, reportedError?: string) => {
    const rulesetTag = drill.rulesContext ?? null;
    onComplete(
      applySkillUpdate(profile, drill.skillId, value, { drillId: drill.id, difficulty: drill.difficulty, source, reportedError, ruleset: rulesetTag }),
      { skillId: drill.skillId, value, drillId: drill.id, difficulty: drill.difficulty, ts: Date.now(), reportedError, ruleset: rulesetTag }
    );
  };

  if (drill.type === "execution") {
    const execBalls = drill.diagram ? diagramToBalls(drill.diagram) : [
      { x: 0.35, y: 0.50, color: BALL.cue, highlight: true },
      { x: 0.62, y: 0.44, color: BALL.red, highlight: true },
    ];
    return <div>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: SP.lg, padding: "0 8px" }}>
        <PoolTable width={260} balls={execBalls} targetZone={drill.diagram?.targetZone} tableMarkings={drill.diagram?.tableMarkings} targetPocket={drill.diagram?.targetPocket} aimLines={drill.diagram?.aimLines ?? []} />
      </div>
      <Card>
        {rulesetForBadge && <div style={{ marginBottom: SP.sm }}><RulesBadge ruleset={rulesetForBadge} /></div>}
        <div style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: 1, marginBottom: SP.xs }}>
          DIFFICULTY {drill.difficulty}/10 · {SKILL_MAP[drill.skillId].name.toUpperCase()}
        </div>
        <div style={{ fontSize: 19, fontWeight: 700, marginBottom: SP.sm }}>{drill.name}</div>
        {drill.setup ? <>
          <div style={{ marginBottom: SP.sm }}>
            <div style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: 1, marginBottom: 3 }}>SETUP</div>
            <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.55 }}>{drill.setup}</div>
          </div>
          {drill.objective && <div style={{ marginBottom: SP.sm }}>
            <div style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: 1, marginBottom: 3 }}>OBJECTIVE</div>
            <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.55 }}>{drill.objective}</div>
          </div>}
          {drill.successCriteria && drill.successCriteria.length > 0 && <div style={{ marginBottom: SP.md }}>
            <div style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: 1, marginBottom: 3 }}>SUCCESS</div>
            <ul style={{ color: C.dim, fontSize: 13, lineHeight: 1.6, margin: 0, paddingLeft: 16 }}>
              {drill.successCriteria.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </div>}
        </> : <div style={{ color: C.dim, fontSize: 14, lineHeight: 1.6, marginBottom: SP.md }}>{drill.desc}</div>}
        <WhyThisDrill reason={drill.reason} />
        {!errorOpen
          ? <div style={{ display: "grid", gap: SP.sm, gridTemplateColumns: "1fr 1fr" }}>
              <Btn variant="success" onClick={() => finish(1)} style={{ minHeight: 56 }}><Check size={20} /> Success</Btn>
              <Btn variant="danger"  onClick={() => setErrorOpen(true)} style={{ minHeight: 56 }}><X size={20} /> Failed</Btn>
            </div>
          : <ErrorGrid onPick={(code) => finish(0, code)} />}
      </Card>
    </div>;
  }

  if (!feedback) {
    const decBalls  = drill.diagram ? diagramToBalls(drill.diagram) : null;
    const hasLabels = drill.diagram?.balls.some(b => b.trainingLabel);
    return <div>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: hasLabels ? SP.xs : SP.lg, padding: "0 8px" }}>
        {decBalls ? <PoolTable width={260} balls={decBalls} /> : <DecisionDrillDiagram />}
      </div>
      {hasLabels && (
        <div style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: 0.5, marginBottom: SP.md, textAlign: "center" }}>
          Numbers identify the balls — they do not show the correct order.
        </div>
      )}
      <Card>
        {rulesetForBadge && <div style={{ marginBottom: SP.sm }}><RulesBadge ruleset={rulesetForBadge} /></div>}
        <div style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: 1, marginBottom: SP.xs }}>
          DECISION · {SKILL_MAP[drill.skillId].name.toUpperCase()}
        </div>
        <div style={{ fontSize: 19, fontWeight: 700, marginBottom: SP.sm }}>{drill.name}</div>
        <div style={{ color: C.dim, fontSize: 14, lineHeight: 1.6, marginBottom: SP.md }}>{drill.desc}</div>
        <WhyThisDrill reason={drill.reason} />
        <SectionLabel>What would you do?</SectionLabel>
        <div style={{ display: "grid", gap: SP.sm }}>
          {activeOptions.map((option) => <button key={option.key} onClick={() => {
            const value = decisionValue(option.tier as DecisionTier);
            const rulesetTag = drill.rulesContext ?? (drill.rulesetOptions ? activeRuleset : null);
            setFeedback({ option, updated: applySkillUpdate(profile, drill.skillId, value, { drillId: drill.id, difficulty: drill.difficulty, source, tier: option.tier, ruleset: rulesetTag }), value });
          }} style={{
            background: C.panel2, border: `1px solid ${C.line}`, borderRadius: R.md,
            color: C.ink, cursor: "pointer", fontFamily: "'Inter', sans-serif",
            fontSize: 14, padding: "14px 16px", textAlign: "left", fontWeight: 500,
          }}>{option.label}</button>)}
        </div>
      </Card>
    </div>;
  }

  const tier    = TIER_LABELS[feedback.option.tier] ?? TIER_LABELS["acceptable"];
  const seq     = feedback.option.sequence;
  const fbBalls = drill.diagram ? diagramToBalls(drill.diagram) : null;
  const routeSegs: Array<{ fromBallId: string; toBallId: string; type: "cueBallRoute" | "objectBallRoute" }> = seq
    ? seq.filter(s => s.positionFor && s.positionFor !== "pocket")
         .map(s => ({ fromBallId: s.ballId, toBallId: s.positionFor!, type: "cueBallRoute" as const }))
    : [];

  return <div>
    {fbBalls && (
      <div style={{ alignItems: "center", display: "flex", flexDirection: "column", marginBottom: SP.md }}>
        <PoolTable width={260} balls={fbBalls} routeSegments={routeSegs} />
        {seq && seq.length > 0 && (
          <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center", marginTop: SP.sm }}>
            {seq.map((step, i) => {
              const bd = drill.diagram!.balls.find(b => b.id === step.ballId);
              const nm = bd?.group === "black" ? "BLACK"
                       : bd?.trainingLabel     ? `Ball ${bd.trainingLabel}`
                       : step.ballId;
              return <span key={i} style={{ alignItems: "center", display: "flex", gap: 3 }}>
                <span style={{ background: COLORS.surfaceTeal, border: `1px solid ${COLORS.primary}55`, borderRadius: R.sm, color: COLORS.primary, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, padding: "2px 6px" }}>{nm}</span>
                {i < seq.length - 1 && <span style={{ color: C.muted, fontSize: 10 }}>›</span>}
              </span>;
            })}
          </div>
        )}
      </div>
    )}
    <Card>
      <div style={{ borderBottom: `1px solid ${C.line}`, marginBottom: SP.lg, paddingBottom: SP.md }}>
        <div style={{ color: tier.color, fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: 1, marginBottom: SP.sm }}>{tier.label}</div>
        <p style={{ color: C.dim, lineHeight: 1.65, margin: 0, fontSize: 14 }}>{feedback.option.rationale}</p>
      </div>
      <Btn variant="primary" onClick={() => onComplete(feedback.updated, {
        skillId: drill.skillId, value: feedback.value, drillId: drill.id,
        difficulty: drill.difficulty, tier: feedback.option.tier, ts: Date.now(),
        ruleset: drill.rulesContext ?? (drill.rulesetOptions ? activeRuleset : null),
      })}>Continue <ChevronRight size={17} /></Btn>
    </Card>
  </div>;
}

// ─── Clearance runner ──────────────────────────────────────────────────────────
const smallBtn: CSSProperties = { background: "transparent", border: `1px solid ${C.line}`, borderRadius: R.sm, color: C.brass, cursor: "pointer", fontSize: 14, padding: "4px 10px" };
type ClearanceEntry = Attempt & { skillId?: SkillId; observedSkill?: SkillId; type?: string; chainNarrative?: string };

function ClearanceRunner({ clearance, profile, source, activeRuleset, onComplete }: {
  clearance: Clearance; profile: Profile; source: "assessment" | "training";
  activeRuleset: RuleSetId;
  onComplete: (profile: Profile, entries: ClearanceEntry[]) => void;
}) {
  const initialRemaining = useMemo(() => clearance.balls.filter((b) => b.role === "target" || b.role === "black").map((b) => b.id), [clearance]);
  const [remaining,  setRemaining]  = useState<string[]>(initialRemaining);
  const [attempted,  setAttempted]  = useState<string[]>([]);
  const [potted,     setPotted]     = useState<string[]>([]);
  const profileRef  = useRef(profile);
  const entriesRef  = useRef<ClearanceEntry[]>([]);
  const endedRef    = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const [phase, setPhase]               = useState<"brief" | "choose" | "plan" | "play">("brief");
  const [planned, setPlanned]           = useState<string[]>(initialRemaining);
  const [current, setCurrent]           = useState<string | null>(null);
  const [errorOpen, setErrorOpen]       = useState(false);
  const [adaptationOpen, setAdaptation] = useState(false);
  const ballMap = useMemo(() => Object.fromEntries(clearance.balls.map((b) => [b.id, b])), [clearance]);

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

  useEffect(() => {
    if (phase === "play" && remaining.length === 0 && !adaptationOpen) complete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining.length, phase, adaptationOpen]);

  const legalTargets = useMemo(() => {
    const targetBalls = remaining.filter((id) => ballMap[id]?.role === "target");
    const blackBalls  = remaining.filter((id) => ballMap[id]?.role === "black");
    const tableState = {
      ruleset: activeRuleset, groupAssignment: "assigned" as const,
      playerGroup: "yellow" as const, opponentGroup: "red" as const,
      balls: clearance.balls.map((b) => ({ ...b })), cueBallInHand: false,
      freeShotActive: false, playerBallsRemaining: targetBalls.length, opponentBallsRemaining: 0,
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
    profileRef.current = applySkillUpdate(profileRef.current, ball.execSkill, value, { drillId: clearance.id, difficulty: clearance.difficulty, source, clearance: true, ballId: ball.id, reportedError, ruleset: activeRuleset }, now);
    entriesRef.current.push({ ts: now, value, difficulty: clearance.difficulty, drillId: clearance.id, source, clearance: true, ballId: ball.id, reportedError, skillId: ball.execSkill, observedSkill: ball.execSkill, ruleset: activeRuleset });
    setAttempted((prev) => [...prev, ball.id]);
    setCurrent(null);
    setErrorOpen(false);
    if (value === 1) {
      setPotted((prev) => [...prev, ball.id]);
      setRemaining((prev) => prev.filter((id) => id !== ball.id));
    } else {
      if (clearance.failureMode === "end_clearance") { complete(); return; }
      if (clearance.adaptationEligible && reportedError === "POSITION") setAdaptation(true);
    }
  };

  // Build ball specs for pool table SVG — use authored diagram when available (includes cue ball + training labels)
  const clearanceBalls: BallSpec[] = useMemo(() => {
    if (clearance.diagram) {
      return diagramToBalls(clearance.diagram, 280).map(b => {
        const isPotted = b.label ? potted.includes(b.label) : false;
        return { ...b, opacity: isPotted ? 0.28 : b.opacity, highlight: !isPotted && (b.opacity ?? 1) > 0.54 };
      });
    }
    const count = clearance.balls.length;
    return clearance.balls.map((b, i) => {
      const col = b.group === "black" ? BALL.black : b.group === "red" ? BALL.red : BALL.yellow;
      const opacity = potted.includes(b.id) ? 0.28 : b.role === "obstacle" ? 0.55 : 1;
      const xFrac = 0.15 + (i / Math.max(count - 1, 1)) * 0.7;
      return { x: xFrac, y: 0.5, color: col, highlight: !potted.includes(b.id) && b.role !== "obstacle", label: b.id, opacity };
    });
  }, [clearance, potted]);

  if (phase === "brief") return <Card>
    {clearance.playerGroup && <div style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: 1, marginBottom: SP.sm }}>YOU ARE: {clearance.playerGroup.toUpperCase()}S</div>}
    <div style={{ fontSize: 18, fontWeight: 700, marginBottom: clearance.objective ? SP.sm : SP.md }}>{clearance.name}</div>
    {clearance.objective && <div style={{ marginBottom: SP.md }}>
      <div style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: 1, marginBottom: 3 }}>OBJECTIVE</div>
      <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.55 }}>{clearance.objective}</div>
    </div>}
    <div style={{ marginBottom: SP.md }}>
      <div style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: 1, marginBottom: 3 }}>HOW TO LOG IT</div>
      <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.65 }}>Tap the ball you intend to play, attempt the shot, then record Success or Failed. Adapt your route if position changes.</div>
    </div>
    {clearance.successCriteria && clearance.successCriteria.length > 0 && <div style={{ marginBottom: SP.lg }}>
      <div style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: 1, marginBottom: 3 }}>SUCCESS</div>
      <ul style={{ color: C.dim, fontSize: 13, lineHeight: 1.6, margin: 0, paddingLeft: 16 }}>
        {clearance.successCriteria.map((c, i) => <li key={i}>{c}</li>)}
      </ul>
    </div>}
    <Btn variant="primary" onClick={() => setPhase(clearance.planEligible ? "choose" : "play")}>Start Exercise <ChevronRight size={17} /></Btn>
  </Card>;

  if (phase === "choose") return <Card>
    <div style={{ fontSize: 18, fontWeight: 700, marginBottom: SP.sm }}>{clearance.name}</div>
    <p style={{ color: C.dim, fontSize: 13, lineHeight: 1.55, margin: `0 0 ${SP.lg}px` }}>Would you like to plan your clearance order first, or just play?</p>
    <div style={{ display: "grid", gap: SP.sm }}>
      <Btn variant="primary" onClick={() => setPhase("plan")}>Plan the clearance</Btn>
      <Btn onClick={() => setPhase("play")}>Just play</Btn>
    </div>
  </Card>;

  if (phase === "plan") return <Card>
    <div style={{ fontSize: 18, fontWeight: 700, marginBottom: SP.xs }}>Plan your order</div>
    <p style={{ color: C.dim, fontSize: 13, marginBottom: SP.md, lineHeight: 1.55 }}>Reorder to match your intended route. Your plan is scored against the authored route quality.</p>
    <div style={{ display: "grid", gap: SP.sm, marginBottom: SP.lg }}>
      {planned.map((id, idx) => (
        <div key={id} style={{ alignItems: "center", background: C.panel2, border: `1px solid ${C.line}`, borderRadius: R.md, display: "flex", justifyContent: "space-between", padding: "11px 14px" }}>
          <span style={{ color: C.ink, fontSize: 14 }}><span style={{ color: C.brass, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, marginRight: 8 }}>{idx + 1}.</span>{ballMap[id]?.label ?? id}</span>
          <span style={{ display: "flex", gap: SP.xs }}>
            <button onClick={() => { if (!idx) return; const c = [...planned]; [c[idx-1],c[idx]]=[c[idx],c[idx-1]]; setPlanned(c); }} style={smallBtn}>↑</button>
            <button onClick={() => { if (idx === planned.length-1) return; const c = [...planned]; [c[idx+1],c[idx]]=[c[idx],c[idx+1]]; setPlanned(c); }} style={smallBtn}>↓</button>
          </span>
        </div>
      ))}
    </div>
    <div style={{ display: "grid", gap: SP.sm, gridTemplateColumns: "1fr 1fr" }}>
      <Btn variant="primary" onClick={() => {
        const planResult = evaluatePlannedRoute(planned, clearance);
        const now = Date.now();
        profileRef.current = applySkillUpdate(profileRef.current, "pattern", planResult.value, { drillId: clearance.id, source: "planDecision", difficulty: clearance.difficulty, tier: planResult.tier, ruleset: activeRuleset }, now);
        entriesRef.current.push({ ts: now, value: planResult.value, difficulty: clearance.difficulty, drillId: clearance.id, source: "planDecision", tier: planResult.tier, skillId: "pattern", ruleset: activeRuleset });
        setPhase("play");
      }}>Confirm Plan</Btn>
      <Btn onClick={() => setPhase("play")}>Just Play</Btn>
    </div>
  </Card>;

  if (adaptationOpen) return <Card>
    <div style={{ borderBottom: `1px solid ${C.line}`, marginBottom: SP.lg, paddingBottom: SP.md }}>
      <div style={{ color: COLORS.gold, fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 1, marginBottom: SP.xs }}>POSITION LOST</div>
      <div style={{ color: C.dim, fontSize: 14 }}>What's your plan from here?</div>
    </div>
    <div style={{ display: "grid", gap: SP.sm }}>
      {["Re-plan clearance", "Continue original route", "Develop a problem ball", "Play safe", "Other"].map((choice) => (
        <button key={choice} onClick={() => {
          const decSkill: SkillId = ADAPTATION_SKILL_MAP[choice] ?? "pattern";
          const tier: DecisionTier = choice === clearance.preferredAdaptation ? "optimal" : choice === "Other" ? "highrisk" : "acceptable";
          const value = decisionValue(tier);
          const now = Date.now();
          profileRef.current = applySkillUpdate(profileRef.current, decSkill, value, { drillId: clearance.id, source: "adaptation", difficulty: clearance.difficulty, tier, ruleset: activeRuleset }, now);
          entriesRef.current.push({ ts: now, value, difficulty: clearance.difficulty, drillId: clearance.id, source: "adaptation", type: "adaptation", skillId: decSkill, tier, ruleset: activeRuleset });
          setAdaptation(false);
        }} style={{
          background: C.panel2, border: `1px solid ${C.line}`, borderRadius: R.md,
          color: C.ink, cursor: "pointer", fontFamily: "'Inter', sans-serif",
          fontSize: 14, padding: "14px 16px", textAlign: "left", fontWeight: 500,
        }}>{choice}</button>
      ))}
    </div>
  </Card>;

  // Ball selection
  if (!selectedId) return <div>
    <div style={{ display: "flex", justifyContent: "center", marginBottom: SP.md }}>
      <PoolTable width={280} balls={clearanceBalls} />
    </div>
    <Card>
      <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: SP.lg }}>
        <div>
          <div style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: 1, marginBottom: 2 }}>{clearance.name}</div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Which ball?</div>
        </div>
        <div style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>{potted.length}/{initialRemaining.length}</div>
      </div>
      <div style={{ display: "grid", gap: SP.sm }}>
        {legalTargets.map((id) => {
          const tl = clearance.diagram?.balls.find(b => b.id === id)?.trainingLabel;
          return <Btn key={id} onClick={() => setCurrent(id)} style={{ justifyContent: "flex-start" }}>
            {tl ? `Ball ${tl}` : (ballMap[id]?.label ?? id)}
          </Btn>;
        })}
      </div>
      {attempted.length > potted.length && <div style={{ color: C.muted, fontSize: 12, marginTop: SP.md, fontFamily: "'IBM Plex Mono', monospace" }}>{attempted.length - potted.length} miss{attempted.length - potted.length !== 1 ? "es" : ""} recorded</div>}
    </Card>
  </div>;

  // Shot execution
  const ball = ballMap[selectedId];
  const shotBalls = clearanceBalls; // selection shown via selectedBall prop; ball colour is unchanged
  return <div>
    <div style={{ display: "flex", justifyContent: "center", marginBottom: SP.md }}>
      <PoolTable width={280} balls={shotBalls} selectedBall={selectedId} />
    </div>
    <Card>
      <div style={{ marginBottom: SP.lg }}>
        <div style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: 1, marginBottom: 2 }}>{clearance.name}</div>
        <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 4 }}>
          {(() => { const tl = clearance.diagram?.balls.find(b => b.id === selectedId)?.trainingLabel; return tl ? `Pot Ball ${tl}` : `Pot the ${ball?.label ?? selectedId}`; })()}
        </div>
        <div style={{ color: C.muted, fontSize: 12, fontFamily: "'IBM Plex Mono', monospace" }}>SKILL: {ball ? SKILL_MAP[ball.execSkill].name.toUpperCase() : "—"}</div>
      </div>
      {!errorOpen
        ? <div style={{ display: "grid", gap: SP.sm, gridTemplateColumns: "1fr 1fr" }}>
            <Btn variant="success" onClick={() => applyResult(1)} style={{ minHeight: 60 }}><Check size={20} /> Success</Btn>
            <Btn variant="danger"  onClick={() => setErrorOpen(true)} style={{ minHeight: 60 }}><X size={20} /> Failed</Btn>
          </div>
        : <ErrorGrid onPick={(code) => applyResult(0, code)} />}
    </Card>
  </div>;
}

// ─── Session runner ────────────────────────────────────────────────────────────
function SessionRunner({ profile, generated, onFinish }: {
  profile: Profile; generated: ReturnType<typeof generateSession>;
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
      setShowTransition(nextRuleset === "international" ? "International Rules" : "Blackball");
      setTimeout(() => { setShowTransition(null); setIndex((v) => v + 1); }, 2000);
    } else {
      setIndex((v) => v + 1);
    }
  };

  const pct = index / generated.drills.length * 100;

  // Ruleset transition card
  if (showTransition) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300 }}>
    <div style={{ textAlign: "center", padding: SP.xl }}>
      <div style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 1.5, marginBottom: SP.lg, textTransform: "uppercase" }}>Switching Ruleset</div>
      <div style={{ color: C.brass, fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, letterSpacing: 2, marginBottom: SP.sm }}>NEXT</div>
      <div style={{ color: C.ink, fontSize: 22, fontWeight: 700 }}>{showTransition}</div>
    </div>
  </div>;

  return <div>
    <div style={{ marginBottom: SP.lg }}>
      <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: SP.sm }}>
        <SectionLabel>Drill {index + 1} of {generated.drills.length}</SectionLabel>
        <span style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>{Math.round(pct)}%</span>
      </div>
      <ProgressBar color={C.chalk} value={pct} height={5} />
    </div>
    {current.type === "combined"
      ? <ClearanceRunner key={`${current.id}-${index}`} clearance={current} profile={profileRef.current} source="training" activeRuleset={activeRuleset} onComplete={complete} />
      : <DrillRunner     key={`${current.id}-${index}`} drill={current}     profile={profileRef.current} source="training" activeRuleset={activeRuleset} onComplete={complete} />}
  </div>;
}

// ─── Session summary ───────────────────────────────────────────────────────────
function Summary({ summary, onDone, onProgress }: {
  summary: SessionSummary; onDone: () => void; onProgress: () => void;
}) {
  return <div>
    <div style={{ color: C.brass, fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: 2, marginBottom: SP.xl }}>SESSION COMPLETE</div>

    {summary.todayWentWell.length > 0 && <Card style={{ marginBottom: SP.lg }}>
      <SectionLabel>What held up well</SectionLabel>
      <p style={{ color: C.ink, lineHeight: 1.65, margin: 0, fontSize: 14 }}>
        Your {summary.todayWentWell.join(" and ")} held up well today.
      </p>
    </Card>}

    {summary.todayLimited.length > 0 && <Card style={{ marginBottom: SP.lg }}>
      <SectionLabel>What limited you</SectionLabel>
      <p style={{ color: C.dim, lineHeight: 1.65, margin: 0, fontSize: 14 }}>
        Most of today's difficulty traced back to {summary.todayLimited.join(" and ")} — today's snapshot, not a permanent verdict.
      </p>
    </Card>}

    {summary.chainNarratives.length > 0 && <Card style={{ marginBottom: SP.lg }}>
      <SectionLabel>Key insight</SectionLabel>
      {summary.chainNarratives.map((note, i) => <p key={i} style={{ color: C.chalk, lineHeight: 1.6, margin: i ? "8px 0 0" : 0, fontSize: 14 }}>{note}</p>)}
    </Card>}

    {summary.adaptations.length > 0 && <Card style={{ marginBottom: SP.lg }}>
      <SectionLabel>Adaptation noted</SectionLabel>
      <p style={{ color: COLORS.gold, lineHeight: 1.6, margin: 0, fontSize: 14 }}>You made a decision after losing position. That choice is credited to the correct decision skill, separately from execution.</p>
    </Card>}

    <Card style={{ marginBottom: SP.xl }}>
      <SectionLabel>What changes next</SectionLabel>
      <p style={{ color: C.ink, lineHeight: 1.65, margin: 0, fontSize: 14 }}>{summary.changeNote}</p>
    </Card>

    <Btn variant="primary" onClick={onDone} style={{ marginBottom: SP.sm, minHeight: 54 }}>Return to Today</Btn>
    <Btn variant="ghost" onClick={onProgress} style={{ color: C.dim }}>View Progress</Btn>
  </div>;
}

// ─── Progress view ─────────────────────────────────────────────────────────────
function ProgressView({ profile }: { profile: Profile }) {
  const lf       = limitingFactor(profile);
  const weighting = sessionWeighting(profile, lf);
  const isMixed  = profile.preferredRulesMode === "mixed";
  const execSkills = SKILLS.filter(s => s.type === "execution");
  const decSkills  = SKILLS.filter(s => s.type === "decision");

  return <div>
    {/* Current focus card */}
    <Card style={{ marginBottom: SP.lg, border: `1px solid ${C.brassD}` }}>
      <SectionLabel>Current Focus</SectionLabel>
      {lf.primary
        ? <>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: SP.xs }}>{lf.primary.name}</div>
            {lf.status === "provisional" && <div style={{ color: C.brass, fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", marginBottom: SP.xs }}>EARLY SIGNAL</div>}
            {lf.secondary && <div style={{ color: C.dim, fontSize: 14, marginBottom: SP.sm }}>Also: {lf.secondary.name}</div>}
            <div style={{ color: C.muted, fontSize: 13 }}>Confirmed current limiter</div>
          </>
        : <div style={{ color: C.dim, fontSize: 14, lineHeight: 1.55 }}>Still gathering enough evidence for a clear focus. Keep training.</div>}
    </Card>

    {/* Radar chart */}
    <SkillRadar profile={profile} />

    {/* Session balance */}
    <Card style={{ marginBottom: SP.lg }}>
      <SectionLabel>Training balance</SectionLabel>
      <div style={{ display: "grid", gap: SP.md }}>
        <div>
          <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: SP.xs }}>
            <span style={{ color: C.dim, fontSize: 13 }}>Execution</span>
            <span style={{ color: C.ink, fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 600 }}>{Math.round(weighting.exec)}</span>
          </div>
          <ProgressBar color={C.chalk} value={weighting.exec} />
        </div>
        <div>
          <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: SP.xs }}>
            <span style={{ color: C.dim, fontSize: 13 }}>Decision</span>
            <span style={{ color: C.ink, fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 600 }}>{Math.round(weighting.dec)}</span>
          </div>
          <ProgressBar color={C.brass} value={weighting.dec} />
        </div>
      </div>
    </Card>

    {/* Shot-making skills */}
    <Card style={{ marginBottom: SP.lg }}>
      <SectionLabel>Shot-Making</SectionLabel>
      {execSkills.map((skill) => {
        const s = profile.skills[skill.id];
        const confidence = computeConfidence(s.attempts);
        const level = ratingLevel(s.rating);
        const trend  = trendFor(profile.ratingHistory, skill.id);
        return <div key={skill.id} style={{ borderBottom: `1px solid ${C.line}`, padding: "12px 0" }}>
          <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: SP.xs }}>
            <div style={{ alignItems: "center", display: "flex", gap: SP.sm }}>
              <span style={{ color: C.ink, fontSize: 14, fontWeight: 500 }}>{skill.name}</span>
              <TrendIcon trend={trend} />
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: C.brass, fontFamily: "'IBM Plex Mono', monospace", fontSize: 14, fontWeight: 600 }}>{Math.round(s.rating)}</div>
              <div style={{ color: C.muted, fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 0.5 }}>{level}</div>
            </div>
          </div>
          <ProgressBar value={s.rating} color={C.chalk} height={4} />
          <div style={{ color: C.muted, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", marginTop: SP.xs }}>{confidenceDisplay(confidence.tier, isStale(s))}</div>
        </div>;
      })}
    </Card>

    {/* Decision skills */}
    <Card>
      <SectionLabel>Table-Reading</SectionLabel>
      {decSkills.map((skill) => {
        const s = profile.skills[skill.id];
        const confidence = computeConfidence(s.attempts);
        const level = ratingLevel(s.rating);
        const trend  = trendFor(profile.ratingHistory, skill.id);
        const bbConf  = isMixed ? computeRulesetConfidence(profile, skill.id, "blackball") : null;
        const intConf = isMixed ? computeRulesetConfidence(profile, skill.id, "international") : null;
        return <div key={skill.id} style={{ borderBottom: `1px solid ${C.line}`, padding: "12px 0" }}>
          <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: SP.xs }}>
            <div style={{ alignItems: "center", display: "flex", gap: SP.sm }}>
              <span style={{ color: C.ink, fontSize: 14, fontWeight: 500 }}>{skill.name}</span>
              <TrendIcon trend={trend} />
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: C.brass, fontFamily: "'IBM Plex Mono', monospace", fontSize: 14, fontWeight: 600 }}>{Math.round(s.rating)}</div>
              <div style={{ color: C.muted, fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 0.5 }}>{level}</div>
            </div>
          </div>
          <ProgressBar value={s.rating} color={C.brass} height={4} />
          <div style={{ alignItems: "center", display: "flex", gap: SP.sm, marginTop: SP.xs }}>
            <div style={{ color: C.muted, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" }}>{confidenceDisplay(confidence.tier, isStale(s))}</div>
            {isMixed && bbConf && <div style={{ display: "flex", gap: SP.xs }}>
              <RulesBadge ruleset="blackball" style={{ fontSize: 8, padding: "1px 5px" }} />
              <span style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10 }}>{bbConf.tier}</span>
              <RulesBadge ruleset="international" style={{ fontSize: 8, padding: "1px 5px" }} />
              <span style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10 }}>{intConf?.tier ?? "Low"}</span>
            </div>}
          </div>
        </div>;
      })}
    </Card>
  </div>;
}

// ─── Library view ──────────────────────────────────────────────────────────────
function LibraryView({ profile }: { profile: Profile }) {
  const [filter, setFilter] = useState<"all" | "execution" | "decision">("all");
  const mode = profile.preferredRulesMode;
  const rulesets: RuleSetId[] = mode === "mixed" ? ["blackball", "international"] : [mode];

  const groups = SKILLS.map((skill) => {
    const drills = DRILLS.filter((d) =>
      d.skillId === skill.id &&
      rulesets.some((r) => d.rulesets.includes(r)) &&
      (filter === "all" || d.type === filter || (filter === "decision" && d.type !== "execution"))
    );
    return { skill, drills };
  }).filter((g) => g.drills.length);

  const clearances = CLEARANCES.filter((c) => rulesets.some((r) => c.rulesets.includes(r)));

  return <div>
    {/* Filter tabs */}
    <div style={{ background: C.line, border: `1px solid ${C.line}`, borderRadius: R.md, display: "flex", marginBottom: SP.lg, padding: 3 }}>
      {(["all", "execution", "decision"] as const).map((f) => <button key={f} onClick={() => setFilter(f)} style={{
        background: filter === f ? COLORS.surface : "transparent",
        border: filter === f ? `1px solid ${C.line}` : "1px solid transparent",
        borderRadius: R.sm, color: filter === f ? COLORS.primary : C.dim, cursor: "pointer",
        flex: 1, fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: filter === f ? 600 : 400,
        padding: "8px 4px", textTransform: "capitalize",
      }}>{f}</button>)}
    </div>

    {groups.map(({ skill, drills }) => <Card key={skill.id} style={{ marginBottom: SP.md }}>
      <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: SP.md }}>
        <SectionLabel>{skill.name}</SectionLabel>
        {skill.priority && <span style={{ background: `${COLORS.gold}22`, border: `1px solid ${COLORS.gold}`, borderRadius: R.sm, color: COLORS.gold, fontSize: 9, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 1, padding: "2px 7px" }}>PRIORITY</span>}
      </div>
      {drills.map((d, i) => <div key={d.id} style={{ borderBottom: i < drills.length - 1 ? `1px solid ${C.line}` : "none", padding: "10px 0" }}>
        <div style={{ alignItems: "center", display: "flex", gap: SP.sm, marginBottom: 3 }}>
          <span style={{ color: C.ink, fontSize: 14, fontWeight: 500 }}>{d.name}</span>
          {d.rulesContext && <RulesBadge ruleset={d.rulesContext} />}
        </div>
        <div style={{ alignItems: "center", color: C.muted, display: "flex", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, gap: SP.md, letterSpacing: 0.5 }}>
          <span>DIFF {d.difficulty}/10</span>
          <span style={{ textTransform: "uppercase" }}>{d.type}</span>
        </div>
      </div>)}
    </Card>)}

    {(filter === "all" || filter === "execution") && clearances.length > 0 && <Card>
      <SectionLabel>Clearances</SectionLabel>
      {clearances.map((c, i) => <div key={c.id} style={{ borderBottom: i < clearances.length - 1 ? `1px solid ${C.line}` : "none", padding: "10px 0" }}>
        <div style={{ color: C.ink, fontSize: 14, fontWeight: 500, marginBottom: 3 }}>{c.name}</div>
        <div style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: 0.5 }}>
          DIFF {c.difficulty} · {c.balls.filter(b => b.role === "target").length} targets · {c.balls.filter(b => b.role === "obstacle").length} obstacles
        </div>
      </div>)}
    </Card>}
  </div>;
}

// ─── Settings / More ───────────────────────────────────────────────────────────
function SettingsView({ profile, onMode, onReset, onLibrary }: {
  profile: Profile; onMode: (mode: RulesMode) => void; onReset: () => void; onLibrary: () => void;
}) {
  return <div>
    {/* Training mode */}
    <Card style={{ marginBottom: SP.lg }}>
      <SectionLabel>Preferred Training Mode</SectionLabel>
      <p style={{ color: C.dim, fontSize: 13, lineHeight: 1.55, margin: `0 0 ${SP.md}px` }}>Changing your preference keeps all your skill ratings and history. It only changes future session content.</p>
      {MODES_FOR_ONBOARDING.map((item) => <button key={item.mode} onClick={() => onMode(item.mode)} style={{
        alignItems: "center", background: profile.preferredRulesMode === item.mode ? C.panel3 : C.panel2,
        border: `1px solid ${profile.preferredRulesMode === item.mode ? C.brass : C.line}`,
        borderRadius: R.md, color: C.ink, cursor: "pointer", display: "flex",
        justifyContent: "space-between", marginBottom: SP.sm, padding: "13px 16px", textAlign: "left", width: "100%",
      }}>
        <span>
          <strong style={{ fontSize: 14 }}>{item.label}</strong>
          <span style={{ color: C.dim, display: "block", fontSize: 12, marginTop: 3, lineHeight: 1.45 }}>{item.description}</span>
        </span>
        {profile.preferredRulesMode === item.mode && <Check color={C.brass} size={18} />}
      </button>)}
    </Card>

    {/* Rules notes */}
    {profile.preferredRulesMode !== "mixed" && <Card style={{ marginBottom: SP.lg }}>
      <SectionLabel>Rules notes</SectionLabel>
      <p style={{ color: C.dim, fontSize: 13, lineHeight: 1.55, margin: 0 }}>{RULESETS[profile.ruleset].unsupportedNote}</p>
    </Card>}

    {/* Drill library link */}
    <Card style={{ marginBottom: SP.lg }} onClick={onLibrary}>
      <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
        <div>
          <div style={{ color: C.ink, fontWeight: 600, marginBottom: 3 }}>Drill Library</div>
          <div style={{ color: C.dim, fontSize: 13 }}>Browse all drills and clearances.</div>
        </div>
        <ChevronRight color={C.muted} size={18} />
      </div>
    </Card>

    {/* Reset */}
    <Card>
      <SectionLabel>Local profile</SectionLabel>
      <p style={{ color: C.dim, fontSize: 13, lineHeight: 1.55, margin: `0 0 ${SP.md}px` }}>Your profile and match history are stored on this device.</p>
      <Btn variant="danger" onClick={onReset} style={{ maxWidth: 220 }}><RotateCcw size={16} /> Reset profile</Btn>
    </Card>
  </div>;
}

// ─── Match views ───────────────────────────────────────────────────────────────
function MatchHistoryView({ matches, activeMatchId, onNew, onContinue, onDetail }: {
  matches: Match[]; activeMatchId: string | null;
  onNew: () => void; onContinue: () => void; onDetail: (id: string) => void;
}) {
  const activeMatch = matches.find(m => m.id === activeMatchId) ?? null;
  const completed   = matches.filter(m => m.completedAt != null).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

  return <div>
    {/* Active match banner */}
    {activeMatch && <Card style={{ marginBottom: SP.lg, border: `1px solid ${COLORS.gold}` }}>
      <SectionLabel>Active Match</SectionLabel>
      <div style={{ alignItems: "baseline", display: "flex", gap: SP.sm, marginBottom: SP.md }}>
        <div style={{ color: COLORS.gold, fontFamily: "'Bebas Neue', sans-serif", fontSize: 34, letterSpacing: 1, lineHeight: 1 }}>
          {frameScore(activeMatch).player} – {frameScore(activeMatch).opponent}
        </div>
        <RulesBadge ruleset={activeMatch.ruleset} />
        {activeMatch.opponent && <span style={{ color: C.dim, fontSize: 13 }}>vs {activeMatch.opponent}</span>}
      </div>
      <Btn variant="primary" onClick={onContinue}>Continue Match</Btn>
    </Card>}

    <Btn variant={activeMatch ? "outline" : "primary"} onClick={onNew} style={{ marginBottom: SP.lg, minHeight: 52 }}>
      + Log Match
    </Btn>

    {!completed.length && !activeMatch && <EmptyState
      icon="🎱"
      title="No matches yet"
      body="Log your first match and 8-Ball Coach will start learning what costs you frames."
    />}

    {completed.map(m => {
      const sc  = frameScore(m);
      const won = sc.player > sc.opponent;
      return <Card key={m.id} onClick={() => onDetail(m.id)} style={{ marginBottom: SP.md, cursor: "pointer" }}>
        <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: SP.sm }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, letterSpacing: 1, color: won ? C.green : C.rust, lineHeight: 1 }}>{sc.player} – {sc.opponent}</div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: SP.xs }}>
            <RulesBadge ruleset={m.ruleset} />
            <div style={{ display: "flex", gap: SP.xs }}>
              <span style={{ background: `${C.panel2}`, border: `1px solid ${C.line}`, borderRadius: R.sm, color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, padding: "2px 7px", textTransform: "uppercase" }}>{m.competitionType}</span>
              <span style={{ color: won ? C.green : C.rust, fontSize: 11, fontWeight: 700, alignSelf: "center" }}>{won ? "WON" : "LOST"}</span>
            </div>
          </div>
        </div>
        <div style={{ color: C.muted, fontSize: 12, marginBottom: SP.xs, fontFamily: "'IBM Plex Mono', monospace" }}>
          {new Date(m.completedAt!).toLocaleDateString()}{m.opponent ? ` · vs ${m.opponent}` : ""}
        </div>
        <div style={{ color: C.dim, fontSize: 13, fontStyle: "italic" }}>"{matchCoachingLine(m)}"</div>
      </Card>;
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
  const inpStyle: CSSProperties = {
    background: C.panel2, border: `1px solid ${C.line}`, borderRadius: R.md,
    color: C.ink, fontFamily: "'Inter', sans-serif", fontSize: 14,
    outline: "none", padding: "12px 14px", width: "100%",
  };
  const selCard = (active: boolean): CSSProperties => ({
    alignItems: "center", background: active ? C.panel3 : C.panel2,
    border: `1px solid ${active ? C.brass : C.line}`, borderRadius: R.md,
    color: C.ink, cursor: "pointer", display: "flex", justifyContent: "space-between",
    padding: "14px 16px", textAlign: "left" as const,
  });

  return <div>
    <div style={{ color: C.brass, fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, letterSpacing: 1.5, marginBottom: SP.xl }}>START MATCH</div>

    <Card style={{ marginBottom: SP.md }}>
      <SectionLabel>Ruleset</SectionLabel>
      <div style={{ display: "grid", gap: SP.sm, gridTemplateColumns: "1fr 1fr" }}>
        {(["blackball", "international"] as RuleSetId[]).map(r => <button key={r} onClick={() => setRuleset(r)} style={selCard(ruleset === r)}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{r === "blackball" ? "Blackball" : "International"}</div>
            <RulesBadge ruleset={r} />
          </div>
          {ruleset === r && <Check color={C.brass} size={17} />}
        </button>)}
      </div>
    </Card>

    <Card style={{ marginBottom: SP.md }}>
      <SectionLabel>Context</SectionLabel>
      <div style={{ display: "grid", gap: SP.sm, gridTemplateColumns: "1fr 1fr" }}>
        {(["competition", "practice"] as MatchEnvironment[]).map(ct => <button key={ct} onClick={() => setCompetitionType(ct)} style={selCard(competitionType === ct)}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{ct === "competition" ? "Competition" : "Practice"}</span>
          {competitionType === ct && <Check color={C.brass} size={17} />}
        </button>)}
      </div>
    </Card>

    <Card style={{ marginBottom: SP.xl }}>
      <SectionLabel>Optional details</SectionLabel>
      <div style={{ display: "grid", gap: SP.sm }}>
        <input value={opponent}  onChange={e => setOpponent(e.target.value)}  placeholder="Opponent name" style={inpStyle} />
        <input value={format}    onChange={e => setFormat(e.target.value)}    placeholder="Format (e.g. best of 7)" style={inpStyle} />
        <input value={eventName} onChange={e => setEventName(e.target.value)} placeholder="Event or venue" style={inpStyle} />
      </div>
    </Card>

    <Btn variant="primary" onClick={() => onStart({ ruleset, competitionType, opponent: opponent || undefined, format: format || undefined, eventName: eventName || undefined })} style={{ marginBottom: SP.sm, minHeight: 56 }}>
      Start Match
    </Btn>
    <Btn variant="ghost" onClick={onCancel} style={{ color: C.dim }}>Cancel</Btn>
  </div>;
}

function MatchActiveView({ match, onLog, onEditLast, onEnd }: {
  match: Match; onLog: () => void; onEditLast: () => void; onEnd: () => void;
}) {
  const sc = frameScore(match);
  const frames = [...match.frames].reverse();

  return <div>
    {/* Score hero */}
    <div style={{ padding: `${SP.xl}px 0 ${SP.lg}px`, textAlign: "center" }}>
      <div style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: 1.5, marginBottom: SP.md, textTransform: "uppercase" }}>Match in progress</div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: SP.xl }}>
        <div>
          <div style={{ color: C.muted, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 1, marginBottom: SP.xs }}>YOU</div>
          <div style={{ color: C.brass, fontFamily: "'Bebas Neue', sans-serif", fontSize: 72, letterSpacing: 2, lineHeight: 1 }}>{sc.player}</div>
        </div>
        <div style={{ color: C.line, fontFamily: "'Bebas Neue', sans-serif", fontSize: 48, paddingBottom: 8 }}>–</div>
        <div>
          <div style={{ color: C.muted, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 1, marginBottom: SP.xs }}>OPP</div>
          <div style={{ color: C.ink, fontFamily: "'Bebas Neue', sans-serif", fontSize: 72, letterSpacing: 2, lineHeight: 1 }}>{sc.opponent}</div>
        </div>
      </div>
      <div style={{ color: C.muted, fontSize: 12, marginTop: SP.md, display: "flex", alignItems: "center", justifyContent: "center", gap: SP.sm }}>
        <RulesBadge ruleset={match.ruleset} />
        <span style={{ color: C.line }}>·</span>
        <span style={{ textTransform: "capitalize" }}>{match.competitionType}</span>
        {match.opponent && <><span style={{ color: C.line }}>·</span><span>vs {match.opponent}</span></>}
      </div>
    </div>

    {/* Primary actions */}
    <div style={{ display: "grid", gap: SP.sm, gridTemplateColumns: "1fr 1fr", marginBottom: SP.lg }}>
      <Btn variant="success" onClick={onLog} style={{ minHeight: 64, fontSize: 17, flexDirection: "column", gap: 4 }}>
        <Check size={22} /><span>Won Frame</span>
      </Btn>
      <Btn variant="danger" onClick={onLog} style={{ minHeight: 64, fontSize: 17, flexDirection: "column", gap: 4 }}>
        <X size={22} /><span>Lost Frame</span>
      </Btn>
    </div>

    {/* Secondary actions */}
    <div style={{ display: "grid", gap: SP.sm, gridTemplateColumns: "1fr 1fr", marginBottom: SP.lg }}>
      {match.frames.length > 0 && <Btn onClick={onEditLast} style={{ fontSize: 13, color: C.dim }}>Edit Last Frame</Btn>}
      <Btn variant="ghost" onClick={() => {}} style={{ fontSize: 13, color: C.muted, border: `1px solid ${C.line}`, borderRadius: R.md }}>View Frames</Btn>
    </div>

    {/* Frame log */}
    {frames.length > 0 && <Card style={{ marginBottom: SP.lg }}>
      <SectionLabel>Frames played</SectionLabel>
      {frames.map(f => {
        const ev = f.keyEvents[0];
        const catLabel = ev && (FRAME_LOSS_CATEGORIES.find(c => c.key === ev.category)?.label ?? POSITIVE_EVENT_TYPES.find(c => c.key === ev.category)?.label ?? ev.category);
        return <div key={f.id} style={{ alignItems: "center", borderBottom: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", padding: "9px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: SP.sm }}>
            <span style={{ background: f.result === "won" ? `${C.green}22` : `${C.rust}22`, border: `1px solid ${f.result === "won" ? C.green : C.rust}`, borderRadius: 4, color: f.result === "won" ? C.green : C.rust, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, padding: "2px 6px" }}>{f.result === "won" ? "W" : "L"}</span>
            <span style={{ color: C.dim, fontSize: 13 }}>Frame {f.frameNumber}{catLabel && ` · ${catLabel}`}</span>
          </div>
          {ev && <span style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, textTransform: "uppercase" }}>{impactLabel(ev.impact)}</span>}
        </div>;
      })}
    </Card>}

    <Btn variant="ghost" onClick={onEnd} style={{ color: C.rust, border: `1px solid ${C.rust}22`, borderRadius: R.md }}>End Match</Btn>
  </div>;
}

const IMPACT_CHOICES: { display: "Minor" | "Important" | "Frame-deciding"; sub: string }[] = [
  { display: "Minor",          sub: "Minor setback" },
  { display: "Important",      sub: "Cost you ground" },
  { display: "Frame-deciding", sub: "Decisive mistake" },
];

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
    <div style={{ color: C.ink, fontSize: 18, fontWeight: 700, marginBottom: SP.lg }}>Did you win the frame?</div>
    <div style={{ display: "grid", gap: SP.md, gridTemplateColumns: "1fr 1fr", marginBottom: SP.lg }}>
      <Btn variant="success" onClick={() => setResult("won")}  style={{ minHeight: 80, fontSize: 18, flexDirection: "column", gap: SP.sm }}><Check size={24} />WON</Btn>
      <Btn variant="danger"  onClick={() => setResult("lost")} style={{ minHeight: 80, fontSize: 18, flexDirection: "column", gap: SP.sm }}><X    size={24} />LOST</Btn>
    </div>
    <Btn variant="ghost" onClick={onCancel} style={{ color: C.muted }}>Cancel</Btn>
  </div>;

  if (result === "lost" && category === null) return <div>
    <div style={{ color: C.ink, fontSize: 16, fontWeight: 700, marginBottom: SP.sm }}>What decided it?</div>
    <div style={{ color: C.dim, fontSize: 13, marginBottom: SP.lg }}>Optional — tap to add context, or skip.</div>
    <div style={{ display: "grid", gap: SP.sm, gridTemplateColumns: "1fr 1fr", marginBottom: SP.lg }}>
      {FRAME_LOSS_CATEGORIES.map(cat => <button key={cat.key} onClick={() => { setCategory(cat.key); setImpact(cat.defaultImpact); }} style={{
        background: C.panel2, border: `1px solid ${C.line}`, borderRadius: R.md,
        color: C.ink, cursor: "pointer", fontSize: 13, fontFamily: "'Inter', sans-serif",
        fontWeight: 500, padding: "13px 10px", textAlign: "center",
      }}>{cat.label}</button>)}
    </div>
    <Btn onClick={() => onDone("lost")} style={{ marginBottom: SP.sm }}>Skip — log loss only</Btn>
    <Btn variant="ghost" onClick={() => setResult(null)} style={{ color: C.dim }}>Back</Btn>
  </div>;

  if (result === "won" && category === null) return <div>
    <div style={{ color: C.ink, fontSize: 16, fontWeight: 700, marginBottom: SP.sm }}>What went well?</div>
    <div style={{ color: C.dim, fontSize: 13, marginBottom: SP.lg }}>Optional — select a highlight or skip.</div>
    <div style={{ display: "grid", gap: SP.sm, marginBottom: SP.lg }}>
      {POSITIVE_EVENT_TYPES.map(ev => <button key={ev.key} onClick={() => { setCategory(ev.key); setImpact(ev.defaultImpact); }} style={{
        background: C.panel2, border: `1px solid ${C.line}`, borderRadius: R.md,
        color: C.ink, cursor: "pointer", fontSize: 14, fontFamily: "'Inter', sans-serif",
        fontWeight: 500, padding: "13px 16px", textAlign: "left",
      }}>{ev.label}</button>)}
    </div>
    <Btn onClick={() => onDone("won")} style={{ marginBottom: SP.sm }}>Skip — log win only</Btn>
    <Btn variant="ghost" onClick={() => setResult(null)} style={{ color: C.dim }}>Back</Btn>
  </div>;

  return <div>
    <div style={{ color: C.ink, fontSize: 16, fontWeight: 700, marginBottom: SP.xs }}>{result === "won" ? "Won" : "Lost"} · {catLabel}</div>
    <div style={{ color: C.dim, fontSize: 13, marginBottom: SP.lg }}>How costly was it?</div>
    <div style={{ display: "grid", gap: SP.sm, marginBottom: SP.lg }}>
      {IMPACT_CHOICES.map(({ display, sub }) => {
        const imp = displayToImpact(display);
        return <button key={display} onClick={() => setImpact(imp)} style={{
          alignItems: "center", background: impact === imp ? C.panel3 : C.panel2,
          border: `1px solid ${impact === imp ? C.brass : C.line}`, borderRadius: R.md,
          color: C.ink, cursor: "pointer", display: "flex", fontFamily: "'Inter', sans-serif",
          justifyContent: "space-between", padding: "14px 16px",
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{display}</div>
            <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{sub}</div>
          </div>
          {impact === imp && <Check color={C.brass} size={17} />}
        </button>;
      })}
    </div>
    <Btn variant="primary" onClick={() => { if (category && impact) onDone(result, { category, impact, type: result === "lost" ? "error" : "positive" }); }} disabled={!impact} style={{ marginBottom: SP.sm, minHeight: 54 }}>Done</Btn>
    <Btn variant="ghost" onClick={() => setCategory(null)} style={{ color: C.dim }}>Back</Btn>
  </div>;
}

function MatchCompleteView({ summary, onDone }: { summary: MatchSummary; onDone: () => void }) {
  const won = summary.playerFrames > summary.opponentFrames;
  return <div>
    <div style={{ marginBottom: SP.xl, textAlign: "center" }}>
      <div style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 1.5, marginBottom: SP.md }}>FINAL SCORE</div>
      <div style={{ color: won ? C.green : C.rust, fontFamily: "'Bebas Neue', sans-serif", fontSize: 64, letterSpacing: 3, lineHeight: 1 }}>
        {summary.playerFrames} – {summary.opponentFrames}
      </div>
      <div style={{ color: won ? C.green : C.rust, fontSize: 13, fontWeight: 700, marginTop: SP.sm }}>{won ? "MATCH WON" : "MATCH LOST"}</div>
    </div>

    <Card style={{ marginBottom: SP.lg }}>
      <SectionLabel>Match Takeaway</SectionLabel>
      <p style={{ color: C.ink, fontSize: 14, lineHeight: 1.7, margin: 0 }}>{summary.matchNarrative}</p>
    </Card>

    {summary.matchWeaknesses.length > 0 && <Card style={{ marginBottom: SP.lg }}>
      <SectionLabel>Key issues</SectionLabel>
      {summary.matchWeaknesses.map((w, i) => <div key={i} style={{ borderBottom: i < summary.matchWeaknesses.length - 1 ? `1px solid ${C.line}` : "none", alignItems: "center", display: "flex", justifyContent: "space-between", padding: "10px 0" }}>
        <div style={{ color: C.ink, fontSize: 14 }}>{w.label}</div>
        <div style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>{w.count}× · {w.avgImpact}</div>
      </div>)}
    </Card>}

    {summary.matchVsTrainingNote && <Card style={{ marginBottom: SP.lg, border: `1px solid ${C.chalk}44` }}>
      <SectionLabel>Training vs match</SectionLabel>
      <p style={{ color: C.chalk, fontSize: 13, lineHeight: 1.6, margin: 0 }}>{summary.matchVsTrainingNote}</p>
    </Card>}

    <Card style={{ marginBottom: SP.xl }}>
      <SectionLabel>What changes next</SectionLabel>
      <p style={{ color: C.ink, fontSize: 14, lineHeight: 1.7, margin: 0 }}>{summary.lfChange}</p>
    </Card>

    <Btn variant="primary" onClick={onDone} style={{ minHeight: 54 }}>Done</Btn>
  </div>;
}

function MatchDetailView({ match, onDelete, onBack }: { match: Match; onDelete: () => void; onBack: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const sc = frameScore(match);
  const won = sc.player > sc.opponent;

  return <div>
    <button onClick={onBack} style={{ background: "transparent", border: 0, color: C.brass, cursor: "pointer", fontSize: 14, fontFamily: "'Inter', sans-serif", marginBottom: SP.lg, padding: 0, display: "flex", alignItems: "center", gap: SP.xs }}>
      ← Back to matches
    </button>

    <Card style={{ marginBottom: SP.lg }}>
      <div style={{ alignItems: "flex-start", display: "flex", justifyContent: "space-between", marginBottom: SP.sm }}>
        <div style={{ color: won ? C.green : C.rust, fontFamily: "'Bebas Neue', sans-serif", fontSize: 44, letterSpacing: 1.5, lineHeight: 1 }}>{sc.player} – {sc.opponent}</div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: SP.xs }}>
          <RulesBadge ruleset={match.ruleset} />
          <span style={{ background: `${C.panel2}`, border: `1px solid ${C.line}`, borderRadius: R.sm, color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, padding: "2px 7px", textTransform: "uppercase" }}>{match.competitionType}</span>
          <span style={{ color: won ? C.green : C.rust, fontSize: 11, fontWeight: 700 }}>{won ? "WON" : "LOST"}</span>
        </div>
      </div>
      <div style={{ color: C.muted, fontSize: 12, fontFamily: "'IBM Plex Mono', monospace" }}>
        {match.completedAt ? new Date(match.completedAt).toLocaleDateString() : "In progress"}
        {match.opponent && ` · vs ${match.opponent}`}
        {match.format && ` · ${match.format}`}
        {match.eventName && ` · ${match.eventName}`}
      </div>
    </Card>

    {match.frames.length > 0 && <Card style={{ marginBottom: SP.lg }}>
      <SectionLabel>Frames</SectionLabel>
      {match.frames.map((f) => {
        const ev = f.keyEvents[0];
        const catLabel = ev && (FRAME_LOSS_CATEGORIES.find(c => c.key === ev.category)?.label ?? POSITIVE_EVENT_TYPES.find(c => c.key === ev.category)?.label ?? ev.category);
        return <div key={f.id} style={{ alignItems: "center", borderBottom: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", padding: "10px 0" }}>
          <div>
            <div style={{ alignItems: "center", display: "flex", gap: SP.sm }}>
              <span style={{ background: f.result === "won" ? `${C.green}22` : `${C.rust}22`, border: `1px solid ${f.result === "won" ? C.green : C.rust}`, borderRadius: 4, color: f.result === "won" ? C.green : C.rust, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, padding: "2px 6px" }}>Frame {f.frameNumber} {f.result === "won" ? "W" : "L"}</span>
            </div>
            {ev && <div style={{ color: C.dim, fontSize: 12, marginTop: 3 }}>{catLabel}</div>}
          </div>
          {ev && <div style={{ color: C.muted, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, textTransform: "uppercase", alignSelf: "center" }}>{impactLabel(ev.impact)}</div>}
        </div>;
      })}
    </Card>}

    {!confirmDelete
      ? <Btn variant="ghost" onClick={() => setConfirmDelete(true)} style={{ color: C.rust, border: `1px solid ${C.rust}33`, borderRadius: R.md }}>Delete match</Btn>
      : <Card style={{ border: `1px solid ${C.rust}66` }}>
          <div style={{ color: C.ink, fontSize: 14, marginBottom: SP.lg, lineHeight: 1.55 }}>Delete this match? Its coaching influence disappears immediately.</div>
          <div style={{ display: "grid", gap: SP.sm, gridTemplateColumns: "1fr 1fr" }}>
            <Btn variant="danger" onClick={onDelete}>Delete</Btn>
            <Btn onClick={() => setConfirmDelete(false)}>Cancel</Btn>
          </div>
        </Card>}
  </div>;
}

// ─── Edit frame view ───────────────────────────────────────────────────────────
function EditFrameView({ frame, match, onSave, onCancel }: {
  frame: Frame; match: Match;
  onSave: (frameId: string, result: FrameResult, event?: { category: string; impact: FrameImpact; type: "error" | "positive" }) => void;
  onCancel: () => void;
}) {
  const existingEvent = frame.keyEvents[0] ?? null;
  const [result,   setResult]   = useState<FrameResult>(frame.result);
  const [category, setCategory] = useState<string | null>(existingEvent?.category ?? null);
  const [impact,   setImpact]   = useState<FrameImpact | null>(existingEvent?.impact ?? null);
  const catLabel = category ? (FRAME_LOSS_CATEGORIES.find(c => c.key === category)?.label ?? POSITIVE_EVENT_TYPES.find(c => c.key === category)?.label ?? category) : "";

  const resultPicker = <Card style={{ marginBottom: SP.md }}>
    <SectionLabel>Frame result</SectionLabel>
    <div style={{ display: "grid", gap: SP.sm, gridTemplateColumns: "1fr 1fr" }}>
      <Btn variant={result === "won" ? "success" : "default"} onClick={() => { setResult("won");  if (result !== "won")  { setCategory(existingEvent?.type === "positive" ? (existingEvent.category ?? null) : null); setImpact(null); } }} style={{ minHeight: 60 }}><Check size={18} /> Won</Btn>
      <Btn variant={result === "lost" ? "danger" : "default"} onClick={() => { setResult("lost"); if (result !== "lost") { setCategory(existingEvent?.type === "error"    ? (existingEvent.category ?? null) : null); setImpact(null); } }} style={{ minHeight: 60 }}><X    size={18} /> Lost</Btn>
    </div>
  </Card>;

  if (result === "lost" && category === null) return <div>
    {resultPicker}
    <Card style={{ marginBottom: SP.md }}>
      <SectionLabel>What cost you the frame?</SectionLabel>
      <div style={{ display: "grid", gap: SP.sm, gridTemplateColumns: "1fr 1fr" }}>
        {FRAME_LOSS_CATEGORIES.map(cat => <button key={cat.key} onClick={() => { setCategory(cat.key); setImpact(cat.defaultImpact); }} style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: R.md, color: C.ink, cursor: "pointer", fontSize: 13, fontFamily: "'Inter', sans-serif", fontWeight: 500, padding: "12px 10px", textAlign: "center" }}>{cat.label}</button>)}
      </div>
    </Card>
    <Btn onClick={() => onSave(frame.id, "lost")} style={{ marginBottom: SP.sm }}>Save — result only</Btn>
    <Btn variant="ghost" onClick={onCancel} style={{ color: C.dim }}>Cancel — keep original</Btn>
  </div>;

  if (result === "won" && category === null) return <div>
    {resultPicker}
    <Card style={{ marginBottom: SP.md }}>
      <SectionLabel>Any standout moments?</SectionLabel>
      <div style={{ display: "grid", gap: SP.sm }}>
        {POSITIVE_EVENT_TYPES.map(ev => <button key={ev.key} onClick={() => { setCategory(ev.key); setImpact(ev.defaultImpact); }} style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: R.md, color: C.ink, cursor: "pointer", fontSize: 14, fontFamily: "'Inter', sans-serif", fontWeight: 500, padding: "13px 16px", textAlign: "left" }}>{ev.label}</button>)}
      </div>
    </Card>
    <Btn onClick={() => onSave(frame.id, "won")} style={{ marginBottom: SP.sm }}>Save — result only</Btn>
    <Btn variant="ghost" onClick={onCancel} style={{ color: C.dim }}>Cancel — keep original</Btn>
  </div>;

  return <div>
    {resultPicker}
    {category !== null && <Card style={{ marginBottom: SP.md }}>
      <SectionLabel>Event — <span style={{ color: C.ink, textTransform: "none" }}>{catLabel}</span></SectionLabel>
      <button onClick={() => setCategory(null)} style={{ background: "transparent", border: 0, color: C.dim, cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: "2px 0", marginBottom: SP.md }}>← Change event</button>
      <SectionLabel>How costly was it?</SectionLabel>
      <div style={{ display: "grid", gap: SP.sm }}>
        {IMPACT_CHOICES.map(({ display, sub }) => {
          const imp = displayToImpact(display);
          return <button key={display} onClick={() => setImpact(imp)} style={{ alignItems: "center", background: impact === imp ? C.panel3 : C.panel2, border: `1px solid ${impact === imp ? C.brass : C.line}`, borderRadius: R.md, color: C.ink, cursor: "pointer", display: "flex", fontFamily: "'Inter', sans-serif", justifyContent: "space-between", padding: "12px 16px" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{display}</div>
              <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{sub}</div>
            </div>
            {impact === imp && <Check color={C.brass} size={17} />}
          </button>;
        })}
      </div>
    </Card>}
    <Btn variant="primary" onClick={() => onSave(frame.id, result, category && impact ? { category, impact, type: result === "lost" ? "error" : "positive" } : undefined)} style={{ marginBottom: SP.sm, minHeight: 54 }}>Save changes</Btn>
    <Btn variant="ghost" onClick={onCancel} style={{ color: C.dim }}>Cancel — keep original</Btn>
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
  const [editFrameId,   setEditFrameId]   = useState<string | null>(null);

  useEffect(() => { saveProfile(profile); }, [profile]);
  useEffect(() => { saveMatches(matches);  }, [matches]);

  const chooseMode   = (mode: RulesMode) => { setProfile(newProfile(mode)); setView("assessment"); };
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
    const m = matches.find(mx => mx.id === activeMatchId);
    if (!m || m.frames.length === 0) return;
    setEditFrameId(m.frames[m.frames.length - 1].id);
    setView("matchEditFrame");
  };

  const saveFrameEdit = (frameId: string, result: FrameResult, event?: { category: string; impact: FrameImpact; type: "error" | "positive" }) => {
    if (!activeMatchId) return;
    setMatches(prev => prev.map(m => {
      if (m.id !== activeMatchId) return m;
      const now = Date.now();
      const keyEvents: FrameEvent[] = event
        ? [buildFrameEvent({ type: event.type, category: event.category, impact: event.impact, ruleset: m.ruleset, environment: m.competitionType }, now)]
        : [];
      return editFrame(m, frameId, { result, keyEvents });
    }));
    setEditFrameId(null);
    setView("matchActive");
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
  if (view === "pickTime")    return <AppShell view={view} onNav={nav} profile={profile}><PickTime profile={profile} matches={matches} onPick={startSession} onBrowseLibrary={() => setView("library")} /></AppShell>;
  if (view === "session" && generated)   return <AppShell view={view} onNav={nav} profile={profile}><SessionRunner profile={profile} generated={generated} onFinish={finishSession} /></AppShell>;
  if (view === "summary" && summary)     return <AppShell view={view} onNav={nav} profile={profile}><Summary summary={summary} onDone={() => setView("dashboard")} onProgress={() => setView("progress")} /></AppShell>;

  // Match sub-views
  if (view === "matchSetup")  return <AppShell view={view} onNav={nav} profile={profile}><MatchSetupView  onStart={startNewMatch} onCancel={() => setView("matches")} /></AppShell>;
  if (view === "matchLogFrame" && activeMatchId) {
    const m = matches.find(mx => mx.id === activeMatchId);
    if (m) return <AppShell view={view} onNav={nav} profile={profile}><LogFrameView match={m} onDone={logFrame} onCancel={() => setView("matchActive")} /></AppShell>;
  }
  if (view === "matchEditFrame" && activeMatchId && editFrameId) {
    const m = matches.find(mx => mx.id === activeMatchId);
    const f = m?.frames.find(fr => fr.id === editFrameId);
    if (m && f) return <AppShell view={view} onNav={nav} profile={profile}><EditFrameView frame={f} match={m} onSave={saveFrameEdit} onCancel={() => { setEditFrameId(null); setView("matchActive"); }} /></AppShell>;
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
    {view === "settings"  && <SettingsView profile={profile} onMode={(mode) => setProfile(updateRulesMode(profile, mode))} onReset={() => { clearProfile(); setProfile(newProfile()); setView("onboarding"); }} onLibrary={() => setView("library")} />}
  </AppShell>;
}
