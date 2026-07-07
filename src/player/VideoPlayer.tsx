import { useEffect, useRef, useState } from "react";
import Artplayer from "artplayer";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import EyeRestPrompt from "../components/EyeRestPrompt";
import { getProgress, resolveVideoPath, saveVideoProgress } from "../lib/api";
import { isEyeRestEnabled, useEyeRestReminder } from "../lib/eyeRest";

export default function VideoPlayer({ videoId }: { videoId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<Artplayer | null>(null);
  const [title, setTitle] = useState("播放中");
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
        const path = await resolveVideoPath(videoId);
        const displayTitle = decodeDisplayTitle(videoId);
        setTitle(displayTitle);
        getCurrentWindow().setTitle(displayTitle).catch(() => undefined);

        if (!videoId.toLowerCase().endsWith(".mp4")) {
          setError("该视频格式需用系统播放器打开（如 mkv）");
          return;
        }

        const url = convertFileSrc(path);
        const progress = await getProgress();
        const saved = progress.videos[videoId];

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
            saveVideoProgress(videoId, art.currentTime, art.duration || 0).catch(
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
            saveVideoProgress(videoId, art.currentTime, art.duration || 0).catch(
              () => undefined,
            );
          }, 3000);
        });

        artRef.current.on("pause", () => {
          const art = artRef.current;
          if (!art) return;
          saveVideoProgress(videoId, art.currentTime, art.duration || 0).catch(
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
  }, [videoId]);

  useEffect(() => {
    if (phase !== "prompt" || !artRef.current) return;
    artRef.current.pause();
    setPlaying(false);
  }, [phase]);

  return (
    <div className="player-shell relative flex h-full flex-col">
      <div className="border-b border-slate-800 px-3 py-2 text-sm text-slate-200">
        {title}
        {eyeRestEnabled && playing && phase === "idle" && (
          <span className="ml-2 text-[10px] text-slate-500">护眼提醒已开启</span>
        )}
      </div>
      {error ? (
        <div className="flex flex-1 items-center justify-center p-4 text-sm text-rose-300">
          {error}
        </div>
      ) : (
        <div ref={containerRef} className="artplayer-app relative flex-1" />
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

function decodeDisplayTitle(videoId: string) {
  const filename = videoId.split("/").pop() ?? videoId;
  const stem = filename.replace(/\.[^.]+$/, "");
  const stripped = stem.replace(/^\[\d+\]-*/, "").trim();
  return stripped || filename;
}
