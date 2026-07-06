import {
  EYE_REST_BREAK_SEC,
  EYE_REST_SNOOZE_MIN,
  EYE_REST_WORK_MIN,
} from "../lib/eyeRest";

export default function EyeRestPrompt({
  phase,
  restLeft,
  onStartRest,
  onSnooze,
  onDismiss,
  variant = "player",
}: {
  phase: "prompt" | "resting";
  restLeft: number;
  onStartRest: () => void;
  onSnooze: () => void;
  onDismiss?: () => void;
  variant?: "player" | "panel";
}) {
  const dark = variant === "player";

  if (phase === "resting") {
    return (
      <div
        className={`absolute inset-0 z-50 flex items-center justify-center ${
          dark ? "bg-slate-950" : "bg-white"
        }`}
      >
        <div className="px-6 text-center">
          <div
            className={`text-5xl font-semibold tabular-nums ${
              dark ? "text-emerald-300" : "text-emerald-600"
            }`}
          >
            {restLeft}
          </div>
          <p
            className={`mt-3 text-sm leading-6 ${
              dark ? "text-slate-200" : "text-slate-600"
            }`}
          >
            望向 <strong>6 米外</strong>（约窗外或远处墙面）
            <br />
            放松眼睛，眨眨眼
          </p>
          <p
            className={`mt-2 text-xs ${
              dark ? "text-slate-400" : "text-slate-400"
            }`}
          >
            20-20-20 · 剩余 {restLeft} 秒
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`absolute inset-x-0 bottom-0 z-50 border-t px-4 py-3 ${
        dark
          ? "border-slate-700 bg-slate-900 text-slate-100"
          : "border-amber-100 bg-amber-50 text-slate-800"
      }`}
    >
      <div className="text-sm font-medium">👁 该让眼睛休息一下了</div>
      <p
        className={`mt-1 text-xs leading-5 ${
          dark ? "text-slate-300" : "text-slate-600"
        }`}
      >
        20-20-20 法则：连续看屏 {EYE_REST_WORK_MIN} 分钟后，望向{" "}
        <strong>6 米外</strong>至少 {EYE_REST_BREAK_SEC} 秒，缓解视疲劳。
      </p>
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={onStartRest}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
            dark
              ? "bg-emerald-600 text-white hover:bg-emerald-500"
              : "bg-emerald-600 text-white hover:bg-emerald-500"
          }`}
        >
          开始 {EYE_REST_BREAK_SEC} 秒休息
        </button>
        <button
          type="button"
          onClick={onSnooze}
          className={`rounded-lg px-3 py-1.5 text-xs ${
            dark
              ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
              : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
          }`}
        >
          {EYE_REST_SNOOZE_MIN} 分钟后再提醒
        </button>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className={`ml-auto rounded-lg px-2 py-1.5 text-xs ${
              dark ? "text-slate-400 hover:text-slate-200" : "text-slate-400"
            }`}
          >
            关闭
          </button>
        )}
      </div>
    </div>
  );
}
