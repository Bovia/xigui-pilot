import { useCallback, useEffect, useRef, useState } from "react";
import { closeEyeRestOverlay, openEyeRestOverlay } from "./api";

/** 20-20-20：每 20 分钟看 6 米外 20 秒（美国眼科学会等机构推荐） */
export const EYE_REST_WORK_MIN = 20;
export const EYE_REST_BREAK_SEC = 20;
export const EYE_REST_SNOOZE_MIN = 5;
/** 剩余工时少于此秒数时，宿主可显示预告（猫状态条等） */
export const EYE_REST_PREVIEW_SEC = 5 * 60;

const ENABLED_KEY = "xigui-eye-rest-enabled";
const STATE_KEY = "xigui-eye-rest-state";
const ENABLED_EVENT = "xigui-eye-rest-changed";
const STATE_EVENT = "xigui-eye-rest-state";

export type EyeRestPhase = "idle" | "prompt" | "resting";

type PersistedEyeRest = {
  phase: EyeRestPhase;
  /** idle 走表截止时刻；null 表示尚未开跑 */
  workDeadline: number | null;
  snoozeUntil: number;
  /** resting 结束时刻 */
  restEndsAt: number | null;
};

const DEFAULT_STATE: PersistedEyeRest = {
  phase: "idle",
  workDeadline: null,
  snoozeUntil: 0,
  restEndsAt: null,
};

export function isEyeRestEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) !== "false";
}

export function setEyeRestEnabled(enabled: boolean) {
  localStorage.setItem(ENABLED_KEY, enabled ? "true" : "false");
  window.dispatchEvent(new CustomEvent(ENABLED_EVENT, { detail: enabled }));
}

function readPersisted(): PersistedEyeRest {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as Partial<PersistedEyeRest>;
    return {
      phase: parsed.phase === "prompt" || parsed.phase === "resting" ? parsed.phase : "idle",
      workDeadline: typeof parsed.workDeadline === "number" ? parsed.workDeadline : null,
      snoozeUntil: typeof parsed.snoozeUntil === "number" ? parsed.snoozeUntil : 0,
      restEndsAt: typeof parsed.restEndsAt === "number" ? parsed.restEndsAt : null,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function writePersisted(state: PersistedEyeRest) {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(STATE_EVENT));
}

/** 跨面板/播放器/猫窗同步护眼开关 */
export function useEyeRestEnabled(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(isEyeRestEnabled);

  useEffect(() => {
    const sync = () => setEnabled(isEyeRestEnabled());
    const onStorage = (e: StorageEvent) => {
      if (e.key === ENABLED_KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(ENABLED_EVENT, sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(ENABLED_EVENT, sync);
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

/** 把「分钟」常数格式化成可读时长 */
export function formatEyeRestDuration(min: number): string {
  const sec = Math.round(min * 60);
  if (sec < 60) return `${sec} 秒`;
  if (sec % 60 === 0) return `${sec / 60} 分钟`;
  return `${min} 分钟`;
}

/**
 * 休息中：拉开/同步整屏黑底倒计时窗。
 * 卸载时不关黑屏（另一宿主可能仍在 resting），只在 phase 离开 resting 时关。
 */
export function useEyeRestBlackout(phase: EyeRestPhase, restLeft: number) {
  const restLeftRef = useRef(restLeft);
  restLeftRef.current = restLeft;

  useEffect(() => {
    let cancelled = false;
    async function syncOpen() {
      if (phase === "resting") {
        await openEyeRestOverlay().catch(() => undefined);
        if (cancelled) return;
        const { emit } = await import("@tauri-apps/api/event");
        await emit("eye-rest-tick", { restLeft: restLeftRef.current }).catch(() => undefined);
        return;
      }
      await closeEyeRestOverlay().catch(() => undefined);
    }
    syncOpen();
    return () => {
      cancelled = true;
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "resting") return;
    let cancelled = false;
    (async () => {
      const { emit } = await import("@tauri-apps/api/event");
      if (cancelled) return;
      await emit("eye-rest-tick", { restLeft }).catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, restLeft]);

  useEffect(() => {
    if (phase !== "resting") return;
    const unlisten = import("@tauri-apps/api/event").then(({ listen }) =>
      listen("eye-rest-request-sync", () => {
        import("@tauri-apps/api/event").then(({ emit }) =>
          emit("eye-rest-tick", { restLeft: restLeftRef.current }),
        );
      }),
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [phase]);
}

/**
 * 全局护眼状态机（播放器 / 猫窗共用同一条时间线）。
 * 用 localStorage 存绝对截止时刻，播↔不播切换不重置。
 */
export function useEyeRestReminder(enabled: boolean) {
  const [phase, setPhase] = useState<EyeRestPhase>(() => readPersisted().phase);
  const [restLeft, setRestLeft] = useState(EYE_REST_BREAK_SEC);
  const [workLeftSec, setWorkLeftSec] = useState<number | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const clearTick = useCallback(() => {
    if (tickTimer.current !== undefined) {
      window.clearInterval(tickTimer.current);
      tickTimer.current = undefined;
    }
  }, []);

  const applyState = useCallback((state: PersistedEyeRest) => {
    setPhase(state.phase);
    const now = Date.now();
    if (state.phase === "resting" && state.restEndsAt) {
      setRestLeft(Math.max(0, Math.ceil((state.restEndsAt - now) / 1000)));
      setWorkLeftSec(null);
      return;
    }
    if (state.phase === "prompt") {
      setWorkLeftSec(null);
      setRestLeft(EYE_REST_BREAK_SEC);
      return;
    }
    if (state.workDeadline && state.workDeadline > now) {
      setWorkLeftSec(Math.max(0, Math.ceil((state.workDeadline - now) / 1000)));
    } else {
      setWorkLeftSec(null);
    }
    setRestLeft(EYE_REST_BREAK_SEC);
  }, []);

  const ensureRunningState = useCallback((): PersistedEyeRest => {
    const now = Date.now();
    let state = readPersisted();

    if (!enabled) {
      const cleared = { ...DEFAULT_STATE };
      if (
        state.phase !== cleared.phase ||
        state.workDeadline !== cleared.workDeadline ||
        state.snoozeUntil !== cleared.snoozeUntil ||
        state.restEndsAt !== cleared.restEndsAt
      ) {
        writePersisted(cleared);
      }
      return cleared;
    }

    // resting 到点 → 下一轮 idle
    if (state.phase === "resting") {
      if (state.restEndsAt && state.restEndsAt <= now) {
        state = {
          phase: "idle",
          workDeadline: now + EYE_REST_WORK_MIN * 60 * 1000,
          snoozeUntil: 0,
          restEndsAt: null,
        };
        writePersisted(state);
      }
      return state;
    }

    if (state.phase === "prompt") {
      return state;
    }

    // idle：snooze 中先不走表
    if (state.snoozeUntil > now) {
      if (state.workDeadline !== null) {
        state = { ...state, workDeadline: null };
        writePersisted(state);
      }
      return state;
    }

    // idle：工时已到 → prompt
    if (state.workDeadline !== null && state.workDeadline <= now) {
      state = {
        phase: "prompt",
        workDeadline: null,
        snoozeUntil: 0,
        restEndsAt: null,
      };
      writePersisted(state);
      return state;
    }

    // idle：还没开跑（或 snooze 刚结束）→ 启动/续跑全局工时
    if (state.workDeadline === null) {
      state = {
        phase: "idle",
        workDeadline: now + EYE_REST_WORK_MIN * 60 * 1000,
        snoozeUntil: 0,
        restEndsAt: null,
      };
      writePersisted(state);
    }

    return state;
  }, [enabled]);

  // 主循环：全局 tick，跨窗靠 storage 同步
  useEffect(() => {
    const syncFromStore = () => {
      applyState(ensureRunningState());
    };

    syncFromStore();
    clearTick();
    tickTimer.current = window.setInterval(syncFromStore, 1000);

    const onStorage = (e: StorageEvent) => {
      if (e.key === STATE_KEY || e.key === ENABLED_KEY) syncFromStore();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(STATE_EVENT, syncFromStore);
    window.addEventListener(ENABLED_EVENT, syncFromStore);

    return () => {
      clearTick();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(STATE_EVENT, syncFromStore);
      window.removeEventListener(ENABLED_EVENT, syncFromStore);
    };
  }, [applyState, clearTick, ensureRunningState]);

  const startRest = useCallback(() => {
    const next: PersistedEyeRest = {
      phase: "resting",
      workDeadline: null,
      snoozeUntil: 0,
      restEndsAt: Date.now() + EYE_REST_BREAK_SEC * 1000,
    };
    writePersisted(next);
    applyState(next);
  }, [applyState]);

  const snooze = useCallback(() => {
    const next: PersistedEyeRest = {
      phase: "idle",
      workDeadline: null,
      snoozeUntil: Date.now() + EYE_REST_SNOOZE_MIN * 60 * 1000,
      restEndsAt: null,
    };
    writePersisted(next);
    applyState(next);
  }, [applyState]);

  const dismissPrompt = useCallback(() => {
    snooze();
  }, [snooze]);

  return {
    phase,
    restLeft,
    workLeftSec,
    startRest,
    snooze,
    dismissPrompt,
  };
}
