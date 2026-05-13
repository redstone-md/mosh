use openmls::prelude::tls_codec::{Deserialize, Serialize};
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_traits::types::SignatureScheme;

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
    provider: OpenMlsRustCrypto,
    signer: SignatureKeyPair,
    credential: CredentialWithKey,
    group: Option<MlsGroup>,
}

impl MlsSessionCrypto {
    pub fn new(identity: &str) -> Result<Self, MlsCryptoError> {
        let provider = OpenMlsRustCrypto::default();
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
        self.signer
            .to_public_vec()
            .into_iter()
            .take(FINGERPRINT_LEN)
            .map(|byte| format!("{byte:02X}"))
            .collect::<Vec<_>>()
            .join("")
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

    fn decode_key_package(&self, bytes: &[u8]) -> Result<KeyPackage, MlsCryptoError> {
        let message = MlsMessageIn::tls_deserialize(&mut &bytes[..])
            .map_err(|error| MlsCryptoError::Codec(error.to_string()))?;
        let key_package = match message.extract() {
            MlsMessageBodyIn::KeyPackage(key_package) => key_package,
            _ => return Err(MlsCryptoError::Codec("expected KeyPackage".to_string())),
        };
        key_package
            .validate(self.provider.crypto(), ProtocolVersion::default())
            .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))
    }
}
