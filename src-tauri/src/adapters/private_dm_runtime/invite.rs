use super::contracts::PrivateDmRuntimeError;

const INVITE_PREFIX: &str = "mosh://invite";
const TRACKER_BOOTSTRAP: &str = "default-public-trackers";

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
            fingerprint: url.fragment().unwrap_or_default().replace("fp=", ""),
        })
    }
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
