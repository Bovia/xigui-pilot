import { useEffect, useMemo, useState } from "react";
import { getProgress, loadPlan } from "../lib/api";
import CloseButton from "./CloseButton";
import PlanTableModal from "./PlanTableModal";
import {
  applyTodayPacePlan,
  buildPaceWeekDailyPlan,
  estimateFinishDate,
  paceStatus,
  todayIso,
} from "../lib/pacePlan";
import { formatPaceVsWen, wenRecordingFinishDate } from "../lib/wenCatchUp";
import {
  PACE_HOURS_MAX,
  PACE_HOURS_MIN,
  PACE_HOURS_STEP,
  PACE_PRESETS,
  PACE_CHANGED_EVENT,
  readDailyStudyHours,
  writeDailyStudyHours,
} from "../lib/studyPace";
import type { PlanFile } from "../lib/types";
import type { WeekDayRow } from "../lib/dynamicPlan";

function formatDay(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatProgressLine(st: ReturnType<typeof paceStatus>) {
  if (st.remaining === 0) return "已完成";
  return `${st.done}/${st.total}`;
}

export default function StudyPlanSheet({
  open,
  onClose,
  daysToExam,
}: {
  open: boolean;
  onClose: () => void;
  daysToExam?: number;
}) {
  const [appliedHours, setAppliedHours] = useState(readDailyStudyHours);
  const [previewHours, setPreviewHours] = useState<number | null>(null);
  const [weekDaily, setWeekDaily] = useState<WeekDayRow[]>([]);
  const [examDate, setExamDate] = useState<string | null>(null);
  const [progressLine, setProgressLine] = useState("");
  const [finishDate, setFinishDate] = useState<string | null>(null);
  const [wenFinishDate, setWenFinishDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableOpen, setTableOpen] = useState(false);

  const today = useMemo(() => todayIso(), [open]);
  const activeHours = previewHours ?? appliedHours;
  const isPreview = previewHours != null && previewHours !== appliedHours;
  const paceVsWen = useMemo(
    () => formatPaceVsWen(finishDate, wenFinishDate, formatDay),
    [finishDate, wenFinishDate],
  );

  useEffect(() => {
    if (!open) {
      setTableOpen(false);
      setPreviewHours(null);
      return;
    }
    setAppliedHours(readDailyStudyHours());
  }, [open]);

  useEffect(() => {
    const onPace = () => setAppliedHours(readDailyStudyHours());
    window.addEventListener(PACE_CHANGED_EVENT, onPace);
    return () => window.removeEventListener(PACE_CHANGED_EVENT, onPace);
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    Promise.all([
      loadPlan("default") as Promise<PlanFile>,
      loadPlan("wen") as Promise<PlanFile>,
      getProgress(),
    ])
      .then(([plan, planWen, progress]) => {
        setExamDate(plan.examDate ?? null);
        setWeekDaily(
          buildPaceWeekDailyPlan(plan, progress.videos, today, activeHours, {
            useLock: !isPreview,
          }),
        );
        const finish = estimateFinishDate(plan, progress.videos, today, activeHours);
        setFinishDate(finish);
        setWenFinishDate(wenRecordingFinishDate(planWen));
        setProgressLine(formatProgressLine(paceStatus(plan, progress.videos)));
      })
      .catch((e) => {
        setWeekDaily([]);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, [open, today, activeHours, isPreview]);

  const applyNow = () => {
    const hours = activeHours;
    writeDailyStudyHours(hours);
    setAppliedHours(hours);
    setPreviewHours(null);
    Promise.all([loadPlan("default") as Promise<PlanFile>, getProgress()]).then(
      ([plan, progress]) => {
        applyTodayPacePlan(plan, progress.videos, today, hours);
        setWeekDaily(
          buildPaceWeekDailyPlan(plan, progress.videos, today, hours, { useLock: true }),
        );
        setFinishDate(estimateFinishDate(plan, progress.videos, today, hours));
      },
    );
  };

  const previewOnly = (hours: number) => {
    setPreviewHours(hours);
  };

  if (!open) return null;

  return (
    <>
      <div
        className="study-plan-backdrop absolute inset-0 z-30 flex items-end justify-center bg-slate-900/20 p-3"
        onClick={onClose}
      >
        <div
          className="study-plan-sheet panel-scroll max-h-[88%] w-full overflow-y-auto rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-slate-900">2026 学习计划表</h2>
              <p className="mt-1 text-[11px] text-slate-500">
                {examDate && `考 ${examDate.replace(/-/g, "/").replace(/^\d{4}\//, "")}`}
                {daysToExam != null && daysToExam >= 0 && ` · 剩${daysToExam}天`}
                {progressLine && ` · ${progressLine}`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setTableOpen(true)}
                title="表格视图（HTML）"
                className="study-plan-tool-btn rounded-lg px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50"
              >
                表格
              </button>
              <CloseButton onClick={onClose} />
            </div>
          </div>

          <div className="mb-3 rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium text-slate-700">每日时长</span>
              <span className="text-[12px] font-semibold tabular-nums text-slate-900">
                {activeHours.toFixed(1)}h
              </span>
            </div>
            <input
              type="range"
              min={PACE_HOURS_MIN}
              max={PACE_HOURS_MAX}
              step={PACE_HOURS_STEP}
              value={activeHours}
              onChange={(e) => previewOnly(Number(e.target.value))}
              className="study-pace-slider mt-2 w-full"
              aria-label="每天学习时长"
            />
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {PACE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => previewOnly(preset.hours)}
                  className={`rounded-lg px-2 py-0.5 text-[10px] font-medium transition ${
                    appliedHours === preset.hours && !isPreview
                      ? "bg-blue-600 text-white"
                      : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {preset.hours}h
                </button>
              ))}
              <button
                type="button"
                onClick={applyNow}
                className={`ml-auto rounded-lg px-2.5 py-1 text-[10px] font-semibold transition ${
                  isPreview
                    ? "bg-blue-600 text-white hover:bg-blue-700"
                    : "bg-slate-700 text-white hover:bg-slate-800"
                }`}
              >
                生效
              </button>
            </div>
            <p className="mt-2 text-[10px] leading-5 text-slate-500">
              {finishDate ? (
                <>
                  <span className="font-medium text-slate-700">{formatDay(finishDate)}</span> 刷完
                </>
              ) : (
                "已全部完成"
              )}
              {paceVsWen && (
                <span
                  title={
                    wenFinishDate
                      ? `文老师课表最后一节 ${formatDay(wenFinishDate)}`
                      : undefined
                  }
                  className={
                    paceVsWen.canKeepUp ? "font-medium text-emerald-600" : "font-medium text-rose-600"
                  }
                >
                  {" "}
                  · {paceVsWen.text}
                </span>
              )}
              {isPreview ? (
                <span className="text-blue-600"> · 预览</span>
              ) : (
                <span className="text-slate-400"> · 已同步</span>
              )}
            </p>
          </div>

          {error && (
            <div className="mb-3 rounded-lg bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">
              {error}
            </div>
          )}

          {loading && <div className="py-6 text-center text-sm text-slate-500">加载中…</div>}

          {!loading && (
            <div className="space-y-2">
              {weekDaily.map((row) => (
                <div
                  key={row.date}
                  className={`study-plan-week-card rounded-xl border px-3 py-2.5 ${
                    row.isToday
                      ? "border-blue-300 bg-blue-50/60 ring-1 ring-blue-200"
                      : row.isPast
                        ? "border-slate-200/60 bg-slate-50/40"
                        : row.isWeekend
                          ? "border-dashed border-slate-200/80 bg-slate-50/50 opacity-75"
                          : "border-slate-200/80 bg-white"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                        row.isToday
                          ? "bg-blue-600 text-white"
                          : row.isPast
                            ? "bg-slate-200 text-slate-500"
                            : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      周{row.weekday}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] tabular-nums text-slate-500">
                          {formatDay(row.date)}
                        </span>
                        {row.isToday && (
                          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-medium text-blue-700">
                            今天
                          </span>
                        )}
                        {row.isPast && row.lessons.length > 0 && (
                          <span className="text-[9px] text-slate-400">
                            {row.lessons.every((l) => l.done) ? "已学完" : "已学"}
                          </span>
                        )}
                        {row.isWeekend && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500">
                            休息
                          </span>
                        )}
                      </div>
                      {row.isWeekend ? (
                        <div className="mt-1 text-[12px] text-slate-500">{row.note}</div>
                      ) : row.lessons.length > 0 ? (
                        row.lessons.map((l) => (
                          <div
                            key={l.lessonNo}
                            className={`mt-1 text-[12px] font-medium leading-5 ${
                              l.done ? "text-slate-400 line-through" : "text-slate-800"
                            }`}
                          >
                            [{l.lessonNo}] {l.title}
                            {l.done && " ✓"}
                            {!l.done && l.inProgress && (
                              <span className="ml-1 text-[10px] font-normal text-amber-600">
                                续播
                              </span>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="mt-1 text-[12px] text-slate-500">{row.note ?? "—"}</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <PlanTableModal
        open={tableOpen}
        onClose={() => setTableOpen(false)}
        title="2026 学习计划表"
        examDate={examDate}
        daysToExam={daysToExam}
        viewLabel="动态逐日安排"
        weeks={[]}
        weekDaily={weekDaily}
      />
    </>
  );
}
