import { useEffect, useMemo, useRef, useState } from "react";
import { getProgress, loadPlan } from "../lib/api";
import CloseButton from "./CloseButton";
import PlanTableModal from "./PlanTableModal";
import {
  buildWeekDailyPlan,
  dynamicStatus,
  todayIso,
  type WeekDayRow,
} from "../lib/dynamicPlan";
import {
  planVariantForView,
  readPlanSheetView,
  writePlanSheetView,
} from "../lib/planSheetView";
import type { LiveSession, PlanFile, PlanMilestone, PlanSheetView, PlanWeek } from "../lib/types";

const PLAN_OPTIONS: Array<{
  id: PlanSheetView;
  label: string;
  hint: string;
}> = [
  {
    id: "overview",
    label: "考纲优化版",
    hint: "2024 大纲 · 16 周总览",
  },
  {
    id: "wenOverview",
    label: "文老师规划",
    hint: "四阶段 · 60/30/10/2h",
  },
  {
    id: "weekDaily",
    label: "本周详细安排",
    hint: "按进度动态 · 工作日逐日",
  },
];

function formatRange(start: string, end: string) {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  return `${s.getMonth() + 1}/${s.getDate()}–${e.getMonth() + 1}/${e.getDate()}`;
}

function formatDay(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function phaseTone(phase: string) {
  if (phase.includes("输入")) return "bg-sky-100 text-sky-700";
  if (phase.includes("核心")) return "bg-violet-100 text-violet-700";
  if (phase.includes("巩固")) return "bg-emerald-100 text-emerald-700";
  if (phase.includes("输出")) return "bg-amber-100 text-amber-800";
  if (phase.includes("冲刺")) return "bg-rose-100 text-rose-700";
  return "bg-slate-100 text-slate-600";
}

function isLiveSoon(session: LiveSession, today: string) {
  const diff =
    (parseLocalMs(session.date) - parseLocalMs(today)) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= 7;
}

function parseLocalMs(iso: string) {
  return new Date(`${iso}T00:00:00`).getTime();
}

function formatLiveDate(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function activeLiveSession(sessions: LiveSession[] | undefined, today: string) {
  if (!sessions?.length) return null;
  const upcoming = sessions.find((s) => s.date >= today);
  return upcoming ?? sessions[sessions.length - 1];
}

function isWithinRange(today: string, start: string, end: string) {
  return today >= start && today <= end;
}

function activeMilestone(milestones: PlanMilestone[] | undefined, today: string) {
  return milestones?.find((m) => isWithinRange(today, m.start, m.end));
}

function formatProgressLine(st: ReturnType<typeof dynamicStatus>) {
  if (st.remaining === 0) return "已全部完成";
  if (st.nextLesson) return `${st.done}/${st.total} · 下节 ${st.nextLesson.no}`;
  return `${st.done}/${st.total}`;
}

const DEFAULT_REGISTRATION: PlanMilestone = {
  id: "register",
  title: "网上报名",
  start: "2026-08-15",
  end: "2026-09-05",
  note: "中国计算机技术职业资格网 · 8月中旬至9月上旬，切勿错过",
};

function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
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
  const [view, setView] = useState<PlanSheetView>(readPlanSheetView);
  const [weeks, setWeeks] = useState<PlanWeek[]>([]);
  const [liveSessions, setLiveSessions] = useState<LiveSession[]>([]);
  const [examDate, setExamDate] = useState<string | null>(null);
  const [milestones, setMilestones] = useState<PlanMilestone[]>([]);
  const [weekDaily, setWeekDaily] = useState<WeekDayRow[]>([]);
  const [progressLine, setProgressLine] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeOption = PLAN_OPTIONS.find((o) => o.id === view) ?? PLAN_OPTIONS[0];

  const today = useMemo(() => todayIso(), [open]);

  function isWithinRangeLocal(today: string, start: string, end: string) {
    return today >= start && today <= end;
  }

  const registration = useMemo(() => {
    const active = activeMilestone(milestones, today);
    if (active) return active;
    if (isWithinRangeLocal(today, DEFAULT_REGISTRATION.start, DEFAULT_REGISTRATION.end)) {
      return DEFAULT_REGISTRATION;
    }
    return null;
  }, [milestones, today]);

  useEffect(() => {
    if (!open) {
      setMenuOpen(false);
      setTableOpen(false);
      return;
    }
    setLoading(true);
    setError(null);
    const planVariant = planVariantForView(view);
    Promise.all([loadPlan(planVariant) as Promise<PlanFile>, getProgress()])
      .then(async ([plan, progress]) => {
        setWeeks(plan.weeks ?? []);
        setLiveSessions(plan.liveSessions ?? []);
        setExamDate(plan.examDate ?? null);
        setMilestones(plan.milestones ?? [DEFAULT_REGISTRATION]);

        const weekId = currentWeekId ?? plan.weeks?.[0]?.id ?? "W1";
        if (view === "weekDaily") {
          const v2 = (await loadPlan("v2")) as PlanFile;
          setWeekDaily(buildWeekDailyPlan(v2, progress.videos, today, weekId));
          const st = dynamicStatus(v2, progress.videos, today);
          setProgressLine(formatProgressLine(st));
        } else {
          setWeekDaily([]);
          const st = dynamicStatus(plan, progress.videos, today);
          setProgressLine(formatProgressLine(st));
        }
      })
      .catch((e) => {
        setWeeks([]);
        setWeekDaily([]);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, [open, currentWeekId, today, view]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  const switchView = (next: PlanSheetView) => {
    setView(next);
    setMenuOpen(false);
    writePlanSheetView(next);
  };

  const nextLive = view === "wenOverview" ? activeLiveSession(liveSessions, today) : null;

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
                {examDate && `考试 ${examDate.replace(/-/g, "/")}`}
                {daysToExam != null && daysToExam >= 0 && ` · 剩 ${daysToExam} 天`}
                {progressLine && ` · ${progressLine}`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={menuOpen}
                  aria-label="切换计划视图"
                  title="切换视图"
                  className={`study-plan-tool-btn flex items-center gap-0.5 rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
                    menuOpen
                      ? "border-slate-300 bg-slate-100 text-slate-800"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span className="max-w-[88px] truncate">{activeOption.label}</span>
                  <ChevronDownIcon open={menuOpen} />
                </button>
                {menuOpen && (
                  <div
                    role="listbox"
                    className="study-plan-menu absolute right-0 top-full z-40 mt-1 min-w-[196px] overflow-hidden rounded-xl border border-slate-200/80 bg-white py-1 shadow-lg"
                  >
                    {PLAN_OPTIONS.map((option) => {
                      const selected = option.id === view;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => switchView(option.id)}
                          className={`w-full px-3 py-2 text-left transition ${
                            selected ? "bg-blue-50" : "hover:bg-slate-50"
                          }`}
                        >
                          <div
                            className={`text-[12px] font-medium ${
                              selected ? "text-blue-700" : "text-slate-800"
                            }`}
                          >
                            {option.label}
                            {selected && " ✓"}
                          </div>
                          <div className="mt-0.5 text-[10px] text-slate-500">{option.hint}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setTableOpen(true);
                }}
                title="表格视图（HTML）"
                className="study-plan-tool-btn rounded-lg px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50"
              >
                表格
              </button>
              <CloseButton onClick={onClose} />
            </div>
          </div>

          {nextLive && (
            <div className="mb-3 rounded-xl border border-violet-200 bg-violet-50/80 px-3 py-2.5">
              <div className="text-[12px] font-semibold text-violet-900">
                直播第 {nextLive.no} 次 · {formatLiveDate(nextLive.date)} {nextLive.time}
                {nextLive.date === today && (
                  <span className="ml-1.5 rounded bg-violet-200 px-1.5 py-0.5 text-[9px] font-medium text-violet-800">
                    今天
                  </span>
                )}
                {isLiveSoon(nextLive, today) && nextLive.date !== today && (
                  <span className="ml-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-[9px] text-violet-700">
                    本周
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] leading-5 text-violet-800">{nextLive.title}</p>
              {nextLive.format && (
                <p className="mt-0.5 text-[10px] text-violet-600">{nextLive.format}</p>
              )}
            </div>
          )}

          {registration && (
            <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5">
              <div className="text-[12px] font-semibold text-amber-900">
                ⚠️ {registration.title}（{registration.start.replace(/-/g, "/")} –{" "}
                {registration.end.replace(/-/g, "/")}）
              </div>
              <p className="mt-0.5 text-[11px] leading-5 text-amber-800">
                {registration.note ?? "请尽快完成报名，避免错过本次考期。"}
              </p>
            </div>
          )}

          {error && (
            <div className="mb-3 rounded-lg bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">
              {error}
            </div>
          )}

          {loading && <div className="py-6 text-center text-sm text-slate-500">加载中…</div>}

          {!loading && view === "weekDaily" && (
            <div className="space-y-2">
              {weekDaily.map((row) => (
                <div
                  key={row.date}
                  className={`study-plan-week-card rounded-xl border px-3 py-2.5 ${
                    row.isToday
                      ? "border-blue-300 bg-blue-50/60 ring-1 ring-blue-200"
                      : row.isWeekend
                        ? "border-dashed border-slate-200/80 bg-slate-50/50 opacity-75"
                        : "border-slate-200/80 bg-white"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                        row.isToday ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
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

          {!loading && (view === "overview" || view === "wenOverview") && (
            <div className="space-y-2">
              {weeks.map((week) => {
                const isCurrent = week.id === currentWeekId;
                const isRegisterWeek = week.id === "W6" || week.id === "W7";
                return (
                  <div
                    key={week.id}
                    className={`study-plan-week-card rounded-xl border px-3 py-2.5 ${
                      isCurrent
                        ? "border-blue-300 bg-blue-50/60 ring-1 ring-blue-200"
                        : isRegisterWeek && registration
                          ? "border-amber-200 bg-amber-50/40"
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
                          {isRegisterWeek && registration && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-800">
                              报考
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-[12px] font-medium leading-5 text-slate-800">
                          {week.focus}
                        </div>
                        {week.caseArrangement && week.caseArrangement !== "—" && (
                          <div className="mt-0.5 text-[10px] text-slate-500">
                            案例/论文：{week.caseArrangement}
                          </div>
                        )}
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

      <PlanTableModal
        open={tableOpen}
        onClose={() => setTableOpen(false)}
        title="2026 学习计划表"
        examDate={examDate}
        daysToExam={daysToExam}
        viewLabel={activeOption.label}
        weeks={weeks}
        weekDaily={view === "weekDaily" ? weekDaily : undefined}
        currentWeekId={currentWeekId}
      />
    </>
  );
}
