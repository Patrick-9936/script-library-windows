// Script Library for Windows.
//
// The window itself is the project's own page, so the interface is the same one
// the site and the phone app show. What is native on purpose:
//   * all API traffic goes through Rust, so there is no CORS negotiation and no
//     cookie jar the webview could lose;
//   * links to the game and to the API site open in the system handler instead of
//     replacing the app window;
//   * updates are checked against GitHub releases and installed by the same
//     installer the user downloaded, the way the phone app does it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::menu::{Menu, MenuBuilder, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WebviewWindow};

const PROXY: &str = "https://sl.3-107-57-112.sslip.io";
const RELEASES: &str = "https://api.github.com/repos/Patrick-9936/nb-scripts-authors/releases";

/// Closing the main window hides it while the tray remains available.
static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);

/// Names for windows opened from the app itself.
static WINDOW_SEQ: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// A `.lua`/`.luau` file Windows handed to the app, waiting to be shown.
static OPENED_FILE: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

#[derive(Serialize)]
struct ApiResponse {
    status: u16,
    headers: HashMap<String, String>,
    json: serde_json::Value,
}

fn client(timeout: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout))
        .build()
        .map_err(|error| format!("Не удалось создать HTTP-клиент: {error}"))
}

/// Performs one API call for the page and returns the parts the page uses.
#[tauri::command]
async fn sl_api(
    path: String,
    method: String,
    body: Option<String>,
    headers: HashMap<String, String>,
) -> Result<ApiResponse, String> {
    if !path.starts_with('/') || path.starts_with("//") {
        return Err("Запрошен недопустимый путь".into());
    }

    let method = reqwest::Method::from_bytes(method.to_uppercase().as_bytes())
        .map_err(|_| "Недопустимый HTTP-метод".to_string())?;

    let mut request = client(30)?.request(method, format!("{PROXY}{path}"));
    for (key, value) in headers {
        let name = key.to_lowercase();
        // These describe the webview's own connection, not ours.
        if matches!(
            name.as_str(),
            "host" | "content-length" | "connection" | "cookie" | "origin" | "referer"
        ) {
            continue;
        }
        request = request.header(name, value);
    }
    if let Some(body) = body {
        request = request.body(body);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Нет связи с сервером: {error}"))?;
    let status = response.status().as_u16();

    let mut answer_headers = HashMap::new();
    for (key, value) in response.headers() {
        if let Ok(value) = value.to_str() {
            answer_headers.insert(key.as_str().to_string(), value.to_string());
        }
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Ответ оборвался: {error}"))?;
    let json = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);

    Ok(ApiResponse {
        status,
        headers: answer_headers,
        json,
    })
}

fn clean_route(route: &str) -> Option<String> {
    let value: String = route
        .chars()
        .filter(|symbol| {
            symbol.is_ascii_alphanumeric() || matches!(symbol, '/' | '-' | '_' | '@' | '.')
        })
        .collect();
    let value = value.trim_start_matches('/').to_string();
    if value.is_empty() || value.contains("..") {
        None
    } else {
        Some(value)
    }
}

/// Opens a screen in its own window; `mini` keeps a small search window above
/// the other applications.
#[tauri::command]
fn sl_window_open(
    app: tauri::AppHandle,
    route: Option<String>,
    mini: Option<bool>,
) -> Result<(), String> {
    let mini = mini.unwrap_or(false);
    let route = route.as_deref().and_then(clean_route);
    let number = WINDOW_SEQ.fetch_add(1, Ordering::Relaxed);
    let label = format!("{}-{number}", if mini { "mini" } else { "window" });

    let mut builder = tauri::WebviewWindowBuilder::new(
        &app,
        label,
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Script Library")
    .decorations(false)
    .transparent(true)
    .inner_size(
        if mini { 480.0 } else { 1120.0 },
        if mini { 640.0 } else { 800.0 },
    )
    .min_inner_size(
        if mini { 340.0 } else { 720.0 },
        if mini { 320.0 } else { 520.0 },
    );

    if mini {
        builder = builder.always_on_top(true).skip_taskbar(true);
    }

    let window = builder.build().map_err(|error| error.to_string())?;

    #[cfg(target_os = "windows")]
    let _ = window_vibrancy::apply_mica(&window, None);

    let script = format!(
        "{}{}",
        route
            .map(|route| format!("location.hash='#/{route}';"))
            .unwrap_or_default(),
        if mini {
            "document.body.classList.add('sl-mini');document.dispatchEvent(new CustomEvent('sl-mini'));"
        } else {
            ""
        }
    );
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(900));
        let _ = window.eval(&script);
    });

    Ok(())
}

/// Starts the compact search surface and keeps the configured main window out
/// of sight until the user chooses a result.
fn open_mini_window(app: &tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }

    if let Err(error) = sl_window_open((*app).clone(), None, Some(true)) {
        eprintln!("Не удалось открыть мини-окно: {error}");
        focus_window(app);
    }
}

/// One line of a native context menu. `role` maps to a Windows predefined
/// command, so copy/paste behave exactly like the system ones.
#[derive(serde::Deserialize)]
struct MenuEntry {
    id: String,
    label: String,
    role: Option<String>,
    enabled: Option<bool>,
}

/// Shows a real Windows context menu at the cursor and reports the choice
/// through the `sl-menu` event.
#[tauri::command]
fn sl_context_menu(window: WebviewWindow, entries: Vec<MenuEntry>) -> Result<(), String> {
    if entries.is_empty() || entries.len() > 32 {
        return Err("Некорректное меню".into());
    }

    let mut builder = MenuBuilder::new(&window);
    for entry in &entries {
        builder = match entry.role.as_deref() {
            Some("separator") => builder.separator(),
            Some("copy") => {
                builder.item(&PredefinedMenuItem::copy(&window, None).map_err(|e| e.to_string())?)
            }
            Some("cut") => {
                builder.item(&PredefinedMenuItem::cut(&window, None).map_err(|e| e.to_string())?)
            }
            Some("paste") => {
                builder.item(&PredefinedMenuItem::paste(&window, None).map_err(|e| e.to_string())?)
            }
            Some("select-all") => builder.item(
                &PredefinedMenuItem::select_all(&window, Some(&entry.label)).map_err(|e| e.to_string())?,
            ),
            _ => {
                let item = MenuItem::with_id(
                    &window,
                    format!("ctx:{}", entry.id),
                    &entry.label,
                    entry.enabled.unwrap_or(true),
                    None::<&str>,
                )
                .map_err(|error| error.to_string())?;
                builder.item(&item)
            }
        };
    }

    let menu = builder.build().map_err(|error| error.to_string())?;
    window
        .popup_menu(&menu)
        .map_err(|error| error.to_string())
}

/// Finds the script path in a command line; this is how a double-clicked
/// `.lua` file, or "Open with", reaches the app.
fn lua_argument(arguments: &[String]) -> Option<String> {
    arguments.iter().skip(1).find_map(|argument| {
        let path = std::path::Path::new(argument.as_str());
        let extension = path.extension()?.to_string_lossy().to_lowercase();
        if path.exists() && (extension == "lua" || extension == "luau") {
            Some(argument.clone())
        } else {
            None
        }
    })
}

/// Hands the opened script to the page once; the page then forgets it, so a
/// refresh does not reopen the same file.
#[tauri::command]
fn sl_take_opened_file() -> Option<serde_json::Value> {
    let path = OPENED_FILE.lock().ok()?.take()?;
    read_script_file(&path).ok()
}

/// Reads a user-selected Lua/Luau text file for the desktop editor.
#[tauri::command]
fn sl_read_script(path: String) -> Result<serde_json::Value, String> {
    read_script_file(&path)
}

/// Saves downloaded Lua/Luau source into a path selected by the native dialog.
#[tauri::command]
fn sl_save_download(path: String, content: String) -> Result<String, String> {
    if path.trim().is_empty() {
        return Err("Путь сохранения пустой".into());
    }
    if content.len() > 4 * 1024 * 1024 {
        return Err("Файл больше 4 МиБ".into());
    }
    if std::str::from_utf8(content.as_bytes()).is_err() {
        return Err("Текст Lua должен быть в UTF-8".into());
    }

    let destination = std::path::Path::new(&path);
    let extension = destination
        .extension()
        .and_then(std::ffi::OsStr::to_str)
        .map(str::to_ascii_lowercase);
    if !matches!(extension.as_deref(), Some("lua" | "luau")) {
        return Err("Сохранить можно только файл .lua или .luau".into());
    }
    if destination.file_name().is_none() {
        return Err("Выбери имя файла".into());
    }
    if destination.exists() && !destination.is_file() {
        return Err("Путь не указывает на обычный файл".into());
    }

    std::fs::write(destination, content.as_bytes())
        .map_err(|error| format!("Не удалось сохранить файл: {error}"))?;
    Ok(path)
}

fn read_script_file(path: &str) -> Result<serde_json::Value, String> {
    let script_path = std::path::Path::new(path);
    let extension = script_path
        .extension()
        .and_then(std::ffi::OsStr::to_str)
        .map(str::to_ascii_lowercase);
    if !matches!(extension.as_deref(), Some("lua" | "luau")) {
        return Err("Можно открыть только файл .lua или .luau".into());
    }

    let metadata = std::fs::metadata(script_path).map_err(|_| "Файл не найден".to_string())?;
    if !metadata.is_file() {
        return Err("Путь не указывает на обычный файл".into());
    }
    if metadata.len() > 4 * 1024 * 1024 {
        return Err("Файл больше 4 МиБ".into());
    }

    let content = std::fs::read_to_string(script_path)
        .map_err(|_| "Файл не удалось прочитать как текст UTF-8".to_string())?;
    let name = script_path
        .file_name()
        .ok_or_else(|| "Не удалось определить имя файла".to_string())?
        .to_string_lossy()
        .to_string();
    Ok(serde_json::json!({ "name": name, "path": path, "content": content }))
}

/// Opens a folder (or selects a file) in Explorer.
#[tauri::command]
fn sl_reveal(path: String) -> Result<(), String> {
    if !std::path::Path::new(&path).exists() {
        return Err("Файл не найден".into());
    }
    let mut command = std::process::Command::new("explorer");
    if std::path::Path::new(&path).is_dir() {
        command.arg(&path);
    } else {
        command.arg(format!("/select,{path}"));
    }
    command.spawn().map(|_| ()).map_err(|error| error.to_string())
}

/// True when `code` from VS Code is on PATH.
#[tauri::command]
fn sl_code_ready() -> bool {
    std::process::Command::new("code")
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Hands a file or folder to VS Code.
#[tauri::command]
fn sl_open_in_code(path: String, line: Option<u32>) -> Result<(), String> {
    let target = match line {
        Some(number) if number > 0 => format!("{path}:{number}"),
        _ => path,
    };
    std::process::Command::new("code")
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|_| "Visual Studio Code не найден".to_string())
}

/// Sends an already open window to a screen (used by the mini window).
#[tauri::command]
fn sl_main_navigate(app: tauri::AppHandle, route: String) -> Result<(), String> {
    let route = if route == "/" {
        String::new()
    } else {
        clean_route(&route).ok_or("Недопустимый маршрут")?
    };
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval(&format!("location.hash='#/{route}'"));
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    Ok(())
}

#[tauri::command]
fn sl_set_close_to_tray(enabled: bool) {
    CLOSE_TO_TRAY.store(enabled, Ordering::Relaxed);
}

/// Window buttons of the custom titlebar.
#[tauri::command]
fn sl_window(window: tauri::WebviewWindow, action: String) -> Result<(), String> {
    let result = match action.as_str() {
        "minimize" => window.minimize(),
        "maximize" => {
            if window.is_maximized().unwrap_or(false) {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        "close" if window.label() == "main" && CLOSE_TO_TRAY.load(Ordering::Relaxed) => window.hide(),
        "close" => window.close(),
        _ => return Err("Неизвестное действие окна".into()),
    };
    result.map_err(|error| error.to_string())
}

#[tauri::command]
fn sl_window_state(window: tauri::WebviewWindow) -> bool {
    window.is_maximized().unwrap_or(false)
}

#[tauri::command]
fn sl_window_material(window: WebviewWindow) -> bool {
    #[cfg(target_os = "windows")]
    {
        return window_vibrancy::apply_mica(&window, None).is_ok();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        false
    }
}

/// Opens web links and `nullsbrawl://` room links with the system handler.
#[tauri::command]
fn sl_open(url: String) -> Result<(), String> {
    let lower = url.to_lowercase();
    if !(lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("nullsbrawl://"))
    {
        return Err("Недопустимая ссылка".into());
    }
    open_external(&url).map_err(|error| format!("Не удалось открыть ссылку: {error}"))
}

#[cfg(windows)]
fn open_external(url: &str) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    // rundll32 passes the URL through as a single argument; `cmd /c start` would
    // split battle links on `&` and open the wrong thing.
    std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", url])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
}

#[cfg(not(windows))]
fn open_external(url: &str) -> std::io::Result<()> {
    let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    std::process::Command::new(opener).arg(url).spawn().map(|_| ())
}

fn newer(candidate: &str, current: &str) -> bool {
    let parse = |value: &str| -> Vec<u64> {
        value
            .split('.')
            .map(|part| part.parse::<u64>().unwrap_or(0))
            .collect()
    };
    let left = parse(candidate);
    let right = parse(current);
    for index in 0..left.len().max(right.len()) {
        let a = left.get(index).copied().unwrap_or(0);
        let b = right.get(index).copied().unwrap_or(0);
        if a != b {
            return a > b;
        }
    }
    false
}

/// Looks for `desktop-v*` releases and reports whether a newer one exists.
#[tauri::command]
async fn sl_check_update() -> Result<serde_json::Value, String> {
    let current = env!("CARGO_PKG_VERSION");
    let response = client(15)?
        .get(RELEASES)
        .header("user-agent", "script-library-desktop")
        .header("accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| format!("GitHub недоступен: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("GitHub ответил {}", response.status()));
    }

    let releases: Vec<serde_json::Value> = response
        .json()
        .await
        .map_err(|error| format!("Непонятный ответ GitHub: {error}"))?;

    for release in releases {
        let tag = release.get("tag_name").and_then(|value| value.as_str()).unwrap_or_default();
        let Some(version) = tag.strip_prefix("desktop-v") else {
            continue;
        };
        let installer = release
            .get("assets")
            .and_then(|assets| assets.as_array())
            .and_then(|assets| {
                assets.iter().find(|asset| {
                    asset
                        .get("name")
                        .and_then(|name| name.as_str())
                        .map(|name| name.to_lowercase().ends_with("-setup.exe"))
                        .unwrap_or(false)
                })
            })
            .and_then(|asset| asset.get("browser_download_url"))
            .and_then(|url| url.as_str());

        return Ok(serde_json::json!({
            "current": current,
            "latest": version,
            "available": newer(version, current),
            "url": installer,
        }));
    }

    Ok(serde_json::json!({
        "current": current,
        "latest": current,
        "available": false,
        "url": null,
    }))
}

/// Downloads the new installer and hands it to Windows; the app closes so the
/// files it is holding can be replaced.
#[tauri::command]
async fn sl_install_update(url: String) -> Result<(), String> {
    if !url.starts_with("https://github.com/") {
        return Err("Обновление берётся только с GitHub".into());
    }
    let bytes = client(120)?
        .get(&url)
        .header("user-agent", "script-library-desktop")
        .send()
        .await
        .map_err(|error| format!("Не удалось скачать обновление: {error}"))?
        .error_for_status()
        .map_err(|error| format!("GitHub ответил ошибкой: {error}"))?
        .bytes()
        .await
        .map_err(|error| format!("Загрузка оборвалась: {error}"))?;

    let path = std::env::temp_dir().join("script-library-setup.exe");
    std::fs::write(&path, &bytes).map_err(|error| format!("Не удалось сохранить установщик: {error}"))?;

    std::process::Command::new(&path)
        .arg("/S")
        .spawn()
        .map_err(|error| format!("Не удалось запустить установщик: {error}"))?;

    std::process::exit(0);
}

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Открыть", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    let mut builder = TrayIconBuilder::new()
        .tooltip("Script Library")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => focus_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                focus_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn focus_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn route_deep_link(window: &WebviewWindow, url: &str) {
    // script-library://scripts/<uuid> -> the app's own /scripts/<uuid> route.
    let Some(rest) = url.strip_prefix("script-library://") else {
        return;
    };
    let rest = rest.trim_end_matches('/');
    let allowed = rest
        .chars()
        .all(|symbol| symbol.is_ascii_alphanumeric() || matches!(symbol, '/' | '-' | '_' | '@' | '.'));
    if !allowed || rest.is_empty() || rest.contains("..") {
        return;
    }
    let _ = window.eval(&format!("location.hash = '#/{rest}'"));
    let _ = window.set_focus();
}

/// Checked by CI: proves the binary starts and can reach the proxy.
fn self_test() -> i32 {
    let report = serde_json::json!({
        "ok": true,
        "app": "script-library",
        "version": env!("CARGO_PKG_VERSION"),
        "proxy": PROXY,
    });
    println!("{report}");
    0
}

fn api_self_test() -> i32 {
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(25))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            println!("{}", serde_json::json!({ "ok": false, "error": error.to_string() }));
            return 1;
        }
    };

    match client.get(format!("{PROXY}/data/catalog")).send() {
        Ok(response) => {
            let status = response.status().as_u16();
            let body = response.text().unwrap_or_default();
            let authors = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|value| {
                    value
                        .get("authors")
                        .and_then(|authors| authors.as_array().map(|items| items.len()))
                })
                .unwrap_or(0);
            let ok = status == 200 && authors > 0;
            println!(
                "{}",
                serde_json::json!({
                    "ok": ok,
                    "status": status,
                    "authors": authors,
                    "bytes": body.len(),
                })
            );
            if ok {
                0
            } else {
                1
            }
        }
        Err(error) => {
            println!("{}", serde_json::json!({ "ok": false, "error": error.to_string() }));
            1
        }
    }
}

fn main() {
    let arguments: Vec<String> = std::env::args().collect();
    if arguments.iter().any(|argument| argument == "--self-test") {
        std::process::exit(self_test());
    }
    if arguments.iter().any(|argument| argument == "--api-self-test") {
        std::process::exit(api_self_test());
    }

    // `--route=/authors` opens the app straight on a screen; used by the release
    // screenshots and handy for shortcuts.
    let route = arguments
        .iter()
        .find_map(|argument| argument.strip_prefix("--route="))
        .map(|value| value.to_string());
    let start_mini = arguments.iter().any(|argument| argument == "--mini");

    if let Some(path) = lua_argument(&arguments) {
        if let Ok(mut slot) = OPENED_FILE.lock() {
            *slot = Some(path);
        }
    }

    let mut builder = tauri::Builder::default();

    // A second launch (a shortcut, a link) focuses the window that already runs.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = lua_argument(&argv) {
                if let Ok(mut slot) = OPENED_FILE.lock() {
                    *slot = Some(path);
                }
                let _ = tauri::Emitter::emit(app, "sl-open-file", true);
            }
            if argv.iter().any(|argument| argument == "--mini") {
                open_mini_window(app);
            } else if let Some(route) = argv
                .iter()
                .find_map(|argument| argument.strip_prefix("--route="))
            {
                let _ = sl_main_navigate((*app).clone(), route.to_string());
            } else {
                focus_window(app);
            }
        }));
    }

    builder
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            sl_api,
            sl_open,
            sl_window,
            sl_window_open,
            sl_main_navigate,
            sl_set_close_to_tray,
            sl_window_state,
            sl_window_material,
            sl_check_update,
            sl_install_update,
            sl_context_menu,
            sl_reveal,
            sl_code_ready,
            sl_open_in_code,
            sl_take_opened_file,
            sl_read_script,
            sl_save_download
        ])
        .on_menu_event(|app, event| {
            if let Some(action) = event.id().as_ref().strip_prefix("ctx:") {
                let _ = tauri::Emitter::emit(app, "sl-menu", action.to_string());
            }
        })
        .setup(move |app| {
            build_tray(app.handle())?;

            if start_mini {
                open_mini_window(app.handle());
            }

            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                // Registers script-library:// in the current user's registry on
                // first launch; the installer cannot do this for a portable exe.
                let _ = app.deep_link().register_all();
                if let Some(window) = app.get_webview_window("main") {
                    app.deep_link().on_open_url(move |event| {
                        for url in event.urls() {
                            route_deep_link(&window, url.as_str());
                        }
                    });
                }
            }

            if let Some(route) = route {
                let safe: String = route
                    .chars()
                    .filter(|symbol| symbol.is_ascii_alphanumeric() || matches!(symbol, '/' | '-' | '_' | '@' | '.'))
                    .collect();
                // The hash always carries one leading slash: '#/authors'.
                let safe = safe.trim_start_matches('/').to_string();
                if !safe.is_empty() && !safe.contains("..") {
                    let handle = app.handle().clone();
                    std::thread::spawn(move || {
                        // The page boots, shows the first-run panels and only then
                        // settles on a route, so the hash is re-applied a few times.
                        for delay in [1200u64, 3500, 6500] {
                            std::thread::sleep(Duration::from_millis(delay));
                            if let Some(window) = handle.get_webview_window("main") {
                                let _ = window.eval(&format!("location.hash = '#/{safe}'"));
                            }
                        }
                    });
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && CLOSE_TO_TRAY.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Не удалось запустить Script Library");
}
