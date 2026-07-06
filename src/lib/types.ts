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
}

export interface Settings {
  rootDir?: string | null;
  textbookDir?: string | null;
  panelPinned?: boolean | null;
  wovenStyle?: boolean | null;
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

export interface PlanFile {
  lessons: Record<string, PlanLesson>;
}
