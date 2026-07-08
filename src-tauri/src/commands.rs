use crate::progress::{progress_path, ProgressStore, VideoProgress};
use crate::settings::{settings_path, Settings};
use crate::{activate_for_action, close_subtitle_window, ensure_player_window, ensure_subtitle_window, restore_accessory, set_panel_hide_suppressed};
use chrono::{Local, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TodayTask {
    pub id: String,
    pub task_type: String,
    pub title: String,
    pub lesson_no: Option<u32>,
    pub missing: bool,
    pub done: bool,
    pub position: f64,
    pub duration: f64,
    pub completed: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TodaySnapshot {
    pub date: String,
    pub week_id: String,
    pub week_label: String,
    pub phase: String,
    pub focus: String,
    pub week_done: u32,
    pub week_total: u32,
    pub days_to_exam: i64,
    pub root_configured: bool,
    pub missing_lessons: Vec<u32>,
    pub preview_mode: bool,
    pub root_path: Option<String>,
    pub videos_ready: u32,
    pub videos_total: u32,
    pub week_lesson_nos: Vec<u32>,
    pub tasks: Vec<TodayTask>,
    pub today_pending: u32,
    pub plan_variant: String,
    pub plan_name: String,
}

fn video_subdir_from_plan(plan: &Value) -> String {
    plan.get("videoSubdir")
        .and_then(|v| v.as_str())
        .unwrap_or("01：基础课视频（已完结）")
        .to_string()
}

fn lesson_video_subdir(lesson: &Value, plan: &Value) -> String {
    lesson
        .get("videoSubdir")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| video_subdir_from_plan(plan))
}

fn lesson_video_path(root: &str, plan: &Value, lesson: &Value) -> Option<PathBuf> {
    let filename = lesson.get("filename")?.as_str()?;
    let subdir = lesson_video_subdir(lesson, plan);
    let path = resolve_video_dir(root, &subdir).join(filename);
    if path.exists() { Some(path) } else { None }
}

fn dir_has_lesson_videos(dir: &Path) -> bool {
    fs::read_dir(dir)
        .ok()
        .map(|entries| {
            entries.filter_map(|e| e.ok()).any(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                name.starts_with('[')
                    && (name.ends_with(".mp4") || name.ends_with(".mkv"))
            })
        })
        .unwrap_or(false)
}

fn normalize_material_root(raw: &str, video_subdir: &str) -> String {
    let path = Path::new(raw.trim());
    if !path.exists() {
        return raw.to_string();
    }
    if path.join(video_subdir).is_dir() {
        return path.to_string_lossy().to_string();
    }
    if path
        .file_name()
        .is_some_and(|n| n.to_string_lossy() == video_subdir)
        || dir_has_lesson_videos(path)
    {
        return path
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| raw.to_string());
    }
    raw.to_string()
}

fn resolve_video_dir(root: &str, video_subdir: &str) -> PathBuf {
    let root_path = Path::new(root);
    let nested = root_path.join(video_subdir);
    if nested.is_dir() {
        return nested;
    }
    if dir_has_lesson_videos(root_path) {
        return root_path.to_path_buf();
    }
    nested
}

const LIVE_SUBDIR: &str = "03：直播课（陆续更新上传）";
const LIVE_NO_START: u32 = 701;
const LIVE_NO_MAX: u32 = 50;

fn is_playable_video(name: &str) -> bool {
    (name.ends_with(".mp4") || name.ends_with(".mkv"))
        && !name.ends_with(".downloading")
        && !name.contains(".baiduyun.p.downloading")
}

fn live_title_from_filename(filename: &str) -> String {
    let stem = filename
        .trim_end_matches(".mp4")
        .trim_end_matches(".mkv");
    if let Some(idx) = stem.find("--") {
        return stem[idx + 2..].to_string();
    }
    if let Some(idx) = stem.find(']') {
        return stem[idx + 1..]
            .trim_start_matches('-')
            .trim_start_matches('_')
            .to_string();
    }
    stem.to_string()
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LiveCatalogLesson {
    pub no: u32,
    pub title: String,
    pub filename: String,
    pub category: String,
    pub missing: bool,
}

fn scan_live_lessons(root: &str) -> Vec<LiveCatalogLesson> {
    let dir = resolve_video_dir(root, LIVE_SUBDIR);
    if !dir.is_dir() {
        return Vec::new();
    }
    let mut files: Vec<String> = fs::read_dir(&dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|name| is_playable_video(name))
        .collect();
    files.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));

    files
        .into_iter()
        .enumerate()
        .take(LIVE_NO_MAX as usize)
        .map(|(i, filename)| {
            let no = LIVE_NO_START + i as u32;
            let path = dir.join(&filename);
            LiveCatalogLesson {
                no,
                title: live_title_from_filename(&filename),
                filename,
                category: "live".into(),
                missing: !path.is_file(),
            }
        })
        .collect()
}

fn resolve_live_video_path(root: &str, lesson_no: u32) -> Option<PathBuf> {
    scan_live_lessons(root)
        .into_iter()
        .find(|l| l.no == lesson_no)
        .map(|l| resolve_video_dir(root, LIVE_SUBDIR).join(l.filename))
        .filter(|p| p.is_file())
}

fn count_videos(root: &str, plan: &Value) -> (u32, u32) {
    let Some(lessons) = plan.get("lessons").and_then(|v| v.as_object()) else {
        return (0, 0);
    };
    let total = lessons.len() as u32;
    let mut ready = 0u32;
    for lesson in lessons.values() {
        if lesson
            .get("missing")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            continue;
        }
        if lesson_video_path(root, plan, lesson).is_some() {
            ready += 1;
        }
    }
    (ready, total)
}

fn ensure_normalized_settings(app: &AppHandle, plan: &Value) -> Result<Settings, String> {
    let (path, mut settings) = settings_for(app)?;
    let Some(root) = settings.root_dir.clone() else {
        return Ok(settings);
    };
    let video_subdir = video_subdir_from_plan(plan);
    let normalized = normalize_material_root(&root, &video_subdir);
    if normalized != root {
        settings.root_dir = Some(normalized);
        settings.save(&path)?;
    }
    Ok(settings)
}

fn load_plan_for(app: &AppHandle) -> Result<Value, String> {
    let settings = settings_for(app)?.1;
    let file = match settings.plan_variant() {
        "v2" => "plan-v2.json",
        _ => "plan.json",
    };
    let resource = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../public")
        .join(file);
    if resource.exists() {
        let raw = fs::read_to_string(resource).map_err(|e| e.to_string())?;
        return serde_json::from_str(&raw).map_err(|e| e.to_string());
    }
    Err(format!("{file} not found"))
}

fn parse_date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

fn today_string() -> String {
    Local::now().date_naive().format("%Y-%m-%d").to_string()
}

pub(crate) fn settings_for(app: &AppHandle) -> Result<(PathBuf, Settings), String> {
    let path = settings_path(app)?;
    Ok((path.clone(), Settings::load(&path)))
}

fn progress_for(app: &AppHandle) -> Result<(PathBuf, ProgressStore), String> {
    let path = progress_path(app)?;
    Ok((path.clone(), ProgressStore::load(&path)))
}

pub(crate) struct TrayBadge {
    pub count: u32,
    pub today_scope: bool,
}

fn current_week_plan(plan: &Value) -> Value {
    let today_date = parse_date(&today_string()).unwrap_or_else(|| {
        NaiveDate::from_ymd_opt(2026, 7, 7).unwrap()
    });
    let weeks = plan
        .get("weeks")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    for week in &weeks {
        let start = week.get("start").and_then(|v| v.as_str()).and_then(parse_date);
        let end = week.get("end").and_then(|v| v.as_str()).and_then(parse_date);
        if let (Some(start), Some(end)) = (start, end) {
            if today_date >= start && today_date <= end {
                return week.clone();
            }
        }
    }
    weeks.first().cloned().unwrap_or(Value::Null)
}

fn has_today_video_tasks(plan: &Value) -> bool {
    let today = today_string();
    let weeks = plan
        .get("weeks")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    for week in &weeks {
        let tasks = week
            .get("tasks")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        for task in &tasks {
            let scheduled = task
                .get("scheduledDate")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if scheduled == today && task.get("lessonNo").is_some() {
                return true;
            }
        }
    }
    false
}

fn count_unwatched_in_tasks(tasks: &[Value], progress: &ProgressStore) -> u32 {
    let mut count = 0u32;
    for task in tasks {
        if task.get("missing").and_then(|v| v.as_bool()).unwrap_or(false) {
            continue;
        }
        let Some(lesson_no) = task.get("lessonNo").and_then(|v| v.as_u64()) else {
            continue;
        };
        let id = task
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let video = progress
            .videos
            .get(&lesson_no.to_string())
            .cloned()
            .unwrap_or_default();
        let done = progress.tasks.get(&id).copied().unwrap_or(false) || video.completed;
        if !done {
            count += 1;
        }
    }
    count
}

pub(crate) fn count_current_week_unwatched(app: &AppHandle) -> Result<u32, String> {
    let plan = load_plan_for(&app)?;
    let (_, progress) = progress_for(app)?;
    let week = current_week_plan(&plan);
    let tasks = week
        .get("tasks")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(count_unwatched_in_tasks(&tasks, &progress))
}

pub(crate) fn tray_badge_count(app: &AppHandle) -> Result<TrayBadge, String> {
    let plan = load_plan_for(&app)?;
    let today_count = count_today_unwatched(app)?;
    if has_today_video_tasks(&plan) {
        return Ok(TrayBadge {
            count: today_count,
            today_scope: true,
        });
    }
    Ok(TrayBadge {
        count: count_current_week_unwatched(app)?,
        today_scope: false,
    })
}
pub(crate) fn count_today_unwatched(app: &AppHandle) -> Result<u32, String> {
    let plan = load_plan_for(&app)?;
    let today = today_string();
    let (_, progress) = progress_for(app)?;

    let weeks = plan
        .get("weeks")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut count = 0u32;
    for week in &weeks {
        let tasks = week
            .get("tasks")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        for task in &tasks {
            let scheduled = task
                .get("scheduledDate")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if scheduled != today {
                continue;
            }
            if task.get("missing").and_then(|v| v.as_bool()).unwrap_or(false) {
                continue;
            }
            let Some(lesson_no) = task.get("lessonNo").and_then(|v| v.as_u64()) else {
                continue;
            };
            let id = task
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let video = progress
                .videos
                .get(&lesson_no.to_string())
                .cloned()
                .unwrap_or_default();
            let done = progress.tasks.get(&id).copied().unwrap_or(false) || video.completed;
            if !done {
                count += 1;
            }
        }
    }
    Ok(count)
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<Settings, String> {
    let (_, settings) = settings_for(&app)?;
    Ok(settings)
}

#[tauri::command]
pub fn set_root_dir(app: AppHandle, root_dir: String) -> Result<Settings, String> {
    let plan = load_plan_for(&app)?;
    let (path, mut settings) = settings_for(&app)?;
    let video_subdir = video_subdir_from_plan(&plan);
    settings.root_dir = Some(normalize_material_root(&root_dir, &video_subdir));
    settings.save(&path)?;
    Ok(settings)
}

fn normalize_textbook_dir(raw: &str, filename: &str, default_subdir: &str) -> String {
    let path = Path::new(raw.trim());
    if !path.exists() {
        return raw.to_string();
    }
    if path.join(filename).exists() {
        return path.to_string_lossy().to_string();
    }
    let nested = path.join(default_subdir);
    if nested.join(filename).exists() {
        return nested.to_string_lossy().to_string();
    }
    if path
        .file_name()
        .is_some_and(|n| n.to_string_lossy() == default_subdir)
    {
        return path.to_string_lossy().to_string();
    }
    raw.to_string()
}

#[tauri::command]
pub fn set_textbook_dir(app: AppHandle, textbook_dir: String) -> Result<Settings, String> {
    let raw = textbook_dir.trim();
    let path = Path::new(raw);
    let (settings_path, mut settings) = settings_for(&app)?;

    if path.is_file() {
        let is_pdf = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("pdf"));
        if !is_pdf {
            return Err("请选择 PDF 文件".into());
        }
        settings.textbook_dir = Some(path.to_string_lossy().to_string());
    } else {
        let textbook = load_textbook()?;
        let filename = textbook
            .get("textbookFilename")
            .and_then(|v| v.as_str())
            .unwrap_or("【带书签可搜索】系统规划与管理师（第2版）.pdf");
        let subdir = textbook
            .get("textbookSubdir")
            .and_then(|v| v.as_str())
            .unwrap_or("03：官方教材");
        settings.textbook_dir = Some(normalize_textbook_dir(raw, filename, subdir));
    }

    settings.save(&settings_path)?;
    Ok(settings)
}

fn normalize_tricolor_notes_dir(raw: &str, default_subdir: &str) -> String {
    let path = Path::new(raw.trim());
    if !path.exists() {
        return raw.to_string();
    }
    if path
        .file_name()
        .is_some_and(|n| n.to_string_lossy() == default_subdir)
    {
        return path.to_string_lossy().to_string();
    }
    let nested = path.join(default_subdir);
    if nested.is_dir() {
        return nested.to_string_lossy().to_string();
    }
    path.to_string_lossy().to_string()
}

#[tauri::command]
pub fn set_tricolor_notes_dir(app: AppHandle, tricolor_notes_dir: String) -> Result<Settings, String> {
    let raw = tricolor_notes_dir.trim();
    let path = Path::new(raw);
    if !path.is_dir() {
        return Err("请选择三色笔记文件夹".into());
    }
    let textbook = load_textbook()?;
    let subdir = textbook
        .get("tricolorNotesSubdir")
        .and_then(|v| v.as_str())
        .unwrap_or("第2版 教材三色笔记");
    let (settings_path, mut settings) = settings_for(&app)?;
    settings.tricolor_notes_dir = Some(normalize_tricolor_notes_dir(raw, subdir));
    settings.save(&settings_path)?;
    Ok(settings)
}

#[tauri::command]
pub fn prepare_dialog(app: AppHandle) {
    set_panel_hide_suppressed(&app, true);
    activate_for_action(&app);
}

#[tauri::command]
pub fn finish_dialog(app: AppHandle) {
    set_panel_hide_suppressed(&app, false);
    if let Some(window) = app.get_webview_window("panel") {
        if window.is_visible().unwrap_or(false) {
            return;
        }
    }
    restore_accessory(&app);
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn get_panel_pinned(app: AppHandle) -> Result<bool, String> {
    let (_, settings) = settings_for(&app)?;
    Ok(settings.panel_pinned())
}

#[tauri::command]
pub fn set_panel_pinned(app: AppHandle, pinned: bool) -> Result<Settings, String> {
    let (path, mut settings) = settings_for(&app)?;
    settings.panel_pinned = Some(pinned);
    settings.save(&path)?;
    crate::apply_panel_pinned(&app, pinned)?;
    Ok(settings)
}

#[tauri::command]
pub fn set_woven_style(app: AppHandle, enabled: bool) -> Result<Settings, String> {
    let (path, mut settings) = settings_for(&app)?;
    settings.woven_style = Some(enabled);
    settings.save(&path)?;
    Ok(settings)
}

#[tauri::command]
pub fn set_plan_variant(app: AppHandle, variant: String) -> Result<Settings, String> {
    let (path, mut settings) = settings_for(&app)?;
    settings.plan_variant = Some(if variant == "v2" {
        "v2".into()
    } else {
        "default".into()
    });
    settings.save(&path)?;
    crate::refresh_tray_badge(&app);
    Ok(settings)
}

#[tauri::command]
pub fn get_progress(app: AppHandle) -> Result<ProgressStore, String> {
    let (_, progress) = progress_for(&app)?;
    Ok(progress)
}

#[tauri::command]
pub fn save_video_progress(
    app: AppHandle,
    lesson_no: u32,
    position: f64,
    duration: f64,
) -> Result<VideoProgress, String> {
    let (path, mut progress) = progress_for(&app)?;
    let key = lesson_no.to_string();
    let was_completed = progress
        .videos
        .get(&key)
        .map(|v| v.completed)
        .unwrap_or(false);
    let reached = duration > 0.0 && position / duration >= 0.9;
    let completed = was_completed || reached;
    let today = today_string();
    let entry = VideoProgress {
        position,
        duration,
        completed,
        updated_at: Local::now().to_rfc3339(),
        last_activity_date: Some(today),
    };
    progress
        .videos
        .insert(lesson_no.to_string(), entry.clone());
    progress.save(&path)?;
    crate::refresh_tray_badge(&app);
    Ok(entry)
}

#[tauri::command]
pub fn mark_task_done(app: AppHandle, task_id: String, done: bool) -> Result<(), String> {
    let (path, mut progress) = progress_for(&app)?;
    progress.tasks.insert(task_id, done);
    progress.save(&path)?;
    crate::refresh_tray_badge(&app);
    Ok(())
}

#[tauri::command]
pub fn get_today_snapshot(app: AppHandle) -> Result<TodaySnapshot, String> {
    let plan = load_plan_for(&app)?;
    let today = today_string();
    let today_date = parse_date(&today).ok_or("invalid today")?;
    let exam_date = plan
        .get("examDate")
        .and_then(|v| v.as_str())
        .and_then(parse_date)
        .unwrap_or_else(|| NaiveDate::from_ymd_opt(2026, 10, 24).unwrap());
    let days_to_exam = (exam_date - today_date).num_days();

    let settings = ensure_normalized_settings(&app, &plan)?;
    let (_, progress) = progress_for(&app)?;
    let (videos_ready, videos_total) = settings
        .root_dir
        .as_deref()
        .map(|root| count_videos(root, &plan))
        .unwrap_or((0, 0));

    let weeks = plan
        .get("weeks")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let lessons: HashMap<u32, Value> = plan
        .get("lessons")
        .and_then(|v| v.as_object())
        .map(|obj| {
            obj.iter()
                .filter_map(|(k, v)| k.parse::<u32>().ok().map(|no| (no, v.clone())))
                .collect()
        })
        .unwrap_or_default();

    let mut current_week = None;
    for week in &weeks {
        let start = week.get("start").and_then(|v| v.as_str()).and_then(parse_date);
        let end = week.get("end").and_then(|v| v.as_str()).and_then(parse_date);
        if let (Some(start), Some(end)) = (start, end) {
            if today_date >= start && today_date <= end {
                current_week = Some(week.clone());
                break;
            }
        }
    }

    let week = current_week.unwrap_or_else(|| weeks.first().cloned().unwrap_or(Value::Null));
    let week_id = week
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("W1")
        .to_string();
    let week_num = week_id
        .trim_start_matches('W')
        .parse::<u32>()
        .unwrap_or(1);
    let phase = week
        .get("phase")
        .and_then(|v| v.as_str())
        .unwrap_or("输入期")
        .to_string();
    let focus = week
        .get("focus")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let week_tasks = week
        .get("tasks")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let week_total = week_tasks.len() as u32;
    let mut week_done = 0u32;
    let mut week_lesson_nos = Vec::new();
    let mut today_tasks = Vec::new();
    let mut week_task_views = Vec::new();

    for task in &week_tasks {
        let id = task
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let scheduled = task
            .get("scheduledDate")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let lesson_no = task.get("lessonNo").and_then(|v| v.as_u64()).map(|n| n as u32);
        if let Some(no) = lesson_no {
            week_lesson_nos.push(no);
        }
        let title = task
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("未命名任务")
            .to_string();
        let missing = task.get("missing").and_then(|v| v.as_bool()).unwrap_or(false);

        let video = lesson_no
            .and_then(|no| progress.videos.get(&no.to_string()))
            .cloned()
            .unwrap_or_default();
        let done = progress.tasks.get(&id).copied().unwrap_or(false) || video.completed;
        if done {
            week_done += 1;
        }

        let view = TodayTask {
            id,
            task_type: "video".into(),
            title,
            lesson_no,
            missing,
            done,
            position: video.position,
            duration: video.duration,
            completed: video.completed,
        };

        if scheduled == today {
            today_tasks.push(view.clone());
        }
        week_task_views.push(view);
    }

    let preview_mode = today_tasks.is_empty() && !week_task_views.is_empty();
    if preview_mode {
        today_tasks = week_task_views;
    }

    let missing_lessons: Vec<u32> = lessons
        .iter()
        .filter_map(|(no, meta)| {
            if meta.get("missing").and_then(|v| v.as_bool()).unwrap_or(false) {
                Some(*no)
            } else {
                None
            }
        })
        .collect();

    let today_pending = tray_badge_count(&app)?.count;

    crate::refresh_tray_badge(&app);

    let plan_variant = settings.plan_variant().to_string();
    let plan_name = plan
        .get("planName")
        .and_then(|v| v.as_str())
        .unwrap_or(if plan_variant == "v2" {
            "考纲优化版"
        } else {
            "原版（视频课表）"
        })
        .to_string();

    Ok(TodaySnapshot {
        date: today,
        week_id,
        week_label: format!("第{}周 {}", week_num, phase),
        phase,
        focus,
        week_done,
        week_total,
        days_to_exam,
        root_configured: settings.root_dir.is_some(),
        missing_lessons,
        preview_mode,
        root_path: settings.root_dir.clone(),
        videos_ready,
        videos_total,
        week_lesson_nos,
        tasks: today_tasks,
        today_pending,
        plan_variant,
        plan_name,
    })
}

fn resolve_video_path_inner(app: &AppHandle, lesson_no: u32) -> Result<String, String> {
    let plan = load_plan_for(&app)?;
    let settings = ensure_normalized_settings(app, &plan)?;
    let root = settings.root_dir.ok_or("请先选择资料根目录")?;

    if (LIVE_NO_START..LIVE_NO_START + LIVE_NO_MAX).contains(&lesson_no) {
        if let Some(path) = resolve_live_video_path(&root, lesson_no) {
            return Ok(path.to_string_lossy().to_string());
        }
        return Err(format!("直播课第 {} 节不存在或尚未下载完成", lesson_no - 700));
    }

    let lesson = plan
        .get("lessons")
        .and_then(|v| v.get(lesson_no.to_string()))
        .ok_or("lesson not found in plan")?;

    let path = lesson_video_path(&root, &plan, lesson)
        .ok_or_else(|| {
            let filename = lesson
                .get("filename")
                .and_then(|v| v.as_str())
                .unwrap_or("?");
            let subdir = lesson_video_subdir(lesson, &plan);
            format!(
                "视频文件不存在: {}/{filename}",
                Path::new(&root).join(subdir).display()
            )
        })?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn resolve_video_path(app: AppHandle, lesson_no: u32) -> Result<String, String> {
    resolve_video_path_inner(&app, lesson_no)
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleInfo {
    pub path: String,
    pub format: String,
}

fn find_subtitle_path(video_path: &Path) -> Option<(PathBuf, &'static str)> {
    let stem = video_path.file_stem()?.to_str()?;
    let dir = video_path.parent()?;
    for ext in ["srt", "vtt"] {
        let candidate = dir.join(format!("{stem}.{ext}"));
        if candidate.is_file() {
            return Some((candidate, ext));
        }
    }
    None
}

fn resolve_subtitle_path_inner(app: &AppHandle, lesson_no: u32) -> Result<Option<SubtitleInfo>, String> {
    let video_path = match resolve_video_path_inner(app, lesson_no) {
        Ok(path) => path,
        Err(_) => return Ok(None),
    };
    let Some((path, format)) = find_subtitle_path(Path::new(&video_path)) else {
        return Ok(None);
    };
    Ok(Some(SubtitleInfo {
        path: path.to_string_lossy().to_string(),
        format: format.to_string(),
    }))
}

#[tauri::command]
pub fn resolve_subtitle_path(app: AppHandle, lesson_no: u32) -> Result<Option<SubtitleInfo>, String> {
    resolve_subtitle_path_inner(&app, lesson_no)
}

#[tauri::command]
pub fn open_subtitle_window(app: AppHandle, lesson_no: u32) -> Result<(), String> {
    let (_, settings) = settings_for(&app)?;
    if !settings.floating_subtitles() {
        return Ok(());
    }
    if resolve_subtitle_path_inner(&app, lesson_no)?.is_none() {
        return Ok(());
    }
    ensure_subtitle_window(&app, lesson_no)
}

#[tauri::command]
pub fn close_subtitle_window_cmd(app: AppHandle, lesson_no: u32) -> Result<(), String> {
    close_subtitle_window(&app, lesson_no);
    Ok(())
}

#[tauri::command]
pub fn set_floating_subtitles(app: AppHandle, enabled: bool) -> Result<Settings, String> {
    let (path, mut settings) = settings_for(&app)?;
    settings.floating_subtitles = Some(enabled);
    settings.save(&path)?;
    if !enabled {
        let windows: Vec<String> = app
            .webview_windows()
            .keys()
            .filter(|label| label.starts_with("subtitle-"))
            .cloned()
            .collect();
        for label in windows {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.close();
            }
        }
    }
    Ok(settings)
}

#[tauri::command]
pub fn get_live_catalog(app: AppHandle) -> Result<Vec<LiveCatalogLesson>, String> {
    let plan = load_plan_for(&app)?;
    let settings = ensure_normalized_settings(&app, &plan)?;
    let Some(root) = settings.root_dir else {
        return Ok(Vec::new());
    };
    Ok(scan_live_lessons(&root))
}

#[tauri::command]
pub fn open_player(app: AppHandle, lesson_no: u32) -> Result<(), String> {
    ensure_player_window(&app, lesson_no)
}

#[tauri::command]
pub fn open_external_video(app: AppHandle, lesson_no: u32) -> Result<(), String> {
    let path = resolve_video_path_inner(&app, lesson_no)?;
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

fn default_material_root() -> PathBuf {
    std::env::var("HOME")
        .map(|h| PathBuf::from(h).join("Desktop/系规"))
        .unwrap_or_else(|_| PathBuf::from("Desktop/系规"))
}

fn resolve_plan_spreadsheet_path(app: &AppHandle, variant: &str) -> Result<PathBuf, String> {
    let name = match variant {
        "v2" => "2026-学习计划-考纲优化版.xlsx",
        _ => "2026-学习计划-原版.xlsx",
    };
    let settings = settings_for(app)?.1;
    let root = settings
        .root_dir
        .as_deref()
        .map(Path::new)
        .filter(|p| p.is_dir())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(default_material_root);
    let path = root.join(name);
    if path.exists() {
        Ok(path)
    } else {
        Err(format!(
            "未找到计划表 Excel：{}\n请在资料目录下运行 pnpm gen:plan-v2 生成",
            path.display()
        ))
    }
}

#[tauri::command]
pub fn open_plan_spreadsheet(app: AppHandle, variant: String) -> Result<(), String> {
    let path = resolve_plan_spreadsheet_path(&app, &variant)?;
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_path(path.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| e.to_string())
}

fn load_textbook() -> Result<Value, String> {
    let resource = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../public/textbook.json");
    if resource.exists() {
        let raw = fs::read_to_string(resource).map_err(|e| e.to_string())?;
        return serde_json::from_str(&raw).map_err(|e| e.to_string());
    }
    Err("textbook.json not found".into())
}

fn resolve_textbook_path(app: &AppHandle) -> Result<PathBuf, String> {
    let settings = settings_for(app)?.1;
    let textbook = load_textbook()?;
    let filename = textbook
        .get("textbookFilename")
        .and_then(|v| v.as_str())
        .unwrap_or("【带书签可搜索】系统规划与管理师（第2版）.pdf");
    let subdir = textbook
        .get("textbookSubdir")
        .and_then(|v| v.as_str())
        .unwrap_or("03：官方教材");

    let path = if let Some(stored) = settings.textbook_dir.as_deref() {
        let stored_path = Path::new(stored);
        if stored_path.is_file() {
            stored_path.to_path_buf()
        } else {
            stored_path.join(filename)
        }
    } else if let Some(root) = settings.root_dir.as_deref() {
        Path::new(root).join(subdir).join(filename)
    } else {
        return Err("请先选择教材 PDF".into());
    };

    if !path.exists() {
        return Err(format!("教材 PDF 不存在: {}", path.display()));
    }
    Ok(path)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TextbookOpenResult {
    pub path: String,
    pub page: Option<u32>,
}

#[cfg(target_os = "macos")]
fn jump_preview_page(page: u32) -> Result<(), String> {
    use enigo::{
        Direction::{Click, Press, Release},
        Enigo, Key, Keyboard, Settings,
    };
    use std::thread;
    use std::time::Duration;

    let mut enigo =
        Enigo::new(&Settings::default()).map_err(|e| format!("键盘模拟初始化失败：{e}"))?;

    // ⌥⌘G → 前往页面
    enigo
        .key(Key::Meta, Press)
        .map_err(|e| format!("模拟按键失败：{e}"))?;
    enigo
        .key(Key::Alt, Press)
        .map_err(|e| format!("模拟按键失败：{e}"))?;
    enigo
        .key(Key::Unicode('g'), Click)
        .map_err(|e| format!("模拟按键失败：{e}"))?;
    enigo
        .key(Key::Alt, Release)
        .map_err(|e| format!("模拟按键失败：{e}"))?;
    enigo
        .key(Key::Meta, Release)
        .map_err(|e| format!("模拟按键失败：{e}"))?;

    thread::sleep(Duration::from_millis(500));
    enigo
        .text(&page.to_string())
        .map_err(|e| format!("输入页码失败：{e}"))?;
    enigo
        .key(Key::Return, Click)
        .map_err(|e| format!("模拟回车失败：{e}"))?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn open_pdf_in_preview(path: &Path, page: Option<u32>) -> Result<(), String> {
    use std::process::Command;
    use std::thread;
    use std::time::Duration;

    let path_str = path.to_string_lossy().to_string();
    Command::new("open")
        .args(["-a", "Preview", &path_str])
        .spawn()
        .map_err(|e| format!("无法打开 Preview：{e}"))?;

    let Some(page_num) = page else {
        return Ok(());
    };

    thread::sleep(Duration::from_millis(1200));
    let _ = Command::new("open").args(["-a", "Preview"]).status();
    thread::sleep(Duration::from_millis(300));

    jump_preview_page(page_num).map_err(|e| {
        format!(
            "教材已在 Preview 打开，但无法跳转到第 {page_num} 页：{e}。请确认「系统设置 → 隐私与安全性 → 辅助功能」中已开启「系规助手」，然后完全退出并重新打开 App"
        )
    })
}

#[cfg(not(target_os = "macos"))]
fn open_pdf_in_preview(path: &Path, _page: Option<u32>) -> Result<(), String> {
    use std::process::Command;

    Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn open_textbook(app: AppHandle, lesson_no: u32) -> Result<TextbookOpenResult, String> {
    activate_for_action(&app);
    let path = resolve_textbook_path(&app)?;
    let textbook = load_textbook()?;
    let page = textbook
        .get("lessons")
        .and_then(|l| l.get(lesson_no.to_string()))
        .and_then(|v| v.get("page"))
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);

    open_pdf_in_preview(&path, page)?;

    Ok(TextbookOpenResult {
        path: path.to_string_lossy().to_string(),
        page,
    })
}

fn lesson_chapter_no(title: &str) -> Option<u32> {
    let compact: String = title.chars().filter(|c| !c.is_whitespace()).collect();
    if compact.starts_with('0') {
        return None;
    }
    if let Some(dot) = compact.find('.') {
        if let Ok(ch) = compact[..dot].parse::<u32>() {
            if ch > 0 {
                return Some(ch);
            }
        }
    }
    None
}

fn resolve_tricolor_notes_path(app: &AppHandle, chapter: u32) -> Result<PathBuf, String> {
    let settings = settings_for(app)?.1;
    let textbook = load_textbook()?;
    let subdir = textbook
        .get("tricolorNotesSubdir")
        .and_then(|v| v.as_str())
        .unwrap_or("第2版 教材三色笔记");
    let template = textbook
        .get("tricolorNotesFilenameTemplate")
        .and_then(|v| v.as_str())
        .unwrap_or("《系统规划与管理师教程》第2版-三色笔记-第{chapter}章.pdf");
    let filename = template.replace("{chapter}", &chapter.to_string());

    let dir = if let Some(stored) = settings.tricolor_notes_dir.as_deref() {
        PathBuf::from(stored)
    } else if let Some(root) = settings.root_dir.as_deref() {
        Path::new(root).join(subdir)
    } else {
        return Err("请先选择三色笔记文件夹".into());
    };

    let path = dir.join(&filename);
    if !path.exists() {
        return Err(format!("三色笔记 PDF 不存在: {}", path.display()));
    }
    Ok(path)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TricolorNotesOpenResult {
    pub path: String,
    pub chapter: Option<u32>,
}

#[tauri::command]
pub fn open_tricolor_notes(app: AppHandle, lesson_no: u32) -> Result<TricolorNotesOpenResult, String> {
    activate_for_action(&app);
    let plan = load_plan_for(&app)?;
    let title = plan
        .get("lessons")
        .and_then(|v| v.get(lesson_no.to_string()))
        .and_then(|v| v.get("title"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let chapter = lesson_chapter_no(title).ok_or("该课节暂无对应三色笔记章节")?;
    let path = resolve_tricolor_notes_path(&app, chapter)?;
    open_pdf_in_preview(&path, None)?;
    Ok(TricolorNotesOpenResult {
        path: path.to_string_lossy().to_string(),
        chapter: Some(chapter),
    })
}

fn load_quiz() -> Result<Value, String> {
    let resource = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../public/quiz.json");
    if resource.exists() {
        let raw = fs::read_to_string(resource).map_err(|e| e.to_string())?;
        return serde_json::from_str(&raw).map_err(|e| e.to_string());
    }
    Err("quiz.json not found".into())
}

fn quiz_chapter_hint(plan: &Value, lesson_no: u32) -> String {
    let title = plan
        .get("lessons")
        .and_then(|v| v.get(lesson_no.to_string()))
        .and_then(|v| v.get("title"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let compact: String = title.chars().filter(|c| !c.is_whitespace()).collect();
    if compact.starts_with('0') {
        return "导学 · 章节练习".into();
    }
    if let Some(dot) = compact.find('.') {
        if let Ok(ch) = compact[..dot].parse::<u32>() {
            if ch > 0 {
                return format!("第{ch}章练习");
            }
        }
    }
    "章节练习".into()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QuizOpenResult {
    pub chapter_hint: String,
    pub mini_program_name: String,
    pub copied_link: String,
    pub instruction: String,
}

fn copy_to_clipboard(text: &str) -> Result<(), String> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let mut child = Command::new("pbcopy")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| format!("复制失败：{e}"))?;
    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|e| format!("复制失败：{e}"))?;
    }
    child.wait().map_err(|e| format!("复制失败：{e}"))?;
    Ok(())
}

fn open_wechat_app() -> Result<(), String> {
    use std::process::Command;

    Command::new("open")
        .arg("-a")
        .arg("WeChat")
        .spawn()
        .map_err(|e| format!("无法打开微信：{e}"))?;
    Ok(())
}

#[tauri::command]
pub fn open_quiz(app: AppHandle, lesson_no: u32) -> Result<QuizOpenResult, String> {
    activate_for_action(&app);
    let quiz = load_quiz()?;
    let plan = load_plan_for(&app)?;

    let short_link = quiz
        .get("shortLink")
        .and_then(|v| v.as_str())
        .ok_or("quiz.json 缺少 shortLink")?;

    let lesson_link = quiz
        .get("lessons")
        .and_then(|l| l.get(lesson_no.to_string()))
        .and_then(|v| v.get("shortLink"))
        .and_then(|v| v.as_str())
        .unwrap_or(short_link);

    copy_to_clipboard(lesson_link)?;
    open_wechat_app()?;

    let mini_program_name = quiz
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("郑房新一点通")
        .to_string();

    let chapter_hint = quiz_chapter_hint(&plan, lesson_no);
    let instruction = format!(
        "Mac 微信无法从外部直接打开小程序。链接已复制，请在微信「文件传输助手」粘贴并点击卡片打开（建议：{chapter_hint}）"
    );

    Ok(QuizOpenResult {
        chapter_hint,
        mini_program_name,
        copied_link: lesson_link.to_string(),
        instruction,
    })
}
