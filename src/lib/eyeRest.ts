import { useCallback, useEffect, useRef, useState } from "react";
import { closeEyeRestOverlay, openEyeRestOverlay } from "./api";

/** 20-20-20：每 20 分钟看 6 米外 20 秒（美国眼科学会等机构推荐）
 *  调试期用短间隔；验收完改回 WORK=20 / BREAK=20 / SNOOZE=5 / PREVIEW=5*60 */
export const EYE_REST_WORK_MIN = 0.5; // 调试：30 秒（正式 20）
export const EYE_REST_BREAK_SEC = 8; // 调试：8 秒（正式 20）
export const EYE_REST_SNOOZE_MIN = 0.25; // 调试：15 秒（正式 5）
/** 剩余工时少于此秒数时，宿主可显示预告（猫状态条等） */
export const EYE_REST_PREVIEW_SEC = 20; // 调试：最后 20 秒出预告（正式 5*60）

const STORAGE_KEY = "xigui-eye-rest-enabled";
const CHANGED_EVENT = "xigui-eye-rest-changed";

export type EyeRestPhase = "idle" | "prompt" | "resting";

export function isEyeRestEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== "false";
}

export function setEyeRestEnabled(enabled: boolean) {
  localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: enabled }));
}

/** 跨面板/播放器/猫窗同步护眼开关（同 origin 的 storage + 本窗 CustomEvent） */
export function useEyeRestEnabled(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(isEyeRestEnabled);

  useEffect(() => {
    const sync = () => setEnabled(isEyeRestEnabled());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) sync();
    };
    const onLocal = () => sync();
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGED_EVENT, onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHANGED_EVENT, onLocal);
    };
  }, []);

  const set = useCallback((next: boolean) => {
    setEyeRestEnabled(next);
    setEnabled(next);
  }, []);

  return [enabled, set];
}

export function textbookTooltip(page?: number) {
  return {
    label: "官方教材",
    detail: page ? `打开第 ${page} 页` : undefined,
  };
}

export function formatEyeRestWorkLeft(sec: number): string {
  if (sec >= 60) return `歇眼 ${Math.ceil(sec / 60)}′`;
  return `歇眼 ${sec}″`;
}

/** 把「分钟」常数格式化成可读时长（调试短间隔也会显示成秒） */
export function formatEyeRestDuration(min: number): string {
  const sec = Math.round(min * 60);
  if (sec < 60) return `${sec} 秒`;
  if (sec % 60 === 0) return `${sec / 60} 分钟`;
  return `${min} 分钟`;
}

/**
 * 休息中：拉开/同步整屏黑底倒计时窗；结束或卸载时关掉。
 * 催促 UI 仍由各宿主自己管，只有 resting 才上黑屏。
 * 仅当本宿主曾进入 resting 时才关窗，避免播放器休息时猫侧 idle 误关黑屏。
 */
export function useEyeRestBlackout(phase: EyeRestPhase, restLeft: number) {
  const ownsOverlay = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function sync() {
      if (phase === "resting") {
        ownsOverlay.current = true;
        await openEyeRestOverlay().catch(() => undefined);
        if (cancelled) return;
        const { emit, emitTo } = await import("@tauri-apps/api/event");
        const payload = { restLeft };
        await emit("eye-rest-tick", payload).catch(() => undefined);
        await emitTo("eye-rest", "eye-rest-tick", payload).catch(() => undefined);
        return;
      }
      if (ownsOverlay.current) {
        ownsOverlay.current = false;
        await closeEyeRestOverlay().catch(() => undefined);
      }
    }
    sync();
    return () => {
      cancelled = true;
    };
  }, [phase, restLeft]);

  useEffect(() => {
    return () => {
      if (ownsOverlay.current) {
        ownsOverlay.current = false;
        closeEyeRestOverlay().catch(() => undefined);
      }
    };
  }, []);
}

/**
 * 护眼状态机（播放器 / 猫窗各持一份，互斥由宿主决定 active）。
 * - active：本宿主是否走表；切宿主时对方从 0 重计即可
 * - phase 为 prompt/resting 时，即使 active 短暂变 false（播放器到点后 pause）也不清掉
 */
export function useEyeRestReminder(active: boolean, enabled: boolean) {
  const [phase, setPhase] = useState<EyeRestPhase>("idle");
  const [restLeft, setRestLeft] = useState(EYE_REST_BREAK_SEC);
  const [workLeftSec, setWorkLeftSec] = useState<number | null>(null);
  const workTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tickTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const restTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const snoozeUntil = useRef(0);
  const workDeadline = useRef(0);

  const clearWorkTimer = useCallback(() => {
    if (workTimer.current !== undefined) {
      window.clearTimeout(workTimer.current);
      workTimer.current = undefined;
    }
    if (tickTimer.current !== undefined) {
      window.clearInterval(tickTimer.current);
      tickTimer.current = undefined;
    }
  }, []);

  const clearWorkProgress = useCallback(() => {
    clearWorkTimer();
    workDeadline.current = 0;
    setWorkLeftSec(null);
  }, [clearWorkTimer]);

  const startWorkCountdown = useCallback(
    (durationMs: number) => {
      clearWorkTimer();
      workDeadline.current = Date.now() + durationMs;
      const tick = () => {
        const left = Math.max(0, Math.ceil((workDeadline.current - Date.now()) / 1000));
        setWorkLeftSec(left);
      };
      tick();
      tickTimer.current = window.setInterval(tick, 1000);
      workTimer.current = window.setTimeout(() => {
        clearWorkTimer();
        setWorkLeftSec(null);
        setPhase("prompt");
      }, durationMs);
    },
    [clearWorkTimer],
  );

  const scheduleWorkTimer = useCallback(() => {
    clearWorkProgress();
    if (!enabled || !active || phase !== "idle") return;
    if (Date.now() < snoozeUntil.current) {
      workTimer.current = window.setTimeout(
        scheduleWorkTimer,
        snoozeUntil.current - Date.now(),
      );
      return;
    }
    startWorkCountdown(EYE_REST_WORK_MIN * 60 * 1000);
  }, [active, clearWorkProgress, enabled, phase, startWorkCountdown]);

  useEffect(() => {
    scheduleWorkTimer();
    return clearWorkProgress;
  }, [active, enabled, phase, scheduleWorkTimer, clearWorkProgress]);

  // 走表宿主失活：只停工时，不清 prompt/resting（播放器到点 pause 依赖此点）
  useEffect(() => {
    if (!active) clearWorkProgress();
  }, [active, clearWorkProgress]);

  useEffect(() => {
    if (phase !== "resting") return;
    setRestLeft(EYE_REST_BREAK_SEC);
    restTimer.current = window.setInterval(() => {
      setRestLeft((prev) => {
        if (prev <= 1) {
          if (restTimer.current) window.clearInterval(restTimer.current);
          setPhase("idle");
          return EYE_REST_BREAK_SEC;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (restTimer.current) window.clearInterval(restTimer.current);
    };
  }, [phase]);

  const startRest = useCallback(() => setPhase("resting"), []);

  const snooze = useCallback(() => {
    snoozeUntil.current = Date.now() + EYE_REST_SNOOZE_MIN * 60 * 1000;
    setPhase("idle");
  }, []);

  const dismissPrompt = useCallback(() => {
    snoozeUntil.current = Date.now() + EYE_REST_SNOOZE_MIN * 60 * 1000;
    setPhase("idle");
  }, []);

  /** 切到对方宿主时调用：本侧从干净 idle 开始，下次 active 再 20 分钟 */
  const reset = useCallback(() => {
    snoozeUntil.current = 0;
    clearWorkProgress();
    setPhase("idle");
    setRestLeft(EYE_REST_BREAK_SEC);
  }, [clearWorkProgress]);

  return {
    phase,
    restLeft,
    /** 工时剩余秒；idle 且正在走表时有值，供预告状态条 */
    workLeftSec,
    startRest,
    snooze,
    dismissPrompt,
    reset,
  };
}
