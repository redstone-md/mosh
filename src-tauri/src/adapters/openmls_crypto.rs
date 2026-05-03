use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_traits::types::SignatureScheme;

const CIPHERSUITE_NAME: &str = "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519";
const TEST_IDENTITY: &[u8] = b"mosh-device";
const TEST_MESSAGE: &[u8] = b"mosh-openmls-smoke";

pub trait PrivateMessageCrypto {
    fn smoke_test(&self) -> Result<OpenMlsSmokeStatus, OpenMlsAdapterError>;
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct OpenMlsSmokeStatus {
    pub provider: &'static str,
    pub ciphersuite: &'static str,
    pub protected_message_created: bool,
}

#[derive(Debug)]
pub enum OpenMlsAdapterError {
    SignatureKey(String),
    Storage(String),
    Group(String),
    Message(String),
}

impl std::fmt::Display for OpenMlsAdapterError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SignatureKey(error) => write!(formatter, "signature key error: {error}"),
            Self::Storage(error) => write!(formatter, "OpenMLS storage error: {error}"),
            Self::Group(error) => write!(formatter, "MLS group error: {error}"),
            Self::Message(error) => write!(formatter, "MLS message error: {error}"),
        }
    }
}

impl std::error::Error for OpenMlsAdapterError {}

pub struct OpenMlsPrivateMessageCrypto;

impl PrivateMessageCrypto for OpenMlsPrivateMessageCrypto {
    fn smoke_test(&self) -> Result<OpenMlsSmokeStatus, OpenMlsAdapterError> {
        let provider = OpenMlsRustCrypto::default();
        let signer = SignatureKeyPair::new(SignatureScheme::ED25519)
            .map_err(|error| OpenMlsAdapterError::SignatureKey(error.to_string()))?;

        signer
            .store(provider.storage())
            .map_err(|error| OpenMlsAdapterError::Storage(error.to_string()))?;

        let credential = BasicCredential::new(TEST_IDENTITY.to_vec());
        let credential_with_key = CredentialWithKey {
            credential: credential.into(),
            signature_key: signer.to_public_vec().into(),
        };

        let config = MlsGroupCreateConfig::builder()
            .ciphersuite(Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519)
            .use_ratchet_tree_extension(true)
            .build();

        let mut group = MlsGroup::new(&provider, &signer, &config, credential_with_key)
            .map_err(|error| OpenMlsAdapterError::Group(error.to_string()))?;

        let protected_message = group
            .create_message(&provider, &signer, TEST_MESSAGE)
            .map_err(|error| OpenMlsAdapterError::Message(error.to_string()))?;

        Ok(OpenMlsSmokeStatus {
            provider: "openmls_rust_crypto",
            ciphersuite: CIPHERSUITE_NAME,
            protected_message_created: matches!(
                protected_message.body(),
                MlsMessageBodyOut::PrivateMessage(_)
            ),
        })
    }
}

pub fn run_openmls_smoke_test() -> Result<OpenMlsSmokeStatus, OpenMlsAdapterError> {
    OpenMlsPrivateMessageCrypto.smoke_test()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openmls_creates_private_application_message() {
        let status = run_openmls_smoke_test().expect("OpenMLS smoke test should pass");

        assert_eq!(status.provider, "openmls_rust_crypto");
        assert_eq!(status.ciphersuite, CIPHERSUITE_NAME);
        assert!(status.protected_message_created);
    }
}
