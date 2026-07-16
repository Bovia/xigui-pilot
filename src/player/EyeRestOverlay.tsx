import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { EYE_REST_BREAK_SEC } from "../lib/eyeRest";

function readShowCountdown() {
  return new URLSearchParams(window.location.search).get("countdown") === "1";
}

/** 整屏黑底休息：当前屏显示倒计时，其它屏纯黑 */
export default function EyeRestOverlay() {
  const showCountdown = readShowCountdown();
  const [restLeft, setRestLeft] = useState(EYE_REST_BREAK_SEC);
  const syncedRef = useRef(false);

  useEffect(() => {
    document.documentElement.classList.add("eye-rest-view");
    return () => document.documentElement.classList.remove("eye-rest-view");
  }, []);

  useEffect(() => {
    if (!showCountdown) return;
    const unlisten = listen<{ restLeft: number }>("eye-rest-tick", (event) => {
      if (typeof event.payload.restLeft !== "number") return;
      syncedRef.current = true;
      setRestLeft(event.payload.restLeft);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [showCountdown]);

  useEffect(() => {
    if (!showCountdown) return;
    const id = window.setInterval(() => {
      setRestLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [showCountdown]);

  useEffect(() => {
    if (!showCountdown) return;
    const id = window.setTimeout(() => {
      if (syncedRef.current) return;
      import("@tauri-apps/api/event")
        .then(({ emit }) => emit("eye-rest-request-sync"))
        .catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(id);
  }, [showCountdown]);

  if (!showCountdown) {
    return <div className="eye-rest-blackout" aria-hidden />;
  }

  return (
    <div className="eye-rest-blackout">
      <div className="eye-rest-blackout-inner">
        <div className="eye-rest-count">{restLeft}</div>
        <p className="eye-rest-hint">
          望向 <strong>6 米外</strong>
          <br />
          放松眼睛，眨眨眼
        </p>
        <p className="eye-rest-sub">20-20-20 · 剩余 {restLeft} 秒</p>
      </div>
    </div>
  );
}
