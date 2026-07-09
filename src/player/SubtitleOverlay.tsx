import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { PhysicalPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect, useRef, useState } from "react";
import { resolveSubtitlePath } from "../lib/api";
import {
  cueAtTime,
  loadSubtitlePosition,
  nextCue,
  parseSubtitles,
  saveSubtitlePosition,
  type SubtitleCue,
} from "../lib/subtitles";

const DRAG_THRESHOLD_PX = 5;

export default function SubtitleOverlay({ lessonNo }: { lessonNo: number }) {
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [currentText, setCurrentText] = useState("");
  const [nextText, setNextText] = useState("");
  const [placeholder, setPlaceholder] = useState("等待播放同步");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const dragState = useRef({ x: 0, y: 0, didDrag: false, dragStarted: false });

  const focusPlayerWindow = useCallback(async () => {
    const player = await WebviewWindow.getByLabel("player").catch(() => null);
    if (!player) return;
    await player.show().catch(() => undefined);
    await player.setFocus().catch(() => undefined);
  }, [lessonNo]);

  useEffect(() => {
    document.documentElement.classList.add("subtitle-view");
    return () => document.documentElement.classList.remove("subtitle-view");
  }, []);

  async function closeSelf() {
    await getCurrentWindow().close().catch(() => undefined);
  }

  useEffect(() => {
    let disposed = false;

    async function boot() {
      try {
        const info = await resolveSubtitlePath(lessonNo);
        if (!info) {
          await closeSelf();
          return;
        }

        const url = convertFileSrc(info.path);
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`无法读取字幕：${info.path}`);
        }
        const content = await res.text();
        if (disposed) return;

        const parsed = parseSubtitles(content, info.format);
        if (parsed.length === 0) {
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

    const unlistenMove = win.onMoved(({ payload }) => {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveSubtitlePosition({ x: payload.x, y: payload.y });
      }, 200);
    });

    return () => {
      window.clearTimeout(saveTimer.current);
      unlistenMove.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!ready) return;

    const unlistenPromise = listen<{ lessonNo: number; currentTime: number }>(
      "player-timeupdate",
      (event) => {
        if (event.payload.lessonNo !== lessonNo) return;
        const cue = cueAtTime(cues, event.payload.currentTime);
        const upcoming = nextCue(cues, event.payload.currentTime);
        setCurrentText(cue?.text ?? "");
        setNextText(upcoming && upcoming !== cue ? upcoming.text : "");
        if (!cue?.text) {
          setPlaceholder(
            event.payload.currentTime > (cues[cues.length - 1]?.end ?? 0)
              ? `此处暂无字幕（本文件约覆盖至 ${formatClock(cues[cues.length - 1]?.end ?? 0)}）`
              : "等待播放同步",
          );
        }
      },
    );

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [cues, lessonNo, ready]);

  useEffect(() => {
    const unlistenPromise = listen<number>("subtitle-open", (event) => {
      if (event.payload === lessonNo) {
        const win = getCurrentWindow();
        win.show().catch(() => undefined);
        win.setAlwaysOnTop(true).catch(() => undefined);
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [lessonNo]);

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
    getCurrentWindow().startDragging().catch(() => undefined);
  }

  function onBarMouseUp(e: React.MouseEvent) {
    if (e.button !== 0) return;
    if (dragState.current.didDrag) return;
    focusPlayerWindow().catch(() => undefined);
  }

  if (error) {
    return (
      <div className="subtitle-overlay-shell flex h-full w-full items-end justify-center p-2">
        <div className="subtitle-bar w-full max-w-2xl">
          <p className="subtitle-placeholder">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="subtitle-overlay-shell flex h-full w-full items-end justify-center p-2">
      <div
        className="subtitle-bar w-full max-w-2xl cursor-grab select-none active:cursor-grabbing"
        title="点击前置视频 · 拖动移动"
        onMouseDown={onBarMouseDown}
        onMouseMove={onBarMouseMove}
        onMouseUp={onBarMouseUp}
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
