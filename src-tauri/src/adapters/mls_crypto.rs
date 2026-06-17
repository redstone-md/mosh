use openmls::prelude::tls_codec::{Deserialize, Serialize};
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_traits::types::SignatureScheme;

use crate::adapters::mls_storage::PersistentProvider;

const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
const FINGERPRINT_LEN: usize = 16;

#[derive(Debug)]
pub enum MlsCryptoError {
    OpenMls(String),
    Codec(String),
    NotReady,
}

impl std::fmt::Display for MlsCryptoError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::OpenMls(error) => write!(formatter, "OpenMLS error: {error}"),
            Self::Codec(error) => write!(formatter, "codec error: {error}"),
            Self::NotReady => write!(formatter, "MLS group not initialized"),
        }
    }
}

impl std::error::Error for MlsCryptoError {}

pub struct AddOutcome {
    pub commit_bytes: Vec<u8>,
    pub welcome_bytes: Vec<u8>,
    pub tree_bytes: Vec<u8>,
}

pub struct MlsSessionCrypto {
    provider: PersistentProvider,
    signer: SignatureKeyPair,
    credential: CredentialWithKey,
    group: Option<MlsGroup>,
}

impl MlsSessionCrypto {
    pub fn new(identity: &str) -> Result<Self, MlsCryptoError> {
        let provider = PersistentProvider::default();
        let signer = SignatureKeyPair::new(SignatureScheme::ED25519)
            .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))?;
        signer
            .store(provider.storage())
            .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))?;
        let credential = BasicCredential::new(identity.as_bytes().to_vec());
        let credential = CredentialWithKey {
            credential: credential.into(),
            signature_key: signer.to_public_vec().into(),
        };
        Ok(Self {
            provider,
            signer,
            credential,
            group: None,
        })
    }

    pub fn create_group(&mut self) -> Result<(), MlsCryptoError> {
        let config = MlsGroupCreateConfig::builder()
            .ciphersuite(CIPHERSUITE)
            .use_ratchet_tree_extension(true)
            .build();
        let group = MlsGroup::new(
            &self.provider,
            &self.signer,
            &config,
            self.credential.clone(),
        )
        .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))?;
        self.group = Some(group);
        Ok(())
    }

    pub fn key_package_bytes(&mut self) -> Result<Vec<u8>, MlsCryptoError> {
        let key_package = KeyPackage::builder()
            .build(
                CIPHERSUITE,
                &self.provider,
                &self.signer,
                self.credential.clone(),
            )
            .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))?;
        MlsMessageOut::from(key_package)
            .to_bytes()
            .map_err(|error| MlsCryptoError::Codec(error.to_string()))
    }

    /// 2-PARTY ONLY. Adds a peer and returns just `(welcome, tree)`, discarding
    /// the commit. That is safe only because the single new member joins via the
    /// welcome and there are no *other* existing members who would need the
    /// commit to advance their epoch. For a group of 3+, use `add_members` and
    /// broadcast `commit_bytes` to existing members, or they desync.
    pub fn add_peer(
        &mut self,
        key_package_bytes: &[u8],
    ) -> Result<(Vec<u8>, Vec<u8>), MlsCryptoError> {
        let outcome = self.add_members(&[key_package_bytes])?;
        Ok((outcome.welcome_bytes, outcome.tree_bytes))
    }

    pub fn add_members(
        &mut self,
        key_packages_bytes: &[&[u8]],
    ) -> Result<AddOutcome, MlsCryptoError> {
        let key_packages: Vec<KeyPackage> = key_packages_bytes
            .iter()
            .map(|raw| self.decode_key_package(raw))
            .collect::<Result<_, _>>()?;
        let group = self.group.as_mut().ok_or(MlsCryptoError::NotReady)?;
        let (commit, welcome, _group_info) = group
            .add_members(&self.provider, &self.signer, &key_packages)
            .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))?;
        group
            .merge_pending_commit(&self.provider)
            .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))?;
        Ok(AddOutcome {
            commit_bytes: commit
                .to_bytes()
                .map_err(|error| MlsCryptoError::Codec(error.to_string()))?,
            welcome_bytes: welcome
                .to_bytes()
                .map_err(|error| MlsCryptoError::Codec(error.to_string()))?,
            tree_bytes: group
                .export_ratchet_tree()
                .tls_serialize_detached()
                .map_err(|error| MlsCryptoError::Codec(error.to_string()))?,
        })
    }

    pub fn process_commit(&mut self, commit_bytes: &[u8]) -> Result<(), MlsCryptoError> {
        let group = self.group.as_mut().ok_or(MlsCryptoError::NotReady)?;
        let message = MlsMessageIn::tls_deserialize(&mut &commit_bytes[..])
            .map_err(|error| MlsCryptoError::Codec(error.to_string()))?;
        let protocol_message = message
            .try_into_protocol_message()
            .map_err(|error| MlsCryptoError::Codec(error.to_string()))?;
        let processed = group
            .process_message(&self.provider, protocol_message)
            .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))?;
        match processed.into_content() {
            ProcessedMessageContent::StagedCommitMessage(staged) => {
                group
                    .merge_staged_commit(&self.provider, *staged)
                    .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))?;
                Ok(())
            }
            _ => Err(MlsCryptoError::OpenMls(
                "expected staged commit".to_string(),
            )),
        }
    }

    pub fn leave_proposal_bytes(&mut self) -> Result<Vec<u8>, MlsCryptoError> {
        let group = self.group.as_mut().ok_or(MlsCryptoError::NotReady)?;
        let proposal = group
            .leave_group(&self.provider, &self.signer)
            .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))?;
        proposal
            .to_bytes()
            .map_err(|error| MlsCryptoError::Codec(error.to_string()))
    }

    pub fn remove_self_commit(&mut self) -> Result<Vec<u8>, MlsCryptoError> {
        let group = self.group.as_mut().ok_or(MlsCryptoError::NotReady)?;
        let own = group.own_leaf_index();
        let (commit, _welcome, _info) = group
            .remove_members(&self.provider, &self.signer, &[own])
            .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))?;
        group
            .merge_pending_commit(&self.provider)
            .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))?;
        commit
            .to_bytes()
            .map_err(|error| MlsCryptoError::Codec(error.to_string()))
    }

    pub fn queue_remote_proposal(&mut self, proposal_bytes: &[u8]) -> Result<(), MlsCryptoError> {
        let group = self.group.as_mut().ok_or(MlsCryptoError::NotReady)?;
        let message = MlsMessageIn::tls_deserialize(&mut &proposal_bytes[..])
            .map_err(|error| MlsCryptoError::Codec(error.to_string()))?;
        let protocol_message = message
            .try_into_protocol_message()
            .map_err(|error| MlsCryptoError::Codec(error.to_string()))?;
        let processed = group
            .process_message(&self.provider, protocol_message)
            .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))?;
        match processed.into_content() {
            ProcessedMessageContent::ProposalMessage(proposal) => {
                group
                    .store_pending_proposal(self.provider.storage(), *proposal)
                    .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))?;
                Ok(())
            }
            _ => Err(MlsCryptoError::OpenMls(
                "expected proposal message".to_string(),
            )),
        }
    }

    pub fn commit_pending(&mut self) -> Result<Vec<u8>, MlsCryptoError> {
        let group = self.group.as_mut().ok_or(MlsCryptoError::NotReady)?;
        let (commit, _welcome, _info) = group
            .commit_to_pending_proposals(&self.provider, &self.signer)
            .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))?;
        group
            .merge_pending_commit(&self.provider)
            .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))?;
        commit
            .to_bytes()
            .map_err(|error| MlsCryptoError::Codec(error.to_string()))
    }

    pub fn key_package_signer_is_member(
        &self,
        key_package_bytes: &[u8],
    ) -> Result<bool, MlsCryptoError> {
        let key_package = decode_key_package_impl(&self.provider, key_package_bytes)?;
        let candidate = key_package.leaf_node().signature_key().as_slice();
        let Some(group) = self.group.as_ref() else {
            return Ok(false);
        };
        Ok(group
            .members()
            .any(|member| member.signature_key.as_slice() == candidate))
    }

    pub fn join_welcome(
        &mut self,
        welcome_bytes: &[u8],
        tree_bytes: &[u8],
    ) -> Result<(), MlsCryptoError> {
        let welcome_message = MlsMessageIn::tls_deserialize(&mut &welcome_bytes[..])
            .map_err(|error| MlsCryptoError::Codec(error.to_string()))?;
        let welcome = match welcome_message.extract() {
            MlsMessageBodyIn::Welcome(welcome) => welcome,
            _ => return Err(MlsCryptoError::Codec("expected Welcome".to_string())),
        };
        let tree = RatchetTreeIn::tls_deserialize(&mut &tree_bytes[..])
            .map_err(|error| MlsCryptoError::Codec(error.to_string()))?;
        let group = StagedWelcome::new_from_welcome(
            &self.provider,
            &MlsGroupJoinConfig::default(),
            welcome,
            Some(tree),
        )
        .and_then(|staged| staged.into_group(&self.provider))
        .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))?;
        self.group = Some(group);
        Ok(())
    }

    pub fn encrypt(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, MlsCryptoError> {
        let group = self.group.as_mut().ok_or(MlsCryptoError::NotReady)?;
        group
            .create_message(&self.provider, &self.signer, plaintext)
            .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))?
            .to_bytes()
            .map_err(|error| MlsCryptoError::Codec(error.to_string()))
    }

    pub fn decrypt(&mut self, ciphertext: &[u8]) -> Result<Vec<u8>, MlsCryptoError> {
        let group = self.group.as_mut().ok_or(MlsCryptoError::NotReady)?;
        let message = MlsMessageIn::tls_deserialize(&mut &ciphertext[..])
            .map_err(|error| MlsCryptoError::Codec(error.to_string()))?;
        let protocol_message = message
            .try_into_protocol_message()
            .map_err(|error| MlsCryptoError::Codec(error.to_string()))?;
        let processed = group
            .process_message(&self.provider, protocol_message)
            .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))?;
        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(message) => Ok(message.into_bytes()),
            _ => Err(MlsCryptoError::OpenMls(
                "expected application message".to_string(),
            )),
        }
    }

    pub fn fingerprint(&self) -> String {
        fingerprint_from_signature_key(&self.signer.to_public_vec())
    }

    pub fn random_token(&self, prefix: &str) -> Result<String, MlsCryptoError> {
        let bytes = self
            .provider
            .rand()
            .random_array::<8>()
            .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))?;
        let suffix = bytes
            .into_iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        Ok(format!("{prefix}-{suffix}"))
    }

    pub fn is_ready(&self) -> bool {
        self.group.is_some()
    }

    pub fn member_count(&self) -> usize {
        match &self.group {
            Some(group) => group.members().count(),
            None => 0,
        }
    }

    pub fn member_fingerprints(&self) -> Vec<String> {
        let Some(group) = self.group.as_ref() else {
            return Vec::new();
        };
        group
            .members()
            .map(|member| fingerprint_from_signature_key(&member.signature_key))
            .collect()
    }

    fn decode_key_package(&self, bytes: &[u8]) -> Result<KeyPackage, MlsCryptoError> {
        decode_key_package_impl(&self.provider, bytes)
    }

    /// Serialize MLS state for at-rest persistence.
    pub fn snapshot(&self) -> Vec<u8> {
        self.provider.snapshot_bytes()
    }

    /// Public signature key bytes (needed to re-read the signer on restore).
    pub fn signer_public(&self) -> Vec<u8> {
        self.signer.to_public_vec()
    }

    /// Group id bytes (the key for `MlsGroup::load`).
    pub fn group_id_bytes(&self) -> Option<Vec<u8>> {
        self.group
            .as_ref()
            .map(|g| g.group_id().as_slice().to_vec())
    }

    /// Rebuild a session from a persisted snapshot.
    pub fn restore(
        identity: &str,
        signer_public: &[u8],
        snapshot: &[u8],
        group_id: &[u8],
    ) -> Result<Self, MlsCryptoError> {
        let provider = PersistentProvider::from_snapshot(snapshot)
            .map_err(|error| MlsCryptoError::Codec(error.to_string()))?;
        let signer =
            SignatureKeyPair::read(provider.storage(), signer_public, SignatureScheme::ED25519)
                .ok_or_else(|| MlsCryptoError::OpenMls("signer not found in snapshot".into()))?;
        let credential = CredentialWithKey {
            credential: BasicCredential::new(identity.as_bytes().to_vec()).into(),
            signature_key: signer.to_public_vec().into(),
        };
        let group = MlsGroup::load(provider.storage(), &GroupId::from_slice(group_id))
            .map_err(|e| MlsCryptoError::OpenMls(e.to_string()))?
            .ok_or(MlsCryptoError::NotReady)?;
        Ok(Self {
            provider,
            signer,
            credential,
            group: Some(group),
        })
    }
}

fn fingerprint_from_signature_key(bytes: &[u8]) -> String {
    bytes
        .iter()
        .take(FINGERPRINT_LEN)
        .map(|byte| format!("{byte:02X}"))
        .collect()
}

fn decode_key_package_impl(
    provider: &PersistentProvider,
    bytes: &[u8],
) -> Result<KeyPackage, MlsCryptoError> {
    let message = MlsMessageIn::tls_deserialize(&mut &bytes[..])
        .map_err(|error| MlsCryptoError::Codec(error.to_string()))?;
    let key_package = match message.extract() {
        MlsMessageBodyIn::KeyPackage(key_package) => key_package,
        _ => return Err(MlsCryptoError::Codec("expected KeyPackage".to_string())),
    };
    key_package
        .validate(provider.crypto(), ProtocolVersion::default())
        .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restore_keeps_sending() {
        let mut alice = MlsSessionCrypto::new("alice").unwrap();
        alice.create_group().unwrap();
        let mut bob = MlsSessionCrypto::new("bob").unwrap();
        let bob_kp = bob.key_package_bytes().unwrap();
        let (welcome, tree) = alice.add_peer(&bob_kp).unwrap();
        bob.join_welcome(&welcome, &tree).unwrap();

        let snap = alice.snapshot();
        let pubkey = alice.signer_public();
        let gid = alice.group_id_bytes().unwrap();
        drop(alice);
        let mut alice2 = MlsSessionCrypto::restore("alice", &pubkey, &snap, &gid).unwrap();

        let ct = alice2.encrypt(b"after restart").unwrap();
        let pt = bob.decrypt(&ct).unwrap();
        assert_eq!(pt, b"after restart");
    }

    // Reproduces the field bug: after both sides have already exchanged a
    // message (so their own sender ratchet has advanced past generation 0),
    // a snapshot/restore must still let each side send AND receive. The joiner
    // (Bob) restoring and then sending is the reported failure
    // ("secret deleted to preserve forward secrecy").
    #[test]
    fn restore_keeps_sending_after_generation_advance() {
        let mut alice = MlsSessionCrypto::new("alice").unwrap();
        alice.create_group().unwrap();
        let mut bob = MlsSessionCrypto::new("bob").unwrap();
        let bob_kp = bob.key_package_bytes().unwrap();
        let (welcome, tree) = alice.add_peer(&bob_kp).unwrap();
        bob.join_welcome(&welcome, &tree).unwrap();

        // Generation 0 consumed on both sender ratchets.
        let c1 = alice.encrypt(b"a1").unwrap();
        assert_eq!(bob.decrypt(&c1).unwrap(), b"a1");
        let r1 = bob.encrypt(b"b1").unwrap();
        assert_eq!(alice.decrypt(&r1).unwrap(), b"b1");

        // Snapshot + restore BOTH after the advance.
        let restore = |c: &MlsSessionCrypto, id: &str| {
            MlsSessionCrypto::restore(
                id,
                &c.signer_public(),
                &c.snapshot(),
                &c.group_id_bytes().unwrap(),
            )
            .unwrap()
        };
        let mut alice2 = restore(&alice, "alice");
        let mut bob2 = restore(&bob, "bob");
        drop(alice);
        drop(bob);

        // Joiner sends after restart, creator receives.
        let r2 = bob2.encrypt(b"b2 after restart").unwrap();
        assert_eq!(alice2.decrypt(&r2).unwrap(), b"b2 after restart");

        // Creator sends after restart, joiner receives.
        let c2 = alice2.encrypt(b"a2 after restart").unwrap();
        assert_eq!(bob2.decrypt(&c2).unwrap(), b"a2 after restart");
    }
}
