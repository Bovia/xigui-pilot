import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  getProgress,
  getPanelPinned,
  getTodaySnapshot,
  loadPlan,
  loadQuiz,
  loadTextbook,
  openExternalVideo,
  openPlayer,
  openQuiz,
  openTextbook,
  pickRootDir,
  pickTextbook,
  quitApp,
  setPanelPinned,
} from "../lib/api";
import type { CatalogLesson, PlanFile, TextbookFile, TodaySnapshot } from "../lib/types";
import {
  isEyeRestEnabled,
  setEyeRestEnabled,
  textbookTooltip,
} from "../lib/eyeRest";
import { quizTooltip } from "../lib/quiz";
import Tooltip from "../components/Tooltip";
import HelpGuide from "../components/HelpGuide";

function formatDate(date: string) {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function formatProgress(position: number, duration: number, completed: boolean) {
  if (completed) return "已完成";
  const totalMin = duration > 0 ? Math.floor(duration / 60) : 0;
  if (!position) {
    return totalMin > 0 ? `${totalMin} 分钟` : "—";
  }
  const watched = Math.floor(position / 60);
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

function lessonNoLabel(no: number, category?: string) {
  if (category === "special") {
    return `专${String(no - 900).padStart(2, "0")}`;
  }
  return String(no).padStart(2, "0");
}

function catalogSections(catalog: CatalogLesson[]) {
  const basic = catalog.filter((l) => l.category !== "special");
  const special = catalog.filter((l) => l.category === "special");
  const sections: { id: string; title: string; lessons: CatalogLesson[] }[] = [
    { id: "basic", title: "基础课", lessons: basic },
  ];
  if (special.length > 0) {
    sections.push({ id: "special", title: "案例·论文专题", lessons: special });
  }
  return sections;
}

const SECTION_EXPAND_KEY = "xigui-catalog-sections";

function loadExpandedSections(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SECTION_EXPAND_KEY);
    if (raw) return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    /* ignore */
  }
  return { basic: true, special: true };
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

function CatalogSectionBlock({
  id,
  title,
  lessons,
  expanded,
  onToggle,
  weekLessonSet,
  quizName,
  onPlay,
  onTextbook,
  onQuiz,
}: {
  id: string;
  title: string;
  lessons: CatalogLesson[];
  expanded: boolean;
  onToggle: (id: string) => void;
  weekLessonSet: Set<number>;
  quizName: string;
  onPlay: (lesson: CatalogLesson) => void;
  onTextbook: (lesson: CatalogLesson) => void;
  onQuiz: (lesson: CatalogLesson) => void;
}) {
  const weekCount = lessons.filter((l) => weekLessonSet.has(l.no)).length;

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={expanded}
        className="sticky top-0 z-10 flex w-full items-center justify-between rounded-lg bg-white/95 px-2 py-1.5 text-left backdrop-blur-sm transition hover:bg-slate-50"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <ChevronIcon expanded={expanded} />
          <span className="truncate text-[11px] font-medium text-slate-600">{title}</span>
          <span className="shrink-0 text-[10px] text-slate-400">{lessons.length} 节</span>
        </span>
        {weekCount > 0 && (
          <span className="ml-2 shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-medium text-blue-600">
            本周 {weekCount}
          </span>
        )}
      </button>
      {expanded && (
        <div className="space-y-1.5">
          {lessons.map((lesson) => (
            <LessonRow
              key={lesson.no}
              lesson={lesson}
              isThisWeek={weekLessonSet.has(lesson.no)}
              quizName={quizName}
              onPlay={onPlay}
              onTextbook={onTextbook}
              onQuiz={onQuiz}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const headerBtn =
  "flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-700";

function LessonRow({
  lesson,
  isThisWeek,
  quizName,
  onPlay,
  onTextbook,
  onQuiz,
}: {
  lesson: CatalogLesson;
  isThisWeek: boolean;
  quizName: string;
  onPlay: (lesson: CatalogLesson) => void;
  onTextbook: (lesson: CatalogLesson) => void;
  onQuiz: (lesson: CatalogLesson) => void;
}) {
  const pct = progressPercent(lesson.position, lesson.duration, lesson.completed);
  const quizTip = quizTooltip(lesson.title, quizName);
  const bookTip = textbookTooltip(lesson.textbookPage);

  return (
    <div
      className={`relative rounded-xl border px-3 py-2.5 transition ${
        isThisWeek ? "border-blue-200/80 bg-blue-50/30" : "border-slate-200/80 bg-white"
      } ${lesson.completed ? "opacity-75" : ""} ${lesson.missing ? "opacity-45" : ""}`}
    >
      {isThisWeek && (
        <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-blue-500" />
      )}
      <div className="flex items-center gap-2">
        <span className="w-7 shrink-0 text-[11px] font-medium text-slate-400">
          {lessonNoLabel(lesson.no, lesson.category)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {isThisWeek && (
              <span className="shrink-0 rounded bg-blue-100 px-1 py-0.5 text-[9px] font-medium text-blue-600">
                本周
              </span>
            )}
            <div className="truncate text-[12px] font-medium leading-5 text-slate-800">
              {lesson.title}
            </div>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-blue-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="shrink-0 text-[10px] text-slate-400">
              {formatProgress(lesson.position, lesson.duration, lesson.completed)}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Tooltip label={quizTip.label} detail={quizTip.detail}>
            <button
              type="button"
              onClick={() => onQuiz(lesson)}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-[10px] font-medium text-emerald-600 hover:bg-emerald-100"
            >
              题
            </button>
          </Tooltip>
          <Tooltip label={bookTip.label} detail={bookTip.detail}>
            <button
              type="button"
              onClick={() => onTextbook(lesson)}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-[10px] font-medium text-amber-700 hover:bg-amber-100"
            >
              书
            </button>
          </Tooltip>
          <Tooltip label="播放课程">
            <button
              type="button"
              disabled={lesson.missing}
              onClick={() => onPlay(lesson)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 text-white shadow-sm hover:bg-blue-600 disabled:bg-slate-300"
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
  const [plan, progress, textbook] = await Promise.all([
    loadPlan() as Promise<PlanFile>,
    getProgress(),
    loadTextbook() as Promise<TextbookFile>,
  ]);

  return Object.values(plan.lessons)
    .sort((a, b) => a.no - b.no)
    .map((lesson) => {
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
      };
    });
}

export default function TodayPanel() {
  const [snapshot, setSnapshot] = useState<TodaySnapshot | null>(null);
  const [catalog, setCatalog] = useState<CatalogLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickingTextbook, setPickingTextbook] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [eyeRestOn, setEyeRestOn] = useState(isEyeRestEnabled);
  const [quizName, setQuizName] = useState("郑房新一点通");
  const [pinned, setPinned] = useState(true);
  const [guideOpen, setGuideOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState(loadExpandedSections);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggleSection = useCallback((id: string) => {
    setExpandedSections((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem(SECTION_EXPAND_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getTodaySnapshot();
      setSnapshot(data);
      if (data.rootConfigured) {
        setCatalog(await loadCatalog());
      } else {
        setCatalog([]);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const handlePickRoot = useCallback(async () => {
    if (picking || pickingTextbook) return;
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
  }, [picking, pickingTextbook, refresh]);

  const handlePickTextbook = useCallback(async () => {
    if (picking || pickingTextbook) return;
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
  }, [picking, pickingTextbook, refresh, snapshot?.rootPath]);

  useEffect(() => {
    refresh();
    loadQuiz()
      .then((q) => setQuizName(q.name || "郑房新一点通"))
      .catch(() => undefined);
    getPanelPinned()
      .then(setPinned)
      .catch(() => undefined);
  }, [refresh]);

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

  const handleQuiz = async (lesson: CatalogLesson) => {
    setError(null);
    try {
      await openQuiz(lesson.no);
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

  const weekPct =
    snapshot && snapshot.weekTotal
      ? Math.round((snapshot.weekDone / snapshot.weekTotal) * 100)
      : 0;

  const playableCount = catalog.filter((l) => !l.missing).length;
  const weekLessonSet = new Set(snapshot?.weekLessonNos ?? []);

  return (
    <div className="panel-shell relative h-full overflow-hidden rounded-2xl">
      <HelpGuide
        open={guideOpen}
        quizName={quizName}
        onClose={() => setGuideOpen(false)}
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
                <span className="ml-1.5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {snapshot?.todayPending}
                </span>
              )}
            </div>
            {snapshot && (
              <div className="mt-1 text-xs text-slate-500">
                {formatDate(snapshot.date)} · {snapshot.weekLabel}
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
            <div className="relative" ref={menuRef}>
              <Tooltip label="设置">
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-label="设置"
                  className={`${headerBtn} ${menuOpen ? "bg-slate-100 text-slate-700" : ""}`}
                >
                  <GearIcon />
                </button>
              </Tooltip>
            {menuOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 min-w-[168px] overflow-hidden rounded-xl border border-slate-200/80 bg-white py-1 shadow-lg">
                <button
                  type="button"
                  disabled={picking || pickingTextbook}
                  onClick={handlePickRoot}
                  className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {picking ? "选择中…" : "选择资料目录"}
                </button>
                <button
                  type="button"
                  disabled={picking || pickingTextbook}
                  onClick={handlePickTextbook}
                  className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {pickingTextbook ? "选择中…" : "选择教材 PDF"}
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
                  {eyeRestOn ? "✓ 护眼提醒（20-20-20）" : "护眼提醒（20-20-20）"}
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
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span>
                本周 {snapshot.weekDone}/{snapshot.weekTotal}
              </span>
              <span>{weekPct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-blue-500 transition-all"
                style={{ width: `${weekPct}%` }}
              />
            </div>
            <div className="mt-2 text-xs leading-5 text-slate-500">
              {snapshot.focus}
            </div>
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
              {picking ? "选择中…" : "选择资料目录"}
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overflow-x-visible pr-0.5">
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
                weekLessonSet={weekLessonSet}
                quizName={quizName}
                onPlay={handlePlay}
                onTextbook={handleTextbook}
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
