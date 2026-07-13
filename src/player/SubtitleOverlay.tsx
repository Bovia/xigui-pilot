import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  PhysicalPosition,
  currentMonitor,
  cursorPosition,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSettings, openPlayer, resolveSubtitlePath, showPanelWindow } from "../lib/api";
import {
  cueAtTime,
  loadSubtitlePosition,
  nextCue,
  parseSubtitles,
  resolveCatCompanionView,
  saveSubtitlePosition,
  type CatPlayback,
  type SubtitleCue,
} from "../lib/subtitles";

const DRAG_THRESHOLD_PX = 5;
const CAT_SIT_FRAMES = ["/cow-cat-sit-1.png", "/cow-cat-sit-2.png", "/cow-cat-sit-3.png"];
const CAT_REST_FRAMES = ["/cow-cat-rest-1.png", "/cow-cat-rest-2.png"];
/** 多数时间静，偶尔连摆三下；坐姿稍活跃，趴姿更懒 */
const TAIL_WAG_STEPS = 3;
const TAIL_SIT = {
  idleMinMs: 1500,
  idleMaxMs: 5000,
  tickMinMs: 300,
  tickMaxMs: 420,
  shortIdleMs: 2500,
  idleFrame: 1,
  /** 从静止帧出发的两种三下路径，方向随机 */
  wagPaths: [
    [0, 1, 2],
    [2, 1, 0],
  ],
} as const;
const TAIL_REST = {
  idleMinMs: 3000,
  idleMaxMs: 9000,
  tickMinMs: 700,
  tickMaxMs: 1000,
  shortIdleMs: 4000,
  idleFrame: 0,
  wagPaths: [[1, 0, 1]],
} as const;

function randBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function pickIdleMs(
  idleMinMs: number,
  idleMaxMs: number,
  shortIdleMs: number,
  lastIdleMs: number | null,
) {
  if (lastIdleMs !== null && lastIdleMs < shortIdleMs) {
    const mid = (idleMinMs + idleMaxMs) / 2;
    return randBetween(mid, idleMaxMs);
  }
  return randBetween(idleMinMs, idleMaxMs);
}

export default function SubtitleOverlay({ lessonNo }: { lessonNo: number }) {
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [currentText, setCurrentText] = useState("");
  const [nextText, setNextText] = useState("");
  const [placeholder, setPlaceholder] = useState("等待播放同步");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [catMode, setCatMode] = useState(true);
  const [floatingSubtitles, setFloatingSubtitles] = useState(true);
  const [playback, setPlayback] = useState<CatPlayback>("none");
  const [bubbleLeft, setBubbleLeft] = useState(false);
  const [tailFrame, setTailFrame] = useState(0);
  const saveTimer = useRef<number | undefined>(undefined);
  const dragState = useRef({ x: 0, y: 0, didDrag: false, dragStarted: false });
  const hitRefs = useRef<Array<HTMLElement | null>>([]);
  const draggingRef = useRef(false);

  const catView = resolveCatCompanionView({
    playback,
    floatingSubtitles,
    hasCue: Boolean(currentText),
  });
  const showBubble = catView === "playing-speak";
  const restPose = catView === "idle-rest";

  const focusPlayerWindow = useCallback(async () => {
    const player = await WebviewWindow.getByLabel("player").catch(() => null);
    if (player) {
      const visible = await player.isVisible().catch(() => false);
      if (visible) {
        await player.show().catch(() => undefined);
        await player.setFocus().catch(() => undefined);
        return;
      }
    }
    await openPlayer(lessonNo).catch(() => undefined);
  }, [lessonNo]);

  const focusPanelWindow = useCallback(async () => {
    await showPanelWindow().catch(() => undefined);
  }, []);

  const updateBubbleSide = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      const [pos, size, monitor] = await Promise.all([
        win.outerPosition(),
        win.outerSize(),
        currentMonitor(),
      ]);
      if (!monitor) return;
      const midX = pos.x + size.width / 2;
      const screenMid = monitor.position.x + monitor.size.width / 2;
      setBubbleLeft(midX > screenMid);
    } catch {
      /* ignore */
    }
  }, []);

  /** 左右贴边时把窗口夹回屏幕内，避免气泡/猫被裁切 */
  const clampWindowToMonitor = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      const [pos, size, monitor, factor] = await Promise.all([
        win.outerPosition(),
        win.outerSize(),
        currentMonitor(),
        win.scaleFactor(),
      ]);
      if (!monitor) return;
      const margin = Math.round(10 * factor);
      const minX = monitor.position.x + margin;
      const minY = monitor.position.y + margin;
      const maxX = monitor.position.x + monitor.size.width - size.width - margin;
      const maxY = monitor.position.y + monitor.size.height - size.height - margin;
      const nextX = Math.min(Math.max(pos.x, minX), Math.max(minX, maxX));
      const nextY = Math.min(Math.max(pos.y, minY), Math.max(minY, maxY));
      if (nextX !== pos.x || nextY !== pos.y) {
        await win.setPosition(new PhysicalPosition(nextX, nextY));
        saveSubtitlePosition({ x: nextX, y: nextY });
      }
      await updateBubbleSide();
    } catch {
      /* ignore */
    }
  }, [updateBubbleSide]);

  useEffect(() => {
    document.documentElement.classList.add("subtitle-view");
    return () => document.documentElement.classList.remove("subtitle-view");
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("subtitle-cat-mode", catMode);
    return () => document.documentElement.classList.remove("subtitle-cat-mode");
  }, [catMode]);

  // 预加载全部姿势/尾巴帧，切换时不闪白
  useEffect(() => {
    if (!catMode) return;
    const images = [...CAT_SIT_FRAMES, ...CAT_REST_FRAMES].map((src) => {
      const img = new Image();
      img.src = src;
      return img;
    });
    return () => {
      images.length = 0;
    };
  }, [catMode]);

  async function closeSelf() {
    await getCurrentWindow().close().catch(() => undefined);
  }

  useEffect(() => {
    getSettings()
      .then((s) => {
        setCatMode(s.subtitleCatMode ?? true);
        setFloatingSubtitles(s.floatingSubtitles ?? true);
      })
      .catch(() => undefined);

    const unlistenCat = listen<boolean>("subtitle-cat-mode", (event) => {
      setCatMode(event.payload);
    });
    const unlistenFloat = listen<boolean>("floating-subtitles", (event) => {
      setFloatingSubtitles(event.payload);
    });
    return () => {
      unlistenCat.then((fn) => fn());
      unlistenFloat.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    async function boot() {
      try {
        const settings = await getSettings().catch(() => null);
        const cat = settings?.subtitleCatMode ?? true;
        const floating = settings?.floatingSubtitles ?? true;

        const info = await resolveSubtitlePath(lessonNo).catch(() => null);
        if (!info) {
          // 猫猫模式允许无字幕文件，只陪伴不说话
          if (cat) {
            setReady(true);
            return;
          }
          await closeSelf();
          return;
        }

        const url = convertFileSrc(info.path);
        const res = await fetch(url);
        if (!res.ok) {
          if (cat) {
            setReady(true);
            return;
          }
          throw new Error(`无法读取字幕：${info.path}`);
        }
        const content = await res.text();
        if (disposed) return;

        const parsed = parseSubtitles(content, info.format);
        if (parsed.length === 0 && !cat) {
          await closeSelf();
          return;
        }

        setCues(parsed);
        setReady(true);
        const lastEnd = parsed[parsed.length - 1]?.end ?? 0;
        if (lastEnd > 0 && lastEnd < 3600) {
          setPlaceholder(`此处暂无字幕（本文件约覆盖至 ${formatClock(lastEnd)}）`);
        } else {
          setPlaceholder("此处暂无字幕");
        }

        // 常规模式且关闭悬浮字幕时本不该开窗；防御性处理
        if (!cat && !floating) {
          await closeSelf();
        }
      } catch (e) {
        if (!disposed) {
          setError(String(e));
        }
      }
    }

    boot();
    return () => {
      disposed = true;
    };
  }, [lessonNo]);

  useEffect(() => {
    const win = getCurrentWindow();
    win.setAlwaysOnTop(true).catch(() => undefined);

    const saved = loadSubtitlePosition();
    if (saved && saved.x >= -200 && saved.y >= 0 && saved.x < 4000 && saved.y < 4000) {
      win.setPosition(new PhysicalPosition(saved.x, saved.y)).catch(() => undefined);
    } else {
      win.center().catch(() => undefined);
    }

    updateBubbleSide();
    clampWindowToMonitor();

    const unlistenMove = win.onMoved(({ payload }) => {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveSubtitlePosition({ x: payload.x, y: payload.y });
        if (draggingRef.current) {
          updateBubbleSide();
          return;
        }
        clampWindowToMonitor();
      }, 140);
    });

    return () => {
      window.clearTimeout(saveTimer.current);
      unlistenMove.then((fn) => fn());
    };
  }, [updateBubbleSide, clampWindowToMonitor]);

  useEffect(() => {
    if (!ready) return;

    const stickyTextRef = { current: "" };

    const unlistenTime = listen<{
      lessonNo: number;
      currentTime: number;
      playing?: boolean;
    }>("player-timeupdate", (event) => {
      if (event.payload.lessonNo !== lessonNo) return;

      if (typeof event.payload.playing === "boolean") {
        setPlayback(event.payload.playing ? "playing" : "paused");
      }

      const cue = cueAtTime(cues, event.payload.currentTime);
      const upcoming = nextCue(cues, event.payload.currentTime);
      const paused = event.payload.playing === false;

      if (cue?.text) {
        stickyTextRef.current = cue.text;
        setCurrentText(cue.text);
        setNextText(upcoming && upcoming !== cue ? upcoming.text : "");
        return;
      }

      if (paused) {
        stickyTextRef.current = "";
        setCurrentText("");
        setNextText("");
        setPlaceholder(
          event.payload.currentTime > (cues[cues.length - 1]?.end ?? 0)
            ? `此处暂无字幕（本文件约覆盖至 ${formatClock(cues[cues.length - 1]?.end ?? 0)}）`
            : "等待播放同步",
        );
        return;
      }

      // 播放中空档：保持上一句，避免闪烁
      if (stickyTextRef.current) {
        setCurrentText(stickyTextRef.current);
        setNextText(upcoming?.text ?? "");
      }
    });

    const clearSpeech = () => {
      stickyTextRef.current = "";
      setCurrentText("");
      setNextText("");
    };

    const unlistenPlayback = listen<{
      lessonNo: number;
      playing: boolean;
      closed?: boolean;
    }>("player-playback", (event) => {
      if (event.payload.lessonNo !== lessonNo) return;
      if (event.payload.closed || !event.payload.playing) {
        setPlayback(event.payload.closed ? "none" : "paused");
        clearSpeech();
        return;
      }
      setPlayback("playing");
    });

    return () => {
      unlistenTime.then((fn) => fn());
      unlistenPlayback.then((fn) => fn());
    };
  }, [cues, lessonNo, ready]);

  useEffect(() => {
    const unlistenPromise = listen<number>("subtitle-open", (event) => {
      if (event.payload === lessonNo) {
        const win = getCurrentWindow();
        win.show().catch(() => undefined);
        win.setAlwaysOnTop(true).catch(() => undefined);
        updateBubbleSide();
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [lessonNo, updateBubbleSide]);

  useEffect(() => {
    const win = getCurrentWindow();
    if (!catMode) {
      win.setIgnoreCursorEvents(false).catch(() => undefined);
      return;
    }

    let cancelled = false;
    let lastIgnore: boolean | null = null;
    let pendingOver: boolean | null = null;
    let pendingCount = 0;

    async function syncHitTest() {
      if (cancelled) return;
      try {
        const [cursor, pos, factor] = await Promise.all([
          cursorPosition(),
          win.outerPosition(),
          win.scaleFactor(),
        ]);
        const localX = (cursor.x - pos.x) / factor;
        const localY = (cursor.y - pos.y) / factor;
        const overNow =
          draggingRef.current ||
          hitRefs.current.some((el) => {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            const pad = 4;
            return (
              localX >= r.left - pad &&
              localX <= r.right + pad &&
              localY >= r.top - pad &&
              localY <= r.bottom + pad
            );
          });

        if (pendingOver === overNow) {
          pendingCount += 1;
        } else {
          pendingOver = overNow;
          pendingCount = 1;
        }
        if (pendingCount < 2) {
          if (!cancelled) window.setTimeout(syncHitTest, 48);
          return;
        }

        const ignore = !overNow;
        if (lastIgnore !== ignore) {
          lastIgnore = ignore;
          await win.setIgnoreCursorEvents(ignore);
        }
      } catch {
        /* ignore */
      }
      if (!cancelled) {
        window.setTimeout(syncHitTest, 64);
      }
    }

    syncHitTest();
    return () => {
      cancelled = true;
      win.setIgnoreCursorEvents(false).catch(() => undefined);
    };
  }, [catMode]);

  function onBarMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    dragState.current = {
      x: e.clientX,
      y: e.clientY,
      didDrag: false,
      dragStarted: false,
    };
  }

  function onBarMouseMove(e: React.MouseEvent) {
    const state = dragState.current;
    if (state.dragStarted) return;
    if (Math.hypot(e.clientX - state.x, e.clientY - state.y) <= DRAG_THRESHOLD_PX) return;
    state.didDrag = true;
    state.dragStarted = true;
    draggingRef.current = true;
    getCurrentWindow()
      .setIgnoreCursorEvents(false)
      .catch(() => undefined)
      .finally(() => {
        getCurrentWindow().startDragging().catch(() => undefined);
      });
  }

  function makeDragHandlers(onClick: () => void, title: string) {
    return {
      title,
      onMouseDown: onBarMouseDown,
      onMouseMove: onBarMouseMove,
      onMouseUp: (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        const didDrag = dragState.current.didDrag;
        draggingRef.current = false;
        if (didDrag) return;
        onClick();
      },
    };
  }

  const bubbleDragHandlers = makeDragHandlers(
    () => {
      focusPlayerWindow().catch(() => undefined);
    },
    "点击打开视频 · 拖动移动",
  );

  const catDragHandlers = makeDragHandlers(
    () => {
      focusPanelWindow().catch(() => undefined);
    },
    "点击打开面板 · 拖动移动",
  );

  const barDragHandlers = makeDragHandlers(
    () => {
      focusPlayerWindow().catch(() => undefined);
    },
    "点击打开视频 · 拖动移动",
  );

  useEffect(() => {
    function endDrag() {
      draggingRef.current = false;
      clampWindowToMonitor();
    }
    window.addEventListener("mouseup", endDrag);
    return () => window.removeEventListener("mouseup", endDrag);
  }, [clampWindowToMonitor]);

  function setHitRef(index: number) {
    return (el: HTMLElement | null) => {
      hitRefs.current[index] = el;
    };
  }

  useEffect(() => {
    if (!currentText) hitRefs.current[0] = null;
  }, [currentText]);

  // 尾巴：多数时间静，偶尔连摆三下（间隔随机，防连抖）
  useEffect(() => {
    if (!catMode) return;
    const cfg = restPose ? TAIL_REST : TAIL_SIT;
    let cancelled = false;
    let timer: number | undefined;
    let lastIdleMs: number | null = null;
    let wagStep = 0;
    let wagPath: readonly number[] = cfg.wagPaths[0];

    const schedule = (ms: number, fn: () => void) => {
      timer = window.setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
    };

    const startIdle = () => {
      setTailFrame(cfg.idleFrame);
      const idleMs = pickIdleMs(cfg.idleMinMs, cfg.idleMaxMs, cfg.shortIdleMs, lastIdleMs);
      lastIdleMs = idleMs;
      schedule(idleMs, startWag);
    };

    const startWag = () => {
      wagPath = cfg.wagPaths[Math.floor(Math.random() * cfg.wagPaths.length)]!;
      wagStep = 0;
      tickWag();
    };

    const tickWag = () => {
      setTailFrame(wagPath[wagStep]!);
      wagStep += 1;
      if (wagStep >= TAIL_WAG_STEPS) {
        schedule(randBetween(cfg.tickMinMs, cfg.tickMaxMs), startIdle);
        return;
      }
      schedule(randBetween(cfg.tickMinMs, cfg.tickMaxMs), tickWag);
    };

    startIdle();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [catMode, restPose]);

  useEffect(() => {
    if (!catMode) return;
    clampWindowToMonitor();
  }, [catMode, showBubble, bubbleLeft, clampWindowToMonitor]);

  if (error && !catMode) {
    return (
      <div className="subtitle-overlay-shell flex h-full w-full items-end justify-center p-2">
        <div className="subtitle-bar w-full max-w-2xl">
          <p className="subtitle-placeholder">{error}</p>
        </div>
      </div>
    );
  }

  if (catMode) {
    return (
      <div
        className={`subtitle-overlay-shell subtitle-cat-shell flex h-full w-full items-end ${
          bubbleLeft ? "justify-end" : "justify-start"
        }`}
      >
        <div
          className={`subtitle-cat-stack ${
            bubbleLeft ? "subtitle-cat-stack--right" : "subtitle-cat-stack--left"
          }`}
        >
          {showBubble && (
            <div
              ref={setHitRef(0)}
              className="subtitle-bubble subtitle-bubble--visible cursor-grab select-none active:cursor-grabbing"
              {...bubbleDragHandlers}
            >
              <p className="subtitle-current">{currentText}</p>
              {nextText && <p className="subtitle-next">{nextText}</p>}
            </div>
          )}
          <img
            ref={setHitRef(1)}
            className={`subtitle-cat-pet cursor-grab select-none active:cursor-grabbing ${
              restPose ? "subtitle-cat-pet--rest" : "subtitle-cat-pet--talk"
            }`}
            src={
              restPose
                ? CAT_REST_FRAMES[tailFrame % CAT_REST_FRAMES.length]
                : CAT_SIT_FRAMES[tailFrame % CAT_SIT_FRAMES.length]
            }
            alt=""
            draggable={false}
            width={restPose ? 144 : 120}
            height={restPose ? 112 : 136}
            {...catDragHandlers}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="subtitle-overlay-shell flex h-full w-full items-end justify-center p-2">
      <div
        className="subtitle-bar w-full max-w-2xl cursor-grab select-none active:cursor-grabbing"
        {...barDragHandlers}
      >
        {currentText ? (
          <p className="subtitle-current">{currentText}</p>
        ) : (
          <p className="subtitle-placeholder">{placeholder}</p>
        )}
        {nextText && <p className="subtitle-next">{nextText}</p>}
      </div>
    </div>
  );
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
