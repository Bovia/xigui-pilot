import type { PlanFile } from "./types";

/** 文老师课表中最后一节录播的 scheduledDate */
export function wenRecordingFinishDate(planWen: PlanFile): string | null {
  let max: string | null = null;
  for (const week of planWen.weeks ?? []) {
    for (const task of week.tasks ?? []) {
      if (!task.scheduledDate) continue;
      if (!max || task.scheduledDate > max) max = task.scheduledDate;
    }
  }
  return max;
}

function daysBetween(from: string, to: string) {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** 预计刷完日 ≤ 文老师课表完结日 → 能赶上 */
export function canKeepUpWithWen(
  userFinish: string | null,
  wenFinish: string | null,
): boolean | null {
  if (!wenFinish) return null;
  if (!userFinish) return true;
  return daysBetween(userFinish, wenFinish) >= 0;
}

export type PaceVsWen = {
  text: string;
  canKeepUp: boolean;
};

/** 能赶上 / 赶不上（对照文老师课表完结日） */
export function formatPaceVsWen(
  userFinish: string | null,
  wenFinish: string | null,
  formatDay: (iso: string) => string,
): PaceVsWen | null {
  if (!wenFinish) return null;
  const canKeepUp = canKeepUpWithWen(userFinish, wenFinish);
  if (canKeepUp == null) return null;
  const wenLabel = formatDay(wenFinish);
  return {
    canKeepUp,
    text: canKeepUp ? "能赶上" : `赶不上(文${wenLabel})`,
  };
}
