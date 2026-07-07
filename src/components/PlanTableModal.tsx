import CloseButton from "./CloseButton";
import type { PlanWeek } from "../lib/types";
import type { WeekDayRow } from "../lib/dynamicPlan";

function formatDateShort(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function PlanTableModal({
  open,
  onClose,
  title,
  examDate,
  daysToExam,
  viewLabel,
  weeks,
  weekDaily,
  currentWeekId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  examDate?: string | null;
  daysToExam?: number;
  viewLabel: string;
  weeks: PlanWeek[];
  weekDaily?: WeekDayRow[];
  currentWeekId?: string;
}) {
  if (!open) return null;

  return (
    <div
      className="study-plan-backdrop absolute inset-0 z-40 flex items-end justify-center bg-slate-900/25 p-3"
      onClick={onClose}
    >
      <div
        className="study-plan-sheet plan-table-modal panel-scroll max-h-[90%] w-full overflow-y-auto rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
            <p className="mt-1 text-[11px] text-slate-500">
              {viewLabel}
              {examDate && ` · 考试 ${examDate.replace(/-/g, "/")}`}
              {daysToExam != null && daysToExam >= 0 && ` · 剩 ${daysToExam} 天`}
            </p>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        {weekDaily ? (
          <div className="plan-html-table overflow-x-auto rounded-xl border border-slate-200/80">
            <table className="w-full min-w-[320px] border-collapse text-left text-[11px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-600">
                  <th className="px-3 py-2 font-medium">日期</th>
                  <th className="px-3 py-2 font-medium">星期</th>
                  <th className="px-3 py-2 font-medium">安排</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {weekDaily.map((row) => (
                  <tr
                    key={row.date}
                    className={`border-b border-slate-100 ${
                      row.isToday ? "bg-blue-50/50" : row.isWeekend ? "opacity-60" : ""
                    }`}
                  >
                    <td className="px-3 py-2 tabular-nums">{formatDateShort(row.date)}</td>
                    <td className="px-3 py-2">周{row.weekday}</td>
                    <td className="px-3 py-2 leading-5 text-slate-800">
                      {row.isWeekend
                        ? row.note
                        : row.lessons.length > 0
                          ? row.lessons
                              .map((l) => `[${l.lessonNo}] ${l.title}`)
                              .join("；")
                          : row.note ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {row.isWeekend
                        ? "—"
                        : row.lessons.length === 0
                          ? row.note ?? "—"
                          : row.lessons.every((l) => l.done)
                            ? "已完成"
                            : row.isPast
                              ? "未完成"
                              : "待学习"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="plan-html-table overflow-x-auto rounded-xl border border-slate-200/80">
            <table className="w-full min-w-[360px] border-collapse text-left text-[11px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-600">
                  <th className="px-3 py-2 font-medium">周次</th>
                  <th className="px-3 py-2 font-medium">日期</th>
                  <th className="px-3 py-2 font-medium">阶段</th>
                  <th className="px-3 py-2 font-medium">核心内容</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((week) => (
                  <tr
                    key={week.id}
                    className={`border-b border-slate-100 ${
                      week.id === currentWeekId ? "bg-blue-50/50" : ""
                    }`}
                  >
                    <td className="px-3 py-2 font-medium tabular-nums">{week.id}</td>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                      {formatDateShort(week.start)}–{formatDateShort(week.end)}
                    </td>
                    <td className="px-3 py-2">{week.phase}</td>
                    <td className="px-3 py-2 leading-5 text-slate-800">{week.focus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-[10px] leading-5 text-slate-400">
          随学习进度更新；工作日排课，周末休息。
        </p>
      </div>
    </div>
  );
}
