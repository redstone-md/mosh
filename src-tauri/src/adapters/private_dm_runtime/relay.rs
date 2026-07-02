//! Shared relay-mesh node: one moss node on RELAY_MESH_ID, ref-counted across
//! all DMs that currently need relay. Started on first demand, stopped when the
//! last relayed DM releases it. No JoinRelayMesh — one node = one mesh, so
//! membership is just a second Moss_Init.

use crate::adapters::moss_ffi::{MossFfiRuntime, MossNode, MossNodeConfig};
use super::contracts::PrivateDmRuntimeError;
use std::sync::Arc;

pub const RELAY_MESH_ID: &str = "moss-relay/1";
/// Bundled well-known relay-mesh SuperNode spores, dialed on relay-node start
/// to seed `sha1("moss-relay/1")` discovery before the live SuperNode set is
/// learned from the mesh. This is DATA, not a trust anchor — SuperNodes are
/// untrusted (relay is E2E), so a stale/hostile entry only wastes one dial.
/// Fill with real `host:port` addresses after deploying spores (S3) and ship
/// the update via an app release. Empty = relay simply has nobody to dial yet.
pub const RELAY_BOOTSTRAP_SPORES: &[&str] = &[];

#[derive(Default)]
pub struct RelayRef {
    count: usize,
}

impl RelayRef {
    /// Returns the new count; 1 means "just started".
    pub fn acquire(&mut self) -> usize {
        self.count += 1;
        self.count
    }
    /// Returns the new count; 0 means "just stopped".
    pub fn release(&mut self) -> usize {
        self.count = self.count.saturating_sub(1);
        self.count
    }
}

/// Bring up the shared relay node: Init on RELAY_MESH_ID, wire the relay
/// callback (no pubsub/message callback — the relay mesh carries only
/// point-to-point relay frames, never a DM topic), Start, then dial each
/// bootstrap spore.
pub fn start_relay_node(moss: &Arc<MossFfiRuntime>) -> Result<MossNode, PrivateDmRuntimeError> {
    let node = moss
        .init_default_node(RELAY_MESH_ID, &MossNodeConfig::default())
        .map_err(|e| PrivateDmRuntimeError::Moss(e.to_string()))?;
    node.set_relay_callback()
        .map_err(|e| PrivateDmRuntimeError::Moss(e.to_string()))?;
    node.start()
        .map_err(|e| PrivateDmRuntimeError::Moss(e.to_string()))?;
    for spore in RELAY_BOOTSTRAP_SPORES {
        // Best-effort: an unreachable spore must not abort startup.
        let _ = node.connect(spore);
    }
    Ok(node)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relay_ref_starts_on_first_and_stops_on_last() {
        let mut r = RelayRef::default();
        assert_eq!(r.acquire(), 1, "first acquire signals start");
        assert_eq!(r.acquire(), 2);
        assert_eq!(r.release(), 1);
        assert_eq!(r.release(), 0, "last release signals stop");
    }

    #[test]
    fn release_below_zero_saturates() {
        let mut r = RelayRef::default();
        assert_eq!(r.release(), 0);
    }

    #[test]
    fn bootstrap_spores_are_well_formed() {
        // Fill RELAY_BOOTSTRAP_SPORES with real spore addresses after deploying
        // them (see the S3 plan's ops step). Whatever is listed must be a dialable
        // host:port so start_relay_node's connect loop never chokes on a typo.
        for addr in RELAY_BOOTSTRAP_SPORES {
            let (host, port) = addr
                .rsplit_once(':')
                .unwrap_or_else(|| panic!("bootstrap spore {addr:?} missing :port"));
            assert!(!host.is_empty(), "bootstrap spore {addr:?} has empty host");
            assert!(
                port.parse::<u16>().is_ok(),
                "bootstrap spore {addr:?} has non-numeric port"
            );
        }
    }
}
