use std::{collections::HashMap, fs, path::{Component, Path, PathBuf}, sync::{atomic::{AtomicU64, Ordering}, Mutex}, time::Instant};
use tauri::{ipc::{InvokeBody, Request}, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct ExportTargets(Mutex<HashMap<String, (PathBuf, Instant)>>);
static NEXT_TARGET: AtomicU64 = AtomicU64::new(1);

fn valid_name(name: &str) -> bool {
    !name.is_empty() && !name.contains(['\\', ':', '\0']) &&
        matches!(Path::new(name).components().collect::<Vec<_>>().as_slice(), [Component::Normal(_)])
}
impl ExportTargets {
    fn insert(&self, path: PathBuf) -> Result<String, String> {
        let mut targets = self.0.lock().map_err(|_| "导出目标不可用")?;
        targets.retain(|_, (_, time)| time.elapsed().as_secs() < 3600);
        if targets.len() >= 8 { return Err("同时准备的导出过多".into()); }
        let token = format!("export-{}", NEXT_TARGET.fetch_add(1, Ordering::Relaxed));
        targets.insert(token.clone(), (path, Instant::now()));
        Ok(token)
    }
    fn take(&self, token: &str) -> Result<PathBuf, String> {
        self.0.lock().map_err(|_| "导出目标不可用")?.remove(token)
            .filter(|(_, time)| time.elapsed().as_secs() < 3600)
            .map(|(path, _)| path).ok_or_else(|| "导出目标已失效，请重新选择".into())
    }
}

#[tauri::command]
pub async fn export_file_select(app: tauri::AppHandle, window: WebviewWindow, filename: String) -> Result<Option<String>, String> {
    if window.label() != "main" || !valid_name(&filename) { return Err("导出请求无效".into()); }
    let dialog_app = app.clone();
    let path = tauri::async_runtime::spawn_blocking(move || {
        let selected = dialog_app.dialog().file().set_parent(&window).set_title("导出到…").set_file_name(filename).blocking_save_file();
        selected.map(|file| file.into_path().map_err(|error| error.to_string())).transpose()
    }).await.map_err(|error| error.to_string())??;
    // The renderer receives only a one-use handle to the user-selected target, never an arbitrary write path.
    match path { Some(path) => Ok(Some(tauri::Manager::state::<ExportTargets>(&app).insert(path)?)), None => Ok(None) }
}

#[tauri::command]
pub fn export_file_cancel(window: WebviewWindow, targets: State<'_, ExportTargets>, token: String) -> Result<(), String> {
    if window.label() != "main" { return Err("导出请求无效".into()); }
    let _ = targets.take(&token);
    Ok(())
}

#[tauri::command]
pub async fn export_file(window: WebviewWindow, targets: State<'_, ExportTargets>, request: Request<'_>) -> Result<bool, String> {
    if window.label() != "main" { return Err("导出请求无效".into()); }
    let token = request.headers().get("x-eidos-export-token").and_then(|value| value.to_str().ok()).ok_or("导出目标缺失")?;
    let InvokeBody::Raw(bytes) = request.body() else { return Err("导出须使用二进制数据".into()); };
    let path = targets.take(token)?;
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || fs::write(path, bytes).map_err(|error| format!("导出写入失败：{error}")))
        .await.map_err(|error| error.to_string())??;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_paths_and_uses_targets_only_once() {
        for name in ["", ".", "..", "../report.md", "/tmp/report.md", "C:\\report.md"] { assert!(!valid_name(name)); }
        assert!(valid_name("世界.eidos.zip"));
        let targets = ExportTargets::default();
        let path = PathBuf::from("chosen-report.zip");
        let token = targets.insert(path.clone()).unwrap();
        assert!(targets.take("unselected-path").is_err());
        assert_eq!(targets.take(&token).unwrap(), path);
        assert!(targets.take(&token).is_err());
    }
    #[test]
    fn writes_binary_content_to_the_selected_file() {
        let path = std::env::temp_dir().join(format!("eidos-export-test-{}", std::process::id()));
        let targets = ExportTargets::default();
        let token = targets.insert(path.clone()).unwrap();
        fs::write(targets.take(&token).unwrap(), [0, 255, 17]).unwrap();
        assert_eq!(fs::read(&path).unwrap(), vec![0, 255, 17]);
        fs::remove_file(path).unwrap();
    }
}
