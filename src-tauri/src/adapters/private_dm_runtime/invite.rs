use super::contracts::PrivateDmRuntimeError;

const INVITE_PREFIX: &str = "mosh://invite";
const TRACKER_BOOTSTRAP: &str = "default-public-trackers";
/// `crypto.fingerprint()` is 16 bytes → 32 hex chars.
const FINGERPRINT_HEX_LEN: usize = 32;

pub struct ParsedInvite {
    pub mesh_id: String,
    pub session_id: String,
    pub peer_address: Option<String>,
    pub fingerprint: String,
}

impl ParsedInvite {
    pub fn parse(raw: &str) -> Result<Self, PrivateDmRuntimeError> {
        let url = url::Url::parse(raw)
            .map_err(|error| PrivateDmRuntimeError::InvalidInvite(error.to_string()))?;

        if url.scheme() != "mosh" || url.host_str() != Some("invite") {
            return Err(PrivateDmRuntimeError::InvalidInvite(
                "wrong scheme".to_string(),
            ));
        }

        Ok(Self {
            mesh_id: query(&url, "mesh")?,
            session_id: query(&url, "session")?,
            peer_address: optional_query(&url, "peer"),
            fingerprint: parse_fingerprint(url.fragment())?,
        })
    }
}

/// Extracts and validates the peer fingerprint from the URL fragment. Requires
/// an anchored `fp=` key (a bare `#hex` is rejected) and a 32-char hex value —
/// the fingerprint is the identity check, so a malformed invite must fail.
fn parse_fingerprint(fragment: Option<&str>) -> Result<String, PrivateDmRuntimeError> {
    let raw = fragment
        .and_then(|frag| frag.strip_prefix("fp="))
        .ok_or_else(|| PrivateDmRuntimeError::InvalidInvite("missing fingerprint".to_string()))?;
    let normalized = raw.replace('-', "").to_uppercase();
    if normalized.len() != FINGERPRINT_HEX_LEN
        || !normalized.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(PrivateDmRuntimeError::InvalidInvite(
            "invalid fingerprint".to_string(),
        ));
    }
    Ok(normalized)
}

pub fn build_invite_uri(mesh_id: &str, session_id: &str, fingerprint: &str) -> String {
    format!("{INVITE_PREFIX}?mesh={mesh_id}&session={session_id}#fp={fingerprint}")
}

pub fn listen_address() -> String {
    TRACKER_BOOTSTRAP.to_string()
}

fn query(url: &url::Url, key: &str) -> Result<String, PrivateDmRuntimeError> {
    optional_query(url, key)
        .ok_or_else(|| PrivateDmRuntimeError::InvalidInvite(format!("missing {key}")))
}

fn optional_query(url: &url::Url, key: &str) -> Option<String> {
    url.query_pairs()
        .find(|(candidate, _)| candidate == key)
        .map(|(_, value)| value.into_owned())
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    const FP: &str = "AABBCCDDEEFF00112233445566778899"; // 32 hex

    #[test]
    fn parse_accepts_a_valid_invite_and_normalizes_the_fingerprint() {
        let uri = build_invite_uri("mesh-1", "sess-1", FP);
        let parsed = ParsedInvite::parse(&uri).expect("valid invite parses");
        assert_eq!(parsed.mesh_id, "mesh-1");
        assert_eq!(parsed.session_id, "sess-1");
        assert_eq!(parsed.fingerprint, FP);
    }

    #[test]
    fn parse_rejects_a_fragment_without_the_fp_prefix() {
        // A bare hash with no `fp=` key must not be accepted as a fingerprint.
        let uri = format!("mosh://invite?mesh=m&session=s#{FP}");
        assert!(ParsedInvite::parse(&uri).is_err());
    }

    #[test]
    fn parse_rejects_a_malformed_fingerprint() {
        let short = "mosh://invite?mesh=m&session=s#fp=AABB";
        assert!(ParsedInvite::parse(short).is_err());
        let nonhex = "mosh://invite?mesh=m&session=s#fp=ZZBBCCDDEEFF00112233445566778899";
        assert!(ParsedInvite::parse(nonhex).is_err());
    }
}
