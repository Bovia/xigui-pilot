import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { EYE_REST_BREAK_SEC } from "../lib/eyeRest";

/** 整屏黑底休息：大号倒计时居中 */
export default function EyeRestOverlay() {
  const [restLeft, setRestLeft] = useState(EYE_REST_BREAK_SEC);

  useEffect(() => {
    document.documentElement.classList.add("eye-rest-view");
    return () => document.documentElement.classList.remove("eye-rest-view");
  }, []);

  useEffect(() => {
    const unlistenOpen = listen<{ restLeft: number }>("eye-rest-tick", (event) => {
      if (typeof event.payload.restLeft === "number") {
        setRestLeft(event.payload.restLeft);
      }
    });
    return () => {
      unlistenOpen.then((fn) => fn());
    };
  }, []);

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
