use serde::{Deserialize, Serialize};
use std::{
    ffi::{c_char, c_void, CString},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    AppHandle, Manager, State, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;

const TRAY_ID: &str = "main-tray";
const TRAY_AWAKE_ICON: &[u8] = include_bytes!("../icons/tray-awake.png");
const TRAY_SLEEP_ICON: &[u8] = include_bytes!("../icons/tray-sleep.png");
const HELPER_BUNDLE_NAME: &str = "sleepless-pmset-helper";
const HELPER_INSTALL_PATH: &str = "/Library/PrivilegedHelperTools/app.mac.acawake.pmset-helper";
const HELPER_VERSION: &str = "1";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
enum AwakeDuration {
    #[serde(rename = "10m")]
    TenMinutes,
    #[serde(rename = "30m")]
    ThirtyMinutes,
    #[serde(rename = "1h")]
    OneHour,
    #[serde(rename = "forever")]
    Forever,
}

impl Default for AwakeDuration {
    fn default() -> Self {
        Self::Forever
    }
}

impl AwakeDuration {
    fn timeout(self) -> Option<Duration> {
        match self {
            Self::TenMinutes => Some(Duration::from_secs(10 * 60)),
            Self::ThirtyMinutes => Some(Duration::from_secs(30 * 60)),
            Self::OneHour => Some(Duration::from_secs(60 * 60)),
            Self::Forever => None,
        }
    }

    fn menu_id(self) -> &'static str {
        match self {
            Self::TenMinutes => "duration_10m",
            Self::ThirtyMinutes => "duration_30m",
            Self::OneHour => "duration_1h",
            Self::Forever => "duration_forever",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::TenMinutes => "10분",
            Self::ThirtyMinutes => "30분",
            Self::OneHour => "1시간",
            Self::Forever => "영구",
        }
    }
}

#[derive(Default)]
struct SessionState {
    awake_duration: AwakeDuration,
    lid_closed_since: Option<Instant>,
    last_safety_check: Option<Instant>,
    saved_brightness: Option<f32>,
    last_stopped_reason: Option<&'static str>,
}

#[derive(Default)]
struct AwakeProcess {
    child: Mutex<Option<Child>>,
    session: Mutex<SessionState>,
}

impl Drop for AwakeProcess {
    fn drop(&mut self) {
        restore_display_brightness(self);
        if let Ok(mut child_slot) = self.child.lock() {
            if let Some(mut child) = child_slot.take() {
                let _ = run_installed_helper("disable");
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AwakeStatus {
    is_active: bool,
    is_ac_power_connected: bool,
    awake_duration: AwakeDuration,
    is_lid_closed: bool,
    battery_percent: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stopped_reason: Option<&'static str>,
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn CGMainDisplayID() -> u32;
    fn CGDisplayIOServicePort(display: u32) -> u32;
}

#[link(name = "IOKit", kind = "framework")]
extern "C" {
    fn IODisplayGetFloatParameter(
        service: u32,
        options: u32,
        parameter_name: *const c_void,
        value: *mut f32,
    ) -> i32;
    fn IODisplaySetFloatParameter(
        service: u32,
        options: u32,
        parameter_name: *const c_void,
        value: f32,
    ) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringCreateWithCString(
        alloc: *const c_void,
        c_str: *const c_char,
        encoding: u32,
    ) -> *const c_void;
    fn CFRelease(cf: *const c_void);
}

const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

fn with_brightness_key<T>(callback: impl FnOnce(*const c_void) -> T) -> Option<T> {
    let key = CString::new("brightness").ok()?;
    let cf_key = unsafe {
        CFStringCreateWithCString(std::ptr::null(), key.as_ptr(), K_CF_STRING_ENCODING_UTF8)
    };
    if cf_key.is_null() {
        return None;
    }

    let result = callback(cf_key);
    unsafe {
        CFRelease(cf_key);
    }
    Some(result)
}

fn read_display_brightness() -> Option<f32> {
    let service = unsafe { CGDisplayIOServicePort(CGMainDisplayID()) };
    if service == 0 {
        return None;
    }

    with_brightness_key(|key| {
        let mut value = 0.0_f32;
        let status = unsafe { IODisplayGetFloatParameter(service, 0, key, &mut value) };
        if status == 0 {
            Some(value.clamp(0.0, 1.0))
        } else {
            None
        }
    })
    .flatten()
}

fn set_display_brightness(value: f32) -> Result<(), String> {
    let service = unsafe { CGDisplayIOServicePort(CGMainDisplayID()) };
    if service == 0 {
        return Err("Could not find the main display service.".to_string());
    }

    with_brightness_key(|key| {
        let status = unsafe { IODisplaySetFloatParameter(service, 0, key, value.clamp(0.0, 1.0)) };
        if status == 0 {
            Ok(())
        } else {
            Err("Could not change display brightness.".to_string())
        }
    })
    .unwrap_or_else(|| Err("Could not create display brightness key.".to_string()))
}

fn is_on_ac_power() -> Result<bool, String> {
    let output = Command::new("/usr/bin/pmset")
        .args(["-g", "ps"])
        .output()
        .map_err(|error| format!("Could not check power source: {error}"))?;

    if !output.status.success() {
        return Err("Could not check power source with pmset.".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.contains("AC Power"))
}

fn battery_percent() -> Option<u8> {
    let output = Command::new("/usr/bin/pmset")
        .args(["-g", "batt"])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let percent_index = stdout.find('%')?;
    let digits = stdout[..percent_index]
        .chars()
        .rev()
        .take_while(|character| character.is_ascii_digit())
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();

    digits.parse::<u8>().ok()
}

fn is_lid_closed() -> bool {
    let output = Command::new("/usr/sbin/ioreg")
        .args(["-r", "-k", "AppleClamshellState", "-d", "1"])
        .output();

    output
        .ok()
        .map(|output| {
            String::from_utf8_lossy(&output.stdout).contains("\"AppleClamshellState\" = Yes")
        })
        .unwrap_or(false)
}

fn sleep_now() {
    let _ = Command::new("/usr/bin/pmset").arg("sleepnow").status();
}

fn active_child(child_slot: &mut Option<Child>) -> Result<bool, String> {
    match child_slot.as_mut() {
        Some(child) => match child
            .try_wait()
            .map_err(|error| format!("Could not inspect caffeinate: {error}"))?
        {
            Some(_) => {
                *child_slot = None;
                Ok(false)
            }
            None => Ok(true),
        },
        None => Ok(false),
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn applescript_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn bundled_helper_path() -> Result<PathBuf, String> {
    let current_exe =
        std::env::current_exe().map_err(|error| format!("Could not find app path: {error}"))?;
    let exe_dir = current_exe
        .parent()
        .ok_or_else(|| "Could not inspect app directory.".to_string())?;

    let adjacent_helper = exe_dir.join(HELPER_BUNDLE_NAME);
    if adjacent_helper.exists() {
        return Ok(adjacent_helper);
    }

    if exe_dir.file_name().is_some_and(|name| name == "MacOS") {
        if let Some(contents_dir) = exe_dir.parent() {
            let resource_helper = contents_dir.join("Resources").join(HELPER_BUNDLE_NAME);
            if resource_helper.exists() {
                return Ok(resource_helper);
            }
        }
    }

    if let Some(project_dir) = exe_dir.parent().and_then(|target_dir| target_dir.parent()) {
        let helper_target = project_dir
            .join("helper")
            .join("target")
            .join("release")
            .join(HELPER_BUNDLE_NAME);
        if helper_target.exists() {
            return Ok(helper_target);
        }
    }

    Err("Sleepless helper is missing from this app bundle.".to_string())
}

fn installed_helper_version() -> Option<String> {
    let output = Command::new(HELPER_INSTALL_PATH)
        .arg("--version")
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn helper_is_installed() -> bool {
    installed_helper_version().as_deref() == Some(HELPER_VERSION)
}

fn install_helper() -> Result<(), String> {
    if helper_is_installed() {
        return Ok(());
    }

    let source = bundled_helper_path()?;
    let command = format!(
        "/bin/mkdir -p {} && /usr/bin/install -o root -g wheel -m 4755 {} {}",
        shell_quote("/Library/PrivilegedHelperTools"),
        shell_quote(&source.to_string_lossy()),
        shell_quote(HELPER_INSTALL_PATH),
    );
    let script = format!(
        "do shell script {} with administrator privileges with prompt {}",
        applescript_quote(&command),
        applescript_quote("Sleepless needs one-time permission to install its power helper."),
    );
    let output = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| format!("Could not request helper installation permission: {error}"))?;

    if output.status.success() {
        if helper_is_installed() {
            return Ok(());
        }

        return Err("Sleepless helper was installed but could not be verified.".to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let details = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };

    if details.contains("-128") {
        return Err(
            "Administrator permission is required to install the power helper.".to_string(),
        );
    }

    Err(format!("Could not install Sleepless helper: {details}"))
}

fn run_installed_helper(command: &str) -> Result<(), String> {
    let output = Command::new(HELPER_INSTALL_PATH)
        .arg(command)
        .output()
        .map_err(|error| format!("Could not run Sleepless helper: {error}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let details = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };

    Err(format!("Sleepless helper failed: {details}"))
}

fn set_closed_lid_sleep_disabled(disabled: bool) -> Result<(), String> {
    install_helper()?;
    match run_installed_helper(if disabled { "enable" } else { "disable" }) {
        Ok(()) => Ok(()),
        Err(first_error) => {
            install_helper()?;
            run_installed_helper(if disabled { "enable" } else { "disable" })
                .map_err(|second_error| format!("{first_error}; retry failed: {second_error}"))
        }
    }
}

fn restore_display_brightness(state: &AwakeProcess) {
    let Ok(mut session) = state.session.lock() else {
        return;
    };

    if let Some(saved_brightness) = session.saved_brightness.take() {
        let _ = set_display_brightness(saved_brightness);
    }
    session.lid_closed_since = None;
    session.last_safety_check = None;
}

fn dim_display_for_lid_close(state: &AwakeProcess) {
    let Ok(mut session) = state.session.lock() else {
        return;
    };

    if session.saved_brightness.is_none() {
        session.saved_brightness = read_display_brightness();
        let _ = set_display_brightness(0.0);
    }
}

fn current_awake_duration(state: &AwakeProcess) -> AwakeDuration {
    state
        .session
        .lock()
        .map(|session| session.awake_duration)
        .unwrap_or_default()
}

fn is_awake_active(state: &AwakeProcess) -> bool {
    state
        .child
        .lock()
        .ok()
        .and_then(|mut child_slot| active_child(&mut child_slot).ok())
        .unwrap_or(false)
}

fn make_status(
    is_active: bool,
    is_ac_power_connected: bool,
    state: &AwakeProcess,
    stopped_reason: Option<&'static str>,
) -> AwakeStatus {
    AwakeStatus {
        is_active,
        is_ac_power_connected,
        awake_duration: current_awake_duration(state),
        is_lid_closed: is_lid_closed(),
        battery_percent: battery_percent(),
        stopped_reason,
    }
}

fn stop_active_session(
    state: &AwakeProcess,
    app: Option<&AppHandle>,
    stopped_reason: Option<&'static str>,
    should_sleep: bool,
) -> AwakeStatus {
    if let Ok(mut child_slot) = state.child.lock() {
        if let Some(mut child) = child_slot.take() {
            let _ = run_installed_helper("disable");
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    restore_display_brightness(state);

    if let Ok(mut session) = state.session.lock() {
        session.last_stopped_reason = stopped_reason;
    }

    if let Some(app_handle) = app {
        refresh_tray(app_handle, false);
    }

    if should_sleep {
        sleep_now();
    }

    make_status(
        false,
        is_on_ac_power().unwrap_or(false),
        state,
        stopped_reason,
    )
}

#[tauri::command]
fn awake_status(state: State<'_, AwakeProcess>, app: AppHandle) -> Result<AwakeStatus, String> {
    let mut child_slot = state
        .child
        .lock()
        .map_err(|_| "Could not lock awake process state.".to_string())?;

    let is_active = active_child(&mut child_slot)?;
    let is_ac_power_connected = is_on_ac_power().unwrap_or(false);

    if is_active && !is_ac_power_connected {
        drop(child_slot);
        return Ok(stop_active_session(
            &state,
            Some(&app),
            Some("acDisconnected"),
            false,
        ));
    }

    if !is_active {
        let stopped_reason = state
            .session
            .lock()
            .ok()
            .and_then(|mut session| session.last_stopped_reason.take());
        return Ok(make_status(
            false,
            is_ac_power_connected,
            &state,
            stopped_reason,
        ));
    }

    Ok(make_status(true, is_ac_power_connected, &state, None))
}

fn tray_icon(active: bool) -> tauri::Result<Image<'static>> {
    Image::from_bytes(if active {
        TRAY_AWAKE_ICON
    } else {
        TRAY_SLEEP_ICON
    })
}

fn refresh_tray(app: &AppHandle, active: bool) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Ok(icon) = tray_icon(active) {
            let _ = tray.set_icon_with_as_template(Some(icon), true);
        }
        if let Ok(menu) = build_tray_menu(
            app,
            active,
            current_awake_duration(&app.state::<AwakeProcess>()),
        ) {
            let _ = tray.set_menu(Some(menu));
        }
        let tooltip = if active {
            "Sleepless: awake"
        } else {
            "Sleepless: sleep"
        };
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

fn launch_at_login_enabled(app: &AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

fn start_awake_process(
    state: &AwakeProcess,
    app: Option<&AppHandle>,
    awake_duration: AwakeDuration,
) -> Result<AwakeStatus, String> {
    let mut child_slot = state
        .child
        .lock()
        .map_err(|_| "Could not lock awake process state.".to_string())?;

    if active_child(&mut child_slot)? {
        if let Some(app_handle) = app {
            refresh_tray(app_handle, true);
        }
        return Ok(AwakeStatus {
            is_active: true,
            is_ac_power_connected: is_on_ac_power().unwrap_or(true),
            awake_duration: current_awake_duration(state),
            is_lid_closed: is_lid_closed(),
            battery_percent: battery_percent(),
            stopped_reason: None,
        });
    }

    if !is_on_ac_power()? {
        return Err("AC power is required before awake mode can start.".to_string());
    }

    set_closed_lid_sleep_disabled(true)?;

    if let Ok(mut session) = state.session.lock() {
        session.awake_duration = awake_duration;
        session.lid_closed_since = None;
        session.last_safety_check = None;
        session.last_stopped_reason = None;
    }

    let child = Command::new("/usr/bin/caffeinate")
        .args(["-d", "-i", "-m", "-s"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            let _ = set_closed_lid_sleep_disabled(false);
            format!("Could not start caffeinate: {error}")
        })?;

    *child_slot = Some(child);

    if let Some(app_handle) = app {
        refresh_tray(app_handle, true);
    }

    Ok(make_status(true, true, state, None))
}

fn stop_awake_process(
    state: &AwakeProcess,
    app: Option<&AppHandle>,
) -> Result<AwakeStatus, String> {
    let mut child_slot = state
        .child
        .lock()
        .map_err(|_| "Could not lock awake process state.".to_string())?;

    let Some(mut child) = child_slot.take() else {
        if helper_is_installed() {
            let _ = run_installed_helper("disable");
        }

        if let Some(app_handle) = app {
            refresh_tray(app_handle, false);
        }

        return Ok(AwakeStatus {
            is_active: false,
            is_ac_power_connected: is_on_ac_power().unwrap_or(false),
            awake_duration: current_awake_duration(state),
            is_lid_closed: is_lid_closed(),
            battery_percent: battery_percent(),
            stopped_reason: None,
        });
    };

    if let Err(error) = set_closed_lid_sleep_disabled(false) {
        *child_slot = Some(child);
        return Err(error);
    }

    child
        .kill()
        .map_err(|error| format!("Could not stop caffeinate: {error}"))?;
    let _ = child.wait();

    restore_display_brightness(state);

    if let Some(app_handle) = app {
        refresh_tray(app_handle, false);
    }

    Ok(make_status(
        false,
        is_on_ac_power().unwrap_or(false),
        state,
        None,
    ))
}

#[tauri::command]
fn start_awake(
    state: State<'_, AwakeProcess>,
    app: AppHandle,
    awake_duration: AwakeDuration,
) -> Result<AwakeStatus, String> {
    start_awake_process(&state, Some(&app), awake_duration)
}

#[tauri::command]
fn stop_awake(state: State<'_, AwakeProcess>, app: AppHandle) -> Result<AwakeStatus, String> {
    stop_awake_process(&state, Some(&app))
}

#[tauri::command]
fn set_awake_duration(
    state: State<'_, AwakeProcess>,
    app: AppHandle,
    awake_duration: AwakeDuration,
) -> Result<AwakeStatus, String> {
    if let Ok(mut session) = state.session.lock() {
        session.awake_duration = awake_duration;
    }
    let is_active = is_awake_active(&state);
    refresh_tray(&app, is_active);
    Ok(make_status(
        is_active,
        is_on_ac_power().unwrap_or(false),
        &state,
        None,
    ))
}

#[tauri::command]
fn sync_tray_menu(state: State<'_, AwakeProcess>, app: AppHandle) {
    refresh_tray(&app, is_awake_active(&state));
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn duration_from_menu_id(id: &str) -> Option<AwakeDuration> {
    match id {
        "duration_10m" => Some(AwakeDuration::TenMinutes),
        "duration_30m" => Some(AwakeDuration::ThirtyMinutes),
        "duration_1h" => Some(AwakeDuration::OneHour),
        "duration_forever" => Some(AwakeDuration::Forever),
        _ => None,
    }
}

fn build_duration_item(
    app: &AppHandle,
    selected_duration: AwakeDuration,
    duration: AwakeDuration,
) -> tauri::Result<CheckMenuItem<tauri::Wry>> {
    CheckMenuItem::with_id(
        app,
        duration.menu_id(),
        duration.label(),
        true,
        selected_duration == duration,
        None::<&str>,
    )
}

fn build_tray_menu(
    app: &AppHandle,
    active: bool,
    selected_duration: AwakeDuration,
) -> tauri::Result<Menu<tauri::Wry>> {
    let show = MenuItem::with_id(app, "show", "창 열기", true, None::<&str>)?;
    let toggle = CheckMenuItem::with_id(
        app,
        "toggle_awake",
        "잠자기 방지",
        true,
        active,
        None::<&str>,
    )?;
    let duration_10m = build_duration_item(app, selected_duration, AwakeDuration::TenMinutes)?;
    let duration_30m = build_duration_item(app, selected_duration, AwakeDuration::ThirtyMinutes)?;
    let duration_1h = build_duration_item(app, selected_duration, AwakeDuration::OneHour)?;
    let duration_forever = build_duration_item(app, selected_duration, AwakeDuration::Forever)?;
    let duration_menu = Submenu::with_id_and_items(
        app,
        "duration",
        "유지 시간",
        true,
        &[
            &duration_10m,
            &duration_30m,
            &duration_1h,
            &duration_forever,
        ],
    )?;
    let launch_background = CheckMenuItem::with_id(
        app,
        "launch_background",
        "로그인 시 백그라운드 실행",
        true,
        launch_at_login_enabled(app),
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
    Menu::with_items(
        app,
        &[
            &show,
            &toggle,
            &duration_menu,
            &launch_background,
            &separator,
            &quit,
        ],
    )
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_tray_menu(
        app,
        false,
        current_awake_duration(&app.state::<AwakeProcess>()),
    )?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(tray_icon(false)?)
        .icon_as_template(true)
        .tooltip("Sleepless: sleep")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "toggle_awake" => {
                let state = app.state::<AwakeProcess>();
                if is_awake_active(&state) {
                    let _ = stop_awake_process(&state, Some(app));
                } else {
                    let duration = current_awake_duration(&state);
                    let _ = start_awake_process(&state, Some(app), duration);
                }
            }
            "launch_background" => {
                let autolaunch = app.autolaunch();
                if autolaunch.is_enabled().unwrap_or(false) {
                    let _ = autolaunch.disable();
                } else {
                    let _ = autolaunch.enable();
                }
                let state = app.state::<AwakeProcess>();
                refresh_tray(app, is_awake_active(&state));
            }
            "quit" => {
                let state = app.state::<AwakeProcess>();
                let _ = stop_awake_process(&state, Some(app));
                app.exit(0);
            }
            id => {
                if let Some(duration) = duration_from_menu_id(id) {
                    let state = app.state::<AwakeProcess>();
                    if let Ok(mut session) = state.session.lock() {
                        session.awake_duration = duration;
                    }
                    refresh_tray(app, is_awake_active(&state));
                }
            }
        })
        .build(app)?;

    Ok(())
}

fn monitor_active_session(state: &AwakeProcess, app: &AppHandle) {
    let Ok(mut child_slot) = state.child.lock() else {
        return;
    };

    let Ok(is_active) = active_child(&mut child_slot) else {
        return;
    };

    if !is_active {
        return;
    }

    drop(child_slot);

    let is_ac_power_connected = is_on_ac_power().unwrap_or(false);
    let is_closed = is_lid_closed();
    let percent = battery_percent();

    if !is_ac_power_connected {
        let should_sleep = is_closed;
        stop_active_session(state, Some(app), Some("acDisconnected"), should_sleep);
        return;
    }

    if !is_closed {
        restore_display_brightness(state);
        return;
    }

    let now = Instant::now();
    let duration_expired = {
        let Ok(mut session) = state.session.lock() else {
            return;
        };

        let lid_closed_since = *session.lid_closed_since.get_or_insert(now);
        session.last_safety_check.get_or_insert(now);

        session
            .awake_duration
            .timeout()
            .is_some_and(|timeout| now.duration_since(lid_closed_since) >= timeout)
    };

    dim_display_for_lid_close(state);

    if duration_expired {
        stop_active_session(state, Some(app), Some("durationExpired"), true);
        return;
    }

    let should_run_safety_check = state
        .session
        .lock()
        .map(|mut session| {
            let should_check = session
                .last_safety_check
                .is_none_or(|last_check| now.duration_since(last_check) >= Duration::from_secs(60));
            if should_check {
                session.last_safety_check = Some(now);
            }
            should_check
        })
        .unwrap_or(false);

    if should_run_safety_check {
        if percent.is_some_and(|battery| battery <= 10) {
            stop_active_session(state, Some(app), Some("batteryLow"), true);
        } else if percent.is_none() {
            stop_active_session(state, Some(app), Some("batteryUnsafe"), true);
        }
    }
}

fn spawn_power_monitor(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(5));
        let state = app.state::<AwakeProcess>();
        monitor_active_session(&state, &app);
    });
}

fn is_background_launch() -> bool {
    std::env::args().any(|argument| argument == "--background")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--background"])
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .manage(AwakeProcess::default())
        .setup(|app| {
            build_tray(app.handle())?;
            spawn_power_monitor(app.handle().clone());
            if !is_background_launch() {
                show_main_window(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            awake_status,
            set_awake_duration,
            sync_tray_menu,
            start_awake,
            stop_awake
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
