export interface TodayTask {
  id: string;
  taskType: string;
  title: string;
  lessonNo?: number;
  missing: boolean;
  done: boolean;
  position: number;
  duration: number;
  completed: boolean;
}

export interface TodaySnapshot {
  date: string;
  weekId: string;
  weekLabel: string;
  phase: string;
  focus: string;
  weekDone: number;
  weekTotal: number;
  daysToExam: number;
  rootConfigured: boolean;
  missingLessons: number[];
  previewMode: boolean;
  rootPath?: string | null;
  videosReady: number;
  videosTotal: number;
  weekLessonNos: number[];
  tasks: TodayTask[];
  todayPending: number;
  planVariant?: string;
  planName?: string;
}

export interface Settings {
  rootDir?: string | null;
  textbookDir?: string | null;
  panelPinned?: boolean | null;
  wovenStyle?: boolean | null;
  planVariant?: string | null;
  floatingSubtitles?: boolean | null;
}

export interface PlanLesson {
  no: number;
  title: string;
  filename: string;
  category?: string;
  videoSubdir?: string;
  builtinPlayable: boolean;
  missing: boolean;
  durationSec?: number;
}

export interface CatalogLesson {
  no: number;
  title: string;
  category?: string;
  missing: boolean;
  position: number;
  duration: number;
  completed: boolean;
  textbookPage?: number;
}

export interface TextbookFile {
  textbookSubdir: string;
  textbookFilename: string;
  lessons: Record<string, { page: number }>;
}

export interface PlanMilestone {
  id: string;
  title: string;
  start: string;
  end: string;
  note?: string;
}

export interface PlanWeek {
  id: string;
  stage: string;
  phase: string;
  focus: string;
  caseArrangement?: string;
  start: string;
  end: string;
  tasks?: Array<{
    id: string;
    type: string;
    lessonNo?: number;
    title: string;
    scheduledDate?: string;
    missing?: boolean;
  }>;
}

export interface LiveSession {
  no: number;
  title: string;
  date: string;
  time: string;
  format?: string;
  chapterHint?: string;
}

export interface PlanFile {
  planId?: string;
  planName?: string;
  examDate?: string;
  startDate?: string;
  milestones?: PlanMilestone[];
  liveSessions?: LiveSession[];
  weeks?: PlanWeek[];
  lessons: Record<string, PlanLesson>;
}

export type PlanVariant = "default" | "v2" | "wen";

/** 计划表弹窗内的视图（不影响后端 plan.json 选择，后端固定 v2） */
export type PlanSheetView = "overview" | "weekDaily" | "wenOverview";
