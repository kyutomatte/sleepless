use std::process::{Command, ExitCode};

const HELPER_VERSION: &str = "1";

fn is_running_as_root() -> bool {
    Command::new("/usr/bin/id")
        .arg("-u")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .is_some_and(|uid| uid.trim() == "0")
}

fn set_closed_lid_sleep(disabled: bool) -> Result<(), String> {
    if !is_running_as_root() {
        return Err("helper is not running as root".to_string());
    }

    let value = if disabled { "1" } else { "0" };
    let output = Command::new("/usr/bin/pmset")
        .args(["-c", "disablesleep", value])
        .output()
        .map_err(|error| format!("could not run pmset: {error}"))?;

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

    Err(format!("pmset failed: {details}"))
}

fn main() -> ExitCode {
    let Some(command) = std::env::args().nth(1) else {
        eprintln!("usage: sleepless-pmset-helper enable|disable|--version");
        return ExitCode::FAILURE;
    };

    if command == "--version" {
        println!("{HELPER_VERSION}");
        return ExitCode::SUCCESS;
    }

    let result = match command.as_str() {
        "enable" => set_closed_lid_sleep(true),
        "disable" => set_closed_lid_sleep(false),
        _ => Err("unknown helper command".to_string()),
    };

    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
