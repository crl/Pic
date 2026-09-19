use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::ipc::Response;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

const IMAGE_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "tif", "tiff", "bmp",
];

struct OpenQueue(Mutex<Vec<String>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatInfo {
    is_directory: bool,
    is_file: bool,
    mtime_ms: f64,
    size: u64,
}

fn is_image_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| IMAGE_EXTS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn collect_open_paths(args: impl IntoIterator<Item = String>) -> Vec<String> {
    args.into_iter()
        .filter(|arg| is_image_path(arg) && Path::new(arg).exists())
        .collect()
}

fn emit_open_path(app: &AppHandle, path: String) {
    let _ = app.emit("open-path", path);
}

fn file_path_string(path: tauri_plugin_dialog::FilePath) -> Option<String> {
    path.into_path()
        .ok()
        .map(|value| value.to_string_lossy().into_owned())
}

fn depth_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("depth-cache"))
        .map_err(|error| error.to_string())
}

fn depth_cache_file(app: &AppHandle, key: &str) -> Result<Option<PathBuf>, String> {
    if key.len() != 40 || !key.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Ok(None);
    }
    Ok(Some(depth_cache_dir(app)?.join(format!("{key}.bin"))))
}

fn prune_depth_cache(dir: &Path) -> Result<(), String> {
    let mut entries: Vec<(PathBuf, u64)> = fs::read_dir(dir)
        .map_err(|error| error.to_string())?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("bin"))
        .filter_map(|path| {
            let modified = fs::metadata(&path)
                .and_then(|meta| meta.modified())
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_millis() as u64;
            Some((path, modified))
        })
        .collect();
    if entries.len() <= 48 {
        return Ok(());
    }
    entries.sort_by_key(|item| item.1);
    let extra = entries.len() - 48;
    for (path, _) in entries.into_iter().take(extra) {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

#[tauri::command]
async fn open_dialog(app: AppHandle, kind: String) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    if kind == "folder" {
        app.dialog().file().pick_folder(move |path| {
            let _ = tx.send(path.and_then(file_path_string));
        });
    } else {
        app.dialog()
            .file()
            .add_filter(
                "图片",
                &[
                    "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "tif", "tiff", "bmp",
                ],
            )
            .pick_file(move |path| {
                let _ = tx.send(path.and_then(file_path_string));
            });
    }
    tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn stat_path(target: String) -> Result<StatInfo, String> {
    let meta = fs::metadata(&target).map_err(|error| error.to_string())?;
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);
    Ok(StatInfo {
        is_directory: meta.is_dir(),
        is_file: meta.is_file(),
        mtime_ms,
        size: meta.len(),
    })
}

#[tauri::command]
fn list_images(folder: String) -> Result<Vec<String>, String> {
    let mut items: Vec<String> = fs::read_dir(&folder)
        .map_err(|error| error.to_string())?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().map(|kind| kind.is_file()).unwrap_or(false))
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| !name.starts_with('.') && is_image_path(name))
                .unwrap_or(false)
        })
        .map(|path| path.to_string_lossy().into_owned())
        .collect();
    items.sort_by(|left, right| {
        Path::new(left)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase()
            .cmp(
                &Path::new(right)
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_lowercase(),
            )
    });
    Ok(items)
}

#[tauri::command]
fn read_file(target: String) -> Result<Response, String> {
    let bytes = fs::read(&target).map_err(|error| format!("{target}: {error}"))?;
    Ok(Response::new(bytes))
}

#[tauri::command]
fn get_model_path(app: AppHandle) -> Result<Option<String>, String> {
    let path = app
        .path()
        .resolve(
            "models/depth-anything-v2-small.onnx",
            BaseDirectory::Resource,
        )
        .map_err(|error| error.to_string())?;
    if path.exists() {
        return Ok(Some(path.to_string_lossy().into_owned()));
    }
    let fallback = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources/models/depth-anything-v2-small.onnx");
    if fallback.exists() {
        return Ok(Some(fallback.to_string_lossy().into_owned()));
    }
    Ok(None)
}

#[tauri::command]
fn read_depth_cache(app: AppHandle, key: String) -> Result<Response, String> {
    let Some(file) = depth_cache_file(&app, &key)? else {
        return Ok(Response::new(Vec::<u8>::new()));
    };
    if !file.exists() {
        return Ok(Response::new(Vec::<u8>::new()));
    }
    let bytes = fs::read(file).map_err(|error| error.to_string())?;
    Ok(Response::new(bytes))
}

#[tauri::command]
fn write_depth_cache(app: AppHandle, key: String, data: Vec<u8>) -> Result<(), String> {
    let Some(file) = depth_cache_file(&app, &key)? else {
        return Ok(());
    };
    let dir = depth_cache_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    fs::write(&file, data).map_err(|error| error.to_string())?;
    prune_depth_cache(&dir)
}

#[tauri::command]
fn dirname(target: String) -> String {
    Path::new(&target)
        .parent()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or(target)
}

#[tauri::command]
fn basename(target: String) -> String {
    Path::new(&target)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or(target)
}

#[tauri::command]
fn ready(app: AppHandle, queue: State<OpenQueue>) {
    let pending = {
        let mut guard = queue.0.lock().expect("open queue");
        std::mem::take(&mut *guard)
    };
    for path in pending {
        emit_open_path(&app, path);
    }
}

fn build_menu(app: &tauri::App) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let open = MenuItemBuilder::with_id("open", "打开…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let open_folder = MenuItemBuilder::with_id("open-folder", "打开文件夹…").build(app)?;
    let file_menu = SubmenuBuilder::new(app, "文件")
        .item(&open)
        .item(&open_folder)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("退出"))?)
        .build()?;

    let fit = MenuItemBuilder::with_id("fit", "自适应大小")
        .accelerator("CmdOrCtrl+0")
        .build(app)?;
    let actual = MenuItemBuilder::with_id("actual", "实际大小")
        .accelerator("CmdOrCtrl+1")
        .build(app)?;
    let spatial = MenuItemBuilder::with_id("spatial", "3D 景深")
        .accelerator("CmdOrCtrl+3")
        .build(app)?;
    let display_menu = SubmenuBuilder::new(app, "显示")
        .item(&fit)
        .item(&actual)
        .separator()
        .item(&spatial)
        .build()?;

    let previous = MenuItemBuilder::with_id("previous", "上一张")
        .accelerator("Left")
        .build(app)?;
    let next = MenuItemBuilder::with_id("next", "下一张")
        .accelerator("Right")
        .build(app)?;
    let go_menu = SubmenuBuilder::new(app, "前往")
        .item(&previous)
        .item(&next)
        .build()?;

    MenuBuilder::new(app)
        .item(&file_menu)
        .item(&display_menu)
        .item(&go_menu)
        .build()
}

pub fn run() {
    let initial_paths = collect_open_paths(std::env::args().skip(1));
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            for path in collect_open_paths(argv) {
                emit_open_path(app, path);
            }
        }))
        .manage(OpenQueue(Mutex::new(initial_paths)))
        .setup(|app| {
            let menu = build_menu(app)?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                let id = event.id().as_ref();
                let _ = app.emit("menu-action", id);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_dialog,
            stat_path,
            list_images,
            read_file,
            get_model_path,
            read_depth_cache,
            write_depth_cache,
            dirname,
            basename,
            ready
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pic");
}
