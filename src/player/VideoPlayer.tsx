import Artplayer from "artplayer";
import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import EyeRestPrompt from "../components/EyeRestPrompt";
import { loadPlan, resolveVideoPath, saveVideoProgress } from "../lib/api";
import { isEyeRestEnabled, useEyeRestReminder } from "../lib/eyeRest";
import type { PlanFile, PlanLesson } from "../lib/types";

export default function VideoPlayer({ lessonNo }: { lessonNo: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<Artplayer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [eyeRestEnabled] = useState(isEyeRestEnabled);
  const { phase, restLeft, startRest, snooze, dismissPrompt } = useEyeRestReminder(
    playing,
    eyeRestEnabled,
  );

  useEffect(() => {
    let disposed = false;
    let saveTimer: number | undefined;

    async function boot() {
      if (!containerRef.current) return;

      try {
        const [plan, path] = await Promise.all([
          loadPlan() as Promise<PlanFile>,
          resolveVideoPath(lessonNo),
        ]);

        const lesson: PlanLesson | undefined = plan.lessons[String(lessonNo)];
        if (lesson?.title) {
          getCurrentWindow().setTitle(lesson.title).catch(() => undefined);
        } else {
          getCurrentWindow().setTitle(`第 ${lessonNo} 节`).catch(() => undefined);
        }

        if (lesson && !lesson.builtinPlayable) {
          setError("该视频格式需用系统播放器打开（如 mkv）");
          return;
        }

        const url = convertFileSrc(path);
        const saved = await fetchProgress(lessonNo);

        if (disposed || !containerRef.current) return;

        artRef.current?.destroy();
        artRef.current = new Artplayer({
          container: containerRef.current,
          url,
          autoplay: true,
          autoSize: true,
          playbackRate: true,
          setting: true,
          fullscreen: true,
          pip: true,
          mutex: true,
          theme: "#3b82f6",
          lang: "zh-cn",
        });

        artRef.current.on("ready", () => {
          if (saved?.position && artRef.current) {
            artRef.current.seek = saved.position;
          }
        });

        artRef.current.on("play", () => setPlaying(true));
        artRef.current.on("pause", () => setPlaying(false));
        artRef.current.on("video:ended", () => setPlaying(false));

        const win = getCurrentWindow();

        artRef.current.on("pip", (enabled: boolean) => {
          const art = artRef.current;
          if (!art) return;

          if (enabled) {
            saveVideoProgress(lessonNo, art.currentTime, art.duration || 0).catch(
              () => undefined,
            );
            win.hide().catch(() => undefined);
            return;
          }

          win.show().catch(() => undefined);
          win.setFocus().catch(() => undefined);
        });

        artRef.current.on("video:timeupdate", () => {
          const art = artRef.current;
          if (!art) return;
          window.clearTimeout(saveTimer);
          saveTimer = window.setTimeout(() => {
            saveVideoProgress(lessonNo, art.currentTime, art.duration || 0).catch(
              () => undefined,
            );
          }, 3000);
        });

        artRef.current.on("pause", () => {
          const art = artRef.current;
          if (!art) return;
          saveVideoProgress(lessonNo, art.currentTime, art.duration || 0).catch(
            () => undefined,
          );
        });
      } catch (e) {
        setError(String(e));
      }
    }

    boot();

    return () => {
      disposed = true;
      window.clearTimeout(saveTimer);
      artRef.current?.destroy();
      artRef.current = null;
    };
  }, [lessonNo]);

  useEffect(() => {
    if (phase !== "prompt" || !artRef.current) return;
    artRef.current.pause();
    setPlaying(false);
  }, [phase]);

  return (
    <div className="player-shell relative h-full">
      {error ? (
        <div className="flex h-full items-center justify-center p-4 text-sm text-rose-300">
          {error}
        </div>
      ) : (
        <div ref={containerRef} className="artplayer-app relative h-full" />
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
