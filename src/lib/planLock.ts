const LOCK_KEY = "xigui-plan-day-lock";

export interface PlanDayLock {
  date: string;
  todayLessonNos: number[];
  forwardByDate: Record<string, number[]>;
  weekId: string;
}

export function readPlanDayLock(): PlanDayLock | null {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PlanDayLock;
  } catch {
    return null;
  }
}

export function writePlanDayLock(lock: PlanDayLock) {
  localStorage.setItem(LOCK_KEY, JSON.stringify(lock));
}

export function clearPlanDayLockIfStale(today: string) {
  const lock = readPlanDayLock();
  if (lock && lock.date !== today) {
    localStorage.removeItem(LOCK_KEY);
  }
}
