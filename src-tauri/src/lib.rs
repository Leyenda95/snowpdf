use std::path::Path;
use std::sync::Mutex;

/// Files passed on the command line (e.g. double-clicking a PDF associated with
/// SnowPDF). The frontend asks for them once at startup.
struct StartupFiles(Mutex<Vec<String>>);

#[tauri::command]
fn take_startup_files(app: tauri::AppHandle, state: tauri::State<StartupFiles>) -> Vec<String> {
    #[cfg_attr(not(target_os = "android"), allow(unused_mut))]
    let mut files = std::mem::take(&mut *state.0.lock().unwrap());
    #[cfg(target_os = "android")]
    files.extend(take_incoming_files(&app));
    #[cfg(not(target_os = "android"))]
    let _ = &app;
    files
}

/// Android: MainActivity copies the files other apps share with SnowPDF ("Abrir con") into
/// <cache>/incoming and lists their paths in pending.txt. Reads and clears that list.
#[cfg(target_os = "android")]
fn take_incoming_files(app: &tauri::AppHandle) -> Vec<String> {
    use tauri::Manager;
    let Ok(cache) = app.path().app_cache_dir() else {
        return Vec::new();
    };
    let pending = cache.join("incoming").join("pending.txt");
    let Ok(text) = std::fs::read_to_string(&pending) else {
        return Vec::new();
    };
    let _ = std::fs::remove_file(&pending);
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && Path::new(l).is_file())
        .map(String::from)
        .collect()
}

/// Installed fonts as (registry name, absolute file path), e.g. ("Segoe UI Semibold
/// (TrueType)", "C:\\Windows\\Fonts\\seguisb.ttf"). The frontend reads the files it needs
/// with the fs plugin, so text can use more weights than the PDF standard fonts offer.
///
/// Runs off the main thread (`async`): it starts processes, and a plain command would freeze
/// the window meanwhile.
#[tauri::command(async)]
fn list_system_fonts() -> Vec<(String, String)> {
    #[cfg(windows)]
    {
        windows_fonts()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

#[cfg(windows)]
fn windows_fonts() -> Vec<(String, String)> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into());
    let keys = [
        "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
        "HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
    ];
    let mut fonts = Vec::new();
    for key in keys {
        let Ok(output) = std::process::Command::new("reg")
            .args(["query", key])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        else {
            continue;
        };
        // Value lines look like "    Arial Bold (TrueType)    REG_SZ    arialbd.ttf".
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            let Some(at) = line.find("    REG_") else { continue };
            let name = line[..at].trim();
            let Some((_, file)) = line[at + 4..].split_once("    ") else { continue };
            let file = file.trim();
            if name.is_empty() || file.is_empty() {
                continue;
            }
            let path = if Path::new(file).is_absolute() {
                file.to_string()
            } else {
                format!("{windir}\\Fonts\\{file}")
            };
            fonts.push((name.to_string(), path));
        }
    }
    fonts
}

fn collect_startup_files() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .filter(|arg| Path::new(arg).is_file())
        .collect()
}

/// Event telling the window that `take_startup_files` has new files (a second launch left them).
#[cfg(desktop)]
const INCOMING_FILES_EVENT: &str = "incoming-files";

/// A second launch (e.g. double-clicking another PDF while SnowPDF is open) ends up here, in the
/// running process: queue its files, tell the window and bring it to the front.
#[cfg(desktop)]
fn on_second_instance(app: &tauri::AppHandle, argv: Vec<String>, cwd: String) {
    use tauri::{Emitter, Manager};
    let files: Vec<String> = argv
        .into_iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        // Relative paths are relative to the folder the second launch ran in, not ours.
        .map(|arg| Path::new(&cwd).join(arg))
        .filter(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned())
        .collect();
    if !files.is_empty() {
        app.state::<StartupFiles>().0.lock().unwrap().extend(files);
        let _ = app.emit(INCOMING_FILES_EVENT, ());
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Must be the first plugin: it ends a second launch before anything else is set up.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(on_second_instance));
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(StartupFiles(Mutex::new(collect_startup_files())))
        .invoke_handler(tauri::generate_handler![take_startup_files, list_system_fonts])
        .run(tauri::generate_context!())
        .expect("error while running SnowPDF");
}
