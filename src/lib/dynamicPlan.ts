import type { PlanFile, PlanSheetView, PlanWeek } from "./types";
import { readPlanDayLock, writePlanDayLock, clearPlanDayLockIfStale } from "./planLock";

export type PlanLessonRow = {
  lessonNo: number;
  title: string;
  done: boolean;
  missing: boolean;
};

export type WeekDayRow = {
  date: string;
  weekday: string;
  isWeekend: boolean;
  isToday: boolean;
  isPast: boolean;
  lessons: PlanLessonRow[];
  note?: string;
};

export type ProgressVideo = {
  position: number;
  duration: number;
  completed: boolean;
  updated_at?: string;
  last_activity_date?: string;
};

export type ProgressVideos = Record<string, ProgressVideo>;

export type PlanHighlight = {
  lessonNos: Set<number>;
  tagLabel: "今天" | "本周";
};

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];

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

function lessonTitleMap(plan: PlanFile) {
  const map = new Map<number, { title: string; missing: boolean }>();
  for (const week of plan.weeks ?? []) {
    for (const task of week.tasks ?? []) {
      if (task.lessonNo == null) continue;
      map.set(task.lessonNo, {
        title: task.title,
        missing: task.missing ?? false,
      });
    }
  }
  return map;
}

function activityDate(video: ProgressVideo | undefined): string | undefined {
  if (!video) return undefined;
  if (video.last_activity_date) return video.last_activity_date;
  if (video.updated_at && video.updated_at.length >= 10) {
    return video.updated_at.slice(0, 10);
  }
  return undefined;
}

function hasStudyActivity(video: ProgressVideo | undefined) {
  if (!video) return false;
  return video.completed || video.position > 30;
}

function isLessonDone(lessonNo: number, progress: ProgressVideos) {
  return progress[String(lessonNo)]?.completed ?? false;
}

function orderedTasks(plan: PlanFile) {
  const weeks = [...(plan.weeks ?? [])].sort(
    (a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
  const rows: Array<{
    lessonNo: number;
    title: string;
    missing: boolean;
    weekId: string;
    scheduledDate?: string;
  }> = [];
  for (const week of weeks) {
    for (const task of week.tasks ?? []) {
      if (task.lessonNo == null) continue;
      rows.push({
        lessonNo: task.lessonNo,
        title: task.title,
        missing: task.missing ?? false,
        weekId: week.id,
        scheduledDate: task.scheduledDate,
      });
    }
  }
  return rows;
}

function incompleteQueue(plan: PlanFile, progress: ProgressVideos) {
  return orderedTasks(plan).filter((t) => !isLessonDone(t.lessonNo, progress));
}

export function findPlanWeek(plan: PlanFile, weekId: string): PlanWeek | undefined {
  return plan.weeks?.find((w) => w.id === weekId);
}

/** 某天实际学过的课（事实轨） */
export function factualLessonsOnDate(
  plan: PlanFile,
  progress: ProgressVideos,
  date: string,
): PlanLessonRow[] {
  const titles = lessonTitleMap(plan);
  const rows: PlanLessonRow[] = [];
  for (const [key, video] of Object.entries(progress)) {
    if (!hasStudyActivity(video)) continue;
    if (activityDate(video) !== date) continue;
    const lessonNo = Number(key);
    if (!Number.isFinite(lessonNo)) continue;
    const meta = titles.get(lessonNo);
    rows.push({
      lessonNo,
      title: meta?.title ?? `第 ${lessonNo} 节`,
      done: video.completed,
      missing: meta?.missing ?? false,
    });
  }
  return rows.sort((a, b) => a.lessonNo - b.lessonNo);
}

/** 同一进位算法：从未完成队列填入工作日格子（span = 日） */
function fillForwardBuckets(
  plan: PlanFile,
  progress: ProgressVideos,
  today: string,
  week: PlanWeek,
) {
  const queue = incompleteQueue(plan, progress);
  const forward = new Map<string, number[]>();
  let queueIdx = 0;

  for (const date of datesBetween(week.start, week.end)) {
    if (date < today) continue;
    const d = parseLocalDate(date);
    if (isWeekend(d)) continue;
    if (queueIdx >= queue.length) break;
    forward.set(date, [queue[queueIdx].lessonNo]);
    queueIdx += 1;
  }

  return { forward, queueExhausted: queueIdx >= queue.length };
}

function ensureDayLock(
  plan: PlanFile,
  progress: ProgressVideos,
  today: string,
  weekId: string,
) {
  clearPlanDayLockIfStale(today);
  const existing = readPlanDayLock();
  if (existing && existing.date === today && existing.weekId === weekId) {
    return existing;
  }

  const week = findPlanWeek(plan, weekId);
  if (!week) {
    return { date: today, todayLessonNos: [], forwardByDate: {}, weekId };
  }

  const { forward } = fillForwardBuckets(plan, progress, today, week);
  const forwardByDate: Record<string, number[]> = {};
  for (const [date, nos] of forward.entries()) {
    forwardByDate[date] = nos;
  }

  const lock = {
    date: today,
    todayLessonNos: forwardByDate[today] ?? [],
    forwardByDate,
    weekId,
  };
  writePlanDayLock(lock);
  return lock;
}

function rowsFromNos(plan: PlanFile, progress: ProgressVideos, nos: number[]): PlanLessonRow[] {
  const titles = lessonTitleMap(plan);
  return nos.map((lessonNo) => {
    const meta = titles.get(lessonNo);
    return {
      lessonNo,
      title: meta?.title ?? `第 ${lessonNo} 节`,
      done: isLessonDone(lessonNo, progress),
      missing: meta?.missing ?? false,
    };
  });
}

/** 本周逐日：过去=事实，今天及以后=日界锁定后的进位 */
export function buildWeekDailyPlan(
  plan: PlanFile,
  progress: ProgressVideos,
  today: string,
  weekId: string,
): WeekDayRow[] {
  const week = findPlanWeek(plan, weekId);
  if (!week) return [];

  const lock = ensureDayLock(plan, progress, today, weekId);
  const queueExhausted =
    incompleteQueue(plan, progress).length <=
    Object.values(lock.forwardByDate).flat().length;

  return datesBetween(week.start, week.end).map((date) => {
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

    const nos = lock.forwardByDate[date] ?? [];
    const lessons = rowsFromNos(plan, progress, nos);
    return {
      date,
      weekday: WEEKDAY[d.getDay()],
      isWeekend: false,
      isToday,
      isPast: false,
      lessons,
      note:
        lessons.length === 0
          ? queueExhausted
            ? "本周任务已完成 · 可预习或复习"
            : "—"
          : undefined,
    };
  });
}

export function weekLessonNos(plan: PlanFile, weekId: string): number[] {
  const week = findPlanWeek(plan, weekId);
  if (!week) return [];
  return (week.tasks ?? [])
    .map((t) => t.lessonNo)
    .filter((n): n is number => n != null);
}

export function wenTodayLessonNos(plan: PlanFile, today: string): number[] {
  return orderedTasks(plan)
    .filter((t) => t.scheduledDate === today)
    .map((t) => t.lessonNo);
}

export function getPlanHighlight(
  view: PlanSheetView,
  planV2: PlanFile,
  planWen: PlanFile | null,
  progress: ProgressVideos,
  today: string,
  weekId: string,
): PlanHighlight {
  if (view === "weekDaily") {
    const lock = ensureDayLock(planV2, progress, today, weekId);
    return {
      lessonNos: new Set(lock.todayLessonNos),
      tagLabel: "今天",
    };
  }

  if (view === "wenOverview" && planWen) {
    const todayNos = wenTodayLessonNos(planWen, today);
    if (todayNos.length > 0) {
      return { lessonNos: new Set(todayNos), tagLabel: "今天" };
    }
    return {
      lessonNos: new Set(weekLessonNos(planWen, weekId)),
      tagLabel: "本周",
    };
  }

  return {
    lessonNos: new Set(weekLessonNos(planV2, weekId)),
    tagLabel: "本周",
  };
}

export function dynamicStatus(plan: PlanFile, progress: ProgressVideos, _today: string) {
  const all = orderedTasks(plan);
  const done = all.filter((t) => isLessonDone(t.lessonNo, progress)).length;
  const remaining = all.length - done;
  const queue = incompleteQueue(plan, progress);
  const next = queue[0];
  return {
    total: all.length,
    done,
    remaining,
    nextLesson: next ? { no: next.lessonNo, title: next.title } : null,
  };
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
