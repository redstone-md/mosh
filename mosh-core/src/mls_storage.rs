use std::collections::HashMap;

use openmls_rust_crypto::{MemoryStorage, RustCrypto};
use openmls_traits::OpenMlsProvider;

/// Our own provider: built-in RustCrypto + a MemoryStorage we can snapshot.
/// Mirrors OpenMlsRustCrypto, but exposes the storage for serialization.
#[derive(Default)]
pub struct PersistentProvider {
    crypto: RustCrypto,
    storage: MemoryStorage,
}

impl OpenMlsProvider for PersistentProvider {
    type CryptoProvider = RustCrypto;
    type RandProvider = RustCrypto;
    type StorageProvider = MemoryStorage;

    fn storage(&self) -> &Self::StorageProvider {
        &self.storage
    }
    fn crypto(&self) -> &Self::CryptoProvider {
        &self.crypto
    }
    fn rand(&self) -> &Self::RandProvider {
        &self.crypto
    }
}

impl PersistentProvider {
    /// Serialize the whole MemoryStorage via its public `values` map.
    /// (MemoryStorage's own serialize() is gated behind `test-utils`, so we
    /// go through the public field directly.)
    pub fn snapshot_bytes(&self) -> Vec<u8> {
        let guard = self
            .storage
            .values
            .read()
            .expect("mls storage lock poisoned");
        let pairs: Vec<(Vec<u8>, Vec<u8>)> =
            guard.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        serde_json::to_vec(&pairs).expect("serialize mls pairs")
    }

    /// Rebuild a provider from a snapshot produced by `snapshot_bytes`. Returns
    /// an error on corrupt/truncated bytes instead of silently defaulting to an
    /// empty store, which would mask persistence corruption as a fresh session.
    pub fn from_snapshot(bytes: &[u8]) -> Result<Self, serde_json::Error> {
        let pairs: Vec<(Vec<u8>, Vec<u8>)> = serde_json::from_slice(bytes)?;
        let map: HashMap<Vec<u8>, Vec<u8>> = pairs.into_iter().collect();
        let provider = Self::default();
        *provider
            .storage
            .values
            .write()
            .expect("mls storage lock poisoned") = map;
        Ok(provider)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use openmls::prelude::*;
    use openmls_basic_credential::SignatureKeyPair;
    use openmls_traits::types::SignatureScheme;

    const CS: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;

    #[test]
    fn from_snapshot_rejects_corrupt_bytes() {
        // A truncated/tampered snapshot must surface as an error, not silently
        // restore an empty store that looks healthy.
        assert!(PersistentProvider::from_snapshot(b"not valid json").is_err());
    }

    #[test]
    fn snapshot_restores_group() {
        let provider = PersistentProvider::default();
        let signer = SignatureKeyPair::new(SignatureScheme::ED25519).unwrap();
        signer.store(provider.storage()).unwrap();
        let credential = CredentialWithKey {
            credential: BasicCredential::new(b"alice".to_vec()).into(),
            signature_key: signer.to_public_vec().into(),
        };
        let config = MlsGroupCreateConfig::builder()
            .ciphersuite(CS)
            .use_ratchet_tree_extension(true)
            .build();
        let group = MlsGroup::new(&provider, &signer, &config, credential).unwrap();
        let gid = group.group_id().clone();
        let before = group
            .export_secret(provider.crypto(), "t", &[], 32)
            .unwrap();

        let snap = provider.snapshot_bytes();
        let restored = PersistentProvider::from_snapshot(&snap).expect("valid snapshot restores");
        let loaded = MlsGroup::load(restored.storage(), &gid).unwrap().unwrap();
        let after = loaded
            .export_secret(restored.crypto(), "t", &[], 32)
            .unwrap();

        assert_eq!(before, after);
    }
}
