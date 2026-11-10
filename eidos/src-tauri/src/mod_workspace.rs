use std::{fs, path::{Component, Path, PathBuf}};
use tauri::{Manager, WebviewWindow};

fn relative_path(root: &Path, value: &str) -> Result<PathBuf, String> {
    if value.is_empty() || value.len() > 240 || value.contains('\\') || value.contains(':') { return Err("工作文件路径无效".into()); }
    let mut path = root.to_path_buf();
    for part in Path::new(value).components() {
        match part { Component::Normal(name) => path.push(name), _ => return Err("只能访问模组工作目录".into()) }
        if fs::symlink_metadata(&path).map(|m| m.file_type().is_symlink()).unwrap_or(false) { return Err("工作目录不允许符号链接".into()); }
    }
    Ok(path)
}

fn write_checked(path: &Path, content: &str, expected: Option<String>) -> Result<(), String> {
    if content.len() > 4 * 1024 * 1024 { return Err("工作文件超过 4 MB".into()); }
    let current = if path.exists() { Some(fs::read_to_string(path).map_err(|e| e.to_string())?) } else { None };
    // An external edit is never overwritten by replaying an older world-line snapshot.
    if current.as_deref() != Some(content) && current != expected { return Err("工作文件已被外部修改，请先重新载入".into()); }
    fs::create_dir_all(path.parent().ok_or("路径无效")?).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mod_workspace_file(app: tauri::AppHandle, window: WebviewWindow, workspace: String, path: String, content: Option<String>, expected_content: Option<String>) -> Result<serde_json::Value, String> {
    if window.label() != "main" || workspace.len() != 16 || !workspace.bytes().all(|b| b.is_ascii_hexdigit()) { return Err("工作区身份无效".into()); }
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?.join("mod-workspaces");
    if fs::symlink_metadata(&directory).map(|m| m.file_type().is_symlink()).unwrap_or(false) { return Err("工作目录无效".into()); }
    let root = directory.join(workspace);
    if fs::symlink_metadata(&root).map(|m| m.file_type().is_symlink()).unwrap_or(false) { return Err("工作区目录无效".into()); }
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    if fs::symlink_metadata(&root).map_err(|e| e.to_string())?.file_type().is_symlink() { return Err("工作区目录无效".into()); }
    let target = relative_path(&root, &path)?;
    if let Some(value) = content { write_checked(&target, &value, expected_content)?; }
    let metadata = fs::metadata(&target).map_err(|e| e.to_string())?;
    if metadata.len() > 4 * 1024 * 1024 { return Err("工作文件超过 4 MB".into()); }
    let value = fs::read_to_string(target).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "content": value, "directory": root.to_string_lossy() }))
}

#[tauri::command]
pub fn mod_stage_open(app: tauri::AppHandle, window: WebviewWindow, lease: String, title: String, width: f64, height: f64) -> Result<(), String> {
    if window.label() != "main" || lease.len() != 32 || !lease.bytes().all(|b| b.is_ascii_hexdigit()) { return Err("舞台身份无效".into()); }
    let mut url = window.url().map_err(|e| e.to_string())?;
    url.set_path("/mod-stage"); url.set_query(None); url.set_fragment(Some(&lease));
    tauri::WebviewWindowBuilder::new(&app, format!("eidos-mod-{lease}"), tauri::WebviewUrl::External(url))
        .title(&title).inner_size(width.clamp(180.0, 1600.0), height.clamp(180.0, 1600.0)).build().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn mod_stage_close(app: tauri::AppHandle, window: WebviewWindow, lease: String) -> Result<(), String> {
    if window.label() != "main" || lease.len() != 32 || !lease.bytes().all(|b| b.is_ascii_hexdigit()) { return Err("舞台身份无效".into()); }
    if let Some(stage) = app.get_webview_window(&format!("eidos-mod-{lease}")) { stage.close().map_err(|e| e.to_string())?; }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_escape_and_preserves_external_edits() {
        let root = std::env::temp_dir().join(format!("eidos-workspace-{}", std::process::id()));
        assert!(relative_path(&root, "../outside.txt").is_err());
        assert!(relative_path(&root, "/outside.txt").is_err());
        let path = relative_path(&root, "letter.txt").unwrap();
        write_checked(&path, "first", None).unwrap();
        fs::write(&path, "external").unwrap();
        assert!(write_checked(&path, "branch-old", Some("first".into())).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "external");
        fs::remove_file(&path).unwrap();
        fs::remove_dir(&root).unwrap();
    }
}
