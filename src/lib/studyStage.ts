import type { PlanFile } from "./types";
import type { ProgressVideos } from "./dynamicPlan";
import { findWenWeekForDate } from "./wenPlan";
import { incompleteCatalogQueue } from "./pacePlan";

const PHASE_HINTS: Record<string, string[]> = {
  "阶段一·全面复习": [
    "按每日时长刷完剩余录播",
    "对照讲义做笔记，完成章节练习",
    "章节练习正确率争取 >90%",
  ],
  "阶段二·案例突破": [
    "学习案例分析基础知识",
    "历年真题训练，掌握答题套路",
    "案例练习正确率争取 >90%",
  ],
  "阶段三·论文强化": [
    "学习论文模板与写作框架",
    "完成一篇合格论文并提交批改",
  ],
  "阶段四·查漏补缺": [
    "整理错题本，回炉薄弱章节",
    "考前调整状态，速记重点框架",
  ],
};

export type StageCard =
  | {
      kind: "recording";
      phase: string;
      subLabel: string;
      remainingLessons: number;
      remainingHours: number;
    }
  | {
      kind: "phase";
      phase: string;
      focus: string;
      hints: string[];
    };

export function resolveStudyPhase(planWen: PlanFile, today: string): string {
  return findWenWeekForDate(planWen, today)?.phase ?? "阶段一·全面复习";
}

export function getStageCard(
  plan: PlanFile,
  planWen: PlanFile,
  progress: ProgressVideos,
  today: string,
): StageCard {
  const queue = incompleteCatalogQueue(plan, progress);
  const phase = resolveStudyPhase(planWen, today);
  const week = findWenWeekForDate(planWen, today);

  if (queue.length > 0) {
    const remainingHours =
      queue.reduce((s, l) => s + (l.durationSec > 0 ? l.durationSec : 45 * 60), 0) /
      3600;
    const basicLeft = queue.filter((l) => l.lessonNo < 900).length;
    const subLabel = basicLeft > 0 ? "录播" : "收尾";
    return {
      kind: "recording",
      phase,
      subLabel,
      remainingLessons: queue.length,
      remainingHours,
    };
  }

  return {
    kind: "phase",
    phase: queue.length === 0 && phase === "阶段一·全面复习" ? "阶段二·案例突破" : phase,
    focus: week?.focus ?? "",
    hints: PHASE_HINTS[phase === "阶段一·全面复习" ? "阶段二·案例突破" : phase] ?? [],
  };
}

export function formatStageMarquee(card: StageCard): string {
  if (card.kind === "recording") {
    return `${card.phase}（${card.subLabel}）`;
  }
  return card.phase;
}
