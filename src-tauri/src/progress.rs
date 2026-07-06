use serde::{Deserialize, Serialize};
use tauri::Manager;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VideoProgress {
    pub position: f64,
    pub duration: f64,
    pub completed: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProgressStore {
    pub videos: HashMap<String, VideoProgress>,
    pub tasks: HashMap<String, bool>,
}

impl ProgressStore {
    pub fn load(path: &Path) -> Self {
        fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let backup = path.with_extension("json.bak");
        if path.exists() {
            let _ = fs::copy(path, &backup);
        }
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_string_pretty(self).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        fs::rename(tmp, path).map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub fn progress_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| e.to_string())
        .map(|p| p.join("progress.json"))
}
