import { useCallback, useEffect, useRef, useState } from "react";

/** 20-20-20：每 20 分钟看 6 米外 20 秒（美国眼科学会等机构推荐） */
export const EYE_REST_WORK_MIN = 20;
export const EYE_REST_BREAK_SEC = 20;
export const EYE_REST_SNOOZE_MIN = 5;

const STORAGE_KEY = "xigui-eye-rest-enabled";

export function isEyeRestEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== "false";
}

export function setEyeRestEnabled(enabled: boolean) {
  localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
}

export function textbookTooltip(page?: number) {
  return {
    label: "官方教材",
    detail: page ? `打开第 ${page} 页` : undefined,
  };
}

type Phase = "idle" | "prompt" | "resting";

export function useEyeRestReminder(active: boolean, enabled: boolean) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [restLeft, setRestLeft] = useState(EYE_REST_BREAK_SEC);
  const workTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const restTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const snoozeUntil = useRef(0);

  const clearWorkTimer = useCallback(() => {
    if (workTimer.current !== undefined) {
      window.clearTimeout(workTimer.current);
      workTimer.current = undefined;
    }
  }, []);

  const scheduleWorkTimer = useCallback(() => {
    clearWorkTimer();
    if (!enabled || !active || phase !== "idle") return;
    if (Date.now() < snoozeUntil.current) {
      workTimer.current = window.setTimeout(
        scheduleWorkTimer,
        snoozeUntil.current - Date.now(),
      );
      return;
    }
    workTimer.current = window.setTimeout(() => {
      setPhase("prompt");
    }, EYE_REST_WORK_MIN * 60 * 1000);
  }, [active, clearWorkTimer, enabled, phase]);

  useEffect(() => {
    scheduleWorkTimer();
    return clearWorkTimer;
  }, [active, enabled, phase, scheduleWorkTimer, clearWorkTimer]);

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

  return {
    phase,
    restLeft,
    startRest,
    snooze,
    dismissPrompt,
  };
}
