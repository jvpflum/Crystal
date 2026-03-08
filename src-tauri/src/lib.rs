use std::process::{Command, Child, Stdio};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, Runtime, AppHandle,
};
use serde::Serialize;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Serialize)]
struct CommandResult {
    stdout: String,
    stderr: String,
    code: i32,
}

#[derive(Serialize, Clone)]
struct ServerStatus {
    whisper_running: bool,
    tts_running: bool,
    ollama_running: bool,
    openclaw_running: bool,
}

struct ServerProcesses {
    llm: Option<Child>,
    whisper: Option<Child>,
    tts: Option<Child>,
    openclaw: Option<Child>,
    http_client: reqwest::Client,
}

struct AppState {
    servers: Mutex<ServerProcesses>,
    scripts_dir: Mutex<Option<String>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            servers: Mutex::new(ServerProcesses {
                llm: None,
                whisper: None,
                tts: None,
                openclaw: None,
                http_client: reqwest::Client::new(),
            }),
            scripts_dir: Mutex::new(None),
        }
    }
}

/// GPU stats via nvidia-smi — routed through cmd.exe to prevent console flash.
#[tauri::command]
async fn get_gpu_stats() -> Result<CommandResult, String> {
    tokio::task::spawn_blocking(|| {
        #[cfg(target_os = "windows")]
        let output = {
            let mut cmd = Command::new("cmd");
            cmd.args([
                "/C",
                "nvidia-smi --query-gpu=name,utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu,power.draw,power.limit --format=csv,noheader,nounits",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW);
            cmd.output()
        };
        #[cfg(not(target_os = "windows"))]
        let output = Command::new("nvidia-smi")
            .args([
                "--query-gpu=name,utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu,power.draw,power.limit",
                "--format=csv,noheader,nounits",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null())
            .output();

        match output {
            Ok(out) => Ok(CommandResult {
                stdout: String::from_utf8_lossy(&out.stdout).to_string(),
                stderr: String::from_utf8_lossy(&out.stderr).to_string(),
                code: out.status.code().unwrap_or(-1),
            }),
            Err(e) => Err(format!("nvidia-smi failed: {}", e)),
        }
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// System stats via a single wmic batch — avoids PowerShell entirely.
#[tauri::command]
async fn get_sys_stats() -> Result<CommandResult, String> {
    tokio::task::spawn_blocking(|| {
        #[cfg(target_os = "windows")]
        let output = {
            let script = r#"
$cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
$os = Get-CimInstance Win32_OperatingSystem
$ramTotal = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
$ramUsed = [math]::Round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / 1MB, 1)
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
$diskTotal = [math]::Round($disk.Size / 1GB, 0)
$diskUsed = [math]::Round(($disk.Size - $disk.FreeSpace) / 1GB, 0)
$up = (Get-Date) - $os.LastBootUpTime
$upStr = "$($up.Days)d $($up.Hours)h $($up.Minutes)m"
Write-Output "CPU_USAGE:$cpu"
Write-Output "RAM_USED:$ramUsed"
Write-Output "RAM_TOTAL:$ramTotal"
Write-Output "DISK_USED:$diskUsed"
Write-Output "DISK_TOTAL:$diskTotal"
Write-Output "UPTIME:$upStr"
"#;
            let mut cmd = Command::new("powershell");
            cmd.args(["-NoProfile", "-NonInteractive", "-Command", script])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .stdin(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW);
            cmd.output()
        };
        #[cfg(not(target_os = "windows"))]
        let output = Command::new("sh")
            .args(["-c", "echo CPU_USAGE:0; echo RAM_USED:0; echo RAM_TOTAL:0"])
            .output();

        match output {
            Ok(out) => Ok(CommandResult {
                stdout: String::from_utf8_lossy(&out.stdout).to_string(),
                stderr: String::from_utf8_lossy(&out.stderr).to_string(),
                code: out.status.code().unwrap_or(-1),
            }),
            Err(e) => Err(format!("System stats failed: {}", e)),
        }
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
async fn execute_command(command: String, cwd: Option<String>) -> Result<CommandResult, String> {
    tokio::task::spawn_blocking(move || {
        let working_dir = cwd.unwrap_or_else(|| {
            std::env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string())
        });

        #[cfg(target_os = "windows")]
        let output = {
            let mut cmd = Command::new("powershell");
            cmd.args(["-NoProfile", "-NonInteractive", "-Command", &command])
                .current_dir(&working_dir)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .stdin(Stdio::null());

            let sys_path = std::env::var("PATH").unwrap_or_default();
            let extra_dirs = [
                r"C:\Program Files\nodejs",
                r"C:\Program Files\Git\cmd",
            ];
            let user_appdata = std::env::var("APPDATA")
                .map(|a| format!(r"{}\npm", a))
                .unwrap_or_default();
            let mut full_path = String::new();
            for d in &extra_dirs {
                if Path::new(d).exists() && !sys_path.contains(d) {
                    full_path.push_str(d);
                    full_path.push(';');
                }
            }
            if !user_appdata.is_empty() && Path::new(&user_appdata).exists() && !sys_path.contains(&user_appdata) {
                full_path.push_str(&user_appdata);
                full_path.push(';');
            }
            full_path.push_str(&sys_path);
            cmd.env("PATH", &full_path);

            cmd.creation_flags(CREATE_NO_WINDOW).output()
        };

        #[cfg(not(target_os = "windows"))]
        let output = Command::new("sh")
            .args(["-c", &command])
            .current_dir(&working_dir)
            .output();

        match output {
            Ok(out) => Ok(CommandResult {
                stdout: String::from_utf8_lossy(&out.stdout).to_string(),
                stderr: String::from_utf8_lossy(&out.stderr).to_string(),
                code: out.status.code().unwrap_or(-1),
            }),
            Err(e) => Err(format!("Failed to execute command: {}", e)),
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

fn resolve_path(path: &str) -> String {
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string());
    let mut resolved = path.to_string();

    // Expand ~ to home directory
    if resolved.starts_with("~/") || resolved.starts_with("~\\") {
        resolved = format!("{}{}", home, &resolved[1..]);
    } else if resolved == "~" {
        resolved = home.clone();
    }

    // Resolve "Desktop/..." to the actual desktop path (check OneDrive first)
    if resolved.starts_with("Desktop/") || resolved.starts_with("Desktop\\") {
        let onedrive_desktop = format!("{}\\OneDrive\\Desktop\\{}", home, &resolved[8..]);
        let local_desktop = format!("{}\\Desktop\\{}", home, &resolved[8..]);
        if Path::new(&format!("{}\\OneDrive\\Desktop", home)).exists() {
            resolved = onedrive_desktop;
        } else {
            resolved = local_desktop;
        }
    }

    // Replace forward slashes with backslashes on Windows
    resolved = resolved.replace("/", "\\");

    // If still relative (no drive letter), resolve against home
    if !resolved.contains(':') && !resolved.starts_with("\\\\") {
        resolved = format!("{}\\{}", home, resolved);
    }

    resolved
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    let resolved = resolve_path(&path);
    fs::read_to_string(&resolved).map_err(|e| format!("Failed to read file '{}': {}", resolved, e))
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    let resolved = resolve_path(&path);
    if let Some(parent) = Path::new(&resolved).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    fs::write(&resolved, &content).map_err(|e| format!("Failed to write file '{}': {}", resolved, e))?;
    Ok(())
}

#[tauri::command]
fn list_directory(path: String) -> Result<Vec<String>, String> {
    let resolved = resolve_path(&path);
    let entries = fs::read_dir(&resolved).map_err(|e| format!("Failed to read directory '{}': {}", resolved, e))?;
    
    let mut files: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if e.path().is_dir() {
                format!("{}/", name)
            } else {
                name
            }
        })
        .collect();
    
    files.sort();
    Ok(files)
}

#[tauri::command]
async fn http_proxy(state: tauri::State<'_, AppState>, method: String, url: String, body: Option<String>, headers: Option<std::collections::HashMap<String, String>>) -> Result<String, String> {
    if let Ok(parsed) = url.parse::<reqwest::Url>() {
        match parsed.host_str() {
            Some("localhost") | Some("127.0.0.1") | Some("0.0.0.0") => {}
            _ => return Err("http_proxy restricted to localhost".to_string()),
        }
    } else {
        return Err("Invalid URL".to_string());
    }

    let client = {
        let servers = state.servers.lock().unwrap_or_else(|e| e.into_inner());
        servers.http_client.clone()
    };

    let mut req = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        _ => return Err(format!("Unsupported method: {}", method)),
    };

    req = req.header("Content-Type", "application/json");
    if let Some(hdrs) = headers {
        for (k, v) in hdrs {
            req = req.header(&k, &v);
        }
    }
    if let Some(b) = body {
        req = req.body(b);
    }

    let resp = req.timeout(std::time::Duration::from_secs(120))
        .send().await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| format!("Read body failed: {}", e))?;

    Ok(serde_json::json!({ "status": status, "body": text }).to_string())
}

#[tauri::command]
fn get_openclaw_token() -> Result<String, String> {
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string());
    let config_path = format!("{}/.openclaw/openclaw.json", home);
    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Cannot read config: {}", e))?;
    let json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid JSON: {}", e))?;
    let token = json.get("gateway")
        .and_then(|g| g.get("auth"))
        .and_then(|a| a.get("token"))
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();
    Ok(token)
}

fn check_port_in_use(port: u16) -> bool {
    use std::net::TcpStream;
    TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok()
}

fn find_python() -> Option<String> {
    let candidates = ["python", "python3", "py"];
    
    for cmd in candidates {
        let mut command = Command::new(cmd);
        command.args(["--version"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .stdin(Stdio::null());
        #[cfg(target_os = "windows")]
        command.creation_flags(CREATE_NO_WINDOW);
        let result = command.status();
        
        if let Ok(status) = result {
            if status.success() {
                return Some(cmd.to_string());
            }
        }
    }
    
    #[cfg(target_os = "windows")]
    {
        let common_paths = [
            r"C:\Python312\python.exe",
            r"C:\Python311\python.exe",
            r"C:\Python310\python.exe",
            r"C:\Program Files\Python312\python.exe",
            r"C:\Program Files\Python311\python.exe",
            r"C:\Program Files\Python310\python.exe",
        ];
        
        for path in common_paths {
            if Path::new(path).exists() {
                return Some(path.to_string());
            }
        }
        
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let python_paths = [
                format!(r"{}\Programs\Python\Python312\python.exe", local_app_data),
                format!(r"{}\Programs\Python\Python311\python.exe", local_app_data),
                format!(r"{}\Programs\Python\Python310\python.exe", local_app_data),
            ];
            
            for path in python_paths {
                if Path::new(&path).exists() {
                    return Some(path);
                }
            }
        }
    }
    
    None
}

/// Spawn a background process with no visible window on Windows.
#[cfg(target_os = "windows")]
fn spawn_hidden(program: &str, args: &[&str]) -> std::io::Result<Child> {
    fn escape_ps(s: &str) -> String {
        s.replace('\'', "''")
    }
    let full_cmd = if args.is_empty() {
        format!("& '{}'", escape_ps(program))
    } else {
        let args_str = args.iter()
            .map(|a| format!("'{}'", escape_ps(a)))
            .collect::<Vec<_>>()
            .join(" ");
        format!("& '{}' {}", escape_ps(program), args_str)
    };
    Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &full_cmd])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
}

#[cfg(not(target_os = "windows"))]
fn spawn_hidden(program: &str, args: &[&str]) -> std::io::Result<Child> {
    Command::new(program)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()
}

#[tauri::command]
fn get_server_status() -> ServerStatus {
    ServerStatus {
        whisper_running: check_port_in_use(8080),
        tts_running: check_port_in_use(8081),
        ollama_running: check_port_in_use(11434),
        openclaw_running: check_port_in_use(18789),
    }
}

#[tauri::command]
fn start_openclaw_daemon(state: tauri::State<AppState>) -> Result<String, String> {
    if check_port_in_use(18789) {
        return Ok("OpenClaw daemon already running".to_string());
    }
    
    let mut servers = state.servers.lock().unwrap_or_else(|e| e.into_inner());
    
    match spawn_hidden("npx", &["openclaw", "gateway", "--port", "18789"]) {
        Ok(child) => {
            servers.openclaw = Some(child);
            Ok("OpenClaw daemon started".to_string())
        }
        Err(e) => Err(format!("Failed to start OpenClaw daemon: {}", e)),
    }
}

#[tauri::command]
fn start_voice_servers(state: tauri::State<AppState>) -> Result<String, String> {
    let scripts_dir = state.scripts_dir.lock().unwrap_or_else(|e| e.into_inner());
    let scripts_path = scripts_dir.as_ref().ok_or("Scripts directory not set")?;
    
    let python_cmd = find_python().unwrap_or_else(|| "python".to_string());
    let mut servers = state.servers.lock().unwrap_or_else(|e| e.into_inner());
    let mut started = Vec::new();
    
    if !check_port_in_use(8080) {
        let whisper_script = Path::new(scripts_path).join("whisper_server.py");
        if whisper_script.exists() {
            let script_str = whisper_script.to_string_lossy().to_string();
            match spawn_hidden(&python_cmd, &[&script_str]) {
                Ok(child) => {
                    servers.whisper = Some(child);
                    started.push("Whisper STT");
                }
                Err(e) => eprintln!("Failed to start Whisper: {}", e),
            }
        }
    } else {
        started.push("Whisper STT (already running)");
    }
    
    if !check_port_in_use(8081) {
        let tts_script = Path::new(scripts_path).join("tts_server.py");
        if tts_script.exists() {
            let script_str = tts_script.to_string_lossy().to_string();
            match spawn_hidden(&python_cmd, &[&script_str]) {
                Ok(child) => {
                    servers.tts = Some(child);
                    started.push("TTS");
                }
                Err(e) => eprintln!("Failed to start TTS: {}", e),
            }
        }
    } else {
        started.push("TTS (already running)");
    }
    
    if started.is_empty() {
        Ok("No servers needed to start".to_string())
    } else {
        Ok(format!("Started: {}", started.join(", ")))
    }
}

#[tauri::command]
fn stop_voice_servers(state: tauri::State<AppState>) -> Result<String, String> {
    let mut servers = state.servers.lock().unwrap_or_else(|e| e.into_inner());
    let mut stopped = Vec::new();
    
    if let Some(mut child) = servers.whisper.take() {
        kill_process_tree(&mut child);
        stopped.push("Whisper");
    }
    
    if let Some(mut child) = servers.tts.take() {
        kill_process_tree(&mut child);
        stopped.push("TTS");
    }
    
    if stopped.is_empty() {
        Ok("No servers were running".to_string())
    } else {
        Ok(format!("Stopped: {}", stopped.join(", ")))
    }
}

fn create_tray<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    let quit = MenuItem::with_id(app, "quit", "Quit Crystal", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Show Crystal", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide to Tray", true, None::<&str>)?;
    
    let menu = Menu::with_items(app, &[&show, &hide, &quit])?;

    let icon = app.default_window_icon()
        .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?
        .clone();

    let _tray = TrayIconBuilder::with_id("crystal-tray")
        .tooltip("Crystal - AI Desktop Assistant")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "quit" => {
                cleanup_servers(app);
                app.exit(0);
            }
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "hide" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

fn setup_and_start_servers<R: Runtime>(app: &AppHandle<R>) {
    // Try multiple paths to find scripts directory
    let scripts_dir = {
        // First, try current working directory (most common in dev)
        std::env::current_dir().ok().and_then(|cwd| {
            let scripts = cwd.join("scripts");
            if scripts.exists() && scripts.join("whisper_server.py").exists() {
                println!("Found scripts in cwd: {:?}", scripts);
                Some(scripts)
            } else {
                None
            }
        })
    }.or_else(|| {
        // Check bundled resources (production)
        if let Ok(resource_path) = app.path().resource_dir() {
            let bundled = resource_path.join("scripts");
            if bundled.exists() && bundled.join("whisper_server.py").exists() {
                println!("Found scripts in resources: {:?}", bundled);
                Some(bundled)
            } else {
                None
            }
        } else {
            None
        }
    }).or_else(|| {
        // Development mode - look relative to exe going up directories
        std::env::current_exe().ok().and_then(|exe_path| {
            // In dev mode, exe is at: src-tauri/target/debug/crystal.exe
            // Scripts are at: [project root]/scripts/
            let mut current = exe_path.clone();
            for _ in 0..5 {
                if let Some(parent) = current.parent() {
                    current = parent.to_path_buf();
                    let scripts = current.join("scripts");
                    if scripts.exists() && scripts.join("whisper_server.py").exists() {
                        println!("Found scripts relative to exe: {:?}", scripts);
                        return Some(scripts);
                    }
                }
            }
            None
        })
    });
    
    // Kill any orphaned gateway from a previous session, then start a fresh one we own
    if check_port_in_use(18789) {
        println!("Killing orphaned OpenClaw gateway on port 18789...");
        #[cfg(target_os = "windows")]
        {
            let mut cmd = Command::new("powershell");
            cmd.args(["-NoProfile", "-NonInteractive", "-Command",
                "Get-NetTCPConnection -LocalPort 18789 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"])
                .stdout(Stdio::null()).stderr(Stdio::null()).stdin(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW);
            let _ = cmd.output();
        }
        std::thread::sleep(std::time::Duration::from_millis(1500));
    }
    println!("Starting OpenClaw daemon...");
    match spawn_hidden("npx", &["openclaw", "gateway", "--port", "18789"]) {
        Ok(child) => {
            if let Some(state) = app.try_state::<AppState>() {
                let mut servers = state.servers.lock().unwrap_or_else(|e| e.into_inner());
                servers.openclaw = Some(child);
            }
            println!("OpenClaw gateway started on port 18789");
        }
        Err(e) => eprintln!("OpenClaw daemon not available: {} (agent will use direct LLM)", e),
    }

    // Start Ollama if not already running
    if !check_port_in_use(11434) {
        println!("Starting Ollama...");
        match spawn_hidden("ollama", &["serve"]) {
            Ok(child) => {
                if let Some(state) = app.try_state::<AppState>() {
                    let mut servers = state.servers.lock().unwrap_or_else(|e| e.into_inner());
                    servers.llm = Some(child);
                }
                println!("Ollama started on port 11434");
            }
            Err(e) => eprintln!("Failed to start Ollama: {} - make sure Ollama is installed", e),
        }
    } else {
        println!("Ollama already running on port 11434");
    }

    if let Some(ref scripts_path) = scripts_dir {
        if scripts_path.exists() {
            println!("Scripts directory: {:?}", scripts_path);
            
            if let Some(state) = app.try_state::<AppState>() {
                let mut dir = state.scripts_dir.lock().unwrap_or_else(|e| e.into_inner());
                *dir = Some(scripts_path.to_string_lossy().to_string());
            }
            
            let whisper_script = scripts_path.join("whisper_server.py");
            let tts_script = scripts_path.join("tts_server.py");
            
            let python_cmd = find_python();
            
            if let Some(ref python) = python_cmd {
                println!("Using Python: {}", python);
                
                if let Some(state) = app.try_state::<AppState>() {
                    let mut servers = state.servers.lock().unwrap_or_else(|e| e.into_inner());

                    // Kill orphaned voice servers from previous sessions
                    #[cfg(target_os = "windows")]
                    {
                        for port in [8080u16, 8081] {
                            if check_port_in_use(port) {
                                let kill_cmd = format!("Get-NetTCPConnection -LocalPort {} -ErrorAction SilentlyContinue | ForEach-Object {{ Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }}", port);
                                let mut cmd = Command::new("powershell");
                                cmd.args(["-NoProfile", "-NonInteractive", "-Command", &kill_cmd])
                                    .stdout(Stdio::null()).stderr(Stdio::null()).stdin(Stdio::null())
                                    .creation_flags(CREATE_NO_WINDOW);
                                let _ = cmd.output();
                            }
                        }
                        std::thread::sleep(std::time::Duration::from_millis(500));
                    }

                    if whisper_script.exists() {
                        println!("Starting Whisper STT server...");
                        let script_str = whisper_script.to_string_lossy().to_string();
                        match spawn_hidden(python, &[&script_str]) {
                            Ok(child) => {
                                servers.whisper = Some(child);
                                println!("Whisper server started");
                            }
                            Err(e) => eprintln!("Failed to start Whisper: {}", e),
                        }
                    }
                    
                    if tts_script.exists() {
                        println!("Starting TTS server...");
                        let script_str = tts_script.to_string_lossy().to_string();
                        match spawn_hidden(python, &[&script_str]) {
                            Ok(child) => {
                                servers.tts = Some(child);
                                println!("TTS server started");
                            }
                            Err(e) => eprintln!("Failed to start TTS: {}", e),
                        }
                    }
                }
            } else {
                eprintln!("Python not found - voice servers disabled.");
            }
        }
    }
}

fn kill_process_tree(child: &mut Child) {
    let pid = child.id();
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("taskkill");
        cmd.args(["/F", "/T", "/PID", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .stdin(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW);
        let _ = cmd.output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = child.kill();
    }
}

fn cleanup_servers(app: &AppHandle<impl Runtime>) {
    if let Some(state) = app.try_state::<AppState>() {
        let mut servers = state.servers.lock().unwrap_or_else(|e| e.into_inner());
        
        if let Some(mut child) = servers.llm.take() {
            println!("Stopping LLM server...");
            kill_process_tree(&mut child);
        }
        
        if let Some(mut child) = servers.whisper.take() {
            println!("Stopping Whisper server...");
            kill_process_tree(&mut child);
        }
        
        if let Some(mut child) = servers.tts.take() {
            println!("Stopping TTS server...");
            kill_process_tree(&mut child);
        }
        
        if let Some(mut child) = servers.openclaw.take() {
            println!("Stopping OpenClaw daemon...");
            kill_process_tree(&mut child);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState::default())
        .setup(|app| {
            create_tray(app.handle())?;
            
            // Start voice servers automatically
            setup_and_start_servers(app.handle());
            
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            execute_command,
            get_gpu_stats,
            get_sys_stats,
            read_file,
            write_file,
            list_directory,
            get_server_status,
            start_voice_servers,
            stop_voice_servers,
            start_openclaw_daemon,
            http_proxy,
            get_openclaw_token
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                cleanup_servers(app);
            }
        });
}
