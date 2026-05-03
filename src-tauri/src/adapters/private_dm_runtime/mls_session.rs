use openmls::prelude::tls_codec::{Deserialize, Serialize};
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_traits::types::SignatureScheme;

use super::contracts::PrivateDmRuntimeError;

const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
const FINGERPRINT_LEN: usize = 16;

pub struct MlsSessionCrypto {
    provider: OpenMlsRustCrypto,
    signer: SignatureKeyPair,
    credential: CredentialWithKey,
    group: Option<MlsGroup>,
}

impl MlsSessionCrypto {
    pub fn new(identity: &str) -> Result<Self, PrivateDmRuntimeError> {
        let provider = OpenMlsRustCrypto::default();
        let signer = SignatureKeyPair::new(SignatureScheme::ED25519)
            .map_err(|error| PrivateDmRuntimeError::OpenMls(error.to_string()))?;

        signer
            .store(provider.storage())
            .map_err(|error| PrivateDmRuntimeError::OpenMls(error.to_string()))?;

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

    pub fn create_group(&mut self) -> Result<(), PrivateDmRuntimeError> {
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
        .map_err(|error| PrivateDmRuntimeError::OpenMls(error.to_string()))?;

        self.group = Some(group);
        Ok(())
    }

    pub fn key_package_bytes(&mut self) -> Result<Vec<u8>, PrivateDmRuntimeError> {
        let key_package = KeyPackage::builder()
            .build(
                CIPHERSUITE,
                &self.provider,
                &self.signer,
                self.credential.clone(),
            )
            .map_err(|error| PrivateDmRuntimeError::OpenMls(error.to_string()))?;

        MlsMessageOut::from(key_package)
            .to_bytes()
            .map_err(|error| PrivateDmRuntimeError::Codec(error.to_string()))
    }

    pub fn add_peer(
        &mut self,
        key_package_bytes: &[u8],
    ) -> Result<(Vec<u8>, Vec<u8>), PrivateDmRuntimeError> {
        let key_package = self.decode_key_package(key_package_bytes)?;
        let group = self.group.as_mut().ok_or(PrivateDmRuntimeError::NotReady)?;
        let (_, welcome, _) = group
            .add_members(
                &self.provider,
                &self.signer,
                core::slice::from_ref(&key_package),
            )
            .map_err(|error| PrivateDmRuntimeError::OpenMls(error.to_string()))?;

        group
            .merge_pending_commit(&self.provider)
            .map_err(|error| PrivateDmRuntimeError::OpenMls(error.to_string()))?;

        Ok((
            welcome
                .to_bytes()
                .map_err(|error| PrivateDmRuntimeError::Codec(error.to_string()))?,
            group
                .export_ratchet_tree()
                .tls_serialize_detached()
                .map_err(|error| PrivateDmRuntimeError::Codec(error.to_string()))?,
        ))
    }

    pub fn join_welcome(
        &mut self,
        welcome_bytes: &[u8],
        tree_bytes: &[u8],
    ) -> Result<(), PrivateDmRuntimeError> {
        let welcome_message = MlsMessageIn::tls_deserialize(&mut &welcome_bytes[..])
            .map_err(|error| PrivateDmRuntimeError::Codec(error.to_string()))?;
        let welcome = match welcome_message.extract() {
            MlsMessageBodyIn::Welcome(welcome) => welcome,
            _ => return Err(PrivateDmRuntimeError::Codec("expected Welcome".to_string())),
        };
        let tree = RatchetTreeIn::tls_deserialize(&mut &tree_bytes[..])
            .map_err(|error| PrivateDmRuntimeError::Codec(error.to_string()))?;
        let group = StagedWelcome::new_from_welcome(
            &self.provider,
            &MlsGroupJoinConfig::default(),
            welcome,
            Some(tree),
        )
        .and_then(|staged| staged.into_group(&self.provider))
        .map_err(|error| PrivateDmRuntimeError::OpenMls(error.to_string()))?;

        self.group = Some(group);
        Ok(())
    }

    pub fn encrypt(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, PrivateDmRuntimeError> {
        let group = self.group.as_mut().ok_or(PrivateDmRuntimeError::NotReady)?;

        group
            .create_message(&self.provider, &self.signer, plaintext)
            .map_err(|error| PrivateDmRuntimeError::OpenMls(error.to_string()))?
            .to_bytes()
            .map_err(|error| PrivateDmRuntimeError::Codec(error.to_string()))
    }

    pub fn decrypt(&mut self, ciphertext: &[u8]) -> Result<Vec<u8>, PrivateDmRuntimeError> {
        let group = self.group.as_mut().ok_or(PrivateDmRuntimeError::NotReady)?;
        let message = MlsMessageIn::tls_deserialize(&mut &ciphertext[..])
            .map_err(|error| PrivateDmRuntimeError::Codec(error.to_string()))?;
        let protocol_message = message
            .try_into_protocol_message()
            .map_err(|error| PrivateDmRuntimeError::Codec(error.to_string()))?;
        let processed = group
            .process_message(&self.provider, protocol_message)
            .map_err(|error| PrivateDmRuntimeError::OpenMls(error.to_string()))?;

        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(message) => Ok(message.into_bytes()),
            _ => Err(PrivateDmRuntimeError::OpenMls(
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

    pub fn random_token(&self, prefix: &str) -> Result<String, PrivateDmRuntimeError> {
        let bytes = self
            .provider
            .rand()
            .random_array::<8>()
            .map_err(|error| PrivateDmRuntimeError::OpenMls(error.to_string()))?;
        let suffix = bytes
            .into_iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();

        Ok(format!("{prefix}-{suffix}"))
    }

    pub fn is_ready(&self) -> bool {
        self.group.is_some()
    }

    fn decode_key_package(&self, bytes: &[u8]) -> Result<KeyPackage, PrivateDmRuntimeError> {
        let message = MlsMessageIn::tls_deserialize(&mut &bytes[..])
            .map_err(|error| PrivateDmRuntimeError::Codec(error.to_string()))?;
        let key_package = match message.extract() {
            MlsMessageBodyIn::KeyPackage(key_package) => key_package,
            _ => {
                return Err(PrivateDmRuntimeError::Codec(
                    "expected KeyPackage".to_string(),
                ))
            }
        };

        key_package
            .validate(self.provider.crypto(), ProtocolVersion::default())
            .map_err(|error| PrivateDmRuntimeError::OpenMls(error.to_string()))
    }
}
