use crate::progress::ProgressStore;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

const VIDEO_EXTENSIONS: &[&str] = &[".mp4", ".mkv", ".mov", ".webm", ".m4v"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogVideo {
    pub id: String,
    pub title: String,
    pub filename: String,
    pub ext: String,
    pub folder: String,
    pub builtin_playable: bool,
    pub duration_sec: u32,
    pub position: f64,
    pub duration: f64,
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSection {
    pub id: String,
    pub title: String,
    pub videos: Vec<CatalogVideo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSnapshot {
    pub root_configured: bool,
    pub root_path: Option<String>,
    pub video_count: u32,
    pub completed_count: u32,
    pub sections: Vec<CatalogSection>,
}

pub fn build_snapshot(root: Option<&str>, progress: &ProgressStore) -> CatalogSnapshot {
    let Some(root) = root.filter(|r| Path::new(r).is_dir()) else {
        return CatalogSnapshot {
            root_configured: false,
            root_path: root.map(String::from),
            video_count: 0,
            completed_count: 0,
            sections: Vec::new(),
        };
    };

    let sections = scan_root(Path::new(root), progress);
    let video_count = sections.iter().map(|s| s.videos.len() as u32).sum();
    let completed_count = sections
        .iter()
        .flat_map(|s| &s.videos)
        .filter(|v| v.completed)
        .count() as u32;

    CatalogSnapshot {
        root_configured: true,
        root_path: Some(root.to_string()),
        video_count,
        completed_count,
        sections,
    }
}

pub fn count_incomplete(root: &str, progress: &ProgressStore) -> u32 {
    let snapshot = build_snapshot(Some(root), progress);
    snapshot.video_count.saturating_sub(snapshot.completed_count)
}

pub fn resolve_video_path(root: &str, video_id: &str) -> Result<PathBuf, String> {
    if video_id.contains("..") {
        return Err("无效的视频路径".into());
    }
    let root_path = Path::new(root);
    let full = root_path.join(video_id);
    let canonical_root = root_path
        .canonicalize()
        .map_err(|e| format!("资料目录不可访问：{e}"))?;
    let canonical_full = full
        .canonicalize()
        .map_err(|_| format!("视频不存在：{video_id}"))?;
    if !canonical_full.starts_with(&canonical_root) {
        return Err("无效的视频路径".into());
    }
    if !is_video_file(&canonical_full) {
        return Err(format!("不是支持的视频文件：{video_id}"));
    }
    Ok(canonical_full)
}

fn scan_root(root: &Path, progress: &ProgressStore) -> Vec<CatalogSection> {
    let mut grouped: BTreeMap<String, Vec<CatalogVideo>> = BTreeMap::new();
    collect_videos(root, root, progress, &mut grouped);
    grouped
        .into_iter()
        .map(|(id, mut videos)| {
            videos.sort_by(|a, b| a.filename.to_lowercase().cmp(&b.filename.to_lowercase()));
            let title = if id == "." {
                "根目录".to_string()
            } else {
                Path::new(&id)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(&id)
                    .to_string()
            };
            CatalogSection { id, title, videos }
        })
        .collect()
}

fn collect_videos(
    root: &Path,
    dir: &Path,
    progress: &ProgressStore,
    grouped: &mut BTreeMap<String, Vec<CatalogVideo>>,
) {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            collect_videos(root, &path, progress, grouped);
            continue;
        }
        if !is_video_file(&path) {
            continue;
        }
        let Some(rel) = path.strip_prefix(root).ok().and_then(|p| p.to_str()) else {
            continue;
        };
        let id = rel.replace('\\', "/");
        let folder = Path::new(&id)
            .parent()
            .and_then(|p| p.to_str())
            .filter(|s| !s.is_empty())
            .unwrap_or(".")
            .replace('\\', "/");
        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{e}"))
            .unwrap_or_default();
        let saved = progress.videos.get(&id);
        let probed = probe_duration(&path);
        let saved_duration = saved.map(|s| s.duration).unwrap_or(0.0);
        let duration = if saved_duration > 0.0 {
            saved_duration
        } else {
            probed as f64
        };
        grouped.entry(folder.clone()).or_default().push(CatalogVideo {
            id,
            title: title_from_filename(&filename),
            filename,
            ext: ext.clone(),
            folder,
            builtin_playable: ext.eq_ignore_ascii_case(".mp4"),
            duration_sec: probed,
            position: saved.map(|s| s.position).unwrap_or(0.0),
            duration,
            completed: saved.map(|s| s.completed).unwrap_or(false),
        });
    }
}

fn is_video_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| {
            let dotted = format!(".{ext}");
            VIDEO_EXTENSIONS
                .iter()
                .any(|candidate| candidate.eq_ignore_ascii_case(&dotted))
        })
        .unwrap_or(false)
}

fn title_from_filename(filename: &str) -> String {
    let stem = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);
    let stripped = stem
        .trim()
        .strip_prefix('[')
        .and_then(|rest| rest.split_once(']').map(|(_, tail)| tail))
        .unwrap_or(stem);
    stripped
        .trim_start_matches('-')
        .trim()
        .to_string()
}

fn probe_duration(path: &Path) -> u32 {
    if !path.is_file() {
        return 0;
    }

    if let Ok(output) = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(path)
        .output()
    {
        if output.status.success() {
            if let Ok(text) = String::from_utf8(output.stdout) {
                if let Ok(secs) = text.trim().parse::<f64>() {
                    return secs.max(0.0) as u32;
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = Command::new("mdls")
            .args(["-name", "kMDItemDurationSeconds", "-raw"])
            .arg(path)
            .output()
        {
            if output.status.success() {
                if let Ok(text) = String::from_utf8(output.stdout) {
                    let trimmed = text.trim();
                    if trimmed != "(null)" {
                        if let Ok(secs) = trimmed.parse::<f64>() {
                            return secs.max(0.0) as u32;
                        }
                    }
                }
            }
        }
    }

    0
}
