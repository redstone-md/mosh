use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};

const DOMAIN: &[u8] = b"mosh-org-v1";

#[derive(Debug, Clone, Copy)]
pub struct OrgContext<'a> {
    pub org_pubkey: &'a str,
    pub mesh_id: &'a str,
    pub channel_kind: &'a str,
}

/// App-level sender authentication over the unauthenticated gossip path
/// (ADR 0007). The moss node key signs; its public key IS the peer-id.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrgSigned {
    pub payload: Vec<u8>,
    pub peer_id: String,
    pub sig: Vec<u8>,
}

#[derive(Debug)]
pub enum EnvelopeError {
    BadPeerId,
    BadSignature,
}

impl std::fmt::Display for EnvelopeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadPeerId => write!(f, "envelope peer_id is not a valid ed25519 key"),
            Self::BadSignature => write!(f, "envelope signature invalid for context"),
        }
    }
}

impl std::error::Error for EnvelopeError {}

fn signing_input(ctx: &OrgContext, payload: &[u8]) -> Vec<u8> {
    let parts: [&[u8]; 4] = [
        ctx.org_pubkey.as_bytes(),
        ctx.mesh_id.as_bytes(),
        ctx.channel_kind.as_bytes(),
        payload,
    ];
    let mut out =
        Vec::with_capacity(DOMAIN.len() + parts.iter().map(|p| 8 + p.len()).sum::<usize>());
    out.extend_from_slice(DOMAIN);
    for part in parts {
        // u64 keeps the length prefix injective even for absurd field sizes.
        out.extend_from_slice(&(part.len() as u64).to_le_bytes());
        out.extend_from_slice(part);
    }
    out
}

pub fn sign(key: &SigningKey, ctx: &OrgContext, payload: &[u8]) -> OrgSigned {
    let sig = key.sign(&signing_input(ctx, payload));
    OrgSigned {
        payload: payload.to_vec(),
        peer_id: hex::encode(key.verifying_key().to_bytes()),
        sig: sig.to_bytes().to_vec(),
    }
}

pub fn verify(env: &OrgSigned, ctx: &OrgContext) -> Result<(), EnvelopeError> {
    let key_bytes: [u8; 32] = hex::decode(&env.peer_id)
        .ok()
        .and_then(|b| b.try_into().ok())
        .ok_or(EnvelopeError::BadPeerId)?;
    let key = VerifyingKey::from_bytes(&key_bytes).map_err(|_| EnvelopeError::BadPeerId)?;
    let sig = Signature::from_slice(&env.sig).map_err(|_| EnvelopeError::BadSignature)?;
    // verify_strict rejects small-order/non-canonical keys and signatures.
    // The peer-id IS the identity here: a weak key registered as a peer-id
    // would otherwise let anyone forge envelopes in that member's name.
    key.verify_strict(&signing_input(ctx, &env.payload), &sig)
        .map_err(|_| EnvelopeError::BadSignature)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;

    fn key() -> SigningKey {
        SigningKey::from_bytes(&[3u8; 32])
    }

    fn ctx<'a>() -> OrgContext<'a> {
        OrgContext {
            org_pubkey: "aa11",
            mesh_id: "org/acme-mesh",
            channel_kind: "org-control",
        }
    }

    #[test]
    fn sign_verify_roundtrip() {
        let env = sign(&key(), &ctx(), b"hello");
        assert_eq!(env.peer_id, hex::encode(key().verifying_key().to_bytes()));
        assert!(verify(&env, &ctx()).is_ok());
    }

    #[test]
    fn tampered_payload_fails() {
        let mut env = sign(&key(), &ctx(), b"hello");
        env.payload = b"hijack".to_vec();
        assert!(verify(&env, &ctx()).is_err());
    }

    #[test]
    fn claimed_peer_id_must_match_signer() {
        let mut env = sign(&key(), &ctx(), b"hello");
        env.peer_id = hex::encode(
            SigningKey::from_bytes(&[4u8; 32])
                .verifying_key()
                .to_bytes(),
        );
        assert!(verify(&env, &ctx()).is_err());
    }

    #[test]
    fn cross_org_replay_fails() {
        let env = sign(&key(), &ctx(), b"join me");
        let other_org = OrgContext {
            org_pubkey: "bb22",
            ..ctx()
        };
        assert!(verify(&env, &other_org).is_err());
        let other_mesh = OrgContext {
            mesh_id: "org/evil-mesh",
            ..ctx()
        };
        assert!(verify(&env, &other_mesh).is_err());
        let other_channel = OrgContext {
            channel_kind: "org-blob",
            ..ctx()
        };
        assert!(verify(&env, &other_channel).is_err());
    }

    #[test]
    fn field_boundary_shift_fails() {
        // ("ab", "c") and ("a", "bc") must not produce the same signing input.
        let a = sign(
            &key(),
            &OrgContext {
                org_pubkey: "ab",
                mesh_id: "c",
                channel_kind: "k",
            },
            b"p",
        );
        let shifted = OrgContext {
            org_pubkey: "a",
            mesh_id: "bc",
            channel_kind: "k",
        };
        assert!(verify(&a, &shifted).is_err());
    }
}
