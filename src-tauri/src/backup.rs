//! Backup files (`.fsim`): every household in the family (yours, plus any child
//! households) in one file, readable by every later version of the app.
//!
//! - Plain: a JSON envelope `{ format, formatVersion, appVersion, savedAt, households }`,
//!   each entry `{ name, linkedTo, household }`, yours first. Version 1 files held a single
//!   `household`; they open as a family of one.
//! - With a password: `FSIMENC1` + Argon2id params + salt + nonce, then the same
//!   JSON encrypted with XChaCha20-Poly1305 (key from the password via Argon2id).
//!
//! Compatibility promise: a file saved by any version opens in every later one.
//! New household fields need `#[serde(default)]`; renames or restructures add a
//! step to [`upgrade`] and bump [`FORMAT_VERSION`]. The golden files in
//! `fixtures/backups/` must always load (see the tests).

use std::path::{Path, PathBuf};

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::rand_core::RngCore;
use chacha20poly1305::aead::{Aead, KeyInit, OsRng};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use engine::model::{Household, Id, Role};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const FORMAT: &str = "finance-simulator-backup";
/// Bump only when [`upgrade`] gains a step. 2: a list of households (family backups).
pub const FORMAT_VERSION: u32 = 2;
pub const EXTENSION: &str = "fsim";
const MAGIC: &[u8; 8] = b"FSIMENC1";
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 24;
const HEADER_LEN: usize = MAGIC.len() + 12 + SALT_LEN + NONCE_LEN;
/// Argon2id cost (OWASP's recommended minimum): 19 MiB, 2 passes. Stored in each file,
/// so it can be raised later without breaking old files.
const KDF_MEMORY_KIB: u32 = 19 * 1024;
const KDF_PASSES: u32 = 2;
const KDF_LANES: u32 = 1;
/// Automatic backups kept in the folder.
pub const AUTO_KEEP: usize = 10;
pub const AUTO_PREFIX: &str = "Finance Simulator backup ";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Envelope {
    format: String,
    format_version: u32,
    app_version: String,
    saved_at: String,
    /// Version 1: the one household.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    household: Option<Value>,
    /// Version 2+: every household, yours first.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    households: Option<Vec<Value>>,
}

/// How a child's household is tied to yours: the child's person id in your household,
/// and which of your plans feeds it (`None` = your base plan).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub person_id: Id,
    #[serde(default)]
    pub plan: Option<Id>,
}

/// One household in a backup.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HouseholdBackup {
    pub name: String,
    #[serde(default)]
    pub linked_to: Option<Link>,
    pub household: Household,
}

impl HouseholdBackup {
    /// A household on its own (not linked to anyone).
    pub fn alone(household: Household) -> HouseholdBackup {
        HouseholdBackup { name: display_name(&household), linked_to: None, household }
    }
}

/// The primary person's name, else the household's name.
pub fn display_name(h: &Household) -> String {
    h.people
        .iter()
        .find(|p| p.role == Role::Primary)
        .map(|p| p.name.clone())
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| h.info.name.clone())
}

/// About a backup file, shown before restoring it. Counts describe the first household.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub app_version: String,
    pub saved_at: String,
    pub format_version: u32,
    pub encrypted: bool,
    pub household_name: String,
    pub people: usize,
    pub children: usize,
    pub accounts: usize,
    pub income: usize,
    pub debts: usize,
    /// What-if plans (scenarios) in the first household.
    pub plans: usize,
    /// Every household in the file, the first being the main one.
    pub households: Vec<String>,
}

#[derive(Debug, PartialEq)]
pub enum BackupError {
    NeedsPassword,
    WrongPassword,
    NotABackup,
    TooNew { app_version: String },
    Invalid(String),
}

impl std::fmt::Display for BackupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BackupError::NeedsPassword => f.write_str("This backup is protected with a password."),
            BackupError::WrongPassword => {
                f.write_str("That password doesn't open this file (or the file was damaged). Check it and try again.")
            }
            BackupError::NotABackup => f.write_str("That file isn't a Finance Simulator backup."),
            BackupError::TooNew { app_version } => write!(
                f,
                "This backup was made with a newer version of Finance Simulator ({app_version}). Please update the app first."
            ),
            BackupError::Invalid(m) => write!(f, "This backup couldn't be read: {m}"),
        }
    }
}

pub fn is_encrypted(bytes: &[u8]) -> bool {
    bytes.starts_with(MAGIC)
}

/// The backup file's bytes for `households` (the main one first). `saved_at` is RFC 3339.
pub fn encode(households: &[HouseholdBackup], password: Option<&str>, app_version: &str, saved_at: &str) -> Vec<u8> {
    let envelope = Envelope {
        format: FORMAT.into(),
        format_version: FORMAT_VERSION,
        app_version: app_version.into(),
        saved_at: saved_at.into(),
        household: None,
        households: Some(
            households.iter().map(|h| serde_json::to_value(h).expect("a household always serializes")).collect(),
        ),
    };
    let json = serde_json::to_vec_pretty(&envelope).expect("an envelope always serializes");
    match password.filter(|p| !p.is_empty()) {
        None => json,
        Some(pw) => encrypt(&json, pw),
    }
}

/// Reads a backup made by this or any earlier version.
pub fn decode(bytes: &[u8], password: Option<&str>) -> Result<(Vec<HouseholdBackup>, BackupInfo), BackupError> {
    let encrypted = is_encrypted(bytes);
    let json = if encrypted {
        let pw = password.filter(|p| !p.is_empty()).ok_or(BackupError::NeedsPassword)?;
        decrypt(bytes, pw)?
    } else {
        bytes.to_vec()
    };
    let value: Value = serde_json::from_slice(&json).map_err(|_| BackupError::NotABackup)?;
    let invalid = |e: serde_json::Error| BackupError::Invalid(e.to_string());
    // Each entry as (name, link, household JSON), plus the file's own details.
    let (entries, app_version, saved_at, format_version) = match value.get("format").and_then(Value::as_str) {
        Some(FORMAT) => {
            let env: Envelope = serde_json::from_value(value).map_err(invalid)?;
            if env.format_version > FORMAT_VERSION {
                return Err(BackupError::TooNew { app_version: env.app_version });
            }
            let entries = match (env.households, env.household) {
                (Some(list), _) => list
                    .into_iter()
                    .map(|mut e| {
                        let household = e.get_mut("household").map(Value::take).ok_or(BackupError::NotABackup)?;
                        let name = e.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
                        let link = e.get("linkedTo").cloned().unwrap_or(Value::Null);
                        Ok((name, link, household))
                    })
                    .collect::<Result<Vec<_>, BackupError>>()?,
                (None, Some(h)) => vec![(String::new(), Value::Null, h)],
                (None, None) => return Err(BackupError::NotABackup),
            };
            (entries, env.app_version, env.saved_at, env.format_version)
        }
        Some(_) => return Err(BackupError::NotABackup),
        // A bare household (e.g. a demo fixture) is accepted as version 1.
        None if value.get("people").is_some() && value.get("accounts").is_some() => {
            (vec![(String::new(), Value::Null, value)], String::new(), String::new(), 1)
        }
        None => return Err(BackupError::NotABackup),
    };
    if entries.is_empty() {
        return Err(BackupError::NotABackup);
    }
    let mut households = Vec::with_capacity(entries.len());
    for (name, link, json) in entries {
        let h: Household = serde_json::from_value(upgrade(json, format_version)?).map_err(invalid)?;
        h.validate().map_err(BackupError::Invalid)?;
        let linked_to: Option<Link> = serde_json::from_value(link).map_err(invalid)?;
        let name = if name.trim().is_empty() { display_name(&h) } else { name };
        households.push(HouseholdBackup { name, linked_to, household: h });
    }
    let info = info(&households, app_version, saved_at, format_version, encrypted);
    Ok((households, info))
}

/// Brings an older file's household JSON up to the current shape, one version at a time.
/// Purely additive changes need no step (new fields default); add one here for renames
/// or restructures, then bump `FORMAT_VERSION` and add a golden file. (Version 2 only
/// changed the envelope, which `decode` handles.)
fn upgrade(household: Value, from: u32) -> Result<Value, BackupError> {
    // Steps run oldest first, each taking the household one version forward, e.g.
    //     if from < 3 { v = v2_to_v3(v)?; }
    let v = household;
    debug_assert!(from <= FORMAT_VERSION);
    Ok(v)
}

fn info(
    households: &[HouseholdBackup],
    app_version: String,
    saved_at: String,
    format_version: u32,
    encrypted: bool,
) -> BackupInfo {
    let h = &households[0].household;
    BackupInfo {
        app_version,
        saved_at,
        format_version,
        encrypted,
        household_name: h.info.name.clone(),
        people: h.people.len(),
        children: h.people.iter().filter(|p| p.role == Role::Child).count(),
        accounts: h.accounts.len(),
        income: h.income.len(),
        debts: h.debts.len(),
        plans: h.scenarios.len(),
        households: households.iter().map(|h| h.name.clone()).collect(),
    }
}

fn kdf(password: &str, salt: &[u8], memory: u32, passes: u32, lanes: u32) -> Result<[u8; 32], BackupError> {
    let params = Params::new(memory, passes, lanes, Some(32)).map_err(|_| BackupError::WrongPassword)?;
    let mut key = [0u8; 32];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|_| BackupError::WrongPassword)?;
    Ok(key)
}

fn encrypt(plain: &[u8], password: &str) -> Vec<u8> {
    let mut salt = [0u8; SALT_LEN];
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce);
    let key = kdf(password, &salt, KDF_MEMORY_KIB, KDF_PASSES, KDF_LANES).expect("fixed KDF params are valid");
    let mut out = Vec::with_capacity(HEADER_LEN + plain.len() + 16);
    out.extend_from_slice(MAGIC);
    for n in [KDF_MEMORY_KIB, KDF_PASSES, KDF_LANES] {
        out.extend_from_slice(&n.to_le_bytes());
    }
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce);
    // The header is authenticated too, so tampering with the KDF params or salt is caught.
    let cipher = XChaCha20Poly1305::new((&key).into());
    let sealed = cipher
        .encrypt(XNonce::from_slice(&nonce), chacha20poly1305::aead::Payload { msg: plain, aad: &out })
        .expect("encryption can't fail for in-memory data");
    out.extend_from_slice(&sealed);
    out
}

fn decrypt(bytes: &[u8], password: &str) -> Result<Vec<u8>, BackupError> {
    if bytes.len() < HEADER_LEN + 16 {
        return Err(BackupError::WrongPassword);
    }
    let (header, sealed) = bytes.split_at(HEADER_LEN);
    let num = |i: usize| u32::from_le_bytes(header[8 + 4 * i..12 + 4 * i].try_into().unwrap());
    let (memory, passes, lanes) = (num(0), num(1), num(2));
    // Refuse absurd costs from a damaged header rather than allocating gigabytes.
    if memory > 1024 * 1024 || passes > 64 || lanes > 64 {
        return Err(BackupError::WrongPassword);
    }
    let salt = &header[20..20 + SALT_LEN];
    let nonce = &header[20 + SALT_LEN..HEADER_LEN];
    let key = kdf(password, salt, memory, passes, lanes)?;
    XChaCha20Poly1305::new((&key).into())
        .decrypt(XNonce::from_slice(nonce), chacha20poly1305::aead::Payload { msg: sealed, aad: header })
        .map_err(|_| BackupError::WrongPassword)
}

/// Writes `bytes` to `path` without ever leaving a half-written file.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension(format!("{EXTENSION}.tmp"));
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)
}

/// File name for an automatic backup, e.g. "Finance Simulator backup 2026-10-24 14-30-05.fsim".
/// Names sort by time.
pub fn auto_file_name(stamp: &str) -> String {
    format!("{AUTO_PREFIX}{stamp}.{EXTENSION}")
}

/// Writes an automatic backup into `folder` and keeps only the newest [`AUTO_KEEP`].
/// Only files this app named are ever deleted.
pub fn write_auto(folder: &Path, bytes: &[u8], stamp: &str) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(folder)?;
    let path = folder.join(auto_file_name(stamp));
    write_atomic(&path, bytes)?;
    let mut ours: Vec<PathBuf> = std::fs::read_dir(folder)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.extension().is_some_and(|x| x == EXTENSION)
                && p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(AUTO_PREFIX))
        })
        .collect();
    ours.sort();
    let extra = ours.len().saturating_sub(AUTO_KEEP);
    for old in &ours[..extra] {
        let _ = std::fs::remove_file(old);
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::demo::{Demo, family, household};

    const SAVED_AT: &str = "2026-10-24T14:30:00-05:00";

    fn demo() -> Household {
        household(Demo::Retiree)
    }

    fn one(h: Household) -> Vec<HouseholdBackup> {
        vec![HouseholdBackup::alone(h)]
    }

    #[test]
    fn plain_round_trip_is_lossless() {
        let h = demo();
        let bytes = encode(&one(h.clone()), None, "0.5.0", SAVED_AT);
        assert!(!is_encrypted(&bytes));
        let (back, info) = decode(&bytes, None).unwrap();
        assert_eq!(back[0].household, h);
        assert_eq!(back[0].name, "Pat");
        assert_eq!(info.app_version, "0.5.0");
        assert_eq!(info.plans, h.scenarios.len());
        assert_eq!(info.children, 2);
        assert!(!info.encrypted);
    }

    #[test]
    fn family_round_trip_keeps_every_household_and_its_link() {
        let fam = family(Demo::Retiree);
        assert!(fam.len() >= 2);
        let (back, info) = decode(&encode(&fam, None, "0.5.0", SAVED_AT), None).unwrap();
        assert_eq!(back, fam);
        assert_eq!(info.households, fam.iter().map(|h| h.name.clone()).collect::<Vec<_>>());
        assert_eq!(back[1].linked_to, Some(Link { person_id: 2, plan: None }));
    }

    #[test]
    fn password_round_trip_and_failures() {
        let h = demo();
        let bytes = encode(&one(h.clone()), Some("correct horse"), "0.5.0", SAVED_AT);
        assert!(is_encrypted(&bytes));
        // The household's name never appears in the clear.
        assert!(!bytes.windows(7).any(|w| w == b"Retired"));
        let (back, info) = decode(&bytes, Some("correct horse")).unwrap();
        assert_eq!(back[0].household, h);
        assert!(info.encrypted);
        assert_eq!(decode(&bytes, None).unwrap_err(), BackupError::NeedsPassword);
        assert_eq!(decode(&bytes, Some("wrong")).unwrap_err(), BackupError::WrongPassword);
        let mut tampered = bytes.clone();
        let last = tampered.len() - 1;
        tampered[last] ^= 1;
        assert_eq!(decode(&tampered, Some("correct horse")).unwrap_err(), BackupError::WrongPassword);
        let mut bad_header = bytes;
        bad_header[30] ^= 1; // inside the salt
        assert_eq!(decode(&bad_header, Some("correct horse")).unwrap_err(), BackupError::WrongPassword);
    }

    #[test]
    fn empty_password_means_no_password() {
        let bytes = encode(&one(demo()), Some(""), "0.5.0", SAVED_AT);
        assert!(!is_encrypted(&bytes));
    }

    #[test]
    fn files_from_a_newer_version_ask_to_update() {
        let mut v: Value = serde_json::from_slice(&encode(&one(demo()), None, "0.5.0", SAVED_AT)).unwrap();
        v["formatVersion"] = (FORMAT_VERSION + 1).into();
        v["appVersion"] = "0.9.0".into();
        let err = decode(&serde_json::to_vec(&v).unwrap(), None).unwrap_err();
        assert_eq!(err, BackupError::TooNew { app_version: "0.9.0".into() });
        assert!(err.to_string().contains("0.9.0"));
    }

    #[test]
    fn other_files_are_rejected_politely() {
        assert_eq!(decode(b"hello", None).unwrap_err(), BackupError::NotABackup);
        assert_eq!(decode(br#"{"format":"something-else"}"#, None).unwrap_err(), BackupError::NotABackup);
        assert_eq!(decode(br#"{"a":1}"#, None).unwrap_err(), BackupError::NotABackup);
    }

    #[test]
    fn a_bare_household_json_is_accepted() {
        let json = serde_json::to_vec(&demo()).unwrap();
        assert_eq!(decode(&json, None).unwrap().0[0].household, demo());
    }

    /// A version-1 file (one `household`) opens as a family of one.
    #[test]
    fn version_1_envelopes_open_as_one_household() {
        let mut v: Value = serde_json::from_slice(&encode(&one(demo()), None, "0.5.0", SAVED_AT)).unwrap();
        let h = v["households"][0]["household"].take();
        let v1 = serde_json::json!({
            "format": FORMAT, "formatVersion": 1, "appVersion": "0.5.0", "savedAt": SAVED_AT, "household": h,
        });
        let (back, info) = decode(&serde_json::to_vec(&v1).unwrap(), None).unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].household, demo());
        assert_eq!(back[0].linked_to, None);
        assert_eq!(info.format_version, 1);
    }

    /// Fields added after the first release must default, so files saved before they
    /// existed still open. Removes every such field from a backup and loads it.
    #[test]
    fn files_without_newer_fields_still_open() {
        let mut v: Value = serde_json::from_slice(&encode(&one(demo()), None, "0.5.0", SAVED_AT)).unwrap();
        v["households"][0].as_object_mut().unwrap().remove("linkedTo");
        let h = v["households"][0]["household"].as_object_mut().unwrap();
        h.remove("assumptions");
        h.remove("scenarios");
        h["info"].as_object_mut().unwrap().remove("homePropertyTax");
        // Private funds came with their terms, so only ordinary accounts can lack the field.
        for a in h["accounts"].as_array_mut().unwrap() {
            if a["private"].is_null() {
                a.as_object_mut().unwrap().remove("private");
            }
        }
        for d in h["debts"].as_array_mut().unwrap() {
            d.as_object_mut().unwrap().remove("homeMortgage");
        }
        let (back, _) = decode(&serde_json::to_vec(&v).unwrap(), None).unwrap();
        assert!(back[0].household.scenarios.is_empty());
        assert_eq!(back[0].household.assumptions, engine::model::Assumptions::default());
        assert_eq!(back[0].household.accounts.len(), demo().accounts.len());
    }

    #[test]
    fn unknown_fields_are_ignored() {
        let mut v: Value = serde_json::from_slice(&encode(&one(demo()), None, "0.5.0", SAVED_AT)).unwrap();
        v["households"][0]["household"]["somethingFromTheFuture"] = 42.into();
        v["households"][0]["household"]["info"]["anotherNewThing"] = "x".into();
        v["households"][0]["somethingElse"] = true.into();
        assert!(decode(&serde_json::to_vec(&v).unwrap(), None).is_ok());
    }

    /// Golden files: saved once by a released version and never edited. Every later
    /// version must open them. Regenerate only for a new format version, as new files.
    #[test]
    fn golden_backups_always_open() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/backups");
        let mut seen = Vec::new();
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_none_or(|x| x != EXTENSION) {
                continue;
            }
            let bytes = std::fs::read(&path).unwrap();
            let pw = is_encrypted(&bytes).then_some(GOLDEN_PASSWORD);
            let (households, info) = decode(&bytes, pw).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
            assert!(!households[0].household.people.is_empty() && info.accounts > 0, "{}", path.display());
            seen.push(info.format_version);
        }
        for v in 1..=FORMAT_VERSION {
            assert!(seen.contains(&v), "no golden file for format version {v} in {}", dir.display());
        }
    }

    #[test]
    fn restoring_a_golden_backup_into_the_database_is_lossless() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/backups/v1-retiree.fsim");
        let (households, _) = decode(&std::fs::read(path).unwrap(), None).unwrap();
        let h = &households[0].household;
        let mut conn = crate::db::open_in_memory().unwrap();
        crate::db::replace_household(&mut conn, h).unwrap();
        assert_eq!(&crate::db::load_household(&conn).unwrap(), h);
    }

    /// Dev check against a real database copy: migrates it, backs it up, and restores it.
    /// `FSIM_DB=/path/to/copy.sqlite cargo test -p finance-simulator real_db_backup -- --ignored`
    #[test]
    #[ignore]
    fn real_db_backup_round_trip() {
        let path = std::env::var("FSIM_DB").expect("set FSIM_DB to a copy of household.sqlite");
        let conn = crate::db::open(Path::new(&path)).unwrap();
        let h = crate::db::load_household(&conn).unwrap();
        for pw in [None, Some("a real password")] {
            let (back, info) = decode(&encode(&one(h.clone()), pw, "0.5.0", SAVED_AT), pw).unwrap();
            assert_eq!(back[0].household, h);
            println!(
                "{} ({}): {} people, {} accounts, {} plans",
                info.household_name,
                pw.is_some(),
                info.people,
                info.accounts,
                info.plans
            );
        }
        let mut fresh = crate::db::open_in_memory().unwrap();
        crate::db::replace_household(&mut fresh, &h).unwrap();
        assert_eq!(crate::db::load_household(&fresh).unwrap(), h);
    }

    /// The password used for encrypted golden files.
    const GOLDEN_PASSWORD: &str = "golden-test-password";

    /// Dev tool: writes the golden files for the current format version.
    /// `cargo test -p finance-simulator write_golden -- --ignored`
    #[test]
    #[ignore]
    fn write_golden_backups() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/backups");
        std::fs::create_dir_all(&dir).unwrap();
        let version = env!("CARGO_PKG_VERSION");
        let fam = family(Demo::Retiree);
        let plain = dir.join(format!("v{FORMAT_VERSION}-family.fsim"));
        let locked = dir.join(format!("v{FORMAT_VERSION}-family-password.fsim"));
        assert!(!plain.exists() && !locked.exists(), "golden files are never overwritten");
        std::fs::write(plain, encode(&fam, None, version, SAVED_AT)).unwrap();
        std::fs::write(locked, encode(&fam, Some(GOLDEN_PASSWORD), version, SAVED_AT)).unwrap();
    }

    #[test]
    fn automatic_backups_keep_the_newest_ten() {
        let dir = std::env::temp_dir().join(format!("fsim-auto-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("my notes.fsim"), b"keep me").unwrap();
        for i in 0..13 {
            write_auto(&dir, b"{}", &format!("2026-10-24 14-30-{i:02}")).unwrap();
        }
        let mut names: Vec<String> =
            std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
        names.sort();
        assert_eq!(names.len(), AUTO_KEEP + 1, "{names:?}");
        assert!(names.contains(&"my notes.fsim".to_string()), "never deletes files it didn't make");
        assert!(names.contains(&auto_file_name("2026-10-24 14-30-12")));
        assert!(!names.contains(&auto_file_name("2026-10-24 14-30-02")));
        let _ = std::fs::remove_dir_all(dir);
    }
}
