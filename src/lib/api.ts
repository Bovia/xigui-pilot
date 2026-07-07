import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import type { CatalogSnapshot, Settings } from "./types";

export const getCatalog = () => invoke<CatalogSnapshot>("get_catalog");

export const getSettings = () => invoke<Settings>("get_settings");

export const setRootDir = (rootDir: string) =>
  invoke<Settings>("set_root_dir", { rootDir });

/** 非阻塞选目录，避免 Rust blocking 对话框卡死主线程 */
export async function pickRootDir(): Promise<Settings | null> {
  await invoke("prepare_dialog");

  const selected = await open({
    directory: true,
    multiple: false,
    title: "选择资料库文件夹",
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

export const openPlayer = (videoId: string, title: string) =>
  invoke<void>("open_player", { videoId, title });

export const resolveVideoPath = (videoId: string) =>
  invoke<string>("resolve_video_path", { videoId });

export const saveVideoProgress = (
  videoId: string,
  position: number,
  duration: number,
) => invoke("save_video_progress", { videoId, position, duration });

export const openExternalVideo = (videoId: string) =>
  invoke<void>("open_external_video", { videoId });

export const quitApp = () => invoke<void>("quit_app");
