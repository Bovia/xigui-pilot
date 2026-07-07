import type { PlanFile, PlanWeek } from "./types";

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

type ProgressVideos = Record<
  string,
  { position: number; duration: number; completed: boolean }
>;

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

function orderedTasks(plan: PlanFile) {
  const weeks = [...(plan.weeks ?? [])].sort(
    (a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
  const rows: Array<{
    lessonNo: number;
    title: string;
    missing: boolean;
    weekId: string;
  }> = [];
  for (const week of weeks) {
    for (const task of week.tasks ?? []) {
      if (task.lessonNo == null) continue;
      rows.push({
        lessonNo: task.lessonNo,
        title: task.title,
        missing: task.missing ?? false,
        weekId: week.id,
      });
    }
  }
  return rows;
}

function isLessonDone(lessonNo: number, progress: ProgressVideos) {
  const saved = progress[String(lessonNo)];
  return saved?.completed ?? false;
}

function incompleteQueue(plan: PlanFile, progress: ProgressVideos) {
  return orderedTasks(plan).filter((t) => !isLessonDone(t.lessonNo, progress));
}

export function findPlanWeek(plan: PlanFile, weekId: string): PlanWeek | undefined {
  return plan.weeks?.find((w) => w.id === weekId);
}

/** 按进度动态排期：从「首个未完成课节」起，依次填入本周剩余工作日（每天 1 节） */
export function buildWeekDailyPlan(
  plan: PlanFile,
  progress: ProgressVideos,
  today: string,
  weekId: string,
): WeekDayRow[] {
  const week = findPlanWeek(plan, weekId);
  if (!week) return [];

  const queue = incompleteQueue(plan, progress);
  let queueIdx = 0;
  const forward = new Map<string, PlanLessonRow[]>();

  for (const date of datesBetween(week.start, week.end)) {
    if (date < today) continue;
    const d = parseLocalDate(date);
    if (isWeekend(d)) continue;
    if (queueIdx >= queue.length) break;
    const item = queue[queueIdx++];
    forward.set(date, [
      {
        lessonNo: item.lessonNo,
        title: item.title,
        done: false,
        missing: item.missing,
      },
    ]);
  }

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
      const staticTasks = (week.tasks ?? []).filter((t) => t.scheduledDate === date);
      const lessons: PlanLessonRow[] = staticTasks
        .filter((t) => t.lessonNo != null)
        .map((t) => ({
          lessonNo: t.lessonNo!,
          title: t.title,
          done: isLessonDone(t.lessonNo!, progress),
          missing: t.missing ?? false,
        }));
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

    const lessons = forward.get(date) ?? [];
    return {
      date,
      weekday: WEEKDAY[d.getDay()],
      isWeekend: false,
      isToday,
      isPast: false,
      lessons,
      note:
        lessons.length === 0
          ? queueIdx >= queue.length
            ? "本周任务已完成 · 可预习或复习"
            : "—"
          : undefined,
    };
  });
}

export function dynamicStatus(plan: PlanFile, progress: ProgressVideos, today: string) {
  const all = orderedTasks(plan);
  const done = all.filter((t) => isLessonDone(t.lessonNo, progress)).length;
  const remaining = all.length - done;
  const queue = incompleteQueue(plan, progress);
  const next = queue[0];
  return {
    total: all.length,
    done,
    remaining,
    nextLesson: next
      ? { no: next.lessonNo, title: next.title }
      : null,
    ahead:
      done >
      all.filter((t) => {
        const w = findPlanWeek(plan, "W1");
        if (!w) return false;
        return (w.tasks ?? []).some(
          (task) =>
            task.lessonNo === t.lessonNo &&
            (task.scheduledDate ?? "") <= today &&
            isLessonDone(t.lessonNo, progress),
        );
      }).length,
  };
}
