use std::process::{Command, Child, Stdio};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, Runtime, AppHandle,
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
    vllm_running: bool,
    openclaw_running: bool,
    nvidia_stt_running: bool,
    nvidia_tts_running: bool,
    voice_gateway_running: bool,
}

struct ServerProcesses {
    openclaw: Option<Child>,
    nvidia_stt: Option<Child>,
    nvidia_tts: Option<Child>,
    voice_gateway: Option<Child>,
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

static LOCAL_HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
static REMOTE_HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn get_chat_client(is_local: bool) -> reqwest::Client {
    if is_local {
        LOCAL_HTTP_CLIENT.get_or_init(|| {
            reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(3))
                .timeout(std::time::Duration::from_secs(120))
                .pool_max_idle_per_host(2)
                .tcp_keepalive(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new())
        }).clone()
    } else {
        REMOTE_HTTP_CLIENT.get_or_init(|| {
            reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(15))
                .timeout(std::time::Duration::from_secs(120))
                .pool_max_idle_per_host(2)
                .build()
                .unwrap_or_else(|_| reqwest::Client::new())
        }).clone()
    }
}

struct AppState {
    servers: Mutex<ServerProcesses>,
    scripts_dir: Mutex<Option<String>>,
    streaming: Mutex<HashMap<String, Arc<StreamingProcess>>>,
    openclaw_cli_lock: Arc<Mutex<()>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            servers: Mutex::new(ServerProcesses {
                openclaw: None,
                nvidia_stt: None,
                nvidia_tts: None,
                voice_gateway: None,
                http_client: reqwest::Client::new(),
            }),
            scripts_dir: Mutex::new(None),
            streaming: Mutex::new(HashMap::new()),
            openclaw_cli_lock: Arc::new(Mutex::new(())),
        }
    }
}

fn run_shell_command(command: &str, working_dir: &str) -> Result<CommandResult, String> {
    #[cfg(target_os = "windows")]
    let output = {
        let mut cmd = Command::new("powershell");
        cmd.args(["-NoProfile", "-NonInteractive", "-Command", command])
            .current_dir(working_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null());

        let sys_path = std::env::var("PATH").unwrap_or_default();
        let extra_dirs = [r"C:\Program Files\nodejs", r"C:\Program Files\Git\cmd"];
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
        if !user_appdata.is_empty()
            && Path::new(&user_appdata).exists()
            && !sys_path.contains(&user_appdata)
        {
            full_path.push_str(&user_appdata);
            full_path.push(';');
        }
        full_path.push_str(&sys_path);
        cmd.env("PATH", &full_path);
        cmd.creation_flags(CREATE_NO_WINDOW).output()
    };

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("sh")
        .args(["-c", command])
        .current_dir(working_dir)
        .output();

    fn strip_provider_noise(text: &str) -> String {
        text.lines()
            .filter(|line| {
                let lower = line.to_lowercase();
                !lower.contains("could not be reached at http://127.0.0.1:11434")
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    match output {
        Ok(out) => Ok(CommandResult {
            stdout: strip_provider_noise(&String::from_utf8_lossy(&out.stdout)),
            stderr: strip_provider_noise(&String::from_utf8_lossy(&out.stderr)),
            code: out.status.code().unwrap_or(-1),
        }),
        Err(e) => Err(format!("Failed to execute command: {}", e)),
    }
}

fn looks_like_gateway_timeout(result: &CommandResult) -> bool {
    let combined = format!("{}\n{}", result.stdout, result.stderr).to_lowercase();
    combined.contains("gateway timeout")
        || combined.contains("gateway not reachable")
        || combined.contains("gateway closed")
        || combined.contains("rpc probe: failed")
}

fn openclaw_retry_safe(command: &str) -> bool {
    let c = command.to_lowercase();
    if !c.trim_start().starts_with("openclaw") {
        return false;
    }
    // Retry only read-only/status commands to avoid duplicate side effects.
    c.contains(" list")
        || c.contains(" status")
        || c.contains(" health")
        || c.contains(" config get")
        || c.contains(" --json")
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
async fn execute_command(
    state: tauri::State<'_, AppState>,
    command: String,
    cwd: Option<String>,
) -> Result<CommandResult, String> {
    let working_dir =
        cwd.unwrap_or_else(|| std::env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string()));
    let is_openclaw = command.trim_start().to_lowercase().starts_with("openclaw");
    if is_openclaw {
        let command_clone = command.clone();
        let working_dir_clone = working_dir.clone();
        let lock = state.openclaw_cli_lock.clone();
        return tokio::task::spawn_blocking(move || {
            let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
            let first = run_shell_command(&command_clone, &working_dir_clone)?;
            if openclaw_retry_safe(&command_clone) && looks_like_gateway_timeout(&first) {
                let _ = run_shell_command("openclaw gateway restart", &working_dir_clone);
                std::thread::sleep(std::time::Duration::from_secs(2));
                return run_shell_command(&command_clone, &working_dir_clone);
            }
            Ok(first)
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))?;
    }
    tokio::task::spawn_blocking(move || run_shell_command(&command, &working_dir))
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

    // Canonicalize and verify the path stays under USERPROFILE.
    // On Windows, canonicalize() prepends \\?\ — strip it before comparing.
    if let Ok(canonical) = std::fs::canonicalize(&resolved) {
        let canon_str = canonical.to_string_lossy().to_string();
        let clean = canon_str.strip_prefix(r"\\?\").unwrap_or(&canon_str);
        let home_lower = home.to_lowercase();
        if !clean.to_lowercase().starts_with(&home_lower) {
            eprintln!("resolve_path: '{}' escapes home directory, blocking", path);
            return format!("{}\\__blocked_path__", home);
        }
        return clean.to_string();
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

/// Direct OpenAI-compatible chat streaming – bypasses the OpenClaw CLI entirely.
/// Connects to vLLM (local) or OpenAI (hosted) and streams SSE chunks back
/// through the existing StreamingProcess mechanism so the frontend can poll.
#[tauri::command]
fn start_direct_chat(
    state: tauri::State<AppState>,
    messages: Vec<serde_json::Value>,
    base_url: String,
    api_key: String,
    model: String,
    max_tokens: Option<u32>,
) -> Result<String, String> {
    if let Ok(parsed) = base_url.parse::<reqwest::Url>() {
        match parsed.host_str() {
            Some("localhost") | Some("127.0.0.1") | Some("0.0.0.0")
            | Some("api.openai.com") | Some("api.anthropic.com")
            | Some("api.x.ai") | Some("generativelanguage.googleapis.com")
            | Some("api.deepseek.com") => {}
            _ => return Err(format!("start_direct_chat: host '{}' not in allowlist", parsed.host_str().unwrap_or("unknown"))),
        }
    } else {
        return Err("start_direct_chat: invalid base_url".to_string());
    }

    let id = format!("stream-{}", STREAM_ID_COUNTER.fetch_add(1, Ordering::Relaxed));
    let proc = Arc::new(StreamingProcess {
        stdout_buf: Mutex::new(String::new()),
        stderr_buf: Mutex::new(String::new()),
        read_cursor: Mutex::new(0),
        stderr_cursor: Mutex::new(0),
        done: Mutex::new(false),
        exit_code: Mutex::new(None),
        pid: 0,
        stdout_trimmed: Mutex::new(0),
        stderr_trimmed: Mutex::new(0),
    });

    let proc_clone = Arc::clone(&proc);
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let max_tok = max_tokens.unwrap_or(4096);

    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async move {
            let is_local = api_key == "vllm-local" || api_key == "ollama";
            let client = get_chat_client(is_local);
            let mut body = serde_json::json!({
                "model": model,
                "messages": messages,
                "stream": true,
            });
            if is_local {
                body["max_tokens"] = serde_json::json!(max_tok);
                body["chat_template_kwargs"] = serde_json::json!({"enable_thinking": false});
            } else {
                body["max_completion_tokens"] = serde_json::json!(max_tok);
            }

            let resp = client
                .post(&url)
                .header("Content-Type", "application/json")
                .header("Authorization", format!("Bearer {}", api_key))
                .json(&body)
                .send()
                .await;

            match resp {
                Ok(r) if r.status().is_success() => {
                    use futures_util::StreamExt;
                    let mut stream = r.bytes_stream();
                    let mut buf = String::new();
                    while let Some(chunk) = stream.next().await {
                        match chunk {
                            Ok(bytes) => {
                                buf.push_str(&String::from_utf8_lossy(&bytes));
                                while let Some(pos) = buf.find('\n') {
                                    let line = buf[..pos].to_string();
                                    buf = buf[pos + 1..].to_string();
                                    if let Some(data) = line.strip_prefix("data: ") {
                                        if data.trim() == "[DONE]" { continue; }
                                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                                            let delta = parsed
                                                .get("choices")
                                                .and_then(|c| c.get(0))
                                                .and_then(|c| c.get("delta"));
                                            if let Some(d) = delta {
                                                let content = d.get("content").and_then(|c| c.as_str()).unwrap_or("");
                                                let reasoning = d.get("reasoning_content").and_then(|c| c.as_str()).unwrap_or("");
                                                if !content.is_empty() || !reasoning.is_empty() {
                                                    let mut out = proc_clone.stdout_buf.lock().unwrap_or_else(|e| e.into_inner());
                                                    out.push_str(content);
                                                    out.push_str(reasoning);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                let mut err = proc_clone.stderr_buf.lock().unwrap_or_else(|e| e.into_inner());
                                err.push_str(&format!("Stream error: {}\n", e));
                                break;
                            }
                        }
                    }
                }
                Ok(r) => {
                    let status = r.status();
                    let body = r.text().await.unwrap_or_default();
                    let mut err = proc_clone.stderr_buf.lock().unwrap_or_else(|e| e.into_inner());
                    err.push_str(&format!("API error {}: {}\n", status, body));
                }
                Err(e) => {
                    let mut err = proc_clone.stderr_buf.lock().unwrap_or_else(|e| e.into_inner());
                    err.push_str(&format!("Connection failed: {}\n", e));
                }
            }

            *proc_clone.exit_code.lock().unwrap_or_else(|e| e.into_inner()) = Some(0);
            *proc_clone.done.lock().unwrap_or_else(|e| e.into_inner()) = true;
        });
    });

    state.streaming.lock().unwrap_or_else(|e| e.into_inner()).insert(id.clone(), proc);
    Ok(id)
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

/// Locate the bundled `scripts/` directory containing helpers like
/// `mempalace_query.py`. Tries (in order): cwd, Tauri resource dir, and
/// directories above the running exe (dev mode).
fn find_scripts_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    if let Ok(cwd) = std::env::current_dir() {
        let scripts = cwd.join("scripts");
        if scripts.is_dir() && scripts.join("mempalace_query.py").exists() {
            return Some(scripts);
        }
    }
    if let Ok(resource_path) = app.path().resource_dir() {
        let bundled = resource_path.join("scripts");
        if bundled.is_dir() && bundled.join("mempalace_query.py").exists() {
            return Some(bundled);
        }
    }
    if let Ok(exe_path) = std::env::current_exe() {
        let mut current = exe_path;
        for _ in 0..6 {
            if let Some(parent) = current.parent() {
                current = parent.to_path_buf();
                let scripts = current.join("scripts");
                if scripts.is_dir() && scripts.join("mempalace_query.py").exists() {
                    return Some(scripts);
                }
            } else {
                break;
            }
        }
    }
    None
}

/// Run a bundled Python script with the given args. Spawns Python directly
/// (no shell) so the caller never has to worry about quoting / escaping —
/// each arg is passed as a single argv entry. Returns stdout/stderr/code.
#[tauri::command]
async fn run_python_script<R: Runtime>(
    app: AppHandle<R>,
    script: String,
    args: Vec<String>,
) -> Result<CommandResult, String> {
    let scripts_dir = find_scripts_dir(&app)
        .ok_or_else(|| "scripts/ directory not found (looked in cwd, resource dir, and exe parents)".to_string())?;
    let script_path = scripts_dir.join(&script);
    if !script_path.exists() {
        return Err(format!("script not found: {}", script_path.display()));
    }
    let python = find_python().ok_or_else(|| "python interpreter not found on PATH".to_string())?;

    tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&python);
        cmd.arg(&script_path);
        for a in &args {
            cmd.arg(a);
        }
        cmd.env("PYTHONIOENCODING", "utf-8");
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let output = cmd.output()
            .map_err(|e| format!("failed to spawn python: {}", e))?;
        Ok(CommandResult {
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            code: output.status.code().unwrap_or(-1),
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
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
        vllm_running: check_port_in_use(8000),
        openclaw_running: check_port_in_use(18789),
        nvidia_stt_running: check_port_in_use(8090),
        nvidia_tts_running: check_port_in_use(8091),
        voice_gateway_running: check_port_in_use(6500),
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

    if !check_port_in_use(6500) {
        let gw_script = Path::new(scripts_path).join("voice_gateway.py");
        if gw_script.exists() {
            let script_str = gw_script.to_string_lossy().to_string();
            match spawn_hidden(&python_cmd, &[&script_str]) {
                Ok(child) => {
                    servers.voice_gateway = Some(child);
                    started.push("Voice Gateway");
                }
                Err(e) => eprintln!("Failed to start Voice Gateway: {}", e),
            }
        }
    } else {
        started.push("Voice Gateway (already running)");
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

    if let Some(mut child) = servers.voice_gateway.take() {
        kill_process_tree(&mut child);
        stopped.push("Voice Gateway");
    }

    if stopped.is_empty() {
        Ok("No NVIDIA speech servers were running".to_string())
    } else {
        Ok(format!("Stopped: {}", stopped.join(", ")))
    }
}

fn find_compose_file() -> Option<String> {
    // Try cwd first (dev mode)
    if let Ok(cwd) = std::env::current_dir() {
        let compose = cwd.join("docker-compose.yml");
        if compose.exists() {
            return Some(compose.to_string_lossy().to_string());
        }
    }
    // Walk up from the executable
    if let Ok(exe) = std::env::current_exe() {
        let mut current = exe;
        for _ in 0..5 {
            if let Some(parent) = current.parent() {
                current = parent.to_path_buf();
                let compose = current.join("docker-compose.yml");
                if compose.exists() {
                    return Some(compose.to_string_lossy().to_string());
                }
            }
        }
    }
    None
}

#[tauri::command]
async fn start_vllm_docker() -> Result<String, String> {
    if check_port_in_use(8000) {
        return Ok("vLLM already running on port 8000".to_string());
    }

    let compose_file = find_compose_file()
        .ok_or("docker-compose.yml not found")?;

    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        let output = {
            let mut cmd = Command::new("cmd");
            cmd.args(["/C", "docker", "compose", "-f", &compose_file, "up", "-d", "vllm"])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .stdin(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW);
            cmd.output()
        };
        #[cfg(not(target_os = "windows"))]
        let output = Command::new("docker")
            .args(["compose", "-f", &compose_file, "up", "-d", "vllm"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null())
            .output();

        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                if out.status.success() {
                    Ok(format!("vLLM container started. Model loading may take a few minutes.\n{}{}", stdout, stderr))
                } else {
                    Err(format!("docker compose failed (exit {}): {}{}", out.status.code().unwrap_or(-1), stdout, stderr))
                }
            }
            Err(e) => Err(format!("Failed to run docker compose: {}", e)),
        }
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
async fn stop_vllm_docker() -> Result<String, String> {
    let compose_file = find_compose_file()
        .ok_or("docker-compose.yml not found")?;

    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        let output = {
            let mut cmd = Command::new("cmd");
            cmd.args(["/C", "docker", "compose", "-f", &compose_file, "down"])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .stdin(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW);
            cmd.output()
        };
        #[cfg(not(target_os = "windows"))]
        let output = Command::new("docker")
            .args(["compose", "-f", &compose_file, "down"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null())
            .output();

        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                if out.status.success() {
                    Ok(format!("vLLM container stopped.\n{}{}", stdout, stderr))
                } else {
                    Err(format!("docker compose down failed: {}{}", stdout, stderr))
                }
            }
            Err(e) => Err(format!("Failed to run docker compose: {}", e)),
        }
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
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
async fn start_openclaw_daemon(_state: tauri::State<'_, AppState>) -> Result<String, String> {
    if check_port_in_use(18789) && gateway_http_healthy() {
        return Ok("OpenClaw daemon already running".to_string());
    }

    sanitize_openclaw_config();

    tokio::task::spawn_blocking(|| {
        let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\jarro".to_string());
        let gateway_cmd_path = std::path::PathBuf::from(&home).join(".openclaw").join("gateway.cmd");

        #[cfg(target_os = "windows")]
        let spawn_result = if gateway_cmd_path.exists() {
            let mut cmd = Command::new("cmd");
            cmd.args(["/c", gateway_cmd_path.to_str().unwrap_or("gateway.cmd")])
                .stdout(Stdio::null()).stderr(Stdio::null()).stdin(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW);
            cmd.spawn()
        } else {
            let openclaw_bin = find_openclaw_bin();
            let mut cmd = Command::new(&openclaw_bin);
            cmd.args(["gateway", "start"])
                .stdout(Stdio::null()).stderr(Stdio::null()).stdin(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW);
            cmd.spawn()
        };
        #[cfg(not(target_os = "windows"))]
        let spawn_result = {
            let openclaw_bin = find_openclaw_bin();
            Command::new(&openclaw_bin)
                .args(["gateway", "start"])
                .stdout(Stdio::null()).stderr(Stdio::null()).stdin(Stdio::null())
                .spawn()
        };

        match spawn_result {
            Ok(_) => {
                for _ in 0..25 {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    if check_port_in_use(18789) && gateway_http_healthy() {
                        return Ok("OpenClaw daemon started".to_string());
                    }
                }
                Err("Gateway started but not healthy within 75s — check openclaw config".to_string())
            }
            Err(e) => Err(format!("Failed to start gateway: {}", e)),
        }
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
fn start_voice_servers(state: tauri::State<AppState>) -> Result<String, String> {
    start_nvidia_speech_servers(state)
}

#[tauri::command]
fn stop_voice_servers(state: tauri::State<AppState>) -> Result<String, String> {
    stop_nvidia_speech_servers(state)
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
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.emit("crystal:shutting-down", ());
                }
                std::thread::sleep(std::time::Duration::from_millis(300));
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
        ("vllm", "http://127.0.0.1:8000/v1"),
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

/// Check if the gateway is accepting HTTP connections (more reliable than RPC probe).
fn gateway_http_healthy() -> bool {
    use std::io::{Read as IoRead, Write as IoWrite};
    use std::net::TcpStream;
    if let Ok(mut stream) = TcpStream::connect_timeout(
        &"127.0.0.1:18789".parse().unwrap(),
        std::time::Duration::from_secs(2),
    ) {
        let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(3)));
        let _ = stream.write_all(b"GET / HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n");
        let mut buf = [0u8; 64];
        if let Ok(n) = stream.read(&mut buf) {
            let resp = String::from_utf8_lossy(&buf[..n]);
            return resp.contains("HTTP/");
        }
    }
    false
}

/// Start the OpenClaw gateway, preferring gateway.cmd (which wraps with
/// `op run` to inject 1Password secrets) over bare `openclaw gateway start`.
///
/// This runs entirely in a background thread to avoid blocking app startup.
fn start_gateway_resilient<R: Runtime>(_app: &AppHandle<R>) {
    sanitize_openclaw_config();

    if check_port_in_use(18789) && gateway_http_healthy() {
        println!("OpenClaw gateway already healthy on port 18789 — reusing instance");
        return;
    }

    println!("Starting OpenClaw gateway in background...");
    std::thread::spawn(|| {
        let openclaw_bin = find_openclaw_bin();

        // If the port is held by a dead/stuck process, stop it first.
        if check_port_in_use(18789) {
            println!("OpenClaw port 18789 occupied but unhealthy — stopping stale gateway...");
            #[cfg(target_os = "windows")]
            {
                let mut cmd = Command::new(&openclaw_bin);
                cmd.args(["gateway", "stop"])
                    .stdout(Stdio::null()).stderr(Stdio::null()).stdin(Stdio::null())
                    .creation_flags(CREATE_NO_WINDOW);
                let _ = cmd.output();
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = Command::new(&openclaw_bin)
                    .args(["gateway", "stop"])
                    .stdout(Stdio::null()).stderr(Stdio::null()).stdin(Stdio::null())
                    .output();
            }
            for _ in 0..10 {
                if !check_port_in_use(18789) { break; }
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
            if check_port_in_use(18789) {
                #[cfg(target_os = "windows")]
                {
                    let kill_cmd = "Get-NetTCPConnection -LocalPort 18789 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }";
                    let mut cmd = Command::new("powershell");
                    cmd.args(["-NoProfile", "-NonInteractive", "-Command", kill_cmd])
                        .stdout(Stdio::null()).stderr(Stdio::null()).stdin(Stdio::null())
                        .creation_flags(CREATE_NO_WINDOW);
                    let _ = cmd.output();
                }
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
        }

        // Prefer gateway.cmd which injects 1Password secrets via `op run`.
        // Fall back to bare `openclaw gateway start` if gateway.cmd is missing.
        let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\jarro".to_string());
        let gateway_cmd_path = std::path::PathBuf::from(&home).join(".openclaw").join("gateway.cmd");
        let use_gateway_cmd = gateway_cmd_path.exists();

        println!(
            "Triggering OpenClaw gateway via {}...",
            if use_gateway_cmd { "gateway.cmd (1Password secrets)" } else { "openclaw CLI" }
        );

        #[cfg(target_os = "windows")]
        let spawn_result = if use_gateway_cmd {
            let mut cmd = Command::new("cmd");
            cmd.args(["/c", gateway_cmd_path.to_str().unwrap_or("gateway.cmd")])
                .stdout(Stdio::null()).stderr(Stdio::null()).stdin(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW);
            cmd.spawn()
        } else {
            let mut cmd = Command::new(&openclaw_bin);
            cmd.args(["gateway", "start"])
                .stdout(Stdio::null()).stderr(Stdio::null()).stdin(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW);
            cmd.spawn()
        };
        #[cfg(not(target_os = "windows"))]
        let spawn_result = Command::new(&openclaw_bin)
            .args(["gateway", "start"])
            .stdout(Stdio::null()).stderr(Stdio::null()).stdin(Stdio::null())
            .spawn();

        match spawn_result {
            Ok(_child) => {
                // Don't wait for the CLI to finish — just poll the port.
            }
            Err(e) => {
                eprintln!("Failed to invoke gateway: {}", e);
                return;
            }
        }

        // Poll for readiness. gateway.cmd pipeline:
        //   1. `op run` — 1–60s (first call may prompt Windows Hello / 1Password desktop unlock)
        //   2. `op` resolves every `op://` reference in .env — ~5–15s depending on network
        //   3. Node.js boots openclaw dist — ~15–25s
        // A 75s budget is too tight on cold boots; 180s covers first-unlock scenarios
        // while still failing fast if something is actually broken.
        let max_wait = std::time::Duration::from_secs(180);
        let start = std::time::Instant::now();
        while start.elapsed() < max_wait {
            std::thread::sleep(std::time::Duration::from_secs(3));
            if check_port_in_use(18789) && gateway_http_healthy() {
                println!("OpenClaw gateway is ready on port 18789 ({:.0}s)", start.elapsed().as_secs_f64());
                return;
            }
        }
        eprintln!(
            "OpenClaw gateway did not become healthy within {}s — running without gateway",
            max_wait.as_secs()
        );
    });
}

fn is_docker_running() -> bool {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "docker", "info"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .stdin(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW);
        matches!(cmd.status(), Ok(s) if s.success())
    }
    #[cfg(not(target_os = "windows"))]
    {
        matches!(
            Command::new("docker").arg("info")
                .stdout(Stdio::null()).stderr(Stdio::null()).stdin(Stdio::null())
                .status(),
            Ok(s) if s.success()
        )
    }
}

fn try_start_docker_desktop() {
    #[cfg(target_os = "windows")]
    {
        let paths = [
            r"C:\Program Files\Docker\Docker\Docker Desktop.exe",
            r"C:\Program Files (x86)\Docker\Docker\Docker Desktop.exe",
        ];
        for p in &paths {
            if Path::new(p).exists() {
                println!("Starting Docker Desktop from {}...", p);
                let mut cmd = Command::new(p);
                cmd.stdout(Stdio::null()).stderr(Stdio::null()).stdin(Stdio::null())
                    .creation_flags(CREATE_NO_WINDOW);
                let _ = cmd.spawn();
                return;
            }
        }
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "start", "", "Docker Desktop"])
            .stdout(Stdio::null()).stderr(Stdio::null()).stdin(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW);
        let _ = cmd.spawn();
    }
}

fn ensure_docker_then_vllm(compose_file: &str) {
    if !is_docker_running() {
        println!("Docker not running — attempting to start Docker Desktop...");
        try_start_docker_desktop();

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(90);
        loop {
            if is_docker_running() {
                println!("Docker Desktop is ready.");
                break;
            }
            if std::time::Instant::now() > deadline {
                eprintln!("Docker Desktop did not start within 90s — vLLM will not be available.");
                return;
            }
            std::thread::sleep(std::time::Duration::from_secs(3));
        }
    }

    println!("Starting vLLM Docker container...");
    #[cfg(target_os = "windows")]
    let output = {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "docker", "compose", "-f", compose_file, "up", "-d", "vllm"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW);
        cmd.output()
    };
    #[cfg(not(target_os = "windows"))]
    let output = Command::new("docker")
        .args(["compose", "-f", compose_file, "up", "-d", "vllm"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .output();
    match output {
        Ok(out) if out.status.success() => {
            println!("vLLM Docker container started (model loading ~5min with CUDA graph compilation)");
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            eprintln!("vLLM Docker start failed: {}", stderr);
        }
        Err(e) => eprintln!("Could not launch vLLM Docker container: {}", e),
    }
}

fn setup_and_start_servers<R: Runtime>(app: &AppHandle<R>) {
    // Try multiple paths to find scripts directory
    let scripts_dir = {
        // First, try current working directory (most common in dev)
        std::env::current_dir().ok().and_then(|cwd| {
            let scripts = cwd.join("scripts");
            if scripts.exists() && scripts.join("nvidia_stt_worker.py").exists() {
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
            if bundled.exists() && bundled.join("nvidia_stt_worker.py").exists() {
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
                    if scripts.exists() && scripts.join("nvidia_stt_worker.py").exists() {
                        println!("Found scripts relative to exe: {:?}", scripts);
                        return Some(scripts);
                    }
                }
            }
            None
        })
    });
    
    start_gateway_resilient(app);

    // LLM backend: auto-start vLLM Docker container if not already running
    if check_port_in_use(8000) {
        println!("vLLM detected on port 8000 (OpenAI-compatible API)");
    } else if let Some(compose_file) = find_compose_file() {
        let compose_clone = compose_file.clone();
        std::thread::spawn(move || {
            ensure_docker_then_vllm(&compose_clone);
        });
    } else {
        eprintln!("vLLM not detected on port 8000 and no docker-compose.yml found.");
    }

    if let Some(ref scripts_path) = scripts_dir {
        if scripts_path.exists() {
            println!("Scripts directory: {:?}", scripts_path);
            
            if let Some(state) = app.try_state::<AppState>() {
                let mut dir = state.scripts_dir.lock().unwrap_or_else(|e| e.into_inner());
                *dir = Some(scripts_path.to_string_lossy().to_string());
            }
            
            let python_cmd = find_python();
            
            if let Some(ref python) = python_cmd {
                println!("Using Python: {}", python);
                
                if let Some(state) = app.try_state::<AppState>() {
                    let mut servers = state.servers.lock().unwrap_or_else(|e| e.into_inner());

                    // Kill orphaned voice servers from previous sessions
                    #[cfg(target_os = "windows")]
                    {
                        for port in [8090u16, 8091, 6500] {
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

                    // Start Voice Gateway (unified STT/TTS API on port 6500)
                    let gateway_script = scripts_path.join("voice_gateway.py");
                    if gateway_script.exists() && !check_port_in_use(6500) {
                        println!("Starting Voice Gateway...");
                        let script_str = gateway_script.to_string_lossy().to_string();
                        match spawn_hidden(python, &[&script_str]) {
                            Ok(child) => {
                                servers.voice_gateway = Some(child);
                                println!("Voice Gateway started on port 6500");
                            }
                            Err(e) => eprintln!("Failed to start Voice Gateway: {}", e),
                        }
                    } else if check_port_in_use(6500) {
                        println!("Voice Gateway already running on port 6500");
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
        
        if let Some(mut child) = servers.nvidia_stt.take() {
            println!("Stopping NVIDIA STT worker...");
            kill_process_tree(&mut child);
        }

        if let Some(mut child) = servers.nvidia_tts.take() {
            println!("Stopping NVIDIA TTS worker...");
            kill_process_tree(&mut child);
        }
        
        if let Some(mut child) = servers.voice_gateway.take() {
            println!("Stopping Voice Gateway...");
            kill_process_tree(&mut child);
        }

        // Stop OpenClaw gateway via CLI (managed by service manager, not a child process)
        if check_port_in_use(18789) {
            println!("Stopping OpenClaw gateway via service manager...");
            let openclaw_bin = find_openclaw_bin();
            #[cfg(target_os = "windows")]
            {
                let mut cmd = Command::new(&openclaw_bin);
                cmd.args(["gateway", "stop"])
                    .stdout(Stdio::null()).stderr(Stdio::null()).stdin(Stdio::null())
                    .creation_flags(CREATE_NO_WINDOW);
                let _ = cmd.output();
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = Command::new(&openclaw_bin)
                    .args(["gateway", "stop"])
                    .stdout(Stdio::null()).stderr(Stdio::null()).stdin(Stdio::null())
                    .output();
            }
        }
        // Legacy: if we somehow still hold a child handle, clean it up
        if let Some(mut child) = servers.openclaw.take() {
            println!("Stopping legacy OpenClaw child process...");
            kill_process_tree(&mut child);
        }

        // Fallback: if gateway CLI stop didn't work, force-kill the port holder
        #[cfg(target_os = "windows")]
        if check_port_in_use(18789) {
            println!("Gateway still on 18789 after CLI stop — force-killing port holder...");
            let kill_cmd = "Get-NetTCPConnection -LocalPort 18789 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }";
            let mut cmd = Command::new("powershell");
            cmd.args(["-NoProfile", "-NonInteractive", "-Command", kill_cmd])
                .stdout(Stdio::null()).stderr(Stdio::null()).stdin(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW);
            let _ = cmd.output();
        }

        // Kill any streaming commands still running
        let mut streaming = state.streaming.lock().unwrap_or_else(|e| e.into_inner());
        for (id, proc) in streaming.iter() {
            if proc.pid == 0 { continue; }
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

    // Stop vLLM Docker container (Crystal owns the lifecycle)
    if check_port_in_use(8000) {
        if let Some(compose_file) = find_compose_file() {
            println!("Stopping vLLM Docker container...");
            #[cfg(target_os = "windows")]
            {
                let mut cmd = Command::new("cmd");
                cmd.args(["/C", "docker", "compose", "-f", &compose_file, "stop", "vllm"])
                    .stdout(Stdio::null()).stderr(Stdio::null()).stdin(Stdio::null())
                    .creation_flags(CREATE_NO_WINDOW);
                let _ = cmd.output();
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = Command::new("docker")
                    .args(["compose", "-f", &compose_file, "stop", "vllm"])
                    .stdout(Stdio::null()).stderr(Stdio::null()).stdin(Stdio::null())
                    .output();
            }
            println!("vLLM container stopped.");
        }
    }

    // Kill any orphaned processes on Crystal-managed ports
    #[cfg(target_os = "windows")]
    {
        let ports = [8090u16, 8091, 6500];
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
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Second instance tried to launch — focus the existing window instead
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(AppState::default())
        .setup(|app| {
            create_tray(app.handle())?;

            // Start voice servers automatically
            setup_and_start_servers(app.handle());

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                println!("Window close requested – shutting down all services...");
                api.prevent_close();
                let _ = window.emit("crystal:shutting-down", ());
                std::thread::sleep(std::time::Duration::from_millis(300));
                cleanup_servers(window.app_handle());
                window.app_handle().exit(0);
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
            start_vllm_docker,
            stop_vllm_docker,
            http_proxy,
            get_openclaw_token,
            start_direct_chat,
            run_python_script
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                cleanup_servers(app);
            }
        });
}
