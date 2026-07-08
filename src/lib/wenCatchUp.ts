import type { ProgressVideos } from "./dynamicPlan";
import {
  catalogLessonList,
  estimateQueueFinishDate,
  type CatalogLessonMeta,
} from "./pacePlan";
import type { PlanFile } from "./types";

function isLessonDone(lessonNo: number, progress: ProgressVideos) {
  return progress[String(lessonNo)]?.completed ?? false;
}

/** 文老师课表中，scheduledDate ≤ today 应完成的录播课节 */
export function wenLessonsDueByDate(planWen: PlanFile, today: string): number[] {
  const seen = new Set<number>();
  const nos: number[] = [];
  for (const week of planWen.weeks ?? []) {
    for (const task of week.tasks ?? []) {
      if (task.lessonNo == null || !task.scheduledDate) continue;
      if (task.scheduledDate > today || seen.has(task.lessonNo)) continue;
      seen.add(task.lessonNo);
      nos.push(task.lessonNo);
    }
  }
  return nos.sort((a, b) => a - b);
}

export type WenCatchUpStatus = {
  wenDueCount: number;
  alignedCount: number;
  behindCount: number;
  aheadCount: number;
  behindHours: number;
  catchUpDate: string | null;
};

export function computeWenCatchUp(
  plan: PlanFile,
  planWen: PlanFile,
  progress: ProgressVideos,
  today: string,
  dailyHours: number,
): WenCatchUpStatus {
  const due = wenLessonsDueByDate(planWen, today);
  const catalog = catalogLessonList(plan);
  const byNo = new Map(catalog.map((l) => [l.lessonNo, l]));

  const behindNos = due.filter((no) => !isLessonDone(no, progress));
  const alignedCount = due.length - behindNos.length;
  const totalDone = catalog.filter((l) => isLessonDone(l.lessonNo, progress)).length;
  const aheadCount = behindNos.length === 0 ? Math.max(0, totalDone - due.length) : 0;

  const behindQueue: CatalogLessonMeta[] = behindNos.map((no) => {
    const meta = byNo.get(no);
    return (
      meta ?? {
        lessonNo: no,
        title: `第 ${no} 节`,
        missing: false,
        durationSec: 45 * 60,
      }
    );
  });

  const behindHours =
    behindQueue.reduce((s, l) => s + (l.durationSec > 0 ? l.durationSec : 45 * 60), 0) / 3600;

  const catchUpDate =
    behindNos.length > 0
      ? estimateQueueFinishDate(behindQueue, today, dailyHours)
      : null;

  return {
    wenDueCount: due.length,
    alignedCount,
    behindCount: behindNos.length,
    aheadCount,
    behindHours,
    catchUpDate,
  };
}

export function formatWenCatchUpLine(
  status: WenCatchUpStatus,
  formatDay: (iso: string) => string,
): string {
  if (status.wenDueCount === 0) {
    return "文老师课表今日暂无应完成录播";
  }
  if (status.behindCount > 0) {
    const datePart = status.catchUpDate
      ? ` · 预计 ${formatDay(status.catchUpDate)} 赶上`
      : "";
    return `文老师进度 ${status.wenDueCount} 节 · 落后 ${status.behindCount} 节（约 ${status.behindHours.toFixed(1)}h）${datePart}`;
  }
  if (status.aheadCount > 0) {
    return `文老师进度 ${status.wenDueCount} 节 · 已超前 ${status.aheadCount} 节`;
  }
  return `文老师进度 ${status.wenDueCount} 节 · 已对齐`;
}
