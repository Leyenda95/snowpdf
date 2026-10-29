use std::path::Path;
use std::sync::Mutex;

/// Files passed on the command line (e.g. double-clicking a PDF associated with
/// SnowPDF). The frontend asks for them once at startup.
struct StartupFiles(Mutex<Vec<String>>);

#[tauri::command]
fn take_startup_files(state: tauri::State<StartupFiles>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

/// Installed fonts as (registry name, absolute file path), e.g. ("Segoe UI Semibold
/// (TrueType)", "C:\\Windows\\Fonts\\seguisb.ttf"). The frontend reads the files it needs
/// with the fs plugin, so text can use more weights than the PDF standard fonts offer.
#[tauri::command]
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(StartupFiles(Mutex::new(collect_startup_files())))
        .invoke_handler(tauri::generate_handler![take_startup_files, list_system_fonts])
        .run(tauri::generate_context!())
        .expect("error while running SnowPDF");
}
