mod contracts;
mod invite;
mod wire;

use std::collections::HashMap;
use std::sync::Arc;

pub use contracts::{
    AcceptInviteRequest, ChatMessage, CloseSessionResult, InviteCreated, MeshInfo,
    PrivateDmRuntimeError, SendMessageResult, SessionListSnapshot, SessionSnapshot, SnapshotEvent,
    StartSessionRequest,
};
use invite::{build_invite_uri, listen_address, ParsedInvite};
use crate::adapters::mls_crypto::MlsSessionCrypto;
use wire::{
    channel_session_id, control_channel, data_channel, decode, decode_json, encode, publish_json,
    ControlEnvelope, DataEnvelope,
};

use crate::adapters::moss_ffi::{
    clear_event_log, drain_messages_where, snapshot_event_log, MossFfiRuntime, MossNode,
    MossNodeConfig, MossReceivedMessage,
};

pub struct PrivateDmRuntime {
    moss: Arc<MossFfiRuntime>,
    sessions: HashMap<String, PrivateDmSession>,
}

struct PrivateDmSession {
    role: SessionRole,
    device_id: String,
    participant_id: String,
    session_id: String,
    mesh_id: String,
    fingerprint: String,
    invite_uri: Option<String>,
    peer_joined: bool,
    node: MossNode,
    crypto: MlsSessionCrypto,
    messages: Vec<ChatMessage>,
    seen_moss_messages: Vec<String>,
    control_channel: String,
    data_channel: String,
}

#[derive(Clone, Copy)]
enum SessionRole {
    Alice,
    Bob,
}

impl PrivateDmRuntime {
    pub fn new(moss: MossFfiRuntime) -> Self {
        Self::from_shared(Arc::new(moss))
    }

    pub fn from_shared(moss: Arc<MossFfiRuntime>) -> Self {
        Self {
            moss,
            sessions: HashMap::new(),
        }
    }

    pub fn create_invite(
        &mut self,
        request: StartSessionRequest,
    ) -> Result<InviteCreated, PrivateDmRuntimeError> {
        let mut crypto = MlsSessionCrypto::new(&request.display_name)?;
        crypto.create_group()?;
        let session_id = crypto.random_token("session")?;
        let mesh_id = crypto.random_token("mesh")?;
        let participant_id = crypto.random_token("participant")?;
        let fingerprint = crypto.fingerprint();
        let invite_uri = build_invite_uri(&mesh_id, &session_id, &fingerprint);
        let node = start_node(
            &self.moss,
            &mesh_id,
            &session_id,
            request.listen_port,
            request.static_peer,
        )?;

        let session = PrivateDmSession::new(
            SessionRole::Alice,
            request.display_name,
            participant_id,
            session_id.clone(),
            mesh_id.clone(),
            fingerprint.clone(),
            Some(invite_uri.clone()),
            node,
            crypto,
        );

        self.sessions.insert(session_id.clone(), session);

        Ok(InviteCreated {
            invite_uri,
            session_id,
            mesh_id,
            fingerprint,
            listen_address: listen_address(),
        })
    }

    pub fn accept_invite(
        &mut self,
        request: AcceptInviteRequest,
    ) -> Result<SessionSnapshot, PrivateDmRuntimeError> {
        let invite = ParsedInvite::parse(&request.invite_uri)?;
        if self.sessions.contains_key(&invite.session_id) {
            return Err(PrivateDmRuntimeError::DuplicateSession(invite.session_id));
        }
        let mut crypto = MlsSessionCrypto::new(&request.display_name)?;
        let participant_id = crypto.random_token("participant")?;
        let key_package = crypto.key_package_bytes()?;
        let node = start_node(
            &self.moss,
            &invite.mesh_id,
            &invite.session_id,
            request.listen_port,
            request.static_peer.or(invite.peer_address),
        )?;
        let envelope = ControlEnvelope::KeyPackage {
            session_id: invite.session_id.clone(),
            participant_id: participant_id.clone(),
            from_device: request.display_name.clone(),
            key_package_b64: encode(&key_package),
        };

        publish_json(&node, &control_channel(&invite.session_id), &envelope)?;

        let session = PrivateDmSession::new(
            SessionRole::Bob,
            request.display_name,
            participant_id,
            invite.session_id.clone(),
            invite.mesh_id,
            invite.fingerprint,
            Some(request.invite_uri),
            node,
            crypto,
        );

        let session_id = session.session_id.clone();
        self.sessions.insert(session_id.clone(), session);
        self.poll_session(&session_id)
    }

    pub fn send_message(
        &mut self,
        session_id: &str,
        body: String,
    ) -> Result<SendMessageResult, PrivateDmRuntimeError> {
        self.drain_inbound()?;
        let session = self.session_mut(session_id)?;
        let ciphertext = session.crypto.encrypt(body.as_bytes())?;
        let envelope = DataEnvelope {
            session_id: session.session_id.clone(),
            participant_id: session.participant_id.clone(),
            from_device: session.device_id.clone(),
            ciphertext_b64: encode(&ciphertext),
        };

        publish_json(&session.node, &session.data_channel, &envelope)?;
        session.messages.push(ChatMessage {
            from_device: session.device_id.clone(),
            body,
        });

        Ok(SendMessageResult {
            session_id: session.session_id.clone(),
            state: session.state(),
            ciphertext_bytes: ciphertext.len(),
        })
    }

    pub fn poll_session(
        &mut self,
        session_id: &str,
    ) -> Result<SessionSnapshot, PrivateDmRuntimeError> {
        self.drain_inbound()?;
        let session = self.session_ref(session_id)?;
        Ok(session.snapshot())
    }

    pub fn list_sessions(&mut self) -> Result<SessionListSnapshot, PrivateDmRuntimeError> {
        self.drain_inbound()?;
        let mut snapshots: Vec<SessionSnapshot> = self
            .sessions
            .values()
            .map(PrivateDmSession::snapshot)
            .collect();
        snapshots.sort_by(|a, b| a.session_id.cmp(&b.session_id));
        Ok(SessionListSnapshot { sessions: snapshots })
    }

    pub fn close_session(
        &mut self,
        session_id: &str,
    ) -> Result<CloseSessionResult, PrivateDmRuntimeError> {
        match self.sessions.remove(session_id) {
            Some(_) => Ok(CloseSessionResult {
                session_id: session_id.to_string(),
                closed: true,
            }),
            None => Err(PrivateDmRuntimeError::MissingSession),
        }
    }

    fn drain_inbound(&mut self) -> Result<(), PrivateDmRuntimeError> {
        let inbound =
            drain_messages_where(|message| channel_session_id(&message.channel).is_some());
        for message in inbound {
            let session_id = match channel_session_id(&message.channel) {
                Some(sid) => sid.to_string(),
                None => continue,
            };
            if let Some(session) = self.sessions.get_mut(&session_id) {
                session.handle_moss_message(message)?;
            }
        }
        Ok(())
    }

    fn session_mut(
        &mut self,
        session_id: &str,
    ) -> Result<&mut PrivateDmSession, PrivateDmRuntimeError> {
        self.sessions
            .get_mut(session_id)
            .ok_or(PrivateDmRuntimeError::MissingSession)
    }

    fn session_ref(
        &self,
        session_id: &str,
    ) -> Result<&PrivateDmSession, PrivateDmRuntimeError> {
        self.sessions
            .get(session_id)
            .ok_or(PrivateDmRuntimeError::MissingSession)
    }
}

impl PrivateDmSession {
    fn new(
        role: SessionRole,
        device_id: String,
        participant_id: String,
        session_id: String,
        mesh_id: String,
        fingerprint: String,
        invite_uri: Option<String>,
        node: MossNode,
        crypto: MlsSessionCrypto,
    ) -> Self {
        let control_channel = control_channel(&session_id);
        let data_channel = data_channel(&session_id);
        Self {
            role,
            device_id,
            participant_id,
            session_id,
            mesh_id,
            fingerprint,
            invite_uri,
            peer_joined: false,
            node,
            crypto,
            messages: Vec::new(),
            seen_moss_messages: Vec::new(),
            control_channel,
            data_channel,
        }
    }

    fn handle_moss_message(
        &mut self,
        message: MossReceivedMessage,
    ) -> Result<(), PrivateDmRuntimeError> {
        if self.has_seen_message(&message) {
            return Ok(());
        }
        if message.channel == self.control_channel {
            self.handle_control(message.payload)
        } else if message.channel == self.data_channel {
            self.handle_data(message.payload)
        } else {
            Ok(())
        }
    }

    fn has_seen_message(&mut self, message: &MossReceivedMessage) -> bool {
        let key = format!("{}:{}", message.channel, encode(&message.payload));

        if self.seen_moss_messages.contains(&key) {
            return true;
        }

        self.seen_moss_messages.push(key);
        false
    }

    fn handle_control(&mut self, payload: Vec<u8>) -> Result<(), PrivateDmRuntimeError> {
        let envelope: ControlEnvelope = decode_json(&payload)?;

        match envelope {
            ControlEnvelope::KeyPackage {
                session_id,
                participant_id,
                key_package_b64,
                ..
            } if self.is_alice_session(&session_id, &participant_id) => {
                if self.peer_joined {
                    return Ok(());
                }
                let key_package = decode(&key_package_b64)?;
                let (welcome, tree) = self.crypto.add_peer(&key_package)?;
                self.peer_joined = true;
                let envelope = ControlEnvelope::Welcome {
                    session_id: self.session_id.clone(),
                    participant_id: self.participant_id.clone(),
                    from_device: self.device_id.clone(),
                    welcome_b64: encode(&welcome),
                    ratchet_tree_b64: encode(&tree),
                };

                publish_json(&self.node, &self.control_channel, &envelope)
            }
            ControlEnvelope::Welcome {
                session_id,
                participant_id,
                welcome_b64,
                ratchet_tree_b64,
                ..
            } if self.is_bob_session(&session_id, &participant_id) => {
                if self.peer_joined {
                    return Ok(());
                }
                self.crypto
                    .join_welcome(&decode(&welcome_b64)?, &decode(&ratchet_tree_b64)?)?;
                self.peer_joined = true;
                Ok(())
            }
            _ => Ok(()),
        }
    }

    fn handle_data(&mut self, payload: Vec<u8>) -> Result<(), PrivateDmRuntimeError> {
        let envelope: DataEnvelope = decode_json(&payload)?;

        if envelope.session_id != self.session_id
            || envelope.participant_id == self.participant_id
        {
            return Ok(());
        }

        let plaintext = self.crypto.decrypt(&decode(&envelope.ciphertext_b64)?)?;
        self.messages.push(ChatMessage {
            from_device: envelope.from_device,
            body: String::from_utf8_lossy(&plaintext).into_owned(),
        });

        Ok(())
    }

    fn is_alice_session(&self, session_id: &str, participant_id: &str) -> bool {
        matches!(self.role, SessionRole::Alice)
            && self.session_id == session_id
            && self.participant_id != participant_id
    }

    fn is_bob_session(&self, session_id: &str, participant_id: &str) -> bool {
        matches!(self.role, SessionRole::Bob)
            && self.session_id == session_id
            && self.participant_id != participant_id
    }

    fn snapshot(&self) -> SessionSnapshot {
        SessionSnapshot {
            session_id: self.session_id.clone(),
            mesh_id: self.mesh_id.clone(),
            role: self.role.as_str().to_string(),
            display_name: self.device_id.clone(),
            state: self.state(),
            invite_uri: self.invite_uri.clone(),
            fingerprint: self.fingerprint.clone(),
            messages: self.messages.clone(),
            mesh: self.mesh_info(),
            events: snapshot_event_log()
                .into_iter()
                .map(|event| SnapshotEvent {
                    event_type: event.event_type,
                    event_name: SnapshotEvent::name_for(event.event_type).to_string(),
                    detail_json: event.detail_json,
                    epoch_millis: event.epoch_millis,
                })
                .collect(),
        }
    }

    fn mesh_info(&self) -> Option<MeshInfo> {
        let raw = self.node.mesh_info_json()?;
        let mut info: MeshInfo = serde_json::from_str(&raw).ok()?;
        if info.nat_type.is_empty() {
            if let Some(nat) = self.node.nat_type() {
                info.nat_type = nat;
            }
        }
        Some(info)
    }

    fn state(&self) -> String {
        if self.peer_joined && self.crypto.is_ready() {
            "ready".to_string()
        } else {
            "waiting".to_string()
        }
    }
}

impl SessionRole {
    fn as_str(self) -> &'static str {
        match self {
            SessionRole::Alice => "alice",
            SessionRole::Bob => "bob",
        }
    }
}

fn start_node(
    runtime: &Arc<MossFfiRuntime>,
    mesh_id: &str,
    session_id: &str,
    listen_port: u16,
    static_peer: Option<String>,
) -> Result<MossNode, PrivateDmRuntimeError> {
    let node = runtime
        .init_default_node(
            mesh_id,
            &MossNodeConfig {
                listen_port,
                static_peer,
            },
        )
        .map_err(|error| PrivateDmRuntimeError::Moss(error.to_string()))?;

    node.set_message_callback()
        .map_err(|error| PrivateDmRuntimeError::Moss(error.to_string()))?;
    node.set_event_callback()
        .map_err(|error| PrivateDmRuntimeError::Moss(error.to_string()))?;
    clear_event_log();
    node.start()
        .map_err(|error| PrivateDmRuntimeError::Moss(error.to_string()))?;
    node.subscribe(&control_channel(session_id))
        .map_err(|error| PrivateDmRuntimeError::Moss(error.to_string()))?;
    node.subscribe(&data_channel(session_id))
        .map_err(|error| PrivateDmRuntimeError::Moss(error.to_string()))?;

    Ok(node)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::moss_ffi::{drain_received_messages, MossFfiRuntime, MOSS_TEST_LOCK};

    #[test]
    fn private_dm_runtime_exchanges_e2ee_message_over_moss() {
        let _guard = MOSS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        drain_received_messages();
        let runtime = Arc::new(MossFfiRuntime::load_default().expect("Moss runtime should load"));
        let mut alice = PrivateDmRuntime::from_shared(Arc::clone(&runtime));
        let invite = alice
            .create_invite(StartSessionRequest {
                display_name: "Alice".to_string(),
                listen_port: 42130,
                static_peer: None,
            })
            .expect("Alice invite should be created");

        let mut bob = PrivateDmRuntime::from_shared(runtime);
        bob.accept_invite(AcceptInviteRequest {
            invite_uri: invite.invite_uri.clone(),
            display_name: "Bob".to_string(),
            listen_port: 42131,
            static_peer: Some("127.0.0.1:42130".to_string()),
        })
        .expect("Bob should accept invite");

        wait_until_ready(&mut alice, &mut bob, &invite.session_id);
        alice
            .send_message(&invite.session_id, "hello bob".to_string())
            .expect("Alice should send");

        let snapshot = wait_for_message(&mut bob, &invite.session_id, "hello bob");
        assert_eq!(snapshot.state, "ready");
    }

    fn wait_until_ready(
        alice: &mut PrivateDmRuntime,
        bob: &mut PrivateDmRuntime,
        session_id: &str,
    ) {
        for _ in 0..80 {
            let alice_ready = alice
                .poll_session(session_id)
                .expect("Alice poll should pass")
                .state
                == "ready";
            let bob_ready = bob
                .poll_session(session_id)
                .expect("Bob poll should pass")
                .state
                == "ready";
            if alice_ready && bob_ready {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        panic!("sessions did not become ready");
    }

    fn wait_for_message(
        runtime: &mut PrivateDmRuntime,
        session_id: &str,
        body: &str,
    ) -> SessionSnapshot {
        for _ in 0..30 {
            let snapshot = runtime.poll_session(session_id).expect("poll should pass");
            if snapshot.messages.iter().any(|message| message.body == body) {
                return snapshot;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        panic!("message did not arrive");
    }
}
