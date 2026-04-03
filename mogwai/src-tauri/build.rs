use std::fs;
use std::path::Path;

fn main() {
    // Standard Tauri build
    tauri_build::build();

    // Copy scripts to target directory for development
    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    
    let scripts_src = Path::new(&manifest_dir).parent().unwrap().join("scripts");
    let target_dir = Path::new(&manifest_dir).join("target").join(&profile).join("scripts");

    if scripts_src.exists() {
        // Create target scripts directory
        fs::create_dir_all(&target_dir).ok();

        // Copy all Python files
        if let Ok(entries) = fs::read_dir(&scripts_src) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().map_or(false, |ext| ext == "py" || ext == "txt") {
                    let dest = target_dir.join(path.file_name().unwrap());
                    fs::copy(&path, &dest).ok();
                }
            }
        }
        
        println!("cargo:rerun-if-changed=../scripts/");
    }
}
