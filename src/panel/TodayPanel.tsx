import { useCallback, useEffect, useRef, useState, Fragment } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  getProgress,
  getLiveCatalog,
  getPanelPinned,
  getSettings,
  getTodaySnapshot,
  loadPlan,
  loadQuiz,
  loadTextbook,
  openExternalVideo,
  openPlayer,
  openTextbook,
  openTricolorNotes,
  pickRootDir,
  pickTextbook,
  pickTricolorNotes,
  quitApp,
  setPanelPinned,
  setFloatingSubtitles,
  setSubtitleCatMode,
  setLaunchAtLogin,
  setWovenStyle,
  syncPaceTodayLock,
  toggleQuizDone,
} from "../lib/api";
import {
  formatWenTodayMarquee,
  getWenBenchmark,
  type WenBenchmark,
} from "../lib/wenPlan";
import { computeLessonTags, type LessonTagState } from "../lib/lessonTags";
import { formatTodayMarquee, computeTodayPlanProgress, getTodayPaceContract, type TodayPlanProgress } from "../lib/pacePlan";
import { PLAN_VIEW_EVENT } from "../lib/planSheetView";
import { PACE_CHANGED_EVENT, readDailyStudyHours } from "../lib/studyPace";
import {
  formatStageMarquee,
  getStageCard,
} from "../lib/studyStage";
import type { CatalogLesson, PlanFile, TextbookFile, TodaySnapshot } from "../lib/types";
import {
  isEyeRestEnabled,
  setEyeRestEnabled,
} from "../lib/eyeRest";
import { quizChapterKey, quizTooltip } from "../lib/quiz";
import Tooltip from "../components/Tooltip";
import BookTooltip from "../components/BookTooltip";
import HelpGuide from "../components/HelpGuide";
import ProgressHintMarquee from "../components/ProgressHintMarquee";
import StudyPlanSheet from "../components/StudyPlanSheet";

function formatDate(date: string) {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function formatProgress(position: number, duration: number, completed: boolean) {
  if (completed) return "已完成";
  const totalMin = duration > 0 ? Math.floor(duration / 60) : 0;
  if (position <= 0) {
    return totalMin > 0 ? `${totalMin} 分钟` : "—";
  }
  const watched = Math.floor(position / 60);
  if (watched <= 0 && position > 0) {
    const sec = Math.floor(position);
    return totalMin > 0 ? `已看 ${sec} 秒 / ${totalMin} 分钟` : `已看 ${sec} 秒`;
  }
  if (totalMin > 0) {
    return `已看 ${watched}/${totalMin} 分钟`;
  }
  return `已看 ${watched} 分钟`;
}

function progressPercent(position: number, duration: number, completed: boolean) {
  if (completed) return 100;
  if (!duration) return 0;
  return Math.min(100, Math.round((position / duration) * 100));
}

function startDrag(e: React.MouseEvent) {
  if (e.button !== 0) return;
  getCurrentWindow().startDragging().catch(() => undefined);
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="ml-0.5 h-3.5 w-3.5 fill-current">
      <path d="M8 5.14v13.72L19 12 8 5.14z" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[22px] w-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

function PinIcon({ pinned }: { pinned: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[22px] w-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 17v5" />
      <path d="M5 10h14" />
      <path d="M12 10V3" />
      <path d="M9 3h6l-1 7" />
      {!pinned && <path d="m4 4 16 16" />}
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[22px] w-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 14h.01" />
      <path d="M12 14h.01" />
      <path d="M16 14h.01" />
      <path d="M8 18h.01" />
      <path d="M12 18h.01" />
    </svg>
  );
}

function lessonNoLabel(no: number, category?: string) {
  if (category === "special") {
    return `专${String(no - 900).padStart(2, "0")}`;
  }
  if (category === "live") {
    return `直${String(no - 700).padStart(2, "0")}`;
  }
  return String(no).padStart(2, "0");
}

function catalogSections(catalog: CatalogLesson[]) {
  const basic = catalog.filter((l) => l.category !== "special" && l.category !== "live");
  const special = catalog.filter((l) => l.category === "special");
  const live = catalog.filter((l) => l.category === "live");
  const sections: { id: string; title: string; lessons: CatalogLesson[] }[] = [
    { id: "basic", title: "基础课", lessons: basic },
  ];
  if (special.length > 0) {
    sections.push({ id: "special", title: "案例·论文专题", lessons: special });
  }
  sections.push({ id: "live", title: "直播课", lessons: live });
  return sections;
}

const SECTION_EXPAND_KEY = "xigui-catalog-sections";
const PANEL_SCROLL_KEY = "xigui-panel-scroll-y";

function scrollLessonToTop(container: HTMLElement, el: Element) {
  const sectionHeader = el.parentElement?.previousElementSibling;
  const headerH =
    sectionHeader instanceof HTMLElement ? sectionHeader.offsetHeight : 36;
  const buffer = headerH + 10;
  const top =
    el.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop;
  container.scrollTop = Math.max(0, top - buffer);
}

function loadExpandedSections(): Record<string, boolean> {
  const defaults = { basic: true, special: true, live: true };
  try {
    const raw = localStorage.getItem(SECTION_EXPAND_KEY);
    if (raw) return { ...defaults, ...(JSON.parse(raw) as Record<string, boolean>) };
  } catch {
    /* ignore */
  }
  return defaults;
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-3.5 w-3.5 text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function TodayProgressBar({ progress }: { progress: TodayPlanProgress }) {
  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
        <span>
          今日 {progress.lessonDone}/{progress.lessonTotal} 节
        </span>
        <span>{progress.timePct}%</span>
      </div>
      <div className="woven-progress-track h-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className="woven-progress-fill h-full rounded-full bg-blue-500 transition-all"
          style={{ width: `${progress.timePct}%` }}
        />
      </div>
    </div>
  );
}

function WenDivider() {
  return (
    <div
      className="wen-divider relative z-[1] -my-1.5 flex items-center justify-center py-1"
      role="separator"
      aria-label="文老师课程进度"
    >
      <div className="wen-divider-line absolute inset-x-4 top-1/2 border-t border-dashed border-slate-300/90" />
      <span className="wen-divider-label relative bg-white px-2 text-[10px] font-medium text-slate-500">
        文老师
      </span>
    </div>
  );
}

function CatalogSectionBlock({
  id,
  title,
  lessons,
  expanded,
  onToggle,
  lessonTags,
  onPlay,
  onTextbook,
  onTricolorNotes,
  onQuiz,
}: {
  id: string;
  title: string;
  lessons: CatalogLesson[];
  expanded: boolean;
  onToggle: (id: string) => void;
  lessonTags: LessonTagState;
  onPlay: (lesson: CatalogLesson) => void;
  onTextbook: (lesson: CatalogLesson) => void;
  onTricolorNotes: (lesson: CatalogLesson) => void;
  onQuiz: (lesson: CatalogLesson) => void;
}) {
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={expanded}
        className="catalog-section-header sticky top-0 z-10 flex w-full items-center rounded-lg bg-white px-3 py-1.5 text-left transition hover:bg-slate-50"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <ChevronIcon expanded={expanded} />
          <span className="truncate text-[11px] font-medium text-slate-600">{title}</span>
          <span className="shrink-0 text-[10px] text-slate-400">{lessons.length} 节</span>
        </span>
      </button>
      {expanded && (
        <div className="space-y-1.5">
          {lessons.length === 0 ? (
            <div className="lesson-card rounded-xl border border-dashed border-slate-200/80 bg-white px-3 py-3 text-center text-[11px] leading-5 text-slate-400">
              {id === "live"
                ? "暂无已下载的录屏 · 放入「03：直播课（陆续更新上传）」后刷新"
                : "暂无课节"}
            </div>
          ) : (
            lessons.map((lesson, index) => {
              const isWen = lessonTags.wenLessonNos.has(lesson.no);
              const prevWen =
                index > 0 && lessonTags.wenLessonNos.has(lessons[index - 1]!.no);
              return (
                <Fragment key={lesson.no}>
                  {isWen && !prevWen && <WenDivider />}
                  <LessonRow
                    lesson={lesson}
                    isExecution={lessonTags.executionLessonNos.has(lesson.no)}
                    executionLabel={lessonTags.executionLabel}
                    onPlay={onPlay}
                    onTextbook={onTextbook}
                    onTricolorNotes={onTricolorNotes}
                    onQuiz={onQuiz}
                  />
                </Fragment>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

const headerBtn =
  "panel-header-btn flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-700";

function LessonRow({
  lesson,
  isExecution,
  executionLabel,
  onPlay,
  onTextbook,
  onTricolorNotes,
  onQuiz,
}: {
  lesson: CatalogLesson;
  isExecution: boolean;
  executionLabel: "今天" | "本周" | null;
  onPlay: (lesson: CatalogLesson) => void;
  onTextbook: (lesson: CatalogLesson) => void;
  onTricolorNotes: (lesson: CatalogLesson) => void;
  onQuiz: (lesson: CatalogLesson) => void;
}) {
  const pct = progressPercent(lesson.position, lesson.duration, lesson.completed);
  const quizTip = quizTooltip(lesson.title, lesson.quizDone ?? false);
  const showStudyExtras = lesson.category !== "special" && lesson.category !== "live";

  return (
    <div
      data-lesson-no={lesson.no}
      className={`lesson-card relative rounded-xl border px-3 py-2.5 transition ${
        isExecution ? "lesson-card--week border-blue-200/80 bg-blue-50/30" : "border-slate-200/80 bg-white"
      } ${lesson.completed ? "opacity-75" : ""} ${lesson.missing ? "opacity-45" : ""}`}
    >
      {isExecution && (
        <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-blue-500" />
      )}
      <div className="flex items-center gap-2">
        <span className="w-7 shrink-0 text-[11px] font-medium text-slate-400">
          {lessonNoLabel(lesson.no, lesson.category)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {isExecution && executionLabel && (
              <span className="woven-badge-week shrink-0 rounded bg-blue-100 px-1 py-0.5 text-[9px] font-medium text-blue-600">
                {executionLabel}
              </span>
            )}
            <div className="truncate text-[12px] font-medium leading-5 text-slate-800">
              {lesson.title}
            </div>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="woven-progress-track h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className="woven-progress-fill h-full rounded-full bg-blue-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="shrink-0 text-[10px] text-slate-400">
              {formatProgress(lesson.position, lesson.duration, lesson.completed)}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {showStudyExtras && (
            <>
              <Tooltip label={quizTip.label} detail={quizTip.detail}>
                <button
                  type="button"
                  onClick={() => onQuiz(lesson)}
                  className={`woven-btn-tag flex h-8 w-8 items-center justify-center rounded-full border text-[10px] font-medium ${
                    lesson.quizDone
                      ? "border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600"
                      : "border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                  }`}
                >
                  {lesson.quizDone ? "题✓" : "题"}
                </button>
              </Tooltip>
              <BookTooltip
                lessonTitle={lesson.title}
                textbookPage={lesson.textbookPage}
                onTextbook={() => onTextbook(lesson)}
                onTricolorNotes={() => onTricolorNotes(lesson)}
              />
            </>
          )}
          <Tooltip label="播放课程">
            <button
              type="button"
              disabled={lesson.missing}
              onClick={() => onPlay(lesson)}
              className="woven-btn-play flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 text-white shadow-sm hover:bg-blue-600 disabled:bg-slate-300"
            >
              <PlayIcon />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

async function loadCatalog(): Promise<CatalogLesson[]> {
  const [plan, progress, textbook, liveLessons] = await Promise.all([
    loadPlan() as Promise<PlanFile>,
    getProgress(),
    loadTextbook() as Promise<TextbookFile>,
    getLiveCatalog().catch(() => []),
  ]);

  const fromPlan = Object.values(plan.lessons)
    .sort((a, b) => a.no - b.no)
    .map((lesson) => {
      const chapterKey = quizChapterKey(lesson.title);
      const saved = progress.videos[String(lesson.no)];
      const page = textbook.lessons[String(lesson.no)]?.page;
      return {
        no: lesson.no,
        title: lesson.title,
        category: lesson.category,
        missing: lesson.missing,
        position: saved?.position ?? 0,
        duration: saved?.duration || lesson.durationSec || 0,
        completed: saved?.completed ?? false,
        textbookPage: page,
        quizChapterKey: chapterKey,
        quizDone: progress.quiz_done?.[chapterKey] ?? false,
      };
    });

  const live = liveLessons.map((lesson) => {
    const saved = progress.videos[String(lesson.no)];
    return {
      no: lesson.no,
      title: lesson.title,
      category: "live" as const,
      missing: lesson.missing,
      position: saved?.position ?? 0,
      duration: saved?.duration ?? 0,
      completed: saved?.completed ?? false,
    };
  });

  return [...fromPlan, ...live];
}

async function loadPanelMeta(snapshot: TodaySnapshot) {
  const [plan, planWen, progress] = await Promise.all([
    loadPlan("default") as Promise<PlanFile>,
    loadPlan("wen") as Promise<PlanFile>,
    getProgress(),
  ]);
  const dailyHours = readDailyStudyHours();
  const contract = getTodayPaceContract(plan, progress.videos, snapshot.date, dailyHours);
  syncPaceTodayLock(snapshot.date, dailyHours, contract).catch(() => undefined);
  const stageCard = getStageCard(plan, planWen, progress.videos, snapshot.date);
  return {
    tags: computeLessonTags(plan, planWen, progress.videos, snapshot.date, dailyHours),
    stageText: formatStageMarquee(stageCard),
    todayText: formatTodayMarquee(plan, progress.videos, snapshot.date, dailyHours),
    wenText: formatWenTodayMarquee(planWen, snapshot.date),
    benchmark: getWenBenchmark(planWen, snapshot.date),
    todayProgress: computeTodayPlanProgress(
      plan,
      progress.videos,
      snapshot.date,
      dailyHours,
    ),
    showTodayBar: stageCard.kind === "recording" && stageCard.phase.includes("阶段一"),
  };
}

export default function TodayPanel() {
  const [snapshot, setSnapshot] = useState<TodaySnapshot | null>(null);
  const [catalog, setCatalog] = useState<CatalogLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickingTextbook, setPickingTextbook] = useState(false);
  const [pickingTricolorNotes, setPickingTricolorNotes] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [eyeRestOn, setEyeRestOn] = useState(isEyeRestEnabled);
  const [quizName, setQuizName] = useState("郑房新一点通");
  const [pinned, setPinned] = useState(true);
  const [wovenStyle, setWovenStyleOn] = useState(false);
  const [floatingSubtitles, setFloatingSubtitlesOn] = useState(true);
  const [subtitleCatMode, setSubtitleCatModeOn] = useState(true);
  const [launchAtLogin, setLaunchAtLoginOn] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState(loadExpandedSections);
  const [lessonTags, setLessonTags] = useState<LessonTagState>({
    wenLessonNos: new Set(),
    executionLessonNos: new Set(),
    executionLabel: null,
  });
  const [wenBenchmark, setWenBenchmark] = useState<WenBenchmark | null>(null);
  const [todayProgress, setTodayProgress] = useState<TodayPlanProgress | null>(null);
  const [showTodayBar, setShowTodayBar] = useState(false);
  const [stageText, setStageText] = useState("—");
  const [todayMarquee, setTodayMarquee] = useState("—");
  const [wenMarquee, setWenMarquee] = useState("—");
  const menuRef = useRef<HTMLDivElement>(null);
  const panelScrollRef = useRef<HTMLDivElement>(null);
  const initialScrollDoneRef = useRef(false);

  const toggleSection = useCallback((id: string) => {
    setExpandedSections((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem(SECTION_EXPAND_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    const container = panelScrollRef.current;
    const savedScrollY = silent && container ? container.scrollTop : null;

    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await getTodaySnapshot();
      setSnapshot(data);
      if (data.rootConfigured) {
        setCatalog(await loadCatalog());
      } else {
        setCatalog([]);
      }
      try {
        const meta = await loadPanelMeta(data);
        setWenBenchmark(meta.benchmark);
        setStageText(meta.stageText);
        setTodayMarquee(meta.todayText);
        setWenMarquee(meta.wenText);
        setTodayProgress(meta.todayProgress);
        setShowTodayBar(meta.showTodayBar);
        setLessonTags(meta.tags);
      } catch {
        setWenBenchmark(null);
        setStageText("—");
        setTodayMarquee("—");
        setWenMarquee("—");
        setLessonTags({
          wenLessonNos: new Set(),
          executionLessonNos: new Set(),
          executionLabel: null,
        });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      if (!silent) {
        setLoading(false);
      } else if (savedScrollY != null && panelScrollRef.current) {
        requestAnimationFrame(() => {
          if (panelScrollRef.current) {
            panelScrollRef.current.scrollTop = savedScrollY;
          }
        });
      }
    }
  }, []);

  const handlePickRoot = useCallback(async () => {
    if (picking || pickingTextbook || pickingTricolorNotes) return;
    setPicking(true);
    setMenuOpen(false);
    setError(null);
    try {
      await pickRootDir();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setPicking(false);
    }
  }, [picking, pickingTextbook, pickingTricolorNotes, refresh]);

  const handlePickTextbook = useCallback(async () => {
    if (picking || pickingTextbook || pickingTricolorNotes) return;
    setPickingTextbook(true);
    setMenuOpen(false);
    setError(null);
    try {
      await pickTextbook(snapshot?.rootPath);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setPickingTextbook(false);
    }
  }, [picking, pickingTextbook, pickingTricolorNotes, refresh, snapshot?.rootPath]);

  const handlePickTricolorNotes = useCallback(async () => {
    if (picking || pickingTextbook || pickingTricolorNotes) return;
    setPickingTricolorNotes(true);
    setMenuOpen(false);
    setError(null);
    try {
      await pickTricolorNotes(snapshot?.rootPath);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setPickingTricolorNotes(false);
    }
  }, [picking, pickingTextbook, pickingTricolorNotes, refresh, snapshot?.rootPath]);

  useEffect(() => {
    refresh();
    loadQuiz()
      .then((q) => setQuizName(q.name || "郑房新一点通"))
      .catch(() => undefined);
    getPanelPinned()
      .then(setPinned)
      .catch(() => undefined);
    getSettings()
      .then((s) => {
        setWovenStyleOn(s.wovenStyle ?? false);
        setFloatingSubtitlesOn(s.floatingSubtitles ?? true);
        setSubtitleCatModeOn(s.subtitleCatMode ?? true);
        setLaunchAtLoginOn(s.launchAtLogin ?? false);
      })
      .catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    const unlistenPromise = listen<{
      lessonNo: number;
      position: number;
      duration: number;
    }>("video-progress-updated", (event) => {
      const { lessonNo, position, duration } = event.payload;
      setCatalog((prev) =>
        prev.map((lesson) => {
          if (lesson.no !== lessonNo) return lesson;
          // 实时事件也可能乱序到达，面板显示进度不允许回退
          const nextPosition = Math.max(lesson.position, position);
          return {
            ...lesson,
            position: nextPosition,
            duration: duration || lesson.duration,
            completed:
              lesson.completed ||
              (duration > 0 && nextPosition / duration >= 0.9),
          };
        }),
      );
      // 不在此从磁盘重拉 todayProgress：磁盘可能滞后，会把实时 24min 打回 8min
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    const onFocus = () => {
      refresh({ silent: true });
    };
    window.addEventListener("focus", onFocus);
    const win = getCurrentWindow();
    const unlistenPromise = win.onFocusChanged(({ payload: focused }) => {
      if (focused) refresh({ silent: true });
    });
    return () => {
      window.removeEventListener("focus", onFocus);
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [refresh]);

  const todayLessonNosKey = [...lessonTags.executionLessonNos].sort((a, b) => a - b).join(",");

  useEffect(() => {
    const container = panelScrollRef.current;
    if (!container) return;

    let timer: number | undefined;
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        localStorage.setItem(PANEL_SCROLL_KEY, String(container.scrollTop));
      }, 200);
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      window.clearTimeout(timer);
    };
  }, [loading]);

  useEffect(() => {
    if (loading || initialScrollDoneRef.current || !snapshot?.date || catalog.length === 0) {
      return;
    }

    const container = panelScrollRef.current;
    if (!container) return;

    const hasToday = lessonTags.executionLessonNos.size > 0;

    if (!hasToday) {
      initialScrollDoneRef.current = true;
      const saved = localStorage.getItem(PANEL_SCROLL_KEY);
      if (saved) {
        const y = Number(saved);
        if (!Number.isNaN(y)) {
          container.scrollTop = y;
        }
      }
      return;
    }

    const firstTodayNo = catalog.find((l) =>
      lessonTags.executionLessonNos.has(l.no),
    )?.no;
    if (firstTodayNo == null) {
      initialScrollDoneRef.current = true;
      return;
    }

    const section = catalogSections(catalog).find((s) =>
      s.lessons.some((l) => l.no === firstTodayNo),
    );
    if (section) {
      setExpandedSections((prev) => ({ ...prev, [section.id]: true }));
    }

    const timer = window.setTimeout(() => {
      const el = container.querySelector(`[data-lesson-no="${firstTodayNo}"]`);
      if (el) scrollLessonToTop(container, el);
      initialScrollDoneRef.current = true;
    }, 200);

    return () => window.clearTimeout(timer);
  }, [loading, snapshot?.date, catalog, todayLessonNosKey, lessonTags.executionLessonNos]);

  useEffect(() => {
    document.documentElement.classList.add("panel-view");
    return () => document.documentElement.classList.remove("panel-view");
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("theme-woven", wovenStyle);
  }, [wovenStyle]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!snapshot) return;
    const refreshMeta = () => {
      loadPanelMeta(snapshot)
        .then((meta) => {
          setLessonTags(meta.tags);
          setStageText(meta.stageText);
          setTodayMarquee(meta.todayText);
          setWenMarquee(meta.wenText);
          setTodayProgress(meta.todayProgress);
          setShowTodayBar(meta.showTodayBar);
        })
        .catch(() => undefined);
    };
    window.addEventListener(PLAN_VIEW_EVENT, refreshMeta);
    window.addEventListener(PACE_CHANGED_EVENT, refreshMeta);
    return () => {
      window.removeEventListener(PLAN_VIEW_EVENT, refreshMeta);
      window.removeEventListener(PACE_CHANGED_EVENT, refreshMeta);
    };
  }, [snapshot]);

  const handlePlay = async (lesson: CatalogLesson) => {
    if (lesson.missing) return;
    if (!snapshot?.rootConfigured) {
      await handlePickRoot();
      return;
    }
    setError(null);
    try {
      await openPlayer(lesson.no);
    } catch {
      try {
        await openExternalVideo(lesson.no);
      } catch (e) {
        setError(String(e));
      }
    }
  };

  const handleTextbook = async (lesson: CatalogLesson) => {
    setError(null);
    try {
      await openTextbook(lesson.no);
    } catch (e) {
      const msg = String(e);
      if (msg.includes("请先选择")) {
        await handlePickTextbook();
        try {
          await openTextbook(lesson.no);
        } catch (retryErr) {
          setError(String(retryErr));
        }
        return;
      }
      setError(msg);
    }
  };

  const handleTricolorNotes = async (lesson: CatalogLesson) => {
    setError(null);
    try {
      await openTricolorNotes(lesson.no);
    } catch (e) {
      const msg = String(e);
      if (msg.includes("请先选择三色笔记文件夹")) {
        await handlePickTricolorNotes();
        try {
          await openTricolorNotes(lesson.no);
        } catch (retryErr) {
          setError(String(retryErr));
        }
        return;
      }
      setError(msg);
    }
  };

  const handleQuiz = async (lesson: CatalogLesson) => {
    setError(null);
    try {
      const { chapterKey, done } = await toggleQuizDone(lesson.no);
      setCatalog((prev) =>
        prev.map((item) =>
          item.quizChapterKey === chapterKey ? { ...item, quizDone: done } : item,
        ),
      );
    } catch (e) {
      setError(String(e));
    }
  };

  const togglePin = async () => {
    const next = !pinned;
    try {
      await setPanelPinned(next);
      setPinned(next);
    } catch (e) {
      setError(String(e));
    }
  };

  const toggleLaunchAtLogin = async () => {
    const next = !launchAtLogin;
    try {
      await setLaunchAtLogin(next);
      setLaunchAtLoginOn(next);
    } catch (e) {
      setError(String(e));
    }
  };

  const toggleWovenStyle = async () => {
    const next = !wovenStyle;
    try {
      await setWovenStyle(next);
      setWovenStyleOn(next);
    } catch (e) {
      setError(String(e));
    }
  };

  const toggleFloatingSubtitles = async () => {
    const next = !floatingSubtitles;
    try {
      await setFloatingSubtitles(next);
      setFloatingSubtitlesOn(next);
    } catch (e) {
      setError(String(e));
    }
  };

  const toggleSubtitleCatMode = async () => {
    const next = !subtitleCatMode;
    try {
      await setSubtitleCatMode(next);
      setSubtitleCatModeOn(next);
    } catch (e) {
      setError(String(e));
    }
  };

  const headerWeekLabel = wenBenchmark?.weekLabel ?? snapshot?.weekLabel;

  const playableCount = catalog.filter((l) => !l.missing).length;

  return (
    <div className={`panel-shell relative h-full overflow-hidden rounded-2xl${wovenStyle ? " theme-woven" : ""}`}>
      <HelpGuide
        open={guideOpen}
        quizName={quizName}
        onClose={() => setGuideOpen(false)}
      />
      <StudyPlanSheet
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        daysToExam={snapshot?.daysToExam}
      />
      <div className="flex h-full flex-col p-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div
            className="min-w-0 flex-1 cursor-grab active:cursor-grabbing"
            onMouseDown={startDrag}
          >
            <div className="text-[15px] font-semibold text-slate-900">
              今日任务
              {(snapshot?.todayPending ?? 0) > 0 && (
                <span className="woven-badge-count ml-1.5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {snapshot?.todayPending}
                </span>
              )}
            </div>
            {snapshot && (
              <div className="mt-1 text-xs text-slate-500">
                {formatDate(snapshot.date)} · {headerWeekLabel}
                {snapshot.rootConfigured && catalog.length > 0
                  ? ` · ${playableCount}/${catalog.length} 节`
                  : ""}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip label={pinned ? "已固定 · 失焦不隐藏" : "固定窗口 · 失焦不隐藏"}>
              <button
                type="button"
                onClick={togglePin}
                aria-label={pinned ? "取消固定" : "固定窗口"}
                aria-pressed={pinned}
                className={`${headerBtn} ${pinned ? "bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-700" : ""}`}
              >
                <PinIcon pinned={pinned} />
              </button>
            </Tooltip>
            <Tooltip label="学习计划表">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setPlanOpen(true);
                }}
                aria-label="学习计划表"
                aria-pressed={planOpen}
                className={`${headerBtn} ${planOpen ? "bg-slate-100 text-slate-700" : ""}`}
              >
                <CalendarIcon />
              </button>
            </Tooltip>
            <div className="relative" ref={menuRef}>
              {menuOpen ? (
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  aria-label="设置"
                  aria-expanded
                  className={`${headerBtn} bg-slate-100 text-slate-700`}
                >
                  <GearIcon />
                </button>
              ) : (
                <Tooltip label="设置">
                  <button
                    type="button"
                    onClick={() => setMenuOpen(true)}
                    aria-label="设置"
                    className={headerBtn}
                  >
                    <GearIcon />
                  </button>
                </Tooltip>
              )}
            {menuOpen && (
              <div className="settings-menu absolute right-0 top-full z-20 mt-1 min-w-[168px] overflow-hidden rounded-xl border border-slate-200/80 bg-white py-1 shadow-lg">
                <button
                  type="button"
                  disabled={picking || pickingTextbook || pickingTricolorNotes}
                  onClick={handlePickRoot}
                  className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {picking ? "选择中" : "选择资料目录"}
                </button>
                <button
                  type="button"
                  disabled={picking || pickingTextbook || pickingTricolorNotes}
                  onClick={handlePickTextbook}
                  className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {pickingTextbook ? "选择中" : "选择教材 PDF"}
                </button>
                <button
                  type="button"
                  disabled={picking || pickingTextbook || pickingTricolorNotes}
                  onClick={handlePickTricolorNotes}
                  className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {pickingTricolorNotes ? "选择中" : "选择三色笔记文件夹"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = !eyeRestOn;
                    setEyeRestOn(next);
                    setEyeRestEnabled(next);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  {eyeRestOn ? "✓ 护眼（看视频时）" : "护眼（看视频时）"}
                </button>
                <button
                  type="button"
                  onClick={toggleFloatingSubtitles}
                  className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  {floatingSubtitles ? "✓ 桌面悬浮字幕" : "桌面悬浮字幕"}
                </button>
                <button
                  type="button"
                  onClick={toggleSubtitleCatMode}
                  disabled={!floatingSubtitles}
                  className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  {subtitleCatMode ? "✓ 猫猫模式" : "猫猫模式"}
                </button>
                <button
                  type="button"
                  onClick={toggleWovenStyle}
                  className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  {wovenStyle ? "✓ 织物质感" : "织物质感"}
                </button>
                <button
                  type="button"
                  onClick={toggleLaunchAtLogin}
                  className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  {launchAtLogin ? "✓ 开机自启动" : "开机自启动"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setGuideOpen(true);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  使用说明
                </button>
                <div className="my-1 border-t border-slate-100" />
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    quitApp().catch(() => undefined);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"
                >
                  退出
                </button>
              </div>
            )}
            </div>
          </div>
        </div>

        {snapshot && (
          <div className="mb-3">
            {showTodayBar && todayProgress && <TodayProgressBar progress={todayProgress} />}
            <ProgressHintMarquee
              stageText={stageText}
              todayText={todayMarquee}
              wenText={wenMarquee}
            />
          </div>
        )}

        {!snapshot?.rootConfigured && (
          <div className="mb-3">
            <button
              type="button"
              disabled={picking}
              onClick={handlePickRoot}
              className="w-full rounded-xl border border-dashed border-slate-300 py-3 text-sm text-slate-600 hover:border-blue-300 hover:text-blue-600 disabled:opacity-60"
            >
              {picking ? "选择中" : "选择资料目录（Desktop/系规）"}
            </button>
          </div>
        )}

        <div
          ref={panelScrollRef}
          className="panel-scroll min-h-0 flex-1 space-y-1.5 overflow-x-hidden overflow-y-auto pr-1"
        >
          {loading && <div className="text-sm text-slate-500">加载中…</div>}
          {error && (
            <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">
              {error}
            </div>
          )}
          {!loading &&
            snapshot?.rootConfigured &&
            catalogSections(catalog).map((section) => (
              <CatalogSectionBlock
                key={section.id}
                id={section.id}
                title={section.title}
                lessons={section.lessons}
                expanded={expandedSections[section.id] ?? true}
                onToggle={toggleSection}
                lessonTags={lessonTags}
                onPlay={handlePlay}
                onTextbook={handleTextbook}
                onTricolorNotes={handleTricolorNotes}
                onQuiz={handleQuiz}
              />
            ))}
        </div>

        {snapshot && (
          <div className="mt-3 border-t border-slate-100 pt-3 text-center text-xs text-slate-400">
            距考试 {snapshot.daysToExam} 天
          </div>
        )}
      </div>
    </div>
  );
}
