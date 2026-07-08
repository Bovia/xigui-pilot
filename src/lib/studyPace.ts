export const DAILY_STUDY_HOURS_KEY = "xigui.dailyStudyHours";
export const PACE_CHANGED_EVENT = "xigui-pace-changed";

export const PACE_HOURS_MIN = 1;
export const PACE_HOURS_MAX = 5;
export const PACE_HOURS_DEFAULT = 2.5;
export const PACE_HOURS_STEP = 0.5;

export const PACE_PRESETS = [
  { label: "标准", hours: 2.5 },
  { label: "加紧", hours: 3 },
] as const;

export function clampDailyStudyHours(hours: number) {
  const rounded = Math.round(hours / PACE_HOURS_STEP) * PACE_HOURS_STEP;
  return Math.min(PACE_HOURS_MAX, Math.max(PACE_HOURS_MIN, rounded));
}

export function readDailyStudyHours(): number {
  try {
    const raw = localStorage.getItem(DAILY_STUDY_HOURS_KEY);
    if (raw == null) return PACE_HOURS_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return PACE_HOURS_DEFAULT;
    return clampDailyStudyHours(n);
  } catch {
    return PACE_HOURS_DEFAULT;
  }
}

export function writeDailyStudyHours(hours: number) {
  const value = clampDailyStudyHours(hours);
  try {
    localStorage.setItem(DAILY_STUDY_HOURS_KEY, String(value));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(PACE_CHANGED_EVENT, { detail: value }));
}
