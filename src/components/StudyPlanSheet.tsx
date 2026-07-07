import { useEffect, useState } from "react";
import { loadPlan } from "../lib/api";
import type { PlanFile, PlanWeek } from "../lib/types";

function formatRange(start: string, end: string) {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  return `${s.getMonth() + 1}/${s.getDate()}–${e.getMonth() + 1}/${e.getDate()}`;
}

function phaseTone(phase: string) {
  if (phase.includes("输入")) return "bg-sky-100 text-sky-700";
  if (phase.includes("核心")) return "bg-violet-100 text-violet-700";
  if (phase.includes("巩固")) return "bg-emerald-100 text-emerald-700";
  if (phase.includes("输出")) return "bg-amber-100 text-amber-800";
  if (phase.includes("冲刺")) return "bg-rose-100 text-rose-700";
  return "bg-slate-100 text-slate-600";
}

export default function StudyPlanSheet({
  open,
  onClose,
  currentWeekId,
  daysToExam,
}: {
  open: boolean;
  onClose: () => void;
  currentWeekId?: string;
  daysToExam?: number;
}) {
  const [weeks, setWeeks] = useState<PlanWeek[]>([]);
  const [examDate, setExamDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    loadPlan()
      .then((plan: PlanFile) => {
        setWeeks(plan.weeks ?? []);
        setExamDate(plan.examDate ?? null);
      })
      .catch(() => {
        setWeeks([]);
        setExamDate(null);
      })
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-30 flex items-end justify-center bg-slate-900/20 p-3"
      onClick={onClose}
    >
      <div
        className="panel-scroll max-h-[88%] w-full overflow-y-auto rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">2026 学习计划表</h2>
            <p className="mt-1 text-[11px] text-slate-500">
              16 周备考安排
              {examDate && ` · 考试 ${examDate.replace(/-/g, "/")}`}
              {daysToExam != null && daysToExam >= 0 && ` · 还剩 ${daysToExam} 天`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            关闭
          </button>
        </div>

        {loading && <div className="py-6 text-center text-sm text-slate-500">加载中…</div>}

        {!loading && (
          <div className="space-y-2">
            {weeks.map((week) => {
              const isCurrent = week.id === currentWeekId;
              return (
                <div
                  key={week.id}
                  className={`rounded-xl border px-3 py-2.5 ${
                    isCurrent
                      ? "border-blue-300 bg-blue-50/60 ring-1 ring-blue-200"
                      : "border-slate-200/80 bg-white"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                        isCurrent ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {week.id}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] tabular-nums text-slate-500">
                          {formatRange(week.start, week.end)}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${phaseTone(week.phase)}`}
                        >
                          {week.phase}
                        </span>
                        {week.stage && (
                          <span className="text-[9px] text-slate-400">{week.stage}</span>
                        )}
                        {isCurrent && (
                          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-medium text-blue-700">
                            本周
                          </span>
                        )}
                      </div>
                      <div
                        className="mt-1 text-[12px] font-medium leading-5 text-slate-800"
                        title={week.focus}
                      >
                        {week.focus}
                      </div>
                      {week.tasks && week.tasks.length > 0 && (
                        <div className="mt-0.5 text-[10px] text-slate-400">
                          本周 {week.tasks.length} 节视频
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
