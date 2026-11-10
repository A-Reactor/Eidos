mod mod_workspace;
mod export_file;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(export_file::ExportTargets::default())
    .invoke_handler(tauri::generate_handler![mod_workspace::mod_workspace_file, mod_workspace::mod_stage_open, mod_workspace::mod_stage_close, export_file::export_file, export_file::export_file_select, export_file::export_file_cancel])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
