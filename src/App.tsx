import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import DynamicPanel from "./panel/DynamicPanel";
import VideoPlayer from "./player/VideoPlayer";

function readView() {
  const params = new URLSearchParams(window.location.search);
  return params.get("view") ?? "panel";
}

function readVideoId() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("id");
  return raw ? decodeURIComponent(raw) : undefined;
}

export default function App() {
  const [view] = useState(readView);
  const [videoId, setVideoId] = useState<string | undefined>(readVideoId);

  useEffect(() => {
    if (view !== "player") return;

    const unlistenPromise = listen<string>("player-open", (event) => {
      setVideoId(event.payload);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [view]);

  useEffect(() => {
    getCurrentWindow().setDecorations(view === "player").catch(() => undefined);
  }, [view]);

  if (view === "player" && videoId) {
    return <VideoPlayer videoId={videoId} />;
  }

  return <DynamicPanel />;
}
