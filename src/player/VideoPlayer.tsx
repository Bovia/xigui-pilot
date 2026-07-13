import Artplayer from "artplayer";
import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import EyeRestPrompt from "../components/EyeRestPrompt";
import PinIcon from "../components/PinIcon";
import {
  closeSubtitleWindow,
  getPlayerPinned,
  getSettings,
  loadPlan,
  openPlayer,
  openSubtitleWindow,
  resolveSubtitlePath,
  resolveVideoPath,
  saveVideoProgress,
  setPlayerChromeVisible,
  setPlayerPinned,
} from "../lib/api";
import { catalogLessonList } from "../lib/pacePlan";
import { isEyeRestEnabled, useEyeRestReminder } from "../lib/eyeRest";
import { bindPlayerWindowAspect } from "../lib/playerWindow";
import type { PlanFile, PlanLesson } from "../lib/types";

/** 鼠标在视频内时不自动隐藏；仅移出播放器时隐藏 */
const PLAYER_CONTROL_HIDE_MS = 999_999_999;

function showPlayerControls(art: Artplayer) {
  if (art.controls) {
    art.controls.show = true;
  }
}

function hidePlayerControls(art: Artplayer) {
  if (art.controls) {
    art.controls.show = false;
  }
}

function silencePlayer(artRef: React.MutableRefObject<Artplayer | null>) {
  const art = artRef.current;
  if (!art) return;
  try {
    art.muted = true;
    art.volume = 0;
    art.pause();
    const video = art.template?.$video as HTMLVideoElement | undefined;
    if (video) {
      video.muted = true;
      video.volume = 0;
      video.pause();
      // 立刻掐断解码/缓冲，避免 pause 后音频还拖尾
      try {
        video.srcObject = null;
      } catch {
        /* ignore */
      }
      video.removeAttribute("src");
      video.load();
    }
  } catch {
    /* ignore */
  }
}

function teardownPlayer(artRef: React.MutableRefObject<Artplayer | null>) {
  const art = artRef.current;
  if (!art) return;
  try {
    if (art.pip) {
      art.pip = false;
    }
    silencePlayer(artRef);
    art.destroy();
  } catch {
    // 窗口关闭过程中 DOM 可能已卸载
  }
  artRef.current = null;
}

/** 播放中节流落盘间隔 */
const PROGRESS_SAVE_MS = 1000;
/** 面板进度条 UI 刷新间隔（事件广播，不写盘） */
const PROGRESS_UI_EMIT_MS = 300;

function broadcastProgressUi(lessonNo: number, position: number, duration: number) {
  const payload = { lessonNo, position, duration };
  emit("video-progress-updated", payload).catch(() => undefined);
  emitTo("panel", "video-progress-updated", payload).catch(() => undefined);
}

function readVideoTime(art: Artplayer): number {
  const video = art.template?.$video as HTMLVideoElement | undefined;
  const t = video?.currentTime ?? art.currentTime ?? 0;
  return Number.isFinite(t) ? t : 0;
}

function formatPlaybackRate(rate: number): string {
  return rate === 1 ? "正常" : rate.toFixed(1);
}

/** 控制栏一级倍速选择（不走设置二级页） */
function buildPlaybackRateControl() {
  const rates = Artplayer.PLAYBACK_RATE;
  return {
    name: "playback-rate",
    position: "right" as const,
    index: 28,
    html: "正常",
    selector: rates.map((rate) => ({
      value: rate,
      default: rate === 1,
      html: formatPlaybackRate(rate),
    })),
    onSelect(this: Artplayer, item: { value?: string | number; html: string | HTMLElement }) {
      this.playbackRate = Number(item.value);
      return item.html;
    },
    mounted(this: Artplayer, element: HTMLElement) {
      const art = this;
      element.title = "倍速";
      element.classList.add("art-control-playback-rate");

      const syncLabel = () => {
        const label = formatPlaybackRate(art.playbackRate);
        const valueEl = element.querySelector(".art-selector-value");
        if (valueEl) valueEl.textContent = label;
      };

      syncLabel();
      art.on("video:ratechange", syncLabel);

      element.addEventListener("click", (event: MouseEvent) => {
        event.stopPropagation();
        element.classList.toggle("art-rate-open");
      });
      element.querySelector(".art-selector-list")?.addEventListener("click", () => {
        element.classList.remove("art-rate-open");
      });
      art.on("blur", () => element.classList.remove("art-rate-open"));
    },
  };
}

let nextLessonBusy = false;

async function goToNextLesson(currentNo: number) {
  if (nextLessonBusy) return;
  nextLessonBusy = true;
  try {
    const plan = (await loadPlan()) as PlanFile;
    const lessons = catalogLessonList(plan);
    const idx = lessons.findIndex((l) => l.lessonNo === currentNo);
    const next = lessons.slice(idx + 1).find((l) => !l.missing);
    if (!next) return;

    const lesson = plan.lessons[String(next.lessonNo)];
    if (lesson && !lesson.builtinPlayable) {
      await openPlayer(next.lessonNo);
      return;
    }

    try {
      await resolveVideoPath(next.lessonNo);
    } catch {
      return;
    }

    await openPlayer(next.lessonNo);
  } finally {
    nextLessonBusy = false;
  }
}

/** 控制栏「下一节」 */
function buildNextLessonControl(lessonNo: number) {
  return {
    name: "next-lesson",
    position: "left" as const,
    index: 15,
    html: '<span class="art-next-lesson-label">下一节</span>',
    click() {
      goToNextLesson(lessonNo).catch(() => undefined);
    },
    mounted(this: Artplayer, element: HTMLElement) {
      element.title = "播放下一节";
      element.classList.add("art-control-next-lesson");
    },
  };
}

export default function VideoPlayer({ lessonNo }: { lessonNo: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<Artplayer | null>(null);
  const lessonNoRef = useRef(lessonNo);
  const lastKnownRef = useRef({ position: 0, duration: 0 });
  const closingRef = useRef(false);
  const pushTimeUpdateRef = useRef<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subtitleHint, setSubtitleHint] = useState<string | null>(null);
  const [lessonTitle, setLessonTitle] = useState(`第 ${lessonNo} 节`);
  const [playing, setPlaying] = useState(false);
  const [pinned, setPinned] = useState(true);
  const pinnedRef = useRef(true);
  const chromeHideTimerRef = useRef<number | undefined>(undefined);
  const [chromeVisible, setChromeVisible] = useState(false);
  const [eyeRestEnabled] = useState(isEyeRestEnabled);
  const { phase, restLeft, startRest, snooze, dismissPrompt } = useEyeRestReminder(
    playing,
    eyeRestEnabled,
  );

  useEffect(() => {
    document.documentElement.classList.add("player-view");
    return () => document.documentElement.classList.remove("player-view");
  }, []);

  useEffect(() => {
    lessonNoRef.current = lessonNo;
  }, [lessonNo]);

  /** 关窗不落盘：同步掐声拆源 → 藏窗 → 销窗（不要先 await hide，否则声音会拖尾） */
  const closePlayerWindow = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    window.clearTimeout(chromeHideTimerRef.current);
    const win = getCurrentWindow();
    const no = lessonNoRef.current;
    try {
      pushTimeUpdateRef.current = null;
      // 必须同步完成：先停声拆源，再藏窗（藏窗后 teardown 黑帧用户看不见）
      silencePlayer(artRef);
      teardownPlayer(artRef);
      emit("player-playback", { lessonNo: no, playing: false }).catch(() => undefined);
      win.hide().catch(() => undefined);
      // 猫猫模式由 Rust 保留字幕窗；常规模式关窗时一并关掉
      getSettings()
        .then((s) => {
          if (!(s.subtitleCatMode ?? true)) {
            closeSubtitleWindow(no).catch(() => undefined);
          }
        })
        .catch(() => {
          closeSubtitleWindow(no).catch(() => undefined);
        });
      try {
        await win.destroy();
      } catch {
        await win.close().catch(() => undefined);
        closingRef.current = false;
      }
    } catch {
      closingRef.current = false;
    }
  }, []);

  // 原生红灯：不拦截；销毁前同步掐声
  useEffect(() => {
    const onPageHide = () => {
      pushTimeUpdateRef.current = null;
      silencePlayer(artRef);
      teardownPlayer(artRef);
    };

    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  useEffect(() => {
    getPlayerPinned()
      .then(setPinned)
      .catch(() => undefined);

    const unlistenPromise = listen<boolean>("player-pinned-changed", (event) => {
      setPinned(event.payload);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const startWindowDrag = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    getCurrentWindow().startDragging().catch(() => undefined);
  }, []);

  const togglePin = useCallback(async () => {
    const next = !pinned;
    try {
      await setPlayerPinned(next, lessonNo);
      setPinned(next);
    } catch {
      await getCurrentWindow().setAlwaysOnTop(next).catch(() => undefined);
      setPinned(next);
    }
  }, [lessonNo, pinned]);

  useEffect(() => {
    pinnedRef.current = pinned;
  }, [pinned]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const showChrome = () => {
      window.clearTimeout(chromeHideTimerRef.current);
      setChromeVisible(true);
      setPlayerChromeVisible(true).catch(() => undefined);
    };
    const hideChrome = () => {
      window.clearTimeout(chromeHideTimerRef.current);
      chromeHideTimerRef.current = window.setTimeout(() => {
        setChromeVisible(false);
        setPlayerChromeVisible(false).catch(() => undefined);
      }, 500);
    };

    shell.addEventListener("mouseenter", showChrome);
    shell.addEventListener("mouseleave", hideChrome);
    hideChrome();

    return () => {
      shell.removeEventListener("mouseenter", showChrome);
      shell.removeEventListener("mouseleave", hideChrome);
      window.clearTimeout(chromeHideTimerRef.current);
      setChromeVisible(false);
      setPlayerChromeVisible(false).catch(() => undefined);
    };
  }, []);

  const tryOpenSubtitle = useCallback(async () => {
    const no = lessonNoRef.current;
    const settings = await getSettings().catch(() => null);
    const catMode = settings?.subtitleCatMode ?? true;
    const floating = settings?.floatingSubtitles !== false;

    if (!catMode && !floating) return;

    const subtitle = await resolveSubtitlePath(no).catch(() => null);
    if (!catMode && !subtitle) {
      setSubtitleHint("未找到字幕文件：在与视频同目录放置同名 .srt 或 .vtt 后重新播放");
      return;
    }

    await openSubtitleWindow(no).catch(() => undefined);
    window.setTimeout(() => pushTimeUpdateRef.current?.(), 300);
    window.setTimeout(() => pushTimeUpdateRef.current?.(), 1000);
    if (floating && !subtitle) {
      setSubtitleHint("未找到字幕文件：在与视频同目录放置同名 .srt 或 .vtt 后重新播放");
    } else {
      setSubtitleHint(null);
    }
  }, []);

  useEffect(() => {
    const unlistenPromise = listen<number>("player-open", (event) => {
      if (event.payload === lessonNo) {
        tryOpenSubtitle().catch(() => undefined);
      }
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [lessonNo, tryOpenSubtitle]);

  useEffect(() => {
    let disposed = false;
    let saveTimer: number | undefined;
    let lastSaveAt = 0;
    let lastUiEmitAt = 0;
    let windowAspect: ReturnType<typeof bindPlayerWindowAspect> | undefined;

    async function boot() {
      if (!containerRef.current) return;
      setError(null);
      const bootLessonNo = lessonNo;

      try {
        const [plan, path] = await Promise.all([
          loadPlan() as Promise<PlanFile>,
          resolveVideoPath(bootLessonNo),
        ]);
        if (disposed || lessonNoRef.current !== bootLessonNo) return;

        const lesson: PlanLesson | undefined = plan.lessons[String(bootLessonNo)];
        const title = lesson?.title ?? `第 ${bootLessonNo} 节`;
        setLessonTitle(title);
        getCurrentWindow().setTitle(title).catch(() => undefined);

        if (lesson && !lesson.builtinPlayable) {
          setError("该视频格式需用系统播放器打开（如 mkv）");
          return;
        }

        const url = convertFileSrc(path);
        const saved = await fetchProgress(bootLessonNo);
        if (disposed || lessonNoRef.current !== bootLessonNo || !containerRef.current) {
          return;
        }

        lastKnownRef.current = {
          position: saved?.position ?? 0,
          duration: 0,
        };

        Artplayer.CONTROL_HIDE_TIME = PLAYER_CONTROL_HIDE_MS;
        artRef.current?.destroy();
        artRef.current = new Artplayer({
          container: containerRef.current,
          url,
          autoplay: true,
          autoSize: false,
          backdrop: true,
          playbackRate: false,
          setting: false,
          controls: [buildNextLessonControl(bootLessonNo), buildPlaybackRateControl()],
          fullscreen: true,
          pip: true,
          mutex: true,
          theme: "#3b82f6",
          lang: "zh-cn",
        });

        const win = getCurrentWindow();
        windowAspect = bindPlayerWindowAspect(win);

        const activeLesson = () =>
          !disposed && !closingRef.current && lessonNoRef.current === bootLessonNo;

        const syncWindowToVideo = () => {
          if (!activeLesson()) return;
          const art = artRef.current;
          if (!art) return;
          const { videoWidth, videoHeight } = art.template.$video;
          if (videoWidth <= 0 || videoHeight <= 0) return;
          windowAspect
            ?.applyVideoAspect(videoWidth, videoHeight)
            .catch(() => undefined);
        };

        const notePosition = (position: number, duration: number) => {
          if (!activeLesson()) return;
          lastKnownRef.current = { position, duration };
        };

        const emitProgressUi = (force = false) => {
          if (!activeLesson()) return;
          const art = artRef.current;
          if (!art) return;
          const now = Date.now();
          if (!force && now - lastUiEmitAt < PROGRESS_UI_EMIT_MS) return;
          lastUiEmitAt = now;
          const position = readVideoTime(art);
          const duration = art.duration || 0;
          notePosition(position, duration);
          broadcastProgressUi(bootLessonNo, position, duration);
        };

        const persistProgress = (force = false) => {
          if (!activeLesson()) return;
          const art = artRef.current;
          if (!art) return;
          const position = readVideoTime(art);
          const duration = art.duration || 0;
          notePosition(position, duration);
          lastSaveAt = Date.now();
          emitProgressUi(true);
          saveVideoProgress(bootLessonNo, position, duration).catch(() => undefined);
          if (force) pushTimeUpdateRef.current?.();
        };

        const pushTimeUpdate = () => {
          if (!activeLesson()) return;
          const art = artRef.current;
          if (!art) return;
          const currentTime = readVideoTime(art);
          notePosition(currentTime, art.duration || lastKnownRef.current.duration);
          emit("player-timeupdate", {
            lessonNo: bootLessonNo,
            currentTime,
            playing: art.playing,
          }).catch(() => undefined);
        };
        pushTimeUpdateRef.current = pushTimeUpdate;

        artRef.current.on("ready", () => {
          if (!activeLesson()) return;
          const art = artRef.current;
          if (!art) return;
          syncWindowToVideo();

          const { $player } = art.template;
          const keepControlsVisible = () => showPlayerControls(art);
          $player.addEventListener("mouseenter", keepControlsVisible);
          $player.addEventListener("mousemove", keepControlsVisible);
          $player.addEventListener("mouseleave", () => {
            hidePlayerControls(art);
          });

          if (saved?.position) {
            art.seek = saved.position;
            window.setTimeout(pushTimeUpdate, 150);
            window.setTimeout(pushTimeUpdate, 500);
          } else {
            pushTimeUpdate();
          }
        });

        artRef.current.on("play", () => {
          if (!activeLesson()) return;
          setPlaying(true);
          pushTimeUpdate();
          emit("player-playback", { lessonNo: bootLessonNo, playing: true }).catch(
            () => undefined,
          );
        });
        artRef.current.on("pause", () => {
          if (!activeLesson()) return;
          setPlaying(false);
          emit("player-playback", { lessonNo: bootLessonNo, playing: false }).catch(
            () => undefined,
          );
          persistProgress(true);
        });
        artRef.current.on("video:ended", () => {
          if (!activeLesson()) return;
          setPlaying(false);
          emit("player-playback", { lessonNo: bootLessonNo, playing: false }).catch(
            () => undefined,
          );
        });
        artRef.current.on("video:seek", () => {
          if (!activeLesson()) return;
          pushTimeUpdate();
          emitProgressUi(true);
          persistProgress(true);
        });

        artRef.current.on("video:loadedmetadata", syncWindowToVideo);

        artRef.current.on("pip", (enabled: boolean) => {
          if (!activeLesson()) return;
          const art = artRef.current;
          if (!art) return;

          if (enabled) {
            persistProgress(true);
            win.hide().catch(() => undefined);
            return;
          }

          win.show().catch(() => undefined);
          win.setFocus().catch(() => undefined);
          win.setAlwaysOnTop(pinnedRef.current).catch(() => undefined);
        });

        artRef.current.on("video:timeupdate", () => {
          if (!activeLesson()) return;
          pushTimeUpdate();
          emitProgressUi();
          const now = Date.now();
          if (now - lastSaveAt >= PROGRESS_SAVE_MS) {
            persistProgress();
          } else {
            window.clearTimeout(saveTimer);
            saveTimer = window.setTimeout(() => {
              persistProgress();
            }, PROGRESS_SAVE_MS - (now - lastSaveAt));
          }
        });

        await tryOpenSubtitle();
        if (disposed || lessonNoRef.current !== bootLessonNo) return;
      } catch (e) {
        if (!disposed && lessonNoRef.current === bootLessonNo) {
          setError(String(e));
        }
      }
    }

    boot();

    return () => {
      disposed = true;
      window.clearTimeout(saveTimer);
      // 切课：尽力写一次当前课进度（关窗路径不落盘）
      if (!closingRef.current) {
        const art = artRef.current;
        const position = art ? readVideoTime(art) : lastKnownRef.current.position;
        const duration = art
          ? art.duration || lastKnownRef.current.duration
          : lastKnownRef.current.duration;
        if (position > 0 || duration > 0) {
          saveVideoProgress(lessonNo, position, duration).catch(() => undefined);
        }
      }
      windowAspect?.dispose();
      closeSubtitleWindow(lessonNo).catch(() => undefined);
      pushTimeUpdateRef.current = null;
      teardownPlayer(artRef);
    };
  }, [lessonNo, tryOpenSubtitle]);

  useEffect(() => {
    if (phase !== "prompt" || !artRef.current) return;
    artRef.current.pause();
    setPlaying(false);
  }, [phase]);

  return (
    <div
      ref={shellRef}
      className={`player-shell group relative h-full${chromeVisible ? " chrome-visible" : ""}`}
    >
      {error ? (
        <div className="flex h-full items-center justify-center p-4 text-sm text-rose-300">
          {error}
        </div>
      ) : (
        <>
          <div className="player-video-area h-full">
            <div ref={containerRef} className="artplayer-app relative h-full" />
            {/* 课件烧录水印「文老师软考教育」，无法用代码去除，仅遮挡 */}
            <div className="player-watermark-mask" aria-hidden />
          </div>
          <div className="player-traffic-lights-hitbox" aria-hidden>
            <button
              type="button"
              className="player-traffic-light-btn"
              aria-label="关闭"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                closePlayerWindow().catch(() => undefined);
              }}
            />
            <button
              type="button"
              className="player-traffic-light-btn"
              aria-label="最小化"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                getCurrentWindow().minimize().catch(() => undefined);
              }}
            />
            <button
              type="button"
              className="player-traffic-light-btn"
              aria-label="缩放"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                getCurrentWindow().toggleMaximize().catch(() => undefined);
              }}
            />
          </div>
          <div
            className="player-drag-hitbox"
            aria-hidden
            onMouseDown={startWindowDrag}
          />
          <div className="player-title-bar">
            <p className="player-title-text" onMouseDown={startWindowDrag}>
              {lessonTitle}
            </p>
            <button
              type="button"
              onClick={togglePin}
              aria-label={pinned ? "取消置顶" : "窗口置顶"}
              aria-pressed={pinned}
              title={pinned ? "已置顶 · 点击取消" : "窗口置顶"}
              className={`player-pin-btn ${pinned ? "player-pin-btn--active" : ""}`}
            >
              <PinIcon pinned={pinned} />
            </button>
          </div>
        </>
      )}
      {subtitleHint && (
        <div className="absolute inset-x-0 bottom-14 z-40 px-3">
          <p className="rounded-lg bg-slate-900/85 px-3 py-2 text-center text-xs leading-5 text-slate-200">
            {subtitleHint}
            <button
              type="button"
              onClick={() => setSubtitleHint(null)}
              className="ml-2 text-slate-400 hover:text-white"
            >
              知道了
            </button>
          </p>
        </div>
      )}
      {eyeRestEnabled && phase !== "idle" && (
        <EyeRestPrompt
          phase={phase}
          restLeft={restLeft}
          onStartRest={startRest}
          onSnooze={snooze}
          onDismiss={dismissPrompt}
          variant="player"
        />
      )}
    </div>
  );
}

async function fetchProgress(lessonNo: number) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const progress = await invoke<{ videos: Record<string, { position: number }> }>(
      "get_progress",
    );
    return progress.videos[String(lessonNo)];
  } catch {
    return undefined;
  }
}
