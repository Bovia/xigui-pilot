import type { PlanFile } from "./types";
import type { PlanLessonRow, ProgressVideos, WeekDayRow } from "./dynamicPlan";
import { factualLessonsOnDate, todayIso } from "./dynamicPlan";
import { clampDailyStudyHours } from "./studyPace";

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

function isLessonDone(lessonNo: number, progress: ProgressVideos) {
  return progress[String(lessonNo)]?.completed ?? false;
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

function clearPaceTodayLockIfStale(today: string) {
  const lock = readPaceTodayLock();
  if (lock && lock.date !== today) {
    localStorage.removeItem(PACE_TODAY_LOCK_KEY);
  }
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

/** 对指定队列模拟工作日排课，返回完成日期 */
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

export function getTodayPaceLessonNos(
  plan: PlanFile,
  progress: ProgressVideos,
  today: string,
  dailyHours: number,
): number[] {
  clearPaceTodayLockIfStale(today);
  const hours = clampDailyStudyHours(dailyHours);
  const queue = incompleteCatalogQueue(plan, progress);
  if (queue.length === 0) return [];

  const existing = readPaceTodayLock();
  if (existing?.date === today && existing.dailyHours === hours) {
    const head = queue[0]?.lessonNo;
    if (head != null && existing.lessonNos.includes(head)) {
      return existing.lessonNos;
    }
  }

  const { lessonNos } = packLessonsForDay(queue, hours);
  writePaceTodayLock({ date: today, dailyHours: hours, lessonNos });
  return lessonNos;
}

export function buildPaceWeekDailyPlan(
  plan: PlanFile,
  progress: ProgressVideos,
  today: string,
  dailyHours: number,
): WeekDayRow[] {
  const hours = clampDailyStudyHours(dailyHours);
  const allLessons = catalogLessonList(plan);
  const { start, end } = weekRangeForDate(today);
  const queue = [...incompleteCatalogQueue(plan, progress)];
  const queueExhaustedAtStart = queue.length === 0;

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
      const lessons = factualLessonsOnDate(plan, progress, date);
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

    const { lessonNos, consumed } = packLessonsForDay(queue, hours);
    queue.splice(0, consumed);
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
  const nos = getTodayPaceLessonNos(plan, progress, today, dailyHours);
  if (nos.length === 0) {
    return paceStatus(plan, progress).remaining === 0 ? "录播已全部完成" : "今日无安排";
  }
  const titles = catalogLessonList(plan);
  const byNo = new Map(titles.map((l) => [l.lessonNo, l]));
  const parts = nos.map((no) => {
    const t = byNo.get(no);
    return t ? `[${no}] ${t.title}` : `[${no}]`;
  });
  const hours =
    nos.reduce((s, no) => s + (byNo.get(no)?.durationSec ?? 0), 0) / 3600;
  return `${parts.join(" · ")}（约 ${hours.toFixed(1)}h）`;
}

export type TodayPlanProgress = {
  lessonTotal: number;
  lessonDone: number;
  plannedHours: number;
  watchedHours: number;
  timePct: number;
  lessonPct: number;
};

/** 阶段一今日任务进度（按今日计划课节） */
export function computeTodayPlanProgress(
  plan: PlanFile,
  progress: ProgressVideos,
  today: string,
  dailyHours: number,
): TodayPlanProgress | null {
  const nos = getTodayPaceLessonNos(plan, progress, today, dailyHours);
  if (nos.length === 0) return null;

  const byNo = new Map(catalogLessonList(plan).map((l) => [l.lessonNo, l]));
  let lessonDone = 0;
  let plannedSec = 0;
  let watchedSec = 0;

  for (const no of nos) {
    const meta = byNo.get(no);
    const video = progress[String(no)];
    const dur =
      (meta?.durationSec ?? 0) > 0
        ? meta!.durationSec
        : video?.duration ?? 45 * 60;
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
  const timePct = plannedSec > 0 ? Math.min(100, Math.round((watchedSec / plannedSec) * 100)) : 0;
  const lessonPct =
    nos.length > 0 ? Math.round((lessonDone / nos.length) * 100) : 0;

  return {
    lessonTotal: nos.length,
    lessonDone,
    plannedHours,
    watchedHours,
    timePct,
    lessonPct,
  };
}

export { todayIso };
