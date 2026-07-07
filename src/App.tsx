import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import TodayPanel from "./panel/TodayPanel";
import SubtitleOverlay from "./player/SubtitleOverlay";
import VideoPlayer from "./player/VideoPlayer";

function readView() {
  const params = new URLSearchParams(window.location.search);
  return params.get("view") ?? "panel";
}

function readLessonNo() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("lesson");
  return raw ? Number(raw) : undefined;
}

export default function App() {
  const [view] = useState(readView);
  const [lessonNo, setLessonNo] = useState<number | undefined>(readLessonNo);

  useEffect(() => {
    if (view !== "player" && view !== "subtitle") return;

    const unlistenPromise = listen<number>(
      view === "player" ? "player-open" : "subtitle-open",
      (event) => {
        setLessonNo(event.payload);
      },
    );

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [view]);

  useEffect(() => {
    getCurrentWindow()
      .setDecorations(view === "player")
      .catch(() => undefined);
  }, [view]);

  if (view === "subtitle" && lessonNo) {
    return <SubtitleOverlay lessonNo={lessonNo} />;
  }

  if (view === "player" && lessonNo) {
    return <VideoPlayer lessonNo={lessonNo} />;
  }

  return <TodayPanel />;
}
