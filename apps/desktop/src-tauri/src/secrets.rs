//! OS keychain-backed secret storage — macOS Keychain, Windows Credential
//! Manager, Linux Secret Service — via the `keyring` crate.
//!
//! Replaces the plaintext `apiKeys` in settings.json: the renderer migrates
//! existing values on first load and from then on secrets never touch disk
//! unencrypted. Service is fixed ("WebCraft"), the account is the logical
//! key (e.g. "apikey.anthropic").

const SERVICE: &str = "WebCraft";

fn entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, key).map_err(|e| format!("keychain entry: {e}"))
}

#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keychain read: {e}")),
    }
}

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    entry(&key)?
        .set_password(&value)
        .map_err(|e| format!("keychain write: {e}"))
}

#[tauri::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keychain delete: {e}")),
    }
}
