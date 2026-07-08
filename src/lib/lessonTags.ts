import { getTodayPaceLessonNos } from "./pacePlan";
import { readDailyStudyHours } from "./studyPace";
import { getWenHighlight } from "./wenPlan";
import type { PlanFile } from "./types";
import type { ProgressVideos } from "./dynamicPlan";

export type LessonTagState = {
  wenLessonNos: Set<number>;
  executionLessonNos: Set<number>;
  executionLabel: "今天" | "本周" | null;
};

export function computeLessonTags(
  plan: PlanFile,
  planWen: PlanFile,
  progress: ProgressVideos,
  today: string,
  dailyHours = readDailyStudyHours(),
): LessonTagState {
  const wen = getWenHighlight(planWen, today);
  const todayNos = getTodayPaceLessonNos(plan, progress, today, dailyHours);
  return {
    wenLessonNos: wen.lessonNos,
    executionLessonNos: new Set(todayNos),
    executionLabel: todayNos.length > 0 ? "今天" : null,
  };
}
