import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import type { PlanVariant, Settings, TodaySnapshot } from "./types";

export const getTodaySnapshot = () =>
  invoke<TodaySnapshot>("get_today_snapshot");

export const getSettings = () => invoke<Settings>("get_settings");

export const setRootDir = (rootDir: string) =>
  invoke<Settings>("set_root_dir", { rootDir });

export const setTextbookDir = (textbookDir: string) =>
  invoke<Settings>("set_textbook_dir", { textbookDir });

/** 非阻塞选目录，避免 Rust blocking 对话框卡死主线程 */
export async function pickRootDir(): Promise<Settings | null> {
  await invoke("prepare_dialog");

  const selected = await open({
    directory: true,
    multiple: false,
    title: "选择资料根目录（请选 Desktop/系规 文件夹）",
    defaultPath: `${await homeDir()}/Desktop/系规`,
  });

  if (selected === null) {
    await invoke("finish_dialog");
    return null;
  }

  const path = Array.isArray(selected) ? selected[0] : selected;
  const settings = await setRootDir(path);
  await invoke("finish_dialog");
  return settings;
}

/** 选择官方教材 PDF 文件 */
export async function pickTextbook(
  hintRoot?: string | null,
): Promise<Settings | null> {
  await invoke("prepare_dialog");

  let subdir = "03：官方教材";
  let filename = "【带书签可搜索】系统规划与管理师（第2版）.pdf";
  try {
    const tb = await loadTextbook();
    subdir = tb.textbookSubdir || subdir;
    filename = tb.textbookFilename || filename;
  } catch {
    /* use defaults */
  }

  const defaultPath = hintRoot
    ? `${hintRoot}/${subdir}/${filename}`
    : `${await homeDir()}/Desktop/系规/${subdir}/${filename}`;

  const selected = await open({
    directory: false,
    multiple: false,
    filters: [{ name: "PDF 教材", extensions: ["pdf"] }],
    title: "选择官方教材 PDF",
    defaultPath,
  });

  if (selected === null) {
    await invoke("finish_dialog");
    return null;
  }

  const path = Array.isArray(selected) ? selected[0] : selected;
  const settings = await setTextbookDir(path);
  await invoke("finish_dialog");
  return settings;
}

export const getPanelPinned = () => invoke<boolean>("get_panel_pinned");

export const setPanelPinned = (pinned: boolean) =>
  invoke<Settings>("set_panel_pinned", { pinned });

export const setWovenStyle = (enabled: boolean) =>
  invoke<Settings>("set_woven_style", { enabled });

export const getProgress = () =>
  invoke<{
    videos: Record<
      string,
      { position: number; duration: number; completed: boolean }
    >;
  }>("get_progress");

export const getLiveCatalog = () =>
  invoke<
    Array<{
      no: number;
      title: string;
      filename: string;
      category: string;
      missing: boolean;
    }>
  >("get_live_catalog");

export const openPlayer = (lessonNo: number) =>
  invoke<void>("open_player", { lessonNo });

export const resolveVideoPath = (lessonNo: number) =>
  invoke<string>("resolve_video_path", { lessonNo });

export const saveVideoProgress = (
  lessonNo: number,
  position: number,
  duration: number,
) =>
  invoke("save_video_progress", { lessonNo, position, duration });

export const openExternalVideo = (lessonNo: number) =>
  invoke<void>("open_external_video", { lessonNo });

export const openTextbook = (lessonNo: number) =>
  invoke<{ path: string; page?: number }>("open_textbook", { lessonNo });

export const openQuiz = (lessonNo: number) =>
  invoke<{
    chapterHint: string;
    miniProgramName: string;
    copiedLink: string;
    instruction: string;
  }>("open_quiz", { lessonNo });

export const markTaskDone = (taskId: string, done: boolean) =>
  invoke<void>("mark_task_done", { taskId, done });

export const quitApp = () => invoke<void>("quit_app");

export async function loadPlan(variant?: PlanVariant) {
  let v = variant;
  if (!v) {
    try {
      const settings = await getSettings();
      v = settings.planVariant === "default" ? "v2" : settings.planVariant === "v2" ? "v2" : "v2";
    } catch {
      v = "v2";
    }
  }
  const file = v === "v2" ? "/plan-v2.json" : "/plan.json";
  const res = await fetch(file);
  if (!res.ok) {
    throw new Error(`无法加载计划表：${file}`);
  }
  return res.json();
}

export const setPlanVariant = (variant: PlanVariant) =>
  invoke<Settings>("set_plan_variant", { variant });

export const resolveSubtitlePath = (lessonNo: number) =>
  invoke<{ path: string; format: "srt" | "vtt" } | null>("resolve_subtitle_path", {
    lessonNo,
  });

export const openSubtitleWindow = (lessonNo: number) =>
  invoke<void>("open_subtitle_window", { lessonNo });

export const closeSubtitleWindow = (lessonNo: number) =>
  invoke<void>("close_subtitle_window_cmd", { lessonNo });

export const setFloatingSubtitles = (enabled: boolean) =>
  invoke<Settings>("set_floating_subtitles", { enabled });

export const openPlanSpreadsheet = (variant: PlanVariant) =>
  invoke<void>("open_plan_spreadsheet", { variant });

export async function loadTextbook() {
  const res = await fetch("/textbook.json");
  return res.json();
}

export async function loadQuiz() {
  const res = await fetch("/quiz.json");
  return res.json() as Promise<{ name: string }>;
}
