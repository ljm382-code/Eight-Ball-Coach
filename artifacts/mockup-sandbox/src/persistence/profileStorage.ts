import { migrateProfile, newProfile, type Profile, type RuleSetId } from "../engine";

const STORAGE_KEY = "eightball_coach_profile_v1";
const LEGACY_KEYS = ["blackball_profile_v2", "blackball_profile_v1"];

export function loadProfile(): Profile {
  if (typeof window === "undefined") return newProfile();
  const keys = [STORAGE_KEY, ...LEGACY_KEYS];
  for (const key of keys) {
    try {
      const value = window.localStorage.getItem(key);
      if (!value) continue;
      const profile = migrateProfile(JSON.parse(value));
      if (key !== STORAGE_KEY) saveProfile(profile);
      return profile;
    } catch {
      // Ignore malformed local data and continue with a clean profile.
    }
  }
  return newProfile();
}

export function saveProfile(profile: Profile): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export function clearProfile(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function updateRuleset(profile: Profile, ruleset: RuleSetId): Profile {
  return { ...profile, ruleset };
}