use std::process::{Command, Child, Stdio};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};
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
    nvidia_stt_running: bool,
    nvidia_tts_running: bool,
}

struct ServerProcesses {
    llm: Option<Child>,
    whisper: Option<Child>,
    tts: Option<Child>,
    openclaw: Option<Child>,
    nvidia_stt: Option<Child>,
    nvidia_tts: Option<Child>,
    http_client: reqwest::Client,
}

const STREAM_BUF_CAP: usize = 4 * 1024 * 1024; // 4 MB rolling window

struct StreamingProcess {
    stdout_buf: Mutex<String>,
    stderr_buf: Mutex<String>,
    read_cursor: Mutex<usize>,
    stderr_cursor: Mutex<usize>,
    done: Mutex<bool>,
    exit_code: Mutex<Option<i32>>,
    pid: u32,
    /// Bytes trimmed from the front of stdout so far (used to adjust cursor)
    stdout_trimmed: Mutex<usize>,
    stderr_trimmed: Mutex<usize>,
}

#[derive(Serialize)]
struct StreamingPollResult {
    new_output: String,
    new_stderr: String,
    done: bool,
    exit_code: Option<i32>,
}

static STREAM_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

struct AppState {
    servers: Mutex<ServerProcesses>,
    scripts_dir: Mutex<Option<String>>,
    streaming: Mutex<HashMap<String, Arc<StreamingProcess>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            servers: Mutex::new(ServerProcesses {
                llm: None,
                whisper: None,
                tts: None,
                openclaw: None,
                nvidia_stt: None,
                nvidia_tts: None,
                http_client: reqwest::Client::new(),
            }),
            scripts_dir: Mutex::new(None),
            streaming: Mutex::new(HashMap::new()),
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

#[tauri::command]
fn start_streaming_command(state: tauri::State<AppState>, command: String, cwd: Option<String>) -> Result<String, String> {
    let working_dir = cwd.unwrap_or_else(|| {
        std::env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string())
    });

    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("powershell");
        c.args(["-NoProfile", "-NonInteractive", "-Command", &command])
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
        c.env("PATH", &full_path);
        c.creation_flags(CREATE_NO_WINDOW);
        c
    };

    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = Command::new("sh");
        c.args(["-c", &command])
            .current_dir(&working_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null());
        c
    };

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn: {}", e))?;
    let pid = child.id();
    let id = format!("stream-{}", STREAM_ID_COUNTER.fetch_add(1, Ordering::Relaxed));

    let proc = Arc::new(StreamingProcess {
        stdout_buf: Mutex::new(String::new()),
        stderr_buf: Mutex::new(String::new()),
        read_cursor: Mutex::new(0),
        stderr_cursor: Mutex::new(0),
        done: Mutex::new(false),
        exit_code: Mutex::new(None),
        pid,
        stdout_trimmed: Mutex::new(0),
        stderr_trimmed: Mutex::new(0),
    });

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let proc_out = Arc::clone(&proc);
    if let Some(stdout) = stdout {
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let mut buf = proc_out.stdout_buf.lock().unwrap_or_else(|e| e.into_inner());
                    buf.push_str(&line);
                    buf.push('\n');
                    if buf.len() > STREAM_BUF_CAP {
                        let trim = buf.len() - STREAM_BUF_CAP;
                        let boundary = buf[trim..].find('\n').map(|p| trim + p + 1).unwrap_or(trim);
                        buf.drain(..boundary);
                        let mut cursor = proc_out.read_cursor.lock().unwrap_or_else(|e| e.into_inner());
                        *cursor = cursor.saturating_sub(boundary);
                        *proc_out.stdout_trimmed.lock().unwrap_or_else(|e| e.into_inner()) += boundary;
                    }
                }
            }
        });
    }

    let proc_err = Arc::clone(&proc);
    if let Some(stderr) = stderr {
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let mut buf = proc_err.stderr_buf.lock().unwrap_or_else(|e| e.into_inner());
                    buf.push_str(&line);
                    buf.push('\n');
                    if buf.len() > STREAM_BUF_CAP {
                        let trim = buf.len() - STREAM_BUF_CAP;
                        let boundary = buf[trim..].find('\n').map(|p| trim + p + 1).unwrap_or(trim);
                        buf.drain(..boundary);
                        let mut cursor = proc_err.stderr_cursor.lock().unwrap_or_else(|e| e.into_inner());
                        *cursor = cursor.saturating_sub(boundary);
                        *proc_err.stderr_trimmed.lock().unwrap_or_else(|e| e.into_inner()) += boundary;
                    }
                }
            }
        });
    }

    let proc_wait = Arc::clone(&proc);
    std::thread::spawn(move || {
        let status = child.wait();
        let code = status.ok().and_then(|s| s.code()).unwrap_or(-1);
        *proc_wait.exit_code.lock().unwrap_or_else(|e| e.into_inner()) = Some(code);
        *proc_wait.done.lock().unwrap_or_else(|e| e.into_inner()) = true;
    });

    state.streaming.lock().unwrap_or_else(|e| e.into_inner()).insert(id.clone(), proc);
    Ok(id)
}

#[tauri::command]
fn poll_streaming_command(state: tauri::State<AppState>, id: String) -> Result<StreamingPollResult, String> {
    let map = state.streaming.lock().unwrap_or_else(|e| e.into_inner());
    let proc = map.get(&id).ok_or("No such streaming command")?;

    let stdout_buf = proc.stdout_buf.lock().unwrap_or_else(|e| e.into_inner());
    let stderr_buf = proc.stderr_buf.lock().unwrap_or_else(|e| e.into_inner());
    let mut cursor = proc.read_cursor.lock().unwrap_or_else(|e| e.into_inner());
    let mut stderr_cur = proc.stderr_cursor.lock().unwrap_or_else(|e| e.into_inner());
    let done = *proc.done.lock().unwrap_or_else(|e| e.into_inner());
    let exit_code = *proc.exit_code.lock().unwrap_or_else(|e| e.into_inner());

    let new_output = if *cursor < stdout_buf.len() {
        let chunk = stdout_buf[*cursor..].to_string();
        *cursor = stdout_buf.len();
        chunk
    } else {
        String::new()
    };

    let new_stderr = if *stderr_cur < stderr_buf.len() {
        let chunk = stderr_buf[*stderr_cur..].to_string();
        *stderr_cur = stderr_buf.len();
        chunk
    } else {
        String::new()
    };

    Ok(StreamingPollResult { new_output, new_stderr, done, exit_code })
}

#[tauri::command]
fn kill_streaming_command(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    let map = state.streaming.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(proc) = map.get(&id) {
        let pid = proc.pid;
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
            let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
        }
        *proc.done.lock().unwrap_or_else(|e| e.into_inner()) = true;
        *proc.exit_code.lock().unwrap_or_else(|e| e.into_inner()) = Some(-1);
    }
    Ok(())
}

#[tauri::command]
fn cleanup_streaming_command(state: tauri::State<AppState>, id: String) {
    let mut map = state.streaming.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(proc) = map.get(&id) {
        let done = *proc.done.lock().unwrap_or_else(|e| e.into_inner());
        if !done {
            let pid = proc.pid;
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
                let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
            }
        }
    }
    map.remove(&id);
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
fn read_file_base64(path: String) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let resolved = resolve_path(&path);
    let bytes = fs::read(&resolved)
        .map_err(|e| format!("Failed to read file '{}': {}", resolved, e))?;
    let ext = Path::new(&resolved)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    };
    let b64 = STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
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
        nvidia_stt_running: check_port_in_use(8090),
        nvidia_tts_running: check_port_in_use(8091),
    }
}

#[tauri::command]
fn start_nvidia_speech_servers(state: tauri::State<AppState>) -> Result<String, String> {
    let scripts_dir = state.scripts_dir.lock().unwrap_or_else(|e| e.into_inner());
    let scripts_path = scripts_dir.as_ref().ok_or("Scripts directory not set")?;

    let python_cmd = find_python().unwrap_or_else(|| "python".to_string());
    let mut servers = state.servers.lock().unwrap_or_else(|e| e.into_inner());
    let mut started = Vec::new();

    if !check_port_in_use(8090) {
        let stt_script = Path::new(scripts_path).join("nvidia_stt_worker.py");
        if stt_script.exists() {
            let script_str = stt_script.to_string_lossy().to_string();
            match spawn_hidden(&python_cmd, &[&script_str]) {
                Ok(child) => {
                    servers.nvidia_stt = Some(child);
                    started.push("NVIDIA STT (Nemotron)");
                }
                Err(e) => eprintln!("Failed to start NVIDIA STT: {}", e),
            }
        }
    } else {
        started.push("NVIDIA STT (already running)");
    }

    if !check_port_in_use(8091) {
        let tts_script = Path::new(scripts_path).join("nvidia_tts_worker.py");
        if tts_script.exists() {
            let script_str = tts_script.to_string_lossy().to_string();
            match spawn_hidden(&python_cmd, &[&script_str]) {
                Ok(child) => {
                    servers.nvidia_tts = Some(child);
                    started.push("NVIDIA TTS (Magpie)");
                }
                Err(e) => eprintln!("Failed to start NVIDIA TTS: {}", e),
            }
        }
    } else {
        started.push("NVIDIA TTS (already running)");
    }

    if started.is_empty() {
        Ok("No NVIDIA speech servers needed to start".to_string())
    } else {
        Ok(format!("Started: {}", started.join(", ")))
    }
}

#[tauri::command]
fn stop_nvidia_speech_servers(state: tauri::State<AppState>) -> Result<String, String> {
    let mut servers = state.servers.lock().unwrap_or_else(|e| e.into_inner());
    let mut stopped = Vec::new();

    if let Some(mut child) = servers.nvidia_stt.take() {
        kill_process_tree(&mut child);
        stopped.push("NVIDIA STT");
    }

    if let Some(mut child) = servers.nvidia_tts.take() {
        kill_process_tree(&mut child);
        stopped.push("NVIDIA TTS");
    }

    if stopped.is_empty() {
        Ok("No NVIDIA speech servers were running".to_string())
    } else {
        Ok(format!("Stopped: {}", stopped.join(", ")))
    }
}

fn find_openclaw_bin() -> String {
    let appdata = std::env::var("APPDATA").unwrap_or_default();
    let cmd_path = format!(r"{}\npm\openclaw.cmd", appdata);
    if Path::new(&cmd_path).exists() {
        return cmd_path;
    }
    "openclaw".to_string()
}

#[tauri::command]
fn start_openclaw_daemon(state: tauri::State<AppState>) -> Result<String, String> {
    if check_port_in_use(18789) {
        return Ok("OpenClaw daemon already running".to_string());
    }

    // Sanitize config before attempting start
    sanitize_openclaw_config();

    let openclaw_bin = find_openclaw_bin();
    let mut servers = state.servers.lock().unwrap_or_else(|e| e.into_inner());

    // First attempt
    match spawn_hidden(&openclaw_bin, &["gateway", "--port", "18789"]) {
        Ok(child) => {
            std::thread::sleep(std::time::Duration::from_secs(2));
            if check_port_in_use(18789) {
                servers.openclaw = Some(child);
                return Ok("OpenClaw daemon started".to_string());
            }
            // Didn't bind — try doctor --fix
        }
        Err(_) => {}
    }

    // Attempt auto-repair
    let _ = Command::new(&openclaw_bin)
        .args(["doctor", "--fix"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .output();

    // Retry after repair
    match spawn_hidden(&openclaw_bin, &["gateway", "--port", "18789"]) {
        Ok(child) => {
            std::thread::sleep(std::time::Duration::from_secs(2));
            if check_port_in_use(18789) {
                servers.openclaw = Some(child);
                Ok("OpenClaw daemon started (after auto-repair)".to_string())
            } else {
                Err("Gateway started but not listening — check openclaw config".to_string())
            }
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

/// Sanitize the OpenClaw config so a minor schema drift doesn't crash the gateway.
/// Strips BOM, ensures every provider has `baseUrl` + `models`, removes unknown
/// keys that newer/older versions of OpenClaw reject (e.g. `enabled` on providers).
fn sanitize_openclaw_config() {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    let config_path = format!("{}/.openclaw/openclaw.json", home);
    let path = Path::new(&config_path);
    if !path.exists() {
        return;
    }

    let raw = match fs::read_to_string(path) {
        Ok(r) => r,
        Err(_) => return,
    };

    // Strip UTF-8 BOM if present
    let json_str = raw.strip_prefix('\u{FEFF}').unwrap_or(&raw);

    let mut doc: serde_json::Value = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("OpenClaw config is not valid JSON ({}), skipping sanitize", e);
            return;
        }
    };

    let mut changed = false;

    // Provider defaults for missing baseUrl
    let provider_defaults: HashMap<&str, &str> = [
        ("ollama", "http://127.0.0.1:11434"),
        ("anthropic", "https://api.anthropic.com"),
        ("xai", "https://api.x.ai/v1"),
        ("openai", "https://api.openai.com/v1"),
        ("openai-codex", "https://api.openai.com/v1"),
        ("google", "https://generativelanguage.googleapis.com/v1beta"),
        ("deepseek", "https://api.deepseek.com"),
    ]
    .into_iter()
    .collect();

    if let Some(providers) = doc
        .pointer_mut("/models/providers")
        .and_then(|v| v.as_object_mut())
    {
        let keys: Vec<String> = providers.keys().cloned().collect();
        for key in keys {
            if let Some(prov) = providers.get_mut(&key).and_then(|v| v.as_object_mut()) {
                // Remove unsupported 'enabled' flag from provider objects
                if prov.remove("enabled").is_some() {
                    changed = true;
                }
                // Ensure required `baseUrl`
                if !prov.contains_key("baseUrl") {
                    let default_url = provider_defaults
                        .get(key.as_str())
                        .unwrap_or(&"https://localhost");
                    prov.insert(
                        "baseUrl".to_string(),
                        serde_json::Value::String(default_url.to_string()),
                    );
                    changed = true;
                }
                // Ensure required `models` array
                if !prov.contains_key("models") {
                    prov.insert(
                        "models".to_string(),
                        serde_json::Value::Array(vec![]),
                    );
                    changed = true;
                }
            }
        }
    }

    if changed {
        // Backup before writing
        let backup_path = format!("{}.bak", config_path);
        let _ = fs::copy(path, &backup_path);

        match serde_json::to_string_pretty(&doc) {
            Ok(out) => {
                if fs::write(path, out.as_bytes()).is_ok() {
                    println!("OpenClaw config sanitized (fixed provider schema issues)");
                }
            }
            Err(e) => eprintln!("Failed to serialize sanitized config: {}", e),
        }
    }
}

/// Try to start the gateway, retrying once after running `openclaw doctor --fix`
/// if the first attempt fails (config validation error).
fn start_gateway_resilient<R: Runtime>(app: &AppHandle<R>) {
    if check_port_in_use(18789) {
        println!("OpenClaw gateway already running on port 18789 — reusing existing instance");
        return;
    }

    // Pre-flight: sanitize config before first attempt
    sanitize_openclaw_config();

    let openclaw_bin = find_openclaw_bin();

    // First attempt
    println!("Starting OpenClaw daemon...");
    match spawn_hidden(&openclaw_bin, &["gateway", "--port", "18789"]) {
        Ok(child) => {
            // Give the gateway a moment to either start or crash
            std::thread::sleep(std::time::Duration::from_secs(2));
            if check_port_in_use(18789) {
                if let Some(state) = app.try_state::<AppState>() {
                    let mut servers = state.servers.lock().unwrap_or_else(|e| e.into_inner());
                    servers.openclaw = Some(child);
                }
                println!("OpenClaw gateway started on port 18789");
                return;
            }
            // Gateway process exited — config is probably still invalid
            eprintln!("OpenClaw gateway spawned but not listening — attempting doctor --fix");
        }
        Err(e) => {
            eprintln!("OpenClaw gateway spawn failed: {} — attempting doctor --fix", e);
        }
    }

    // Retry: run `openclaw doctor --fix` then try again
    let doctor_result = Command::new(&openclaw_bin)
        .args(["doctor", "--fix"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .output();

    match doctor_result {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            println!("openclaw doctor --fix: {}{}", stdout, stderr);
        }
        Err(e) => {
            eprintln!("Failed to run openclaw doctor: {}", e);
        }
    }

    // Second attempt after doctor
    match spawn_hidden(&openclaw_bin, &["gateway", "--port", "18789"]) {
        Ok(child) => {
            std::thread::sleep(std::time::Duration::from_secs(2));
            if check_port_in_use(18789) {
                if let Some(state) = app.try_state::<AppState>() {
                    let mut servers = state.servers.lock().unwrap_or_else(|e| e.into_inner());
                    servers.openclaw = Some(child);
                }
                println!("OpenClaw gateway started on port 18789 (after doctor --fix)");
            } else {
                eprintln!("OpenClaw gateway still not listening after doctor --fix — running without gateway");
            }
        }
        Err(e) => eprintln!("OpenClaw daemon not available: {} (agent will use direct LLM)", e),
    }
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
    
    start_gateway_resilient(app);

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
                        for port in [8080u16, 8081, 8090, 8091] {
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

                    // Start NVIDIA speech workers (primary)
                    let nvidia_stt_script = scripts_path.join("nvidia_stt_worker.py");
                    let nvidia_tts_script = scripts_path.join("nvidia_tts_worker.py");

                    if nvidia_stt_script.exists() {
                        println!("Starting NVIDIA STT worker (Nemotron/Parakeet)...");
                        let script_str = nvidia_stt_script.to_string_lossy().to_string();
                        match spawn_hidden(python, &[&script_str]) {
                            Ok(child) => {
                                servers.nvidia_stt = Some(child);
                                println!("NVIDIA STT worker started on port 8090");
                            }
                            Err(e) => eprintln!("Failed to start NVIDIA STT: {}", e),
                        }
                    }

                    if nvidia_tts_script.exists() {
                        println!("Starting NVIDIA TTS worker (Magpie)...");
                        let script_str = nvidia_tts_script.to_string_lossy().to_string();
                        match spawn_hidden(python, &[&script_str]) {
                            Ok(child) => {
                                servers.nvidia_tts = Some(child);
                                println!("NVIDIA TTS worker started on port 8091");
                            }
                            Err(e) => eprintln!("Failed to start NVIDIA TTS: {}", e),
                        }
                    }

                    // Start fallback Whisper/Kokoro servers
                    if whisper_script.exists() {
                        println!("Starting Whisper STT server (fallback)...");
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
                        println!("Starting TTS server (fallback)...");
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

        if let Some(mut child) = servers.nvidia_stt.take() {
            println!("Stopping NVIDIA STT worker...");
            kill_process_tree(&mut child);
        }

        if let Some(mut child) = servers.nvidia_tts.take() {
            println!("Stopping NVIDIA TTS worker...");
            kill_process_tree(&mut child);
        }
        
        if let Some(mut child) = servers.openclaw.take() {
            println!("Stopping OpenClaw daemon...");
            kill_process_tree(&mut child);
        }

        // Kill any streaming commands still running
        let mut streaming = state.streaming.lock().unwrap_or_else(|e| e.into_inner());
        for (id, proc) in streaming.iter() {
            println!("Killing streaming process {}...", id);
            let pid = proc.pid;
            #[cfg(target_os = "windows")]
            {
                let mut cmd = Command::new("taskkill");
                cmd.args(["/F", "/T", "/PID", &pid.to_string()])
                    .stdout(Stdio::null()).stderr(Stdio::null()).stdin(Stdio::null())
                    .creation_flags(CREATE_NO_WINDOW);
                let _ = cmd.output();
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
            }
        }
        streaming.clear();
    }

    // Kill any orphaned processes on Crystal-managed ports
    #[cfg(target_os = "windows")]
    {
        let ports = [8080u16, 8081, 8090, 8091];
        for port in ports {
            if check_port_in_use(port) {
                println!("Killing orphan on port {}...", port);
                let kill_cmd = format!(
                    "Get-NetTCPConnection -LocalPort {} -ErrorAction SilentlyContinue | ForEach-Object {{ Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }}",
                    port
                );
                let mut cmd = Command::new("powershell");
                cmd.args(["-NoProfile", "-NonInteractive", "-Command", &kill_cmd])
                    .stdout(Stdio::null()).stderr(Stdio::null()).stdin(Stdio::null())
                    .creation_flags(CREATE_NO_WINDOW);
                let _ = cmd.output();
            }
        }
    }
    println!("All Crystal services stopped.");
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
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                println!("Window close requested – shutting down all services...");
                cleanup_servers(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            execute_command,
            start_streaming_command,
            poll_streaming_command,
            kill_streaming_command,
            cleanup_streaming_command,
            get_gpu_stats,
            get_sys_stats,
            read_file,
            read_file_base64,
            write_file,
            list_directory,
            get_server_status,
            start_voice_servers,
            stop_voice_servers,
            start_nvidia_speech_servers,
            stop_nvidia_speech_servers,
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
