import type { PlanFile } from "./types";
import type { PlanLessonRow, ProgressVideos, WeekDayRow } from "./dynamicPlan";
import { factualLessonsOnDate, todayIso } from "./dynamicPlan";
import { clampDailyStudyHours, PACE_CHANGED_EVENT } from "./studyPace";
import { syncPaceTodayLock } from "./api";

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];
const PACE_TODAY_LOCK_KEY = "xigui-pace-today-lock";

export type CatalogLessonMeta = {
  lessonNo: number;
  title: string;
  missing: boolean;
  durationSec: number;
};

interface PaceTodayLock {
  date: string;
  dailyHours: number;
  lessonNos: number[];
}

export function activityDate(video: ProgressVideos[string] | undefined): string | undefined {
  if (!video) return undefined;
  if (video.last_activity_date) return video.last_activity_date;
  if (video.updated_at && video.updated_at.length >= 10) {
    return video.updated_at.slice(0, 10);
  }
  return undefined;
}

function parseLocalDate(iso: string) {
  return new Date(`${iso}T00:00:00`);
}

function formatIso(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isWeekend(d: Date) {
  const w = d.getDay();
  return w === 0 || w === 6;
}

function datesBetween(start: string, end: string) {
  const out: string[] = [];
  const cur = parseLocalDate(start);
  const last = parseLocalDate(end);
  while (cur <= last) {
    out.push(formatIso(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export function isLessonDone(lessonNo: number, progress: ProgressVideos) {
  return progress[String(lessonNo)]?.completed ?? false;
}

/** 某天是否展示：!completed || (completed && 活动日==当天) */
export function lessonShownOnDate(
  lessonNo: number,
  progress: ProgressVideos,
  date: string,
): boolean {
  const video = progress[String(lessonNo)];
  const done = video?.completed ?? false;
  if (!done) return true;
  return activityDate(video) === date;
}

export function filterVisibleOnDate(
  lessonNos: number[],
  progress: ProgressVideos,
  date: string,
) {
  return lessonNos.filter((no) => lessonShownOnDate(no, progress, date));
}

export function catalogLessonList(plan: PlanFile): CatalogLessonMeta[] {
  const lessons = plan.lessons ?? {};
  return Object.values(lessons)
    .map((lesson) => ({
      lessonNo: lesson.no,
      title: lesson.title,
      missing: lesson.missing ?? false,
      durationSec: lesson.durationSec ?? 0,
    }))
    .sort((a, b) => a.lessonNo - b.lessonNo);
}

export function incompleteCatalogQueue(plan: PlanFile, progress: ProgressVideos) {
  return catalogLessonList(plan).filter((l) => !isLessonDone(l.lessonNo, progress));
}

function readPaceTodayLock(): PaceTodayLock | null {
  try {
    const raw = localStorage.getItem(PACE_TODAY_LOCK_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PaceTodayLock;
  } catch {
    return null;
  }
}

function writePaceTodayLock(lock: PaceTodayLock) {
  localStorage.setItem(PACE_TODAY_LOCK_KEY, JSON.stringify(lock));
}

function persistPaceTodayLock(lock: PaceTodayLock) {
  writePaceTodayLock(lock);
  syncPaceTodayLock(lock.date, lock.dailyHours, lock.lessonNos).catch(() => undefined);
}

export function clearPaceTodayLock() {
  localStorage.removeItem(PACE_TODAY_LOCK_KEY);
}

function clearPaceTodayLockIfStale(today: string) {
  const lock = readPaceTodayLock();
  if (lock && lock.date !== today) {
    clearPaceTodayLock();
  }
}

function validateLock(
  lock: PaceTodayLock | null,
  progress: ProgressVideos,
  today: string,
  dailyHours: number,
): lock is PaceTodayLock {
  if (!lock || lock.date !== today || lock.dailyHours !== dailyHours) return false;
  return lock.lessonNos.every((no) => lessonShownOnDate(no, progress, today));
}

function rowsFromCatalog(
  lessons: CatalogLessonMeta[],
  progress: ProgressVideos,
  nos: number[],
): PlanLessonRow[] {
  const byNo = new Map(lessons.map((l) => [l.lessonNo, l]));
  return nos.map((lessonNo) => {
    const meta = byNo.get(lessonNo);
    const video = progress[String(lessonNo)];
    const done = isLessonDone(lessonNo, progress);
    return {
      lessonNo,
      title: meta?.title ?? `第 ${lessonNo} 节`,
      done,
      missing: meta?.missing ?? false,
      inProgress: !done && (video?.position ?? 0) > 30,
    };
  });
}

/** 按每日学习时长（小时）从队列头部装箱 */
export function packLessonsForDay(
  queue: CatalogLessonMeta[],
  dailyHours: number,
): { lessonNos: number[]; consumed: number } {
  const budgetSec = dailyHours * 3600;
  const lessonNos: number[] = [];
  let usedSec = 0;
  let consumed = 0;

  while (consumed < queue.length) {
    const lesson = queue[consumed]!;
    const nextSec = lesson.durationSec > 0 ? lesson.durationSec : 45 * 60;
    if (lessonNos.length > 0 && usedSec + nextSec > budgetSec * 1.05) {
      break;
    }
    lessonNos.push(lesson.lessonNo);
    usedSec += nextSec;
    consumed += 1;
    if (usedSec >= budgetSec * 0.92) break;
  }

  if (lessonNos.length === 0 && queue.length > 0) {
    lessonNos.push(queue[0]!.lessonNo);
    consumed = 1;
  }

  return { lessonNos, consumed };
}

export function weekRangeForDate(today: string) {
  const d = parseLocalDate(today);
  const day = d.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + mondayOffset);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { start: formatIso(mon), end: formatIso(sun) };
}

export function estimateQueueFinishDate(
  queue: CatalogLessonMeta[],
  today: string,
  dailyHours: number,
): string | null {
  if (queue.length === 0) return null;
  const hours = clampDailyStudyHours(dailyHours);
  const remaining = [...queue];
  let cur = parseLocalDate(today);
  const guard = 400;
  let steps = 0;

  while (remaining.length > 0 && steps < guard) {
    if (!isWeekend(cur)) {
      const { consumed } = packLessonsForDay(remaining, hours);
      remaining.splice(0, consumed);
      if (remaining.length === 0) {
        return formatIso(cur);
      }
    }
    cur.setDate(cur.getDate() + 1);
    steps += 1;
  }

  return formatIso(cur);
}

export function estimateFinishDate(
  plan: PlanFile,
  progress: ProgressVideos,
  today: string,
  dailyHours: number,
): string | null {
  const queue = incompleteCatalogQueue(plan, progress);
  return estimateQueueFinishDate(queue, today, dailyHours);
}

/** 写入今日契约（立即生效） */
export function applyTodayPacePlan(
  plan: PlanFile,
  progress: ProgressVideos,
  today: string,
  dailyHours: number,
): number[] {
  clearPaceTodayLockIfStale(today);
  const hours = clampDailyStudyHours(dailyHours);
  const queue = incompleteCatalogQueue(plan, progress);
  const { lessonNos } = packLessonsForDay(queue, hours);
  persistPaceTodayLock({ date: today, dailyHours: hours, lessonNos });
  window.dispatchEvent(new CustomEvent(PACE_CHANGED_EVENT, { detail: { applied: true } }));
  return lessonNos;
}

function ensureTodayContract(
  plan: PlanFile,
  progress: ProgressVideos,
  today: string,
  dailyHours: number,
  createIfMissing: boolean,
): number[] | null {
  clearPaceTodayLockIfStale(today);
  const hours = clampDailyStudyHours(dailyHours);
  const existing = readPaceTodayLock();
  if (validateLock(existing, progress, today, hours)) {
    return existing.lessonNos;
  }
  if (!createIfMissing) return null;
  const queue = incompleteCatalogQueue(plan, progress);
  if (queue.length === 0) return [];
  const { lessonNos } = packLessonsForDay(queue, hours);
  persistPaceTodayLock({ date: today, dailyHours: hours, lessonNos });
  return lessonNos;
}

/** 今日契约课节（含已完成但今天学的） */
export function getTodayPaceContract(
  plan: PlanFile,
  progress: ProgressVideos,
  today: string,
  dailyHours: number,
): number[] {
  return ensureTodayContract(plan, progress, today, dailyHours, true) ?? [];
}

/** 今日展示列表：契约 ∩ 展示规则 */
export function getTodayPaceDisplayNos(
  plan: PlanFile,
  progress: ProgressVideos,
  today: string,
  dailyHours: number,
): number[] {
  const contract = getTodayPaceContract(plan, progress, today, dailyHours);
  return filterVisibleOnDate(contract, progress, today);
}

/** 今日待办（打「今天」tag）：契约内未完成 */
export function getTodayPacePendingNos(
  plan: PlanFile,
  progress: ProgressVideos,
  today: string,
  dailyHours: number,
): number[] {
  const contract = getTodayPaceContract(plan, progress, today, dailyHours);
  return contract.filter((no) => !isLessonDone(no, progress));
}

/** @deprecated 使用 getTodayPacePendingNos / getTodayPaceDisplayNos */
export function getTodayPaceLessonNos(
  plan: PlanFile,
  progress: ProgressVideos,
  today: string,
  dailyHours: number,
): number[] {
  return getTodayPacePendingNos(plan, progress, today, dailyHours);
}

function removeFromQueue(queue: CatalogLessonMeta[], lessonNos: number[]) {
  const remove = new Set(lessonNos);
  return queue.filter((l) => !remove.has(l.lessonNo));
}

export function buildPaceWeekDailyPlan(
  plan: PlanFile,
  progress: ProgressVideos,
  today: string,
  dailyHours: number,
  options?: { useLock?: boolean },
): WeekDayRow[] {
  const hours = clampDailyStudyHours(dailyHours);
  const useLock = options?.useLock ?? false;
  const allLessons = catalogLessonList(plan);
  const { start, end } = weekRangeForDate(today);
  let simQueue = [...incompleteCatalogQueue(plan, progress)];
  const queueExhaustedAtStart = simQueue.length === 0;

  const todayContract =
    useLock && !queueExhaustedAtStart
      ? ensureTodayContract(plan, progress, today, hours, true) ?? []
      : null;

  return datesBetween(start, end).map((date) => {
    const d = parseLocalDate(date);
    const weekend = isWeekend(d);
    const isToday = date === today;
    const isPast = date < today;

    if (weekend) {
      return {
        date,
        weekday: WEEKDAY[d.getDay()],
        isWeekend: true,
        isToday,
        isPast,
        lessons: [],
        note: "休息",
      };
    }

    if (isPast) {
      const lessons = factualLessonsOnDate(plan, progress, date).filter((l) =>
        lessonShownOnDate(l.lessonNo, progress, date),
      );
      return {
        date,
        weekday: WEEKDAY[d.getDay()],
        isWeekend: false,
        isToday,
        isPast: true,
        lessons,
        note: lessons.length === 0 ? "—" : undefined,
      };
    }

    if (isToday && todayContract) {
      const displayNos = filterVisibleOnDate(todayContract, progress, today);
      const pending = displayNos.filter((no) => !isLessonDone(no, progress));
      simQueue = removeFromQueue(simQueue, pending);
      const lessons = rowsFromCatalog(allLessons, progress, displayNos);
      return {
        date,
        weekday: WEEKDAY[d.getDay()],
        isWeekend: false,
        isToday,
        isPast: false,
        lessons,
        note:
          lessons.length === 0
            ? queueExhaustedAtStart
              ? "录播已全部完成"
              : "—"
            : undefined,
      };
    }

    const { lessonNos, consumed } = packLessonsForDay(simQueue, hours);
    simQueue = simQueue.slice(consumed);
    const lessons = rowsFromCatalog(allLessons, progress, lessonNos);

    return {
      date,
      weekday: WEEKDAY[d.getDay()],
      isWeekend: false,
      isToday,
      isPast: false,
      lessons,
      note:
        lessons.length === 0
          ? queueExhaustedAtStart
            ? "录播已全部完成"
            : "—"
          : undefined,
    };
  });
}

export function paceStatus(plan: PlanFile, progress: ProgressVideos) {
  const all = catalogLessonList(plan);
  const done = all.filter((l) => isLessonDone(l.lessonNo, progress)).length;
  const remaining = all.length - done;
  const queue = incompleteCatalogQueue(plan, progress);
  const next = queue[0];
  const remainingHours =
    queue.reduce((sum, l) => sum + (l.durationSec > 0 ? l.durationSec : 45 * 60), 0) / 3600;

  return {
    total: all.length,
    done,
    remaining,
    remainingHours,
    nextLesson: next ? { no: next.lessonNo, title: next.title } : null,
  };
}

export function formatTodayMarquee(
  plan: PlanFile,
  progress: ProgressVideos,
  today: string,
  dailyHours: number,
): string {
  const display = getTodayPaceDisplayNos(plan, progress, today, dailyHours);
  const pending = getTodayPacePendingNos(plan, progress, today, dailyHours);
  if (display.length === 0) {
    return paceStatus(plan, progress).remaining === 0 ? "录播已全部完成" : "今日无安排";
  }
  const titles = catalogLessonList(plan);
  const byNo = new Map(titles.map((l) => [l.lessonNo, l]));
  const parts = (pending.length > 0 ? pending : display).map((no) => {
    const t = byNo.get(no);
    return t ? `[${no}] ${t.title}` : `[${no}]`;
  });
  const hours =
    display.reduce((s, no) => s + (byNo.get(no)?.durationSec ?? 0), 0) / 3600;
  const done = display.length - pending.length;
  const suffix =
    done > 0 ? `（待办 ${pending.length} 节 · 约 ${hours.toFixed(1)}h）` : `（约 ${hours.toFixed(1)}h）`;
  return `${parts.join(" · ")}${suffix}`;
}

export type TodayPlanProgress = {
  lessonTotal: number;
  lessonDone: number;
  plannedHours: number;
  watchedHours: number;
  timePct: number;
  lessonPct: number;
};

export function computeTodayPlanProgress(
  plan: PlanFile,
  progress: ProgressVideos,
  today: string,
  dailyHours: number,
): TodayPlanProgress | null {
  const display = getTodayPaceDisplayNos(plan, progress, today, dailyHours);
  if (display.length === 0) return null;

  const byNo = new Map(catalogLessonList(plan).map((l) => [l.lessonNo, l]));
  let lessonDone = 0;
  let plannedSec = 0;
  let watchedSec = 0;

  for (const no of display) {
    const meta = byNo.get(no);
    const video = progress[String(no)];
    const dur =
      (meta?.durationSec ?? 0) > 0 ? meta!.durationSec : video?.duration ?? 45 * 60;
    plannedSec += dur;
    if (video?.completed) {
      lessonDone += 1;
      watchedSec += dur;
    } else if (video) {
      watchedSec += Math.min(video.position, dur);
    }
  }

  const plannedHours = plannedSec / 3600;
  const watchedHours = watchedSec / 3600;
  const timePct =
    plannedSec > 0 ? Math.min(100, Math.round((watchedSec / plannedSec) * 100)) : 0;
  const lessonPct =
    display.length > 0 ? Math.round((lessonDone / display.length) * 100) : 0;

  return {
    lessonTotal: display.length,
    lessonDone,
    plannedHours,
    watchedHours,
    timePct,
    lessonPct,
  };
}

export { todayIso };
