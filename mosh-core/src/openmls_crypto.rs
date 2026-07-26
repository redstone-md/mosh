use openmls::prelude::tls_codec::Deserialize;
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_traits::types::SignatureScheme;

const CIPHERSUITE_NAME: &str = "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519";
const TEST_IDENTITY: &[u8] = b"mosh-device";
const ALICE_IDENTITY: &[u8] = b"mosh-alice-device";
const BOB_IDENTITY: &[u8] = b"mosh-bob-device";
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

#[derive(Debug, Clone, serde::Serialize)]
pub struct OpenMlsRoundTripStatus {
    pub provider: &'static str,
    pub ciphersuite: &'static str,
    pub welcome_joined: bool,
    pub plaintext_roundtrip: bool,
}

#[derive(Debug)]
pub enum OpenMlsAdapterError {
    SignatureKey(String),
    Storage(String),
    Group(String),
    Message(String),
    Welcome(String),
    Codec(String),
}

impl std::fmt::Display for OpenMlsAdapterError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SignatureKey(error) => write!(formatter, "signature key error: {error}"),
            Self::Storage(error) => write!(formatter, "OpenMLS storage error: {error}"),
            Self::Group(error) => write!(formatter, "MLS group error: {error}"),
            Self::Message(error) => write!(formatter, "MLS message error: {error}"),
            Self::Welcome(error) => write!(formatter, "MLS welcome error: {error}"),
            Self::Codec(error) => write!(formatter, "MLS codec error: {error}"),
        }
    }
}

impl std::error::Error for OpenMlsAdapterError {}

pub struct OpenMlsPrivateMessageCrypto;

struct MlsDevice {
    provider: OpenMlsRustCrypto,
    signer: SignatureKeyPair,
    credential: CredentialWithKey,
}

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

pub fn run_openmls_alice_bob_roundtrip() -> Result<OpenMlsRoundTripStatus, OpenMlsAdapterError> {
    let alice = create_device(ALICE_IDENTITY)?;
    let bob = create_device(BOB_IDENTITY)?;
    let bob_key_package = create_key_package(&bob)?;
    let group_config = MlsGroupCreateConfig::builder()
        .ciphersuite(Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519)
        .use_ratchet_tree_extension(true)
        .build();

    let mut alice_group = MlsGroup::new(
        &alice.provider,
        &alice.signer,
        &group_config,
        alice.credential,
    )
    .map_err(|error| OpenMlsAdapterError::Group(error.to_string()))?;

    let (_, welcome_out, _) = alice_group
        .add_members(
            &alice.provider,
            &alice.signer,
            core::slice::from_ref(bob_key_package.key_package()),
        )
        .map_err(|error| OpenMlsAdapterError::Group(error.to_string()))?;

    alice_group
        .merge_pending_commit(&alice.provider)
        .map_err(|error| OpenMlsAdapterError::Group(error.to_string()))?;

    let mut bob_group = join_from_welcome(&bob.provider, welcome_out, &alice_group)?;
    let encrypted = alice_group
        .create_message(&alice.provider, &alice.signer, TEST_MESSAGE)
        .map_err(|error| OpenMlsAdapterError::Message(error.to_string()))?;
    let plaintext = decrypt_application_message(&bob.provider, &mut bob_group, encrypted)?;

    Ok(OpenMlsRoundTripStatus {
        provider: "openmls_rust_crypto",
        ciphersuite: CIPHERSUITE_NAME,
        welcome_joined: alice_group.export_ratchet_tree() == bob_group.export_ratchet_tree(),
        plaintext_roundtrip: plaintext == TEST_MESSAGE,
    })
}

pub fn run_openmls_smoke_test() -> Result<OpenMlsSmokeStatus, OpenMlsAdapterError> {
    OpenMlsPrivateMessageCrypto.smoke_test()
}

fn create_device(identity: &[u8]) -> Result<MlsDevice, OpenMlsAdapterError> {
    let provider = OpenMlsRustCrypto::default();
    let signer = SignatureKeyPair::new(SignatureScheme::ED25519)
        .map_err(|error| OpenMlsAdapterError::SignatureKey(error.to_string()))?;

    signer
        .store(provider.storage())
        .map_err(|error| OpenMlsAdapterError::Storage(error.to_string()))?;

    let credential = BasicCredential::new(identity.to_vec());
    let signature_key = signer.to_public_vec().into();

    Ok(MlsDevice {
        provider,
        signer,
        credential: CredentialWithKey {
            credential: credential.into(),
            signature_key,
        },
    })
}

fn create_key_package(device: &MlsDevice) -> Result<KeyPackageBundle, OpenMlsAdapterError> {
    KeyPackage::builder()
        .build(
            Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519,
            &device.provider,
            &device.signer,
            device.credential.clone(),
        )
        .map_err(|error| OpenMlsAdapterError::Group(error.to_string()))
}

fn join_from_welcome(
    provider: &OpenMlsRustCrypto,
    welcome_out: MlsMessageOut,
    alice_group: &MlsGroup,
) -> Result<MlsGroup, OpenMlsAdapterError> {
    let serialized = welcome_out
        .to_bytes()
        .map_err(|error| OpenMlsAdapterError::Codec(error.to_string()))?;
    let welcome_in = MlsMessageIn::tls_deserialize(&mut serialized.as_slice())
        .map_err(|error| OpenMlsAdapterError::Codec(error.to_string()))?;
    let welcome = match welcome_in.extract() {
        MlsMessageBodyIn::Welcome(welcome) => welcome,
        _ => {
            return Err(OpenMlsAdapterError::Welcome(
                "missing Welcome body".to_string(),
            ))
        }
    };

    StagedWelcome::new_from_welcome(
        provider,
        &MlsGroupJoinConfig::default(),
        welcome,
        Some(alice_group.export_ratchet_tree().into()),
    )
    .and_then(|staged| staged.into_group(provider))
    .map_err(|error| OpenMlsAdapterError::Welcome(error.to_string()))
}

fn decrypt_application_message(
    provider: &OpenMlsRustCrypto,
    group: &mut MlsGroup,
    message: MlsMessageOut,
) -> Result<Vec<u8>, OpenMlsAdapterError> {
    let serialized = message
        .to_bytes()
        .map_err(|error| OpenMlsAdapterError::Codec(error.to_string()))?;
    let message_in = MlsMessageIn::tls_deserialize(&mut serialized.as_slice())
        .map_err(|error| OpenMlsAdapterError::Codec(error.to_string()))?;
    let protocol_message = message_in
        .try_into_protocol_message()
        .map_err(|error| OpenMlsAdapterError::Codec(error.to_string()))?;
    let processed = group
        .process_message(provider, protocol_message)
        .map_err(|error| OpenMlsAdapterError::Message(error.to_string()))?;

    match processed.into_content() {
        ProcessedMessageContent::ApplicationMessage(message) => Ok(message.into_bytes()),
        _ => Err(OpenMlsAdapterError::Message(
            "expected application message".to_string(),
        )),
    }
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

    #[test]
    fn openmls_alice_bob_welcome_join_decrypts_message() {
        let status =
            run_openmls_alice_bob_roundtrip().expect("OpenMLS Alice/Bob roundtrip should pass");

        assert_eq!(status.provider, "openmls_rust_crypto");
        assert_eq!(status.ciphersuite, CIPHERSUITE_NAME);
        assert!(status.welcome_joined);
        assert!(status.plaintext_roundtrip);
    }
}
