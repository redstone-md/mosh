//! Remembers the one question we ask about the VPN, and resolves the answer
//! back to a NIC that still exists.
//!
//! Deliberately a plain JSON file rather than the encrypted store: the adapter
//! name is not a secret, and the answer has to be readable on a launch where
//! the keychain refuses to open — otherwise a user whose store broke would
//! also lose their network path.
//!
//! Only "yes" is written. A refusal is not persisted, so the question comes
//! back next launch: a wrong yes is visible and reversible, a remembered no
//! silently strands someone whose network changed.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::network_inventory::NetworkInterfaceInfo;

const FILE_NAME: &str = "vpn-bypass.json";

/// A stored "yes": route Moss around the tunnel, using this adapter.
///
/// The index is kept alongside the name because the two fail differently —
/// a renamed NIC keeps its index, a re-seated one keeps its name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VpnBypassConsent {
    pub interface: String,
    pub index: u32,
}

pub fn consent_path(config_dir: &Path) -> PathBuf {
    config_dir.join(FILE_NAME)
}

/// Reads a stored answer. Absent, unreadable and malformed all mean the same
/// thing to the caller — nobody has answered — so the question gets asked
/// again rather than the launch failing over a config file.
pub fn load(config_dir: &Path) -> Option<VpnBypassConsent> {
    let raw = fs::read(consent_path(config_dir)).ok()?;
    serde_json::from_slice(&raw).ok()
}

pub fn save(config_dir: &Path, consent: &VpnBypassConsent) -> std::io::Result<()> {
    fs::create_dir_all(config_dir)?;
    let body = serde_json::to_vec_pretty(consent)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    fs::write(consent_path(config_dir), body)
}

/// Forgets the answer, so the question is asked again. Absent is success.
pub fn clear(config_dir: &Path) -> std::io::Result<()> {
    match fs::remove_file(consent_path(config_dir)) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

/// Maps a stored answer onto a NIC that exists right now.
///
/// This matters more than it looks: moss aborts node construction outright
/// when it cannot resolve `bind_interface`, so a stale adapter name turns a
/// degraded app into a dead one. Prefer the name, fall back to the index
/// (the user renamed the NIC), and give up rather than guess.
pub fn resolve<'a>(
    consent: &VpnBypassConsent,
    interfaces: &'a [NetworkInterfaceInfo],
) -> Option<&'a NetworkInterfaceInfo> {
    let usable = |iface: &&NetworkInterfaceInfo| {
        iface.is_up && !iface.is_loopback && !iface.is_virtual
    };
    interfaces
        .iter()
        .find(|iface| iface.name == consent.interface && usable(iface))
        .or_else(|| {
            interfaces
                .iter()
                .find(|iface| iface.index == consent.index && usable(iface))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nic(name: &str, index: u32) -> NetworkInterfaceInfo {
        NetworkInterfaceInfo {
            name: name.into(),
            description: name.into(),
            index,
            ipv4: Some("192.168.1.5".into()),
            is_loopback: false,
            is_up: true,
            is_virtual: false,
            is_vpn: false,
            is_default_route: false,
        }
    }

    #[test]
    fn round_trips_through_a_missing_directory() {
        let dir = std::env::temp_dir().join("mosh-vpn-consent-roundtrip");
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(load(&dir), None, "nothing stored yet");

        let consent = VpnBypassConsent {
            interface: "Wi-Fi".into(),
            index: 24,
        };
        save(&dir, &consent).expect("save creates the directory");
        assert_eq!(load(&dir), Some(consent));

        clear(&dir).expect("clear");
        assert_eq!(load(&dir), None, "cleared answer is asked again");
        clear(&dir).expect("clearing an absent answer is not an error");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_corrupt_file_reads_as_unanswered() {
        let dir = std::env::temp_dir().join("mosh-vpn-consent-corrupt");
        fs::create_dir_all(&dir).expect("mkdir");
        fs::write(consent_path(&dir), b"{ not json").expect("write");
        assert_eq!(load(&dir), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolves_by_name_then_by_index_then_gives_up() {
        let consent = VpnBypassConsent {
            interface: "Wi-Fi".into(),
            index: 24,
        };
        let present = vec![nic("Ethernet", 12), nic("Wi-Fi", 24)];
        assert_eq!(resolve(&consent, &present).map(|i| i.index), Some(24));

        // Renamed NIC: the name is gone, the index still points at it.
        let renamed = vec![nic("Wi-Fi 2", 24)];
        assert_eq!(
            resolve(&consent, &renamed).map(|i| i.name.as_str()),
            Some("Wi-Fi 2")
        );

        // Unplugged dock: neither matches, and a down NIC is not a candidate.
        let mut down = nic("Wi-Fi", 24);
        down.is_up = false;
        assert!(resolve(&consent, &[down]).is_none());
        assert!(resolve(&consent, &[]).is_none());
    }

    #[test]
    fn never_resolves_onto_the_tunnel_it_is_meant_to_skip() {
        let consent = VpnBypassConsent {
            interface: "Wi-Fi".into(),
            index: 24,
        };
        let mut tunnel = nic("Wi-Fi", 24);
        tunnel.is_virtual = true;
        assert!(
            resolve(&consent, &[tunnel]).is_none(),
            "a NIC that turned virtual is not the one we agreed to bind"
        );
    }
}
