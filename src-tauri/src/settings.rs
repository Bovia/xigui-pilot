use serde::{Deserialize, Serialize};
use tauri::Manager;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub root_dir: Option<String>,
    pub textbook_dir: Option<String>,
    #[serde(default)]
    pub panel_pinned: Option<bool>,
    #[serde(default)]
    pub woven_style: Option<bool>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            root_dir: None,
            textbook_dir: None,
            panel_pinned: Some(true),
            woven_style: Some(false),
        }
    }
}

impl Settings {
    pub fn panel_pinned(&self) -> bool {
        self.panel_pinned.unwrap_or(true)
    }
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
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_string_pretty(self).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        fs::rename(tmp, path).map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| e.to_string())
        .map(|p| p.join("settings.json"))
}
