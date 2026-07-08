import type { LiveSession, PlanFile, PlanWeek } from "./types";

function weekNum(id: string) {
  return parseInt(id.replace(/^W/, ""), 10) || 1;
}

export function findWenWeekForDate(plan: PlanFile, today: string): PlanWeek | null {
  const weeks = plan.weeks ?? [];
  for (const week of weeks) {
    if (week.start && week.end && today >= week.start && today <= week.end) {
      return week;
    }
  }
  if (weeks.length === 0) return null;
  const first = weeks[0];
  if (first.start && today < first.start) return first;
  return weeks[weeks.length - 1];
}

export function wenWeekIdForDate(plan: PlanFile, today: string): string {
  return findWenWeekForDate(plan, today)?.id ?? "W1";
}

export function activeLiveSession(sessions: LiveSession[] | undefined, today: string) {
  if (!sessions?.length) return null;
  return sessions.find((s) => s.date >= today) ?? sessions[sessions.length - 1];
}

export function lastLiveSession(sessions: LiveSession[] | undefined, today: string) {
  if (!sessions?.length) return null;
  const past = sessions.filter((s) => s.date < today);
  return past.length ? past[past.length - 1] : null;
}

export type WenBenchmark = {
  phase: string;
  stage: string;
  weekId: string;
  weekLabel: string;
  focus: string;
  weekNum: number;
  nextLive: LiveSession | null;
  lastLive: LiveSession | null;
};

export function getWenBenchmark(plan: PlanFile, today: string): WenBenchmark {
  const week = findWenWeekForDate(plan, today);
  const id = week?.id ?? "W1";
  const num = weekNum(id);
  const sessions = plan.liveSessions ?? [];

  return {
    phase: week?.phase ?? "阶段一·全面复习",
    stage: week?.stage ?? "",
    weekId: id,
    weekLabel: `第${num}周 ${week?.phase ?? "阶段一·全面复习"}`,
    focus: week?.focus ?? "",
    weekNum: num,
    nextLive: activeLiveSession(sessions, today),
    lastLive: lastLiveSession(sessions, today),
  };
}

export const WEN_TAG = "文老师" as const;

export type WenHighlight = {
  lessonNos: Set<number>;
  tagLabel: typeof WEN_TAG;
};

export function wenLessonNosOnDate(plan: PlanFile, date: string): number[] {
  const nos: number[] = [];
  for (const week of plan.weeks ?? []) {
    for (const task of week.tasks ?? []) {
      if (task.scheduledDate === date && task.lessonNo != null) {
        nos.push(task.lessonNo);
      }
    }
  }
  return nos;
}

/** 仅当天 scheduledDate 排课（选项 A） */
export function getWenHighlight(plan: PlanFile, today: string): WenHighlight {
  const todayNos = wenLessonNosOnDate(plan, today);
  return { lessonNos: new Set(todayNos), tagLabel: WEN_TAG };
}

export function formatWenTodayMarquee(plan: PlanFile, today: string): string {
  const nos = wenLessonNosOnDate(plan, today);
  if (nos.length === 0) return "今日无录播排课";

  const titles = new Map<number, string>();
  for (const week of plan.weeks ?? []) {
    for (const task of week.tasks ?? []) {
      if (task.lessonNo != null) {
        titles.set(task.lessonNo, task.title);
      }
    }
  }

  return nos
    .map((no) => {
      const title = titles.get(no);
      return title ? `[${no}] ${title}` : `[${no}]`;
    })
    .join(" · ");
}

export function formatLiveShort(session: LiveSession) {
  const d = new Date(`${session.date}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()} ${session.time}`;
}

export type ProgressVideo = {
  position: number;
  duration: number;
  completed: boolean;
};

export function wenWeekProgress(
  plan: PlanFile,
  weekId: string,
  progress: Record<string, ProgressVideo>,
) {
  const week = plan.weeks?.find((w) => w.id === weekId);
  const tasks = (week?.tasks ?? []).filter((t) => t.lessonNo != null);
  let done = 0;
  for (const t of tasks) {
    const v = progress[String(t.lessonNo!)];
    if (v?.completed || (v?.position ?? 0) > 30) done++;
  }
  return { done, total: tasks.length };
}
