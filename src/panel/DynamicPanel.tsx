import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  getCatalog,
  getPanelPinned,
  getSettings,
  openExternalVideo,
  openPlayer,
  pickRootDir,
  quitApp,
  setPanelPinned,
  setWovenStyle,
} from "../lib/api";
import type { CatalogSnapshot, CatalogSection, CatalogVideo } from "../lib/types";
import { isEyeRestEnabled, setEyeRestEnabled } from "../lib/eyeRest";
import Tooltip from "../components/Tooltip";

function formatDuration(seconds: number) {
  if (seconds <= 0) return "—";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  if (m > 0) return `${m} 分钟`;
  return `${total % 60} 秒`;
}

function videoTotalSeconds(video: CatalogVideo) {
  return video.duration > 0 ? video.duration : video.durationSec;
}

function formatProgress(video: CatalogVideo) {
  const total = videoTotalSeconds(video);
  if (video.completed) return "已完成";
  if (!video.position) {
    return formatDuration(total);
  }
  const watched = Math.floor(video.position / 60);
  const totalMin = total > 0 ? Math.floor(total / 60) : 0;
  if (totalMin > 0) {
    return `已看 ${watched}/${totalMin} 分钟`;
  }
  return `已看 ${formatDuration(video.position)}`;
}

function progressPercent(video: CatalogVideo) {
  if (video.completed) return 100;
  const total = videoTotalSeconds(video);
  if (!total) return 0;
  return Math.min(100, Math.round((video.position / total) * 100));
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

const headerBtn =
  "panel-header-btn flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-700";

const SECTION_EXPAND_KEY = "xigui-dynamic-sections";

function loadExpandedSections(sectionIds: string[]) {
  const defaults = Object.fromEntries(sectionIds.map((id) => [id, true]));
  try {
    const raw = localStorage.getItem(SECTION_EXPAND_KEY);
    if (raw) return { ...defaults, ...(JSON.parse(raw) as Record<string, boolean>) };
  } catch {
    /* ignore */
  }
  return defaults;
}

function VideoRow({
  video,
  onPlay,
}: {
  video: CatalogVideo;
  onPlay: (video: CatalogVideo) => void;
}) {
  const pct = progressPercent(video);

  return (
    <div
      className={`lesson-card relative rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 transition ${
        video.completed ? "opacity-75" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-[12px] font-medium leading-5 text-slate-800"
            title={video.title}
          >
            {video.title}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-slate-400" title={video.filename}>
            {video.filename}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="woven-progress-track h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className="woven-progress-fill h-full rounded-full bg-blue-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="shrink-0 tabular-nums text-[10px] text-slate-400">
              {formatProgress(video)}
            </span>
          </div>
        </div>
        <Tooltip label={video.builtinPlayable ? "播放" : "用系统播放器打开"}>
          <button
            type="button"
            onClick={() => onPlay(video)}
            className="woven-btn-play flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 text-white shadow-sm hover:bg-blue-600"
          >
            <PlayIcon />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function SectionBlock({
  section,
  expanded,
  onToggle,
  onPlay,
}: {
  section: CatalogSection;
  expanded: boolean;
  onToggle: (id: string) => void;
  onPlay: (video: CatalogVideo) => void;
}) {
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => onToggle(section.id)}
        aria-expanded={expanded}
        className="catalog-section-header sticky top-0 z-10 flex w-full items-center justify-between rounded-lg bg-white px-2 py-1.5 text-left transition hover:bg-slate-50"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <ChevronIcon expanded={expanded} />
          <span
            className="truncate text-[11px] font-medium text-slate-600"
            title={section.title}
          >
            {section.title}
          </span>
          <span className="shrink-0 text-[10px] text-slate-400">
            {section.videos.length} 个
          </span>
        </span>
      </button>
      {expanded && (
        <div className="space-y-1.5">
          {section.videos.map((video) => (
            <VideoRow key={video.id} video={video} onPlay={onPlay} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DynamicPanel() {
  const [catalog, setCatalog] = useState<CatalogSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [eyeRestOn, setEyeRestOn] = useState(isEyeRestEnabled);
  const [pinned, setPinned] = useState(true);
  const [wovenStyle, setWovenStyleOn] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const menuRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCatalog();
      setCatalog(data);
      setExpandedSections((prev) => {
        const ids = data.sections.map((s) => s.id);
        const merged = loadExpandedSections(ids);
        return { ...merged, ...prev };
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const handlePickRoot = useCallback(async () => {
    if (picking) return;
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
  }, [picking, refresh]);

  useEffect(() => {
    refresh();
    getPanelPinned()
      .then(setPinned)
      .catch(() => undefined);
    getSettings()
      .then((s) => setWovenStyleOn(s.wovenStyle ?? false))
      .catch(() => undefined);
  }, [refresh]);

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

  const toggleSection = useCallback((id: string) => {
    setExpandedSections((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem(SECTION_EXPAND_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const handlePlay = async (video: CatalogVideo) => {
    setError(null);
    if (!catalog?.rootConfigured) {
      await handlePickRoot();
      return;
    }
    try {
      if (!video.builtinPlayable) {
        await openExternalVideo(video.id);
        return;
      }
      await openPlayer(video.id, video.title);
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

  const toggleWovenStyle = async () => {
    const next = !wovenStyle;
    try {
      await setWovenStyle(next);
      setWovenStyleOn(next);
    } catch (e) {
      setError(String(e));
    }
  };

  const pending = catalog
    ? catalog.videoCount - catalog.completedCount
    : 0;
  const progressPct =
    catalog && catalog.videoCount
      ? Math.round((catalog.completedCount / catalog.videoCount) * 100)
      : 0;

  return (
    <div
      className={`panel-shell relative h-full overflow-hidden rounded-2xl${wovenStyle ? " theme-woven" : ""}`}
    >
      <div className="flex h-full flex-col p-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div
            className="min-w-0 flex-1 cursor-grab active:cursor-grabbing"
            onMouseDown={startDrag}
          >
            <div className="text-[15px] font-semibold text-slate-900">
              资料库
              {pending > 0 && (
                <span className="woven-badge-count ml-1.5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {pending}
                </span>
              )}
            </div>
            {catalog?.rootConfigured && (
              <div className="mt-1 text-xs text-slate-500">
                {catalog.completedCount}/{catalog.videoCount} 已看完 · 动态扫描
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
                <div className="settings-menu absolute right-0 top-full z-20 mt-1 min-w-[168px] overflow-hidden rounded-xl border border-slate-200/80 bg-white py-1 shadow-lg">
                  <button
                    type="button"
                    disabled={picking}
                    onClick={handlePickRoot}
                    className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {picking ? "选择中…" : "选择资料目录"}
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      setMenuOpen(false);
                      refresh();
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    重新扫描
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
                    onClick={toggleWovenStyle}
                    className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    {wovenStyle ? "✓ 织物质感" : "织物质感"}
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

        {catalog?.rootConfigured && catalog.videoCount > 0 && (
          <div className="mb-3">
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span>
                进度 {catalog.completedCount}/{catalog.videoCount}
              </span>
              <span>{progressPct}%</span>
            </div>
            <div className="woven-progress-track h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="woven-progress-fill h-full rounded-full bg-blue-500 transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {!catalog?.rootConfigured && (
          <div className="mb-3">
            <button
              type="button"
              disabled={picking}
              onClick={handlePickRoot}
              className="w-full rounded-xl border border-dashed border-slate-300 py-3 text-sm text-slate-600 hover:border-blue-300 hover:text-blue-600 disabled:opacity-60"
            >
              {picking ? "选择中…" : "选择资料目录开始扫描"}
            </button>
          </div>
        )}

        <div className="panel-scroll min-h-0 flex-1 space-y-1.5 overflow-x-hidden overflow-y-auto pr-1">
          {loading && <div className="text-sm text-slate-500">扫描中…</div>}
          {error && (
            <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">
              {error}
            </div>
          )}
          {!loading && catalog?.rootConfigured && catalog.sections.length === 0 && (
            <div className="text-sm text-slate-500">未找到视频文件（mp4 / mkv 等）</div>
          )}
          {!loading &&
            catalog?.sections.map((section) => (
              <SectionBlock
                key={section.id}
                section={section}
                expanded={expandedSections[section.id] ?? true}
                onToggle={toggleSection}
                onPlay={handlePlay}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
