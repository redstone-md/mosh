use super::contracts::PrivateDmRuntimeError;

const INVITE_PREFIX: &str = "mosh://invite";

pub struct ParsedInvite {
    pub mesh_id: String,
    pub session_id: String,
    pub peer_address: String,
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
            peer_address: query(&url, "peer")?,
            fingerprint: url.fragment().unwrap_or_default().replace("fp=", ""),
        })
    }
}

pub fn build_invite_uri(mesh_id: &str, session_id: &str, port: u16, fingerprint: &str) -> String {
    format!(
        "{INVITE_PREFIX}?mesh={mesh_id}&session={session_id}&peer={}:{}#fp={fingerprint}",
        local_host(),
        port
    )
}

pub fn listen_address(port: u16) -> String {
    format!("{}:{}", local_host(), port)
}

fn query(url: &url::Url, key: &str) -> Result<String, PrivateDmRuntimeError> {
    url.query_pairs()
        .find(|(candidate, _)| candidate == key)
        .map(|(_, value)| value.into_owned())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| PrivateDmRuntimeError::InvalidInvite(format!("missing {key}")))
}

fn local_host() -> &'static str {
    "127.0.0.1"
}
