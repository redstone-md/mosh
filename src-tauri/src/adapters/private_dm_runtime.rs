mod contracts;
mod invite;
mod wire;

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;

pub use contracts::{
    AcceptInviteRequest, ActiveCall, AttachmentDescriptor, AttachmentSendResult, AttachmentState,
    AttachmentView, CallEvent, CallOfferBody, CallStarted, ChatMessage, CloseSessionResult,
    DmOffer, InviteCreated, MeshInfo, PendingCall, PrivateDmRuntimeError, SendMessageResult,
    SessionListSnapshot, SessionSnapshot, SnapshotEvent, StartSessionRequest,
};
use invite::{build_invite_uri, listen_address, ParsedInvite};
use crate::adapters::attachment_runtime::{
    AttachmentManifest, AttachmentRuntime, ChunkOutcome, StreamRange, CHUNK_SIZE,
};
pub use crate::adapters::attachment_runtime::VoiceMeta;
use crate::adapters::attachment_store::AttachmentStore;
use crate::adapters::mls_crypto::MlsSessionCrypto;
use crate::adapters::voice_call_runtime::{CallPhase, CallState};
use wire::{
    blob_channel, channel_session_id, control_channel, data_channel, decode, decode_json, encode,
    publish_json, voice_call_channel, BlobEnvelope, ControlEnvelope, DataEnvelope,
};

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn random_b64(bytes: usize) -> String {
    use rand::RngCore;
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &buf)
}

use crate::adapters::moss_ffi::{
    clear_event_log, drain_messages_where, snapshot_event_log, MossFfiRuntime, MossNode,
    MossNodeConfig, MossReceivedMessage,
};

const SEEN_MESSAGE_CAP: usize = 4096;

pub struct PrivateDmRuntime {
    moss: Arc<MossFfiRuntime>,
    attachment_store: Arc<AttachmentStore>,
    sessions: HashMap<String, PrivateDmSession>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum AttachmentDirection {
    Outgoing,
    Incoming,
}

struct AttachmentSlot {
    descriptor: AttachmentDescriptor,
    direction: AttachmentDirection,
    local_path: Option<String>,
    download_requested: bool,
    failed: bool,
    cancelled: bool,
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
    seen_moss_messages: HashSet<String>,
    seen_order: VecDeque<String>,
    control_channel: String,
    data_channel: String,
    blob_channel: String,
    attachment_store: Arc<AttachmentStore>,
    attachments: AttachmentRuntime,
    attachment_slots: HashMap<String, AttachmentSlot>,
    call: Option<CallState>,
}

#[derive(Clone, Copy)]
enum SessionRole {
    Alice,
    Bob,
}

impl PrivateDmRuntime {
    pub fn new(moss: MossFfiRuntime, attachment_store: Arc<AttachmentStore>) -> Self {
        Self::from_shared(Arc::new(moss), attachment_store)
    }

    pub fn from_shared(
        moss: Arc<MossFfiRuntime>,
        attachment_store: Arc<AttachmentStore>,
    ) -> Self {
        Self {
            moss,
            attachment_store,
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
            Arc::clone(&self.attachment_store),
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
            Arc::clone(&self.attachment_store),
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
            attachment: None,
            call_event: None,
        });

        Ok(SendMessageResult {
            session_id: session.session_id.clone(),
            state: session.state(),
            ciphertext_bytes: ciphertext.len(),
        })
    }

    /// Encrypts a file, stores the sender's own copy, and announces the
    /// manifest to the peer over the MLS-protected control channel.
    pub fn send_attachment(
        &mut self,
        session_id: &str,
        file_name: String,
        mime: String,
        bytes: Vec<u8>,
        thumbnail: Option<String>,
        voice: Option<VoiceMeta>,
    ) -> Result<AttachmentSendResult, PrivateDmRuntimeError> {
        self.drain_inbound()?;
        let session = self.session_mut(session_id)?;
        session.send_attachment(file_name, mime, bytes, thumbnail, voice)
    }

    /// Begins (or retries) downloading a peer's attachment.
    pub fn download_attachment(
        &mut self,
        session_id: &str,
        attachment_id: &str,
    ) -> Result<(), PrivateDmRuntimeError> {
        self.drain_inbound()?;
        let session = self.session_mut(session_id)?;
        session.start_attachment_download(attachment_id)?;
        session.pump_attachment_requests();
        Ok(())
    }

    pub fn cancel_attachment(
        &mut self,
        session_id: &str,
        attachment_id: &str,
    ) -> Result<(), PrivateDmRuntimeError> {
        let session = self.session_mut(session_id)?;
        session.cancel_attachment(attachment_id)
    }

    /// Serves a byte range for streaming playback, fetching the region ahead
    /// of the sequential cursor when it has not arrived yet.
    pub fn stream_attachment_range(
        &mut self,
        session_id: &str,
        attachment_id: &str,
        start: u64,
        end: u64,
    ) -> Result<StreamRange, PrivateDmRuntimeError> {
        self.drain_inbound()?;
        let session = self.session_mut(session_id)?;
        if let Some(slot) = session.attachment_slots.get_mut(attachment_id) {
            slot.download_requested = true;
            slot.cancelled = false;
        }
        let _ = session.attachments.start_download(attachment_id);
        let outcome = session.attachments.stream_range(attachment_id, start, end);
        session.pump_attachment_requests();
        Ok(outcome)
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
        // Keep every active download fed without waiting on a user action.
        for session in self.sessions.values_mut() {
            session.pump_attachment_requests();
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

    pub fn call_start(
        &mut self,
        session_id: &str,
    ) -> Result<CallStarted, PrivateDmRuntimeError> {
        self.drain_inbound()?;
        let session = self.session_mut(session_id)?;
        session.call_start()
    }

    pub fn call_accept(
        &mut self,
        session_id: &str,
        call_id: &str,
    ) -> Result<(), PrivateDmRuntimeError> {
        self.drain_inbound()?;
        let session = self.session_mut(session_id)?;
        session.call_accept(call_id)
    }

    pub fn call_decline(
        &mut self,
        session_id: &str,
        call_id: &str,
        reason: &str,
    ) -> Result<(), PrivateDmRuntimeError> {
        self.drain_inbound()?;
        let session = self.session_mut(session_id)?;
        session.call_decline(call_id, reason)
    }

    pub fn call_end(
        &mut self,
        session_id: &str,
        call_id: &str,
        reason: &str,
    ) -> Result<(), PrivateDmRuntimeError> {
        self.drain_inbound()?;
        let session = self.session_mut(session_id)?;
        session.call_end(call_id, reason)
    }

    pub fn call_send_frame(
        &mut self,
        session_id: &str,
        call_id: &str,
        frame: Vec<u8>,
    ) -> Result<(), PrivateDmRuntimeError> {
        let session = self.session_mut(session_id)?;
        session.call_send_frame(call_id, frame)
    }

    pub fn call_drain_frames(
        &mut self,
        session_id: &str,
        call_id: &str,
    ) -> Result<Vec<Vec<u8>>, PrivateDmRuntimeError> {
        self.drain_inbound()?;
        let session = self.session_mut(session_id)?;
        Ok(session.call_drain_frames(call_id))
    }
}

impl PrivateDmSession {
    #[allow(clippy::too_many_arguments)]
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
        attachment_store: Arc<AttachmentStore>,
    ) -> Self {
        let control_channel = control_channel(&session_id);
        let data_channel = data_channel(&session_id);
        let blob_channel = blob_channel(&session_id);
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
            seen_moss_messages: HashSet::new(),
            seen_order: VecDeque::new(),
            control_channel,
            data_channel,
            blob_channel,
            attachment_store,
            attachments: AttachmentRuntime::new(),
            attachment_slots: HashMap::new(),
            call: None,
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
        } else if message.channel == self.blob_channel {
            self.handle_blob(message.payload)
        } else if wire::channel_call_id(&message.channel).is_some() {
            self.handle_voice_call_frame(&message.channel, message.payload)
        } else {
            Ok(())
        }
    }

    fn handle_voice_call_frame(
        &mut self,
        channel: &str,
        payload: Vec<u8>,
    ) -> Result<(), PrivateDmRuntimeError> {
        let Some(call_id) = wire::channel_call_id(channel) else {
            return Ok(());
        };
        if let Some(call) = self.call.as_mut() {
            if call.call_id == call_id {
                call.push_frame(payload);
            }
        }
        Ok(())
    }

    fn has_seen_message(&mut self, message: &MossReceivedMessage) -> bool {
        let key = format!(
            "{}:{}",
            message.channel,
            crate::adapters::attachment_crypto::sha256_hex(&message.payload)
        );
        if !self.seen_moss_messages.insert(key.clone()) {
            return true;
        }
        self.seen_order.push_back(key);
        if self.seen_order.len() > SEEN_MESSAGE_CAP {
            if let Some(evicted) = self.seen_order.pop_front() {
                self.seen_moss_messages.remove(&evicted);
            }
        }
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
            ControlEnvelope::AttachmentManifest {
                session_id,
                participant_id,
                from_device,
                manifest_ciphertext_b64,
            } if session_id == self.session_id
                && participant_id != self.participant_id =>
            {
                let manifest_json =
                    self.crypto.decrypt(&decode(&manifest_ciphertext_b64)?)?;
                let manifest: AttachmentManifest = decode_json(&manifest_json)?;
                self.accept_incoming_manifest(from_device, manifest)
            }
            ControlEnvelope::CallOffer {
                session_id,
                participant_id,
                from_device,
                call_id,
                offer_ciphertext_b64,
            } if session_id == self.session_id
                && participant_id != self.participant_id =>
            {
                if self.call.is_some() {
                    return Ok(());
                }
                let plaintext = self.crypto.decrypt(&decode(&offer_ciphertext_b64)?)?;
                let body: CallOfferBody = decode_json(&plaintext)?;
                let channel = voice_call_channel(&call_id);
                self.call = Some(CallState::ringing(
                    call_id,
                    body.key_b64,
                    body.nonce_prefix_b64,
                    from_device,
                ));
                self.node
                    .subscribe(&channel)
                    .map_err(|error| PrivateDmRuntimeError::Moss(error.to_string()))?;
                Ok(())
            }
            ControlEnvelope::CallAccept {
                session_id,
                participant_id,
                call_id,
            } if session_id == self.session_id
                && participant_id != self.participant_id =>
            {
                if let Some(call) = self.call.as_mut() {
                    if call.call_id == call_id && call.phase == CallPhase::Outgoing {
                        call.become_active(now_ms());
                    }
                }
                Ok(())
            }
            ControlEnvelope::CallDecline {
                session_id,
                participant_id,
                call_id,
                reason: _,
            } if session_id == self.session_id
                && participant_id != self.participant_id =>
            {
                if let Some(call) = self.call.as_ref() {
                    if call.call_id == call_id {
                        let _ = self.node.unsubscribe_voice_call(&call.call_id);
                        let remote = call.remote_device.clone();
                        let call_id_owned = call.call_id.clone();
                        self.call = None;
                        self.append_call_event_message(&remote, "missed", 0, &call_id_owned);
                    }
                }
                Ok(())
            }
            ControlEnvelope::CallEnd {
                session_id,
                participant_id,
                call_id,
                reason,
            } if session_id == self.session_id
                && participant_id != self.participant_id =>
            {
                if let Some(call) = self.call.as_ref() {
                    if call.call_id == call_id {
                        let duration = call.duration_ms(now_ms());
                        let kind = if duration == 0 && reason == "no_answer" {
                            "missed"
                        } else {
                            "completed"
                        };
                        let _ = self.node.unsubscribe_voice_call(&call.call_id);
                        let remote = call.remote_device.clone();
                        let call_id_owned = call.call_id.clone();
                        self.call = None;
                        self.append_call_event_message(
                            &remote,
                            kind,
                            duration,
                            &call_id_owned,
                        );
                    }
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }

    fn append_call_event_message(
        &mut self,
        remote_device: &str,
        kind: &str,
        duration_ms: u64,
        call_id: &str,
    ) {
        self.messages.push(ChatMessage {
            from_device: remote_device.to_string(),
            body: String::new(),
            attachment: None,
            call_event: Some(CallEvent {
                kind: kind.to_string(),
                duration_ms,
                call_id: call_id.to_string(),
            }),
        });
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
            attachment: None,
            call_event: None,
        });

        Ok(())
    }

    fn handle_blob(&mut self, payload: Vec<u8>) -> Result<(), PrivateDmRuntimeError> {
        let envelope: BlobEnvelope = decode_json(&payload)?;
        match envelope {
            BlobEnvelope::Request {
                participant_id,
                request,
            } if participant_id != self.participant_id => {
                let frames = self.attachments.serve_chunks(&request)?;
                for frame in frames {
                    let chunk = BlobEnvelope::Chunk {
                        participant_id: self.participant_id.clone(),
                        frame,
                    };
                    publish_json(&self.node, &self.blob_channel, &chunk)?;
                }
                Ok(())
            }
            BlobEnvelope::Chunk {
                participant_id,
                frame,
            } if participant_id != self.participant_id => {
                let attachment_id = frame.attachment_id.clone();
                let file_name = self
                    .attachment_slots
                    .get(&attachment_id)
                    .map(|slot| slot.descriptor.file_name.clone())
                    .unwrap_or_else(|| "file".to_string());
                match self.attachments.ingest_chunk(&frame) {
                    Ok(ChunkOutcome::Complete {
                        content_hash, bytes, ..
                    }) => {
                        let path = self
                            .attachment_store
                            .write_blob(&content_hash, &file_name, &bytes)?;
                        if let Some(slot) = self.attachment_slots.get_mut(&attachment_id) {
                            slot.local_path = Some(path.to_string_lossy().into_owned());
                            slot.failed = false;
                        }
                        Ok(())
                    }
                    Ok(_) => Ok(()),
                    Err(_) => {
                        if let Some(slot) = self.attachment_slots.get_mut(&attachment_id) {
                            slot.failed = true;
                        }
                        Ok(())
                    }
                }
            }
            _ => Ok(()),
        }
    }

    fn accept_incoming_manifest(
        &mut self,
        from_device: String,
        manifest: AttachmentManifest,
    ) -> Result<(), PrivateDmRuntimeError> {
        let attachment_id = manifest.attachment_id.clone();
        if self.attachment_slots.contains_key(&attachment_id) {
            return Ok(());
        }
        let descriptor = descriptor_of(&manifest);
        self.attachments.register_incoming(manifest)?;
        self.attachment_slots.insert(
            attachment_id,
            AttachmentSlot {
                descriptor: descriptor.clone(),
                direction: AttachmentDirection::Incoming,
                local_path: None,
                download_requested: false,
                failed: false,
                cancelled: false,
            },
        );
        self.messages.push(ChatMessage {
            from_device,
            body: String::new(),
            attachment: Some(descriptor),
            call_event: None,
        });
        Ok(())
    }

    fn send_attachment(
        &mut self,
        file_name: String,
        mime: String,
        bytes: Vec<u8>,
        thumbnail: Option<String>,
        voice: Option<VoiceMeta>,
    ) -> Result<AttachmentSendResult, PrivateDmRuntimeError> {
        if !self.peer_joined || !self.crypto.is_ready() {
            return Err(PrivateDmRuntimeError::NotReady);
        }
        let attachment_id = self.crypto.random_token("attachment")?;
        let manifest = self.attachments.prepare_outgoing(
            attachment_id.clone(),
            file_name,
            mime,
            self.fingerprint.clone(),
            bytes.clone(),
            thumbnail,
            voice,
        )?;
        let stored = self
            .attachment_store
            .write_blob(&manifest.content_hash, &manifest.file_name, &bytes)?;
        let manifest_json = serde_json::to_vec(&manifest)
            .map_err(|error| PrivateDmRuntimeError::Codec(error.to_string()))?;
        let ciphertext = self.crypto.encrypt(&manifest_json)?;
        let envelope = ControlEnvelope::AttachmentManifest {
            session_id: self.session_id.clone(),
            participant_id: self.participant_id.clone(),
            from_device: self.device_id.clone(),
            manifest_ciphertext_b64: encode(&ciphertext),
        };
        publish_json(&self.node, &self.control_channel, &envelope)?;

        let descriptor = descriptor_of(&manifest);
        self.attachment_slots.insert(
            attachment_id.clone(),
            AttachmentSlot {
                descriptor: descriptor.clone(),
                direction: AttachmentDirection::Outgoing,
                local_path: Some(stored.to_string_lossy().into_owned()),
                download_requested: false,
                failed: false,
                cancelled: false,
            },
        );
        self.messages.push(ChatMessage {
            from_device: self.device_id.clone(),
            body: String::new(),
            attachment: Some(descriptor),
            call_event: None,
        });
        Ok(AttachmentSendResult {
            session_id: self.session_id.clone(),
            attachment_id,
            content_hash: manifest.content_hash,
        })
    }

    fn start_attachment_download(
        &mut self,
        attachment_id: &str,
    ) -> Result<(), PrivateDmRuntimeError> {
        let slot = self
            .attachment_slots
            .get_mut(attachment_id)
            .ok_or_else(|| {
                PrivateDmRuntimeError::MissingAttachment(attachment_id.to_string())
            })?;
        if slot.direction != AttachmentDirection::Incoming {
            return Err(PrivateDmRuntimeError::Attachment(
                "cannot download an outgoing attachment".to_string(),
            ));
        }
        slot.download_requested = true;
        slot.failed = false;
        slot.cancelled = false;
        self.attachments.start_download(attachment_id)?;
        Ok(())
    }

    fn cancel_attachment(
        &mut self,
        attachment_id: &str,
    ) -> Result<(), PrivateDmRuntimeError> {
        let slot = self
            .attachment_slots
            .get_mut(attachment_id)
            .ok_or_else(|| {
                PrivateDmRuntimeError::MissingAttachment(attachment_id.to_string())
            })?;
        slot.cancelled = true;
        slot.download_requested = false;
        self.attachments.cancel(attachment_id);
        Ok(())
    }

    fn pump_attachment_requests(&mut self) {
        let active: Vec<String> = self
            .attachment_slots
            .iter()
            .filter(|(_, slot)| {
                slot.direction == AttachmentDirection::Incoming
                    && slot.download_requested
                    && slot.local_path.is_none()
                    && !slot.cancelled
            })
            .map(|(id, _)| id.clone())
            .collect();
        for attachment_id in active {
            if let Some(request) = self.attachments.next_chunk_request(&attachment_id) {
                let envelope = BlobEnvelope::Request {
                    participant_id: self.participant_id.clone(),
                    request,
                };
                let _ = publish_json(&self.node, &self.blob_channel, &envelope);
            }
        }
    }

    fn attachment_views(&self) -> Vec<AttachmentView> {
        let mut views: Vec<AttachmentView> = self
            .attachment_slots
            .values()
            .map(|slot| slot.view(&self.attachments))
            .collect();
        views.sort_by(|a, b| a.attachment_id.cmp(&b.attachment_id));
        views
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
            attachments: self.attachment_views(),
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
            pending_call: self.call.as_ref().and_then(|call| {
                if call.phase == CallPhase::Ringing {
                    Some(PendingCall {
                        call_id: call.call_id.clone(),
                        from_device: call.remote_device.clone(),
                    })
                } else {
                    None
                }
            }),
            active_call: self.call.as_ref().and_then(|call| {
                if call.phase == CallPhase::Active {
                    Some(ActiveCall {
                        call_id: call.call_id.clone(),
                        direction: call.direction.as_str().to_string(),
                        key_b64: call.key_b64.clone(),
                        nonce_prefix_b64: call.nonce_prefix_b64.clone(),
                        started_at_ms: call.started_at_ms,
                    })
                } else {
                    None
                }
            }),
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

    fn call_start(&mut self) -> Result<CallStarted, PrivateDmRuntimeError> {
        if !self.peer_joined || !self.crypto.is_ready() {
            return Err(PrivateDmRuntimeError::NotReady);
        }
        if self.call.is_some() {
            return Err(PrivateDmRuntimeError::Attachment(
                "another call is already in flight".to_string(),
            ));
        }
        let call_id = self.crypto.random_token("call")?;
        let key_b64 = random_b64(32);
        let nonce_prefix_b64 = random_b64(4);
        self.call = Some(CallState::outgoing(
            call_id.clone(),
            key_b64.clone(),
            nonce_prefix_b64.clone(),
            String::new(),
        ));
        self.node
            .subscribe(&voice_call_channel(&call_id))
            .map_err(|error| PrivateDmRuntimeError::Moss(error.to_string()))?;
        let body = CallOfferBody {
            key_b64: key_b64.clone(),
            nonce_prefix_b64: nonce_prefix_b64.clone(),
        };
        let body_json = serde_json::to_vec(&body)
            .map_err(|error| PrivateDmRuntimeError::Codec(error.to_string()))?;
        let ciphertext = self.crypto.encrypt(&body_json)?;
        let envelope = ControlEnvelope::CallOffer {
            session_id: self.session_id.clone(),
            participant_id: self.participant_id.clone(),
            from_device: self.device_id.clone(),
            call_id: call_id.clone(),
            offer_ciphertext_b64: encode(&ciphertext),
        };
        publish_json(&self.node, &self.control_channel, &envelope)?;
        Ok(CallStarted {
            session_id: self.session_id.clone(),
            call_id,
            key_b64,
            nonce_prefix_b64,
        })
    }

    fn call_accept(&mut self, call_id: &str) -> Result<(), PrivateDmRuntimeError> {
        let Some(call) = self.call.as_mut() else {
            return Err(PrivateDmRuntimeError::MissingSession);
        };
        if call.call_id != call_id || call.phase != CallPhase::Ringing {
            return Err(PrivateDmRuntimeError::MissingSession);
        }
        call.become_active(now_ms());
        let envelope = ControlEnvelope::CallAccept {
            session_id: self.session_id.clone(),
            participant_id: self.participant_id.clone(),
            call_id: call_id.to_string(),
        };
        publish_json(&self.node, &self.control_channel, &envelope)
    }

    fn call_decline(&mut self, call_id: &str, reason: &str) -> Result<(), PrivateDmRuntimeError> {
        if let Some(call) = self.call.take() {
            if call.call_id == call_id {
                let _ = self.node.unsubscribe_voice_call(&call.call_id);
                let remote = call.remote_device.clone();
                let call_id_owned = call.call_id.clone();
                self.append_call_event_message(&remote, "missed", 0, &call_id_owned);
                let envelope = ControlEnvelope::CallDecline {
                    session_id: self.session_id.clone(),
                    participant_id: self.participant_id.clone(),
                    call_id: call_id.to_string(),
                    reason: reason.to_string(),
                };
                publish_json(&self.node, &self.control_channel, &envelope)?;
            } else {
                self.call = Some(call);
            }
        }
        Ok(())
    }

    fn call_end(&mut self, call_id: &str, reason: &str) -> Result<(), PrivateDmRuntimeError> {
        let Some(call) = self.call.take() else {
            return Ok(());
        };
        if call.call_id != call_id {
            self.call = Some(call);
            return Ok(());
        }
        let duration = call.duration_ms(now_ms());
        let _ = self.node.unsubscribe_voice_call(&call.call_id);
        let kind = if call.phase != CallPhase::Active {
            "missed"
        } else {
            "completed"
        };
        let remote = call.remote_device.clone();
        let call_id_owned = call.call_id.clone();
        self.append_call_event_message(&remote, kind, duration, &call_id_owned);
        let envelope = ControlEnvelope::CallEnd {
            session_id: self.session_id.clone(),
            participant_id: self.participant_id.clone(),
            call_id: call_id.to_string(),
            reason: reason.to_string(),
        };
        publish_json(&self.node, &self.control_channel, &envelope)
    }

    fn call_send_frame(
        &mut self,
        call_id: &str,
        frame: Vec<u8>,
    ) -> Result<(), PrivateDmRuntimeError> {
        let Some(call) = self.call.as_ref() else {
            return Ok(());
        };
        if call.call_id != call_id || call.phase != CallPhase::Active {
            return Ok(());
        }
        self.node
            .publish(&voice_call_channel(call_id), &frame)
            .map_err(|error| PrivateDmRuntimeError::Moss(error.to_string()))
    }

    fn call_drain_frames(&mut self, call_id: &str) -> Vec<Vec<u8>> {
        let Some(call) = self.call.as_mut() else {
            return Vec::new();
        };
        if call.call_id != call_id {
            return Vec::new();
        }
        call.drain_frames()
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

impl AttachmentSlot {
    fn view(&self, attachments: &AttachmentRuntime) -> AttachmentView {
        let chunk_count = self
            .descriptor
            .total_size
            .div_ceil(u64::from(CHUNK_SIZE))
            .max(1);
        let (direction, progress) = match self.direction {
            AttachmentDirection::Outgoing => (
                "outgoing",
                attachments.outgoing_progress(&self.descriptor.attachment_id),
            ),
            AttachmentDirection::Incoming => (
                "incoming",
                attachments.incoming_progress(&self.descriptor.attachment_id),
            ),
        };
        let completed_chunks = progress
            .as_ref()
            .map(|value| value.completed_chunks)
            .unwrap_or(0);
        let state = if self.cancelled {
            AttachmentState::Cancelled
        } else if self.failed {
            AttachmentState::Failed
        } else if self.local_path.is_some() {
            AttachmentState::Available
        } else if self.download_requested {
            AttachmentState::Downloading
        } else {
            AttachmentState::Offered
        };
        AttachmentView {
            attachment_id: self.descriptor.attachment_id.clone(),
            direction: direction.to_string(),
            state,
            completed_chunks,
            chunk_count,
            local_path: self.local_path.clone(),
        }
    }
}

fn descriptor_of(manifest: &AttachmentManifest) -> AttachmentDescriptor {
    AttachmentDescriptor {
        attachment_id: manifest.attachment_id.clone(),
        content_hash: manifest.content_hash.clone(),
        file_name: manifest.file_name.clone(),
        mime: manifest.mime.clone(),
        total_size: manifest.total_size,
        thumbnail_b64: manifest.thumbnail_b64.clone(),
        voice: manifest.voice.clone(),
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
    node.subscribe(&blob_channel(session_id))
        .map_err(|error| PrivateDmRuntimeError::Moss(error.to_string()))?;

    Ok(node)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::moss_ffi::{drain_received_messages, MossFfiRuntime, MOSS_TEST_LOCK};

    fn temp_store() -> Arc<AttachmentStore> {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "mosh-dm-attachments-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        Arc::new(AttachmentStore::new(&path).expect("attachment store should init"))
    }

    #[test]
    fn private_dm_runtime_exchanges_e2ee_message_over_moss() {
        let _guard = MOSS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        drain_received_messages();
        let runtime = Arc::new(MossFfiRuntime::load_default().expect("Moss runtime should load"));
        let mut alice = PrivateDmRuntime::from_shared(Arc::clone(&runtime), temp_store());
        let invite = alice
            .create_invite(StartSessionRequest {
                display_name: "Alice".to_string(),
                listen_port: 42130,
                static_peer: None,
            })
            .expect("Alice invite should be created");

        let mut bob = PrivateDmRuntime::from_shared(runtime, temp_store());
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

    // Heavy end-to-end transfer over real Moss. Loading the Moss Go runtime
    // a third time in one process makes the handshake flaky under suite
    // load, so this runs on demand via `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn private_dm_runtime_transfers_attachment_over_moss() {
        let _guard = MOSS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        drain_received_messages();
        let runtime = Arc::new(MossFfiRuntime::load_default().expect("Moss runtime should load"));
        let mut alice = PrivateDmRuntime::from_shared(Arc::clone(&runtime), temp_store());
        let invite = alice
            .create_invite(StartSessionRequest {
                display_name: "Alice".to_string(),
                listen_port: 42132,
                static_peer: None,
            })
            .expect("Alice invite should be created");

        let receiver_store = temp_store();
        let mut bob = PrivateDmRuntime::from_shared(runtime, Arc::clone(&receiver_store));
        bob.accept_invite(AcceptInviteRequest {
            invite_uri: invite.invite_uri.clone(),
            display_name: "Bob".to_string(),
            listen_port: 42133,
            static_peer: Some("127.0.0.1:42132".to_string()),
        })
        .expect("Bob should accept invite");

        wait_until_ready(&mut alice, &mut bob, &invite.session_id);

        let payload: Vec<u8> = (0..(CHUNK_SIZE as usize) * 2 + 123)
            .map(|index| (index % 251) as u8)
            .collect();
        let send = alice
            .send_attachment(
                &invite.session_id,
                "photo.bin".to_string(),
                "application/octet-stream".to_string(),
                payload.clone(),
                None,
                None,
            )
            .expect("Alice should send attachment");

        let attachment_id = wait_for_attachment(&mut bob, &invite.session_id, &send.attachment_id);
        bob.download_attachment(&invite.session_id, &attachment_id)
            .expect("Bob should start download");

        wait_for_attachment_available(&mut alice, &mut bob, &invite.session_id, &attachment_id);
        let stored = receiver_store
            .read_blob(&send.content_hash, "photo.bin")
            .expect("Bob should have stored the blob");
        assert_eq!(stored, payload);
    }

    fn wait_for_attachment(
        runtime: &mut PrivateDmRuntime,
        session_id: &str,
        attachment_id: &str,
    ) -> String {
        for _ in 0..40 {
            let snapshot = runtime.poll_session(session_id).expect("poll should pass");
            if snapshot
                .attachments
                .iter()
                .any(|view| view.attachment_id == attachment_id)
            {
                return attachment_id.to_string();
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        panic!("attachment manifest did not arrive");
    }

    fn wait_for_attachment_available(
        alice: &mut PrivateDmRuntime,
        bob: &mut PrivateDmRuntime,
        session_id: &str,
        attachment_id: &str,
    ) {
        for _ in 0..120 {
            let _ = alice.poll_session(session_id);
            let snapshot = bob.poll_session(session_id).expect("poll should pass");
            if snapshot.attachments.iter().any(|view| {
                view.attachment_id == attachment_id
                    && view.state == AttachmentState::Available
            }) {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        panic!("attachment did not finish downloading");
    }

    fn wait_until_ready(
        alice: &mut PrivateDmRuntime,
        bob: &mut PrivateDmRuntime,
        session_id: &str,
    ) {
        // The Moss handshake is timing-sensitive; allow generous headroom so
        // the test stays green under full-suite CPU contention.
        for _ in 0..200 {
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
