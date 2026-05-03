mod contracts;
mod invite;
mod mls_session;
mod wire;

use std::sync::Arc;

pub use contracts::{
    AcceptInviteRequest, ChatMessage, InviteCreated, PrivateDmRuntimeError, SendMessageResult,
    SessionSnapshot, StartSessionRequest,
};
use invite::{build_invite_uri, listen_address, ParsedInvite};
use mls_session::MlsSessionCrypto;
use wire::{
    decode, decode_json, encode, publish_json, ControlEnvelope, DataEnvelope, CONTROL_CHANNEL,
    DATA_CHANNEL,
};

use crate::adapters::moss_ffi::{
    drain_received_messages, MossFfiRuntime, MossNode, MossNodeConfig, MossReceivedMessage,
};

pub struct PrivateDmRuntime {
    moss: Arc<MossFfiRuntime>,
    session: Option<PrivateDmSession>,
}

struct PrivateDmSession {
    role: SessionRole,
    device_id: String,
    session_id: String,
    fingerprint: String,
    invite_uri: Option<String>,
    peer_joined: bool,
    node: MossNode,
    crypto: MlsSessionCrypto,
    messages: Vec<ChatMessage>,
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
            session: None,
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
        let fingerprint = crypto.fingerprint();
        let invite_uri = build_invite_uri(&mesh_id, &session_id, request.listen_port, &fingerprint);
        let node = start_node(
            &self.moss,
            &mesh_id,
            request.listen_port,
            request.static_peer,
        )?;

        self.session = Some(PrivateDmSession {
            role: SessionRole::Alice,
            device_id: request.display_name,
            session_id: session_id.clone(),
            fingerprint: fingerprint.clone(),
            invite_uri: Some(invite_uri.clone()),
            peer_joined: false,
            node,
            crypto,
            messages: Vec::new(),
        });

        Ok(InviteCreated {
            invite_uri,
            session_id,
            mesh_id,
            fingerprint,
            listen_address: listen_address(request.listen_port),
        })
    }

    pub fn accept_invite(
        &mut self,
        request: AcceptInviteRequest,
    ) -> Result<SessionSnapshot, PrivateDmRuntimeError> {
        let invite = ParsedInvite::parse(&request.invite_uri)?;
        let mut crypto = MlsSessionCrypto::new(&request.display_name)?;
        let key_package = crypto.key_package_bytes()?;
        let node = start_node(
            &self.moss,
            &invite.mesh_id,
            request.listen_port,
            Some(request.static_peer.unwrap_or(invite.peer_address)),
        )?;
        let envelope = ControlEnvelope::KeyPackage {
            session_id: invite.session_id.clone(),
            from_device: request.display_name.clone(),
            key_package_b64: encode(&key_package),
        };

        publish_json(&node, CONTROL_CHANNEL, &envelope)?;
        self.session = Some(PrivateDmSession {
            role: SessionRole::Bob,
            device_id: request.display_name,
            session_id: invite.session_id,
            fingerprint: invite.fingerprint,
            invite_uri: Some(request.invite_uri),
            peer_joined: false,
            node,
            crypto,
            messages: Vec::new(),
        });

        self.poll()
    }

    pub fn send_message(
        &mut self,
        body: String,
    ) -> Result<SendMessageResult, PrivateDmRuntimeError> {
        self.poll()?;
        let session = self
            .session
            .as_mut()
            .ok_or(PrivateDmRuntimeError::MissingSession)?;
        let ciphertext = session.crypto.encrypt(body.as_bytes())?;
        let envelope = DataEnvelope {
            session_id: session.session_id.clone(),
            from_device: session.device_id.clone(),
            ciphertext_b64: encode(&ciphertext),
        };

        publish_json(&session.node, DATA_CHANNEL, &envelope)?;
        session.messages.push(ChatMessage {
            from_device: session.device_id.clone(),
            body,
        });

        Ok(SendMessageResult {
            state: session.state(),
            ciphertext_bytes: ciphertext.len(),
        })
    }

    pub fn poll(&mut self) -> Result<SessionSnapshot, PrivateDmRuntimeError> {
        let mut messages = drain_received_messages();
        let session = self
            .session
            .as_mut()
            .ok_or(PrivateDmRuntimeError::MissingSession)?;

        for message in messages.drain(..) {
            session.handle_moss_message(message)?;
        }

        Ok(session.snapshot())
    }
}

impl PrivateDmSession {
    fn handle_moss_message(
        &mut self,
        message: MossReceivedMessage,
    ) -> Result<(), PrivateDmRuntimeError> {
        match message.channel.as_str() {
            CONTROL_CHANNEL => self.handle_control(message.payload),
            DATA_CHANNEL => self.handle_data(message.payload),
            _ => Ok(()),
        }
    }

    fn handle_control(&mut self, payload: Vec<u8>) -> Result<(), PrivateDmRuntimeError> {
        let envelope: ControlEnvelope = decode_json(&payload)?;

        match envelope {
            ControlEnvelope::KeyPackage {
                session_id,
                from_device,
                key_package_b64,
            } if self.is_alice_session(&session_id, &from_device) => {
                if self.peer_joined {
                    return Ok(());
                }
                let key_package = decode(&key_package_b64)?;
                let (welcome, tree) = self.crypto.add_peer(&key_package)?;
                self.peer_joined = true;
                let envelope = ControlEnvelope::Welcome {
                    session_id: self.session_id.clone(),
                    from_device: self.device_id.clone(),
                    welcome_b64: encode(&welcome),
                    ratchet_tree_b64: encode(&tree),
                };

                publish_json(&self.node, CONTROL_CHANNEL, &envelope)
            }
            ControlEnvelope::Welcome {
                session_id,
                from_device,
                welcome_b64,
                ratchet_tree_b64,
            } if self.is_bob_session(&session_id, &from_device) => {
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

        if envelope.session_id != self.session_id || envelope.from_device == self.device_id {
            return Ok(());
        }

        let plaintext = self.crypto.decrypt(&decode(&envelope.ciphertext_b64)?)?;
        self.messages.push(ChatMessage {
            from_device: envelope.from_device,
            body: String::from_utf8_lossy(&plaintext).into_owned(),
        });

        Ok(())
    }

    fn is_alice_session(&self, session_id: &str, from_device: &str) -> bool {
        matches!(self.role, SessionRole::Alice)
            && self.session_id == session_id
            && self.device_id != from_device
    }

    fn is_bob_session(&self, session_id: &str, from_device: &str) -> bool {
        matches!(self.role, SessionRole::Bob)
            && self.session_id == session_id
            && self.device_id != from_device
    }

    fn snapshot(&self) -> SessionSnapshot {
        SessionSnapshot {
            role: self.role.as_str().to_string(),
            state: self.state(),
            invite_uri: self.invite_uri.clone(),
            fingerprint: self.fingerprint.clone(),
            messages: self.messages.clone(),
        }
    }

    fn state(&self) -> String {
        if self.crypto.is_ready() {
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
    node.start()
        .map_err(|error| PrivateDmRuntimeError::Moss(error.to_string()))?;
    node.subscribe(CONTROL_CHANNEL)
        .map_err(|error| PrivateDmRuntimeError::Moss(error.to_string()))?;
    node.subscribe(DATA_CHANNEL)
        .map_err(|error| PrivateDmRuntimeError::Moss(error.to_string()))?;

    Ok(node)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::moss_ffi::MossFfiRuntime;

    #[test]
    fn private_dm_runtime_exchanges_e2ee_message_over_moss() {
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
            invite_uri: invite.invite_uri,
            display_name: "Bob".to_string(),
            listen_port: 42131,
            static_peer: Some(invite.listen_address),
        })
        .expect("Bob should accept invite");

        wait_until_ready(&mut alice, &mut bob);
        alice
            .send_message("hello bob".to_string())
            .expect("Alice should send");

        let snapshot = wait_for_message(&mut bob, "hello bob");
        assert_eq!(snapshot.state, "ready");
    }

    fn wait_until_ready(alice: &mut PrivateDmRuntime, bob: &mut PrivateDmRuntime) {
        for _ in 0..30 {
            let alice_ready = alice.poll().expect("Alice poll should pass").state == "ready";
            let bob_ready = bob.poll().expect("Bob poll should pass").state == "ready";
            if alice_ready && bob_ready {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        panic!("sessions did not become ready");
    }

    fn wait_for_message(runtime: &mut PrivateDmRuntime, body: &str) -> SessionSnapshot {
        for _ in 0..30 {
            let snapshot = runtime.poll().expect("poll should pass");
            if snapshot.messages.iter().any(|message| message.body == body) {
                return snapshot;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        panic!("message did not arrive");
    }
}
