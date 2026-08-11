/**
 * Match data persistence — separate localStorage key from profile storage.
 * Matches are stored independently so profile integrity is never affected by match operations.
 */
import type { Match } from "../match";

const MATCHES_KEY = "8bc:matches";

export function loadMatches(): Match[] {
  try {
    const raw = localStorage.getItem(MATCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Match[]) : [];
  } catch {
    return [];
  }
}

export function saveMatches(matches: Match[]): void {
  try {
    localStorage.setItem(MATCHES_KEY, JSON.stringify(matches));
  } catch {
    // Storage may be unavailable in test environments — silently ignore
  }
}
