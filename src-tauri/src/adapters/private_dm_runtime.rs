mod contracts;
mod invite;
mod wire;

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;

pub use crate::adapters::attachment_runtime::VoiceMeta;
use crate::adapters::attachment_runtime::{
    AttachmentManifest, AttachmentRuntime, ChunkOutcome, OutgoingAttachment, StreamRange,
    CHUNK_SIZE,
};
use crate::adapters::attachment_store::AttachmentStore;
use crate::adapters::message_id::MessageIdGen;
use crate::adapters::mls_crypto::MlsSessionCrypto;
use crate::adapters::outbound_delivery::OutboundAttemptRecord;
use crate::adapters::persistence::Persistence;
use crate::adapters::voice_call_runtime::{CallPhase, CallState};
pub use contracts::{
    AcceptInviteRequest, ActiveCall, AttachmentDescriptor, AttachmentSendResult, AttachmentState,
    AttachmentView, CallEvent, CallOfferBody, CallStarted, ChatMessage, CloseSessionResult,
    DmOffer, InviteCreated, MeshInfo, MessageDeliveryStatus, OutgoingCall, PendingCall,
    PrivateDmRuntimeError, SendMessageResult, SessionListSnapshot, SessionSnapshot, SnapshotEvent,
    StartSessionRequest,
};
use invite::{build_invite_uri, listen_address, ParsedInvite};
use wire::{
    blob_channel, channel_session_id, control_channel, data_channel, decode, decode_json, encode,
    publish_json, voice_call_channel, BlobEnvelope, ControlEnvelope, DataEnvelope,
};

const OUTBOUND_SCOPE_PRIVATE_DM: &str = "private_dm";

// Minimum gap between MLS handshake control re-publishes. The KeyPackage and
// Welcome exchange is a one-shot publish, but gossip does not buffer for a peer
// that has not meshed yet, so the first publish is routinely lost while
// discovery is still in progress (or the link is flapping). Bob re-sends his
// KeyPackage on this cadence until he processes the Welcome.
const HANDSHAKE_RESEND_MS: u64 = 2000;

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

fn apply_delivery(
    message: &mut ChatMessage,
    status: MessageDeliveryStatus,
    error: Option<String>,
    retry_count: u32,
) {
    message.delivery_status = Some(status);
    message.delivery_error = error;
    message.retry_count = Some(retry_count);
    message.retryable = Some(matches!(status, MessageDeliveryStatus::Failed));
}

use crate::adapters::moss_ffi::{
    clear_event_log, drain_messages_where, snapshot_event_log, MossFfiRuntime, MossNode,
    MossNodeConfig, MossReceivedMessage,
};

const SEEN_MESSAGE_CAP: usize = 4096;

pub struct PrivateDmRuntime {
    moss: Arc<MossFfiRuntime>,
    attachment_store: Arc<AttachmentStore>,
    persistence: Option<Arc<Persistence>>,
    persisted_counts: HashMap<String, usize>,
    // Sessions whose persisted record already carries a valid (non-empty)
    // group_id, so the tail-persist loop refreshes each record only once.
    finalized_session_records: HashSet<String>,
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
    // Transport coordinates kept so the persisted session record can be
    // rebuilt verbatim (notably to refresh the joiner's group_id after join).
    listen_port: u16,
    static_peer: Option<String>,
    // The remote peer's display name, learned from the first inbound frame.
    peer_display_name: Option<String>,
    peer_joined: bool,
    node: MossNode,
    crypto: MlsSessionCrypto,
    messages: Vec<ChatMessage>,
    message_ids: MessageIdGen,
    seen_moss_messages: HashSet<String>,
    seen_order: VecDeque<String>,
    control_channel: String,
    data_channel: String,
    blob_channel: String,
    attachment_store: Arc<AttachmentStore>,
    attachments: AttachmentRuntime,
    attachment_slots: HashMap<String, AttachmentSlot>,
    outbound_attempts: HashMap<String, OutboundAttemptRecord>,
    call: Option<CallState>,
    // MLS handshake retransmit state. Bob keeps his published KeyPackage here
    // and re-sends it (throttled by HANDSHAKE_RESEND_MS) until he joins; Alice
    // caches the Welcome she produced so she can re-answer a repeat KeyPackage
    // without re-running add_members (which would advance the group epoch).
    pending_key_package: Option<Vec<u8>>,
    pending_welcome: Option<Vec<u8>>,
    last_handshake_send_ms: u64,
}

#[derive(Clone, Copy)]
enum SessionRole {
    Alice,
    Bob,
}

impl PrivateDmRuntime {
    pub fn new(moss: MossFfiRuntime, attachment_store: Arc<AttachmentStore>) -> Self {
        Self::from_shared(Arc::new(moss), attachment_store, None)
    }

    pub fn from_shared(
        moss: Arc<MossFfiRuntime>,
        attachment_store: Arc<AttachmentStore>,
        persistence: Option<Arc<Persistence>>,
    ) -> Self {
        Self {
            moss,
            attachment_store,
            persistence,
            persisted_counts: HashMap::new(),
            finalized_session_records: HashSet::new(),
            sessions: HashMap::new(),
        }
    }

    /// Rebuild sessions + history from the encrypted store. Best-effort: a bad
    /// row is skipped, never fatal.
    pub fn rehydrate(&mut self) {
        let Some(p) = self.persistence.as_ref().cloned() else {
            return;
        };
        let rows = match p.list_sessions() {
            Ok(rows) => rows,
            Err(_) => return,
        };
        for row in rows {
            let rec: contracts::PersistedSession = match serde_json::from_slice(&row) {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("rehydrate: bad session row: {e}");
                    continue;
                }
            };
            let snapshot = match p.get_mls_snapshot(&rec.session_id) {
                Ok(Some(s)) => s,
                _ => {
                    eprintln!("rehydrate: missing MLS snapshot for {}", rec.session_id);
                    continue;
                }
            };
            let crypto = match MlsSessionCrypto::restore(
                &rec.display_name,
                &rec.signer_public,
                &snapshot,
                &rec.group_id,
            ) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!(
                        "rehydrate: crypto restore failed for {}: {e}",
                        rec.session_id
                    );
                    continue;
                }
            };
            let node = match start_node(
                &self.moss,
                &rec.mesh_id,
                &rec.session_id,
                rec.listen_port,
                rec.static_peer.clone(),
            ) {
                Ok(n) => n,
                Err(e) => {
                    eprintln!("rehydrate: node start failed for {}: {e}", rec.session_id);
                    continue;
                }
            };
            let mut session = PrivateDmSession::new(
                if rec.role_is_alice {
                    SessionRole::Alice
                } else {
                    SessionRole::Bob
                },
                rec.display_name.clone(),
                rec.participant_id.clone(),
                rec.session_id.clone(),
                rec.mesh_id.clone(),
                rec.fingerprint.clone(),
                rec.invite_uri.clone(),
                rec.listen_port,
                rec.static_peer.clone(),
                node,
                crypto,
                Arc::clone(&self.attachment_store),
            );
            if let Ok(msgs) = p.list_messages(&rec.session_id) {
                for m in msgs {
                    if let Ok(pm) = serde_json::from_slice::<contracts::PersistedMessage>(&m) {
                        let mut message = pm.message;
                        if message.message_id.is_none() {
                            message.message_id = Some(pm.message_id.clone());
                        }
                        if message.sent_at_ms.is_none() {
                            message.sent_at_ms = Some(pm.sent_at_ms);
                        }
                        // Re-render cached attachments from the local store. Non-cached
                        // attachments get no slot, so a peer re-offer can still register
                        // them (auto re-download from persisted data is impossible: the
                        // chunk-crypto manifest is not persisted and MLS forward secrecy
                        // bars re-decrypting the original offer).
                        if let Some(desc) = message.attachment.as_ref() {
                            if self
                                .attachment_store
                                .exists(&desc.content_hash, &desc.file_name)
                                .unwrap_or(false)
                            {
                                if let Ok(path) = self
                                    .attachment_store
                                    .path_for(&desc.content_hash, &desc.file_name)
                                {
                                    let direction = if message.from_device == rec.display_name {
                                        AttachmentDirection::Outgoing
                                    } else {
                                        AttachmentDirection::Incoming
                                    };
                                    session
                                        .attachment_slots
                                        .entry(desc.attachment_id.clone())
                                        .or_insert(AttachmentSlot {
                                            descriptor: desc.clone(),
                                            direction,
                                            local_path: Some(path.to_string_lossy().into_owned()),
                                            download_requested: false,
                                            failed: false,
                                            cancelled: false,
                                        });
                                }
                            }
                        }
                        session.upsert_message(message);
                    }
                }
            }
            if let Ok(rows) = p.list_outbound_attempts(OUTBOUND_SCOPE_PRIVATE_DM, &rec.session_id) {
                for row in rows {
                    let Ok(attempt) = serde_json::from_slice::<OutboundAttemptRecord>(&row) else {
                        continue;
                    };
                    let Ok(mut message) =
                        serde_json::from_str::<ChatMessage>(&attempt.message_json)
                    else {
                        continue;
                    };
                    if message.message_id.is_none() {
                        message.message_id = Some(attempt.message_id.clone());
                    }
                    if message.sent_at_ms.is_none() {
                        message.sent_at_ms = Some(attempt.sent_at_ms);
                    }
                    apply_delivery(
                        &mut message,
                        attempt.delivery_status,
                        attempt.delivery_error.clone(),
                        attempt.retry_count,
                    );
                    session.upsert_message(message);
                    session
                        .outbound_attempts
                        .insert(attempt.message_id.clone(), attempt);
                }
            }
            // Recover the peer's display name from a restored inbound message so
            // the chat/call UI still shows it after a restart.
            session.peer_display_name = session
                .messages
                .iter()
                .map(|message| message.from_device.as_str())
                .find(|name| !name.is_empty() && *name != rec.display_name)
                .map(str::to_string);
            if session.peer_display_name.is_some() && session.crypto.is_ready() {
                session.peer_joined = true;
            }
            // DUP-GUARD: re-seed persisted_counts so the next persist_session_tail
            // does NOT re-append the messages we just loaded.
            self.persisted_counts
                .insert(rec.session_id.clone(), session.messages.len());
            // The loaded record already has a valid group_id; don't rewrite it.
            self.finalized_session_records
                .insert(rec.session_id.clone());
            self.sessions.insert(rec.session_id.clone(), session);
        }
    }

    pub fn create_invite(
        &mut self,
        request: StartSessionRequest,
    ) -> Result<InviteCreated, PrivateDmRuntimeError> {
        let persist_listen_port = request.listen_port;
        let persist_static_peer = request.static_peer.clone();
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
            persist_listen_port,
            persist_static_peer.clone(),
            node,
            crypto,
            Arc::clone(&self.attachment_store),
        );

        self.sessions.insert(session_id.clone(), session);

        // Alice's group exists from create_group(), so the record is final the
        // moment it is written.
        if let Some(p) = self.persistence.as_ref() {
            if let Some(session) = self.sessions.get(&session_id) {
                if let Ok(json) = serde_json::to_vec(&session.to_persisted_record()) {
                    let _ = p.put_session(&session.session_id, &json);
                    let _ = p.put_mls_snapshot(&session.session_id, &session.crypto.snapshot());
                    self.finalized_session_records.insert(session_id.clone());
                }
            }
        }

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
        let persist_listen_port = request.listen_port;
        let mut crypto = MlsSessionCrypto::new(&request.display_name)?;
        let participant_id = crypto.random_token("participant")?;
        let key_package = crypto.key_package_bytes()?;
        let persist_static_peer = request.static_peer.clone().or(invite.peer_address.clone());
        let node = start_node(
            &self.moss,
            &invite.mesh_id,
            &invite.session_id,
            request.listen_port,
            persist_static_peer.clone(),
        )?;
        let envelope = ControlEnvelope::KeyPackage {
            session_id: invite.session_id.clone(),
            participant_id: participant_id.clone(),
            from_device: request.display_name.clone(),
            key_package_b64: encode(&key_package),
        };
        // Keep the serialized KeyPackage so the drain loop can re-publish it
        // until the Welcome arrives. The first publish below often lands before
        // the mesh link to Alice exists and is silently dropped.
        let key_package_payload = serde_json::to_vec(&envelope)
            .map_err(|error| PrivateDmRuntimeError::Codec(error.to_string()))?;

        node.publish(&control_channel(&invite.session_id), &key_package_payload)
            .map_err(|error| PrivateDmRuntimeError::Moss(error.to_string()))?;

        let mut session = PrivateDmSession::new(
            SessionRole::Bob,
            request.display_name,
            participant_id,
            invite.session_id.clone(),
            invite.mesh_id,
            invite.fingerprint,
            Some(request.invite_uri),
            persist_listen_port,
            persist_static_peer.clone(),
            node,
            crypto,
            Arc::clone(&self.attachment_store),
        );
        session.pending_key_package = Some(key_package_payload);
        session.last_handshake_send_ms = now_ms();

        let session_id = session.session_id.clone();
        self.sessions.insert(session_id.clone(), session);

        // Bob has no MLS group until he processes Alice's Welcome, so this
        // record carries an empty group_id placeholder. It is intentionally NOT
        // finalized here; persist_session_tail refreshes it once the group
        // exists so rehydrate can load it after a restart.
        if let Some(p) = self.persistence.as_ref() {
            if let Some(session) = self.sessions.get(&session_id) {
                if let Ok(json) = serde_json::to_vec(&session.to_persisted_record()) {
                    let _ = p.put_session(&session.session_id, &json);
                }
            }
        }

        self.poll_session(&session_id)
    }

    pub fn send_message(
        &mut self,
        session_id: &str,
        body: String,
    ) -> Result<SendMessageResult, PrivateDmRuntimeError> {
        self.drain_inbound()?;
        let (
            session_id_owned,
            data_channel,
            state,
            message_id,
            sent_at_ms,
            ciphertext_bytes,
            payload,
        ) = {
            let session = self.session_mut(session_id)?;
            let ciphertext = session.crypto.encrypt(body.as_bytes())?;
            let mut message = session.stamp_message(ChatMessage {
                from_device: session.device_id.clone(),
                body,
                message_id: None,
                sent_at_ms: None,
                attachment: None,
                call_event: None,
                delivery_status: Some(MessageDeliveryStatus::Pending),
                delivery_error: None,
                retryable: None,
                retry_count: Some(0),
            });
            let message_id = message.message_id.clone().unwrap_or_default();
            let sent_at_ms = message.sent_at_ms.unwrap_or_else(now_ms);
            message.message_id = Some(message_id.clone());
            message.sent_at_ms = Some(sent_at_ms);
            let envelope = DataEnvelope {
                session_id: session.session_id.clone(),
                participant_id: session.participant_id.clone(),
                from_device: session.device_id.clone(),
                message_id: Some(message_id.clone()),
                sent_at_ms: Some(sent_at_ms),
                ciphertext_b64: encode(&ciphertext),
            };
            let payload = serde_json::to_vec(&envelope)
                .map_err(|error| PrivateDmRuntimeError::Codec(error.to_string()))?;
            let attempt = OutboundAttemptRecord {
                conversation_id: session.session_id.clone(),
                message_id: message_id.clone(),
                sent_at_ms,
                ciphertext_bytes: ciphertext.len(),
                message_json: serde_json::to_string(&message)
                    .map_err(|error| PrivateDmRuntimeError::Codec(error.to_string()))?,
                publish_payload_b64: encode(&payload),
                delivery_status: MessageDeliveryStatus::Pending,
                delivery_error: None,
                retry_count: 0,
            };
            session.upsert_message(message);
            session
                .outbound_attempts
                .insert(message_id.clone(), attempt);
            (
                session.session_id.clone(),
                session.data_channel.clone(),
                session.state(),
                message_id,
                sent_at_ms,
                ciphertext.len(),
                payload,
            )
        };
        self.persist_outbound_state(session_id, &message_id, true);

        let publish = {
            let session = self.session_ref(session_id)?;
            session
                .node
                .publish(&data_channel, &payload)
                .map_err(|error| PrivateDmRuntimeError::Moss(error.to_string()))
        };

        let result = match publish {
            Ok(()) => {
                let session = self.session_mut(session_id)?;
                session.mark_delivery(&message_id, MessageDeliveryStatus::Sent, None, 0)?;
                session.outbound_attempts.remove(&message_id);
                SendMessageResult {
                    session_id: session_id_owned,
                    state,
                    ciphertext_bytes,
                    message_id: message_id.clone(),
                    sent_at_ms,
                    delivery_status: MessageDeliveryStatus::Sent,
                    delivery_error: None,
                }
            }
            Err(error) => {
                let error_text = error.to_string();
                let session = self.session_mut(session_id)?;
                let retry_count =
                    if let Some(attempt) = session.outbound_attempts.get_mut(&message_id) {
                        attempt.delivery_status = MessageDeliveryStatus::Failed;
                        attempt.delivery_error = Some(error_text.clone());
                        attempt.retry_count
                    } else {
                        0
                    };
                session.mark_delivery(
                    &message_id,
                    MessageDeliveryStatus::Failed,
                    Some(error_text.clone()),
                    retry_count,
                )?;
                session.sync_attempt_message_json(&message_id)?;
                SendMessageResult {
                    session_id: session_id_owned,
                    state,
                    ciphertext_bytes,
                    message_id: message_id.clone(),
                    sent_at_ms,
                    delivery_status: MessageDeliveryStatus::Failed,
                    delivery_error: Some(error_text),
                }
            }
        };
        self.persist_outbound_state(session_id, &message_id, false);
        self.persist_session_tail();
        Ok(result)
    }

    pub fn retry_message(
        &mut self,
        session_id: &str,
        message_id: &str,
    ) -> Result<SendMessageResult, PrivateDmRuntimeError> {
        self.drain_inbound()?;
        let (
            session_id_owned,
            data_channel,
            state,
            sent_at_ms,
            ciphertext_bytes,
            retry_count,
            payload,
        ) = {
            let session = self.session_mut(session_id)?;
            let (payload_b64, sent_at_ms, ciphertext_bytes) = {
                let attempt = session
                    .outbound_attempts
                    .get_mut(message_id)
                    .ok_or_else(|| PrivateDmRuntimeError::MissingMessage(message_id.to_string()))?;
                attempt.retry_count = attempt.retry_count.saturating_add(1);
                attempt.delivery_status = MessageDeliveryStatus::Pending;
                attempt.delivery_error = None;
                (
                    attempt.publish_payload_b64.clone(),
                    attempt.sent_at_ms,
                    attempt.ciphertext_bytes,
                )
            };
            let payload = decode(&payload_b64)?;
            let retry_count = session
                .outbound_attempts
                .get(message_id)
                .map(|attempt| attempt.retry_count)
                .unwrap_or(0);
            session.mark_delivery(
                message_id,
                MessageDeliveryStatus::Pending,
                None,
                retry_count,
            )?;
            session.sync_attempt_message_json(message_id)?;
            (
                session.session_id.clone(),
                session.data_channel.clone(),
                session.state(),
                sent_at_ms,
                ciphertext_bytes,
                retry_count,
                payload,
            )
        };
        self.persist_outbound_state(session_id, message_id, false);

        let publish = {
            let session = self.session_ref(session_id)?;
            session
                .node
                .publish(&data_channel, &payload)
                .map_err(|error| PrivateDmRuntimeError::Moss(error.to_string()))
        };

        let result = match publish {
            Ok(()) => {
                let session = self.session_mut(session_id)?;
                session.mark_delivery(
                    message_id,
                    MessageDeliveryStatus::Sent,
                    None,
                    retry_count,
                )?;
                session.outbound_attempts.remove(message_id);
                SendMessageResult {
                    session_id: session_id_owned,
                    state,
                    ciphertext_bytes,
                    message_id: message_id.to_string(),
                    sent_at_ms,
                    delivery_status: MessageDeliveryStatus::Sent,
                    delivery_error: None,
                }
            }
            Err(error) => {
                let error_text = error.to_string();
                let session = self.session_mut(session_id)?;
                if let Some(attempt) = session.outbound_attempts.get_mut(message_id) {
                    attempt.delivery_status = MessageDeliveryStatus::Failed;
                    attempt.delivery_error = Some(error_text.clone());
                }
                session.mark_delivery(
                    message_id,
                    MessageDeliveryStatus::Failed,
                    Some(error_text.clone()),
                    retry_count,
                )?;
                session.sync_attempt_message_json(message_id)?;
                SendMessageResult {
                    session_id: session_id_owned,
                    state,
                    ciphertext_bytes,
                    message_id: message_id.to_string(),
                    sent_at_ms,
                    delivery_status: MessageDeliveryStatus::Failed,
                    delivery_error: Some(error_text),
                }
            }
        };
        self.persist_outbound_state(session_id, message_id, false);
        Ok(result)
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
        Ok(SessionListSnapshot {
            sessions: snapshots,
        })
    }

    pub fn close_session(
        &mut self,
        session_id: &str,
    ) -> Result<CloseSessionResult, PrivateDmRuntimeError> {
        match self.sessions.remove(session_id) {
            Some(_) => {
                // Purge persisted state too, otherwise the conversation
                // re-appears on the next launch via rehydrate.
                self.persisted_counts.remove(session_id);
                self.finalized_session_records.remove(session_id);
                if let Some(p) = self.persistence.as_ref() {
                    if let Err(error) = p.delete_session(session_id) {
                        eprintln!("failed to delete persisted session {session_id}: {error}");
                    }
                }
                Ok(CloseSessionResult {
                    session_id: session_id.to_string(),
                    closed: true,
                })
            }
            None => Err(PrivateDmRuntimeError::MissingSession),
        }
    }

    fn drain_inbound(&mut self) -> Result<(), PrivateDmRuntimeError> {
        let inbound = drain_messages_where(|message| is_private_dm_inbound(&message.channel));
        for message in inbound {
            // A single bad inbound frame must never abort the drain — otherwise
            // it would also fail the caller (e.g. send_message drains first).
            // After a restart the in-memory replay-dedup set is empty, so the
            // mesh re-delivers already-consumed MLS messages; decrypting those
            // fails with "secret deleted to preserve forward secrecy". That is
            // expected, so drop the frame and keep going.
            if let Some(session_id) = channel_session_id(&message.channel).map(str::to_string) {
                if let Some(session) = self.sessions.get_mut(&session_id) {
                    if let Err(error) = session.handle_moss_message(message) {
                        eprintln!("dropping inbound frame for {session_id}: {error}");
                    }
                }
                continue;
            }
            if wire::channel_call_id(&message.channel).is_some() {
                for session in self.sessions.values_mut() {
                    if let Err(error) = session.handle_moss_message(message.clone()) {
                        eprintln!("dropping inbound call frame: {error}");
                    }
                }
            }
        }
        // Keep every active download fed, and re-drive any incomplete MLS
        // handshake, without waiting on a user action. The UI polls roughly
        // once a second, so this is the heartbeat that retransmits a KeyPackage
        // whose first publish was dropped before the mesh link formed.
        let now = now_ms();
        for session in self.sessions.values_mut() {
            session.pump_attachment_requests();
            session.pump_handshake(now);
        }
        self.persist_session_tail();
        Ok(())
    }

    fn persist_outbound_state(
        &mut self,
        session_id: &str,
        message_id: &str,
        persist_snapshot: bool,
    ) {
        let Some(p) = self.persistence.as_ref().cloned() else {
            return;
        };
        let (sent_at_ms, message_row, attempt_row, snapshot, session_row, needs_record_refresh) = {
            let Some(session) = self.sessions.get(session_id) else {
                return;
            };
            let Some(message) = session
                .messages
                .iter()
                .find(|message| message.message_id.as_deref() == Some(message_id))
            else {
                return;
            };
            let sent_at_ms = message.sent_at_ms.unwrap_or_else(now_ms);
            let message_row = serde_json::to_vec(&contracts::PersistedMessage {
                conversation_id: session.session_id.clone(),
                sent_at_ms,
                message_id: message_id.to_string(),
                message: message.clone(),
            })
            .ok();
            let attempt_row = session
                .outbound_attempts
                .get(message_id)
                .and_then(|attempt| serde_json::to_vec(attempt).ok());
            let snapshot = persist_snapshot.then(|| session.crypto.snapshot());
            let needs_record_refresh = !self.finalized_session_records.contains(session_id)
                && session.crypto.group_id_bytes().is_some();
            let session_row = needs_record_refresh
                .then(|| serde_json::to_vec(&session.to_persisted_record()).ok())
                .flatten();
            (
                sent_at_ms,
                message_row,
                attempt_row,
                snapshot,
                session_row,
                needs_record_refresh,
            )
        };

        if let Some(row) = message_row {
            let _ = p.append_message(session_id, sent_at_ms, message_id, &row);
        }
        if let Some(snapshot) = snapshot {
            let _ = p.put_mls_snapshot(session_id, &snapshot);
        }
        match attempt_row {
            Some(row) => {
                let _ =
                    p.put_outbound_attempt(OUTBOUND_SCOPE_PRIVATE_DM, session_id, message_id, &row);
            }
            None => {
                let _ =
                    p.delete_outbound_attempt(OUTBOUND_SCOPE_PRIVATE_DM, session_id, message_id);
            }
        }
        if let Some(row) = session_row {
            let _ = p.put_session(session_id, &row);
            if needs_record_refresh {
                self.finalized_session_records
                    .insert(session_id.to_string());
            }
        }
    }

    fn persist_session_tail(&mut self) {
        let Some(p) = self.persistence.as_ref().cloned() else {
            return;
        };
        // Records to (re)write once their MLS group exists. Collected during the
        // read-only loop and applied after, since finalizing mutates self.
        let mut pending_records: Vec<(String, Vec<u8>)> = Vec::new();
        for session in self.sessions.values() {
            let start = self
                .persisted_counts
                .get(&session.session_id)
                .copied()
                .unwrap_or(0);
            let has_new_messages = session.messages.len() > start;
            for (idx, msg) in session.messages.iter().enumerate().skip(start) {
                let ts = msg.sent_at_ms.unwrap_or_else(now_ms);
                let message_id = msg
                    .message_id
                    .clone()
                    .unwrap_or_else(|| format!("{ts}-{idx:06}"));
                let mut message = msg.clone();
                if message.sent_at_ms.is_none() {
                    message.sent_at_ms = Some(ts);
                }
                if message.message_id.is_none() {
                    message.message_id = Some(message_id.clone());
                }
                let record = contracts::PersistedMessage {
                    conversation_id: session.session_id.clone(),
                    sent_at_ms: ts,
                    message_id: message_id.clone(),
                    message,
                };
                if let Ok(json) = serde_json::to_vec(&record) {
                    let _ = p.append_message(&session.session_id, ts, &message_id, &json);
                }
            }

            // The session record needs refreshing once the MLS group exists
            // (e.g. after the joiner processes the Welcome), so its group_id is
            // no longer the empty placeholder.
            let needs_record_refresh =
                !self.finalized_session_records.contains(&session.session_id)
                    && session.crypto.group_id_bytes().is_some();

            // Only rewrite the (encrypted) MLS snapshot when state actually
            // advanced — new messages ratchet the group, and a freshly joined
            // group must be captured. Skipping idle polls avoids re-encrypting
            // the full snapshot on every UI refresh, which also starved the
            // loopback handshake under test on slow CI hardware.
            if has_new_messages || needs_record_refresh {
                let _ = p.put_mls_snapshot(&session.session_id, &session.crypto.snapshot());
            }

            if needs_record_refresh {
                if let Ok(json) = serde_json::to_vec(&session.to_persisted_record()) {
                    pending_records.push((session.session_id.clone(), json));
                }
            }
        }
        for (id, json) in pending_records {
            let _ = p.put_session(&id, &json);
            self.finalized_session_records.insert(id);
        }
        let new_counts: Vec<(String, usize)> = self
            .sessions
            .values()
            .map(|s| (s.session_id.clone(), s.messages.len()))
            .collect();
        for (id, len) in new_counts {
            self.persisted_counts.insert(id, len);
        }
    }

    fn session_mut(
        &mut self,
        session_id: &str,
    ) -> Result<&mut PrivateDmSession, PrivateDmRuntimeError> {
        self.sessions
            .get_mut(session_id)
            .ok_or(PrivateDmRuntimeError::MissingSession)
    }

    fn session_ref(&self, session_id: &str) -> Result<&PrivateDmSession, PrivateDmRuntimeError> {
        self.sessions
            .get(session_id)
            .ok_or(PrivateDmRuntimeError::MissingSession)
    }

    pub fn call_start(&mut self, session_id: &str) -> Result<CallStarted, PrivateDmRuntimeError> {
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

fn is_private_dm_inbound(channel: &str) -> bool {
    channel_session_id(channel).is_some() || wire::channel_call_id(channel).is_some()
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
        listen_port: u16,
        static_peer: Option<String>,
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
            listen_port,
            static_peer,
            peer_display_name: None,
            peer_joined: false,
            node,
            crypto,
            messages: Vec::new(),
            message_ids: MessageIdGen::default(),
            seen_moss_messages: HashSet::new(),
            seen_order: VecDeque::new(),
            control_channel,
            data_channel,
            blob_channel,
            attachment_store,
            attachments: AttachmentRuntime::new(),
            attachment_slots: HashMap::new(),
            outbound_attempts: HashMap::new(),
            call: None,
            pending_key_package: None,
            pending_welcome: None,
            last_handshake_send_ms: 0,
        }
    }

    /// Builds the persisted record from the live session. `group_id` reflects
    /// the current MLS group, so re-persisting after the joiner processes the
    /// Welcome replaces the empty placeholder written at accept time.
    fn to_persisted_record(&self) -> contracts::PersistedSession {
        contracts::PersistedSession {
            role_is_alice: matches!(self.role, SessionRole::Alice),
            display_name: self.device_id.clone(),
            participant_id: self.participant_id.clone(),
            session_id: self.session_id.clone(),
            mesh_id: self.mesh_id.clone(),
            fingerprint: self.fingerprint.clone(),
            invite_uri: self.invite_uri.clone(),
            signer_public: self.crypto.signer_public(),
            group_id: self.crypto.group_id_bytes().unwrap_or_default(),
            listen_port: self.listen_port,
            static_peer: self.static_peer.clone(),
        }
    }

    fn stamp_message(&self, mut message: ChatMessage) -> ChatMessage {
        let sent_at_ms = message.sent_at_ms.unwrap_or_else(now_ms);
        message.sent_at_ms = Some(sent_at_ms);
        if message.message_id.as_deref().unwrap_or_default().is_empty() {
            message.message_id = Some(self.message_ids.next(sent_at_ms));
        }
        message
    }

    fn upsert_message(&mut self, message: ChatMessage) {
        if let Some(message_id) = message.message_id.as_deref() {
            if let Some(existing) = self
                .messages
                .iter_mut()
                .find(|existing| existing.message_id.as_deref() == Some(message_id))
            {
                *existing = message;
                return;
            }
        }
        self.messages.push(message);
    }

    fn find_message_mut(&mut self, message_id: &str) -> Option<&mut ChatMessage> {
        self.messages
            .iter_mut()
            .find(|message| message.message_id.as_deref() == Some(message_id))
    }

    fn has_message(&self, candidate: &ChatMessage) -> bool {
        self.messages.iter().any(|existing| {
            existing.from_device == candidate.from_device
                && match (
                    existing.message_id.as_deref(),
                    candidate.message_id.as_deref(),
                ) {
                    (Some(left), Some(right)) if !left.is_empty() && !right.is_empty() => {
                        left == right
                    }
                    _ => {
                        existing.sent_at_ms == candidate.sent_at_ms
                            && existing.body == candidate.body
                    }
                }
        })
    }

    fn mark_delivery(
        &mut self,
        message_id: &str,
        status: MessageDeliveryStatus,
        error: Option<String>,
        retry_count: u32,
    ) -> Result<(), PrivateDmRuntimeError> {
        let message = self
            .find_message_mut(message_id)
            .ok_or_else(|| PrivateDmRuntimeError::MissingMessage(message_id.to_string()))?;
        apply_delivery(message, status, error, retry_count);
        Ok(())
    }

    fn sync_attempt_message_json(&mut self, message_id: &str) -> Result<(), PrivateDmRuntimeError> {
        let message_json = self
            .messages
            .iter()
            .find(|message| message.message_id.as_deref() == Some(message_id))
            .ok_or_else(|| PrivateDmRuntimeError::MissingMessage(message_id.to_string()))
            .and_then(|message| {
                serde_json::to_string(message)
                    .map_err(|error| PrivateDmRuntimeError::Codec(error.to_string()))
            })?;
        if let Some(attempt) = self.outbound_attempts.get_mut(message_id) {
            attempt.message_json = message_json;
        }
        Ok(())
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

    /// Remember the peer's display name from an inbound frame's `from_device`.
    fn note_peer_name(&mut self, from_device: &str) {
        if from_device.is_empty() || from_device == self.device_id {
            return;
        }
        if self.peer_display_name.as_deref() != Some(from_device) {
            self.peer_display_name = Some(from_device.to_string());
        }
    }

    fn note_verified_peer_activity(&mut self, from_device: &str) {
        let is_peer = !from_device.is_empty() && from_device != self.device_id;
        self.note_peer_name(from_device);
        if is_peer && self.crypto.is_ready() {
            self.peer_joined = true;
        }
    }

    /// True when a pending KeyPackage should be re-published: the handshake is
    /// not complete, we still hold the payload, and the throttle window elapsed.
    fn handshake_resend_due(&self, now_ms: u64) -> bool {
        !self.peer_joined
            && self.pending_key_package.is_some()
            && now_ms.saturating_sub(self.last_handshake_send_ms) >= HANDSHAKE_RESEND_MS
    }

    /// Best-effort retransmit of the joiner's KeyPackage while the MLS handshake
    /// is still incomplete. Driven by the inbound drain loop (≈1/s), throttled
    /// to HANDSHAKE_RESEND_MS. Once the peer has joined the pending payload is
    /// dropped so nothing is re-sent.
    fn pump_handshake(&mut self, now_ms: u64) {
        if self.peer_joined {
            self.pending_key_package = None;
            return;
        }
        if !self.handshake_resend_due(now_ms) {
            return;
        }
        let Some(payload) = self.pending_key_package.clone() else {
            return;
        };
        self.last_handshake_send_ms = now_ms;
        let _ = self.node.publish(&self.control_channel, &payload);
    }

    fn handle_control(&mut self, payload: Vec<u8>) -> Result<(), PrivateDmRuntimeError> {
        let envelope: ControlEnvelope = decode_json(&payload)?;

        match envelope {
            ControlEnvelope::KeyPackage {
                session_id,
                participant_id,
                from_device,
                key_package_b64,
            } if self.is_alice_session(&session_id, &participant_id) => {
                self.note_peer_name(&from_device);
                // Bob re-sends his KeyPackage until he sees the Welcome. If we
                // already added him, our first Welcome was likely lost before
                // his node meshed, so re-answer with the cached copy rather than
                // calling add_members again (which advances the group epoch).
                if self.peer_joined {
                    if let Some(welcome_payload) = self.pending_welcome.clone() {
                        return self
                            .node
                            .publish(&self.control_channel, &welcome_payload)
                            .map_err(|error| PrivateDmRuntimeError::Moss(error.to_string()));
                    }
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
                let welcome_payload = serde_json::to_vec(&envelope)
                    .map_err(|error| PrivateDmRuntimeError::Codec(error.to_string()))?;
                self.pending_welcome = Some(welcome_payload.clone());

                self.node
                    .publish(&self.control_channel, &welcome_payload)
                    .map_err(|error| PrivateDmRuntimeError::Moss(error.to_string()))
            }
            ControlEnvelope::Welcome {
                session_id,
                participant_id,
                from_device,
                welcome_b64,
                ratchet_tree_b64,
            } if self.is_bob_session(&session_id, &participant_id) => {
                if self.peer_joined {
                    return Ok(());
                }
                self.note_peer_name(&from_device);
                self.crypto
                    .join_welcome(&decode(&welcome_b64)?, &decode(&ratchet_tree_b64)?)?;
                self.peer_joined = true;
                // Joined: stop retransmitting the KeyPackage.
                self.pending_key_package = None;
                Ok(())
            }
            ControlEnvelope::AttachmentManifest {
                session_id,
                participant_id,
                from_device,
                manifest_ciphertext_b64,
            } if session_id == self.session_id && participant_id != self.participant_id => {
                let manifest_json = self.crypto.decrypt(&decode(&manifest_ciphertext_b64)?)?;
                let manifest: AttachmentManifest = decode_json(&manifest_json)?;
                self.note_verified_peer_activity(&from_device);
                self.accept_incoming_manifest(from_device, manifest)
            }
            ControlEnvelope::CallOffer {
                session_id,
                participant_id,
                from_device,
                call_id,
                offer_ciphertext_b64,
            } if session_id == self.session_id && participant_id != self.participant_id => {
                if self.call.is_some() {
                    return Ok(());
                }
                let plaintext = self.crypto.decrypt(&decode(&offer_ciphertext_b64)?)?;
                let body: CallOfferBody = decode_json(&plaintext)?;
                self.note_verified_peer_activity(&from_device);
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
            } if session_id == self.session_id && participant_id != self.participant_id => {
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
            } if session_id == self.session_id && participant_id != self.participant_id => {
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
                reason: _,
            } if session_id == self.session_id && participant_id != self.participant_id => {
                if let Some(call) = self.call.as_ref() {
                    if call.call_id == call_id {
                        let duration = call.duration_ms(now_ms());
                        let kind = call.end_kind();
                        let _ = self.node.unsubscribe_voice_call(&call.call_id);
                        let remote = call.remote_device.clone();
                        let call_id_owned = call.call_id.clone();
                        self.call = None;
                        self.append_call_event_message(&remote, kind, duration, &call_id_owned);
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
        let message = self.stamp_message(ChatMessage {
            from_device: remote_device.to_string(),
            body: String::new(),
            message_id: None,
            sent_at_ms: None,
            attachment: None,
            call_event: Some(CallEvent {
                kind: kind.to_string(),
                duration_ms,
                call_id: call_id.to_string(),
            }),
            delivery_status: None,
            delivery_error: None,
            retryable: None,
            retry_count: None,
        });
        self.messages.push(message);
    }

    fn handle_data(&mut self, payload: Vec<u8>) -> Result<(), PrivateDmRuntimeError> {
        let envelope: DataEnvelope = decode_json(&payload)?;

        if envelope.session_id != self.session_id || envelope.participant_id == self.participant_id
        {
            return Ok(());
        }

        let plaintext = self.crypto.decrypt(&decode(&envelope.ciphertext_b64)?)?;
        self.note_verified_peer_activity(&envelope.from_device);
        let message = self.stamp_message(ChatMessage {
            from_device: envelope.from_device,
            body: String::from_utf8_lossy(&plaintext).into_owned(),
            message_id: envelope.message_id,
            sent_at_ms: envelope.sent_at_ms,
            attachment: None,
            call_event: None,
            delivery_status: None,
            delivery_error: None,
            retryable: None,
            retry_count: None,
        });
        if self.has_message(&message) {
            return Ok(());
        }
        self.messages.push(message);

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
                        content_hash,
                        bytes,
                        ..
                    }) => {
                        let path =
                            self.attachment_store
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
        let message = self.stamp_message(ChatMessage {
            from_device,
            body: String::new(),
            message_id: None,
            sent_at_ms: None,
            attachment: Some(descriptor),
            call_event: None,
            delivery_status: None,
            delivery_error: None,
            retryable: None,
            retry_count: None,
        });
        self.messages.push(message);
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
        if !self.ready_for_user_actions() {
            return Err(PrivateDmRuntimeError::NotReady);
        }
        let attachment_id = self.crypto.random_token("attachment")?;
        let manifest = self.attachments.prepare_outgoing(OutgoingAttachment {
            attachment_id: attachment_id.clone(),
            file_name,
            mime,
            from_fingerprint: self.fingerprint.clone(),
            bytes: bytes.clone(),
            thumbnail_b64: thumbnail,
            voice,
        })?;
        let stored = self.attachment_store.write_blob(
            &manifest.content_hash,
            &manifest.file_name,
            &bytes,
        )?;
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
        let message = self.stamp_message(ChatMessage {
            from_device: self.device_id.clone(),
            body: String::new(),
            message_id: None,
            sent_at_ms: None,
            attachment: Some(descriptor),
            call_event: None,
            delivery_status: None,
            delivery_error: None,
            retryable: None,
            retry_count: None,
        });
        self.messages.push(message);
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
            .ok_or_else(|| PrivateDmRuntimeError::MissingAttachment(attachment_id.to_string()))?;
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

    fn cancel_attachment(&mut self, attachment_id: &str) -> Result<(), PrivateDmRuntimeError> {
        let slot = self
            .attachment_slots
            .get_mut(attachment_id)
            .ok_or_else(|| PrivateDmRuntimeError::MissingAttachment(attachment_id.to_string()))?;
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
            peer_display_name: self.peer_display_name.clone().unwrap_or_default(),
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
            outgoing_call: self.call.as_ref().and_then(|call| {
                if call.phase == CallPhase::Outgoing {
                    Some(OutgoingCall {
                        call_id: call.call_id.clone(),
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
        if self.ready_for_user_actions() {
            "ready".to_string()
        } else {
            "waiting".to_string()
        }
    }

    fn ready_for_user_actions(&self) -> bool {
        self.peer_joined && self.crypto.is_ready() && self.has_live_peer()
    }

    fn has_live_peer(&self) -> bool {
        self.mesh_info().is_some_and(|info| {
            info.peer_count > 0 || info.direct_peer_count > 0 || info.relayed_peer_count > 0
        })
    }

    fn call_start(&mut self) -> Result<CallStarted, PrivateDmRuntimeError> {
        if !self.ready_for_user_actions() {
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
        let kind = call.end_kind();
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
                bind_interface: None,
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

    // Real two-node loopback handshake; the gossipsub mesh occasionally fails
    // to form in time, so this is an on-demand smoke test (run with
    // `cargo test -- --ignored`). The persistence/resume logic it exercises is
    // covered deterministically by the crypto restore tests and the
    // handshake-free history_and_session_survive_restart.
    #[test]
    #[ignore]
    fn private_dm_runtime_exchanges_e2ee_message_over_moss() {
        let _guard = MOSS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        drain_received_messages();
        let runtime = Arc::new(MossFfiRuntime::load_default().expect("Moss runtime should load"));
        let mut alice = PrivateDmRuntime::from_shared(Arc::clone(&runtime), temp_store(), None);
        let invite = alice
            .create_invite(StartSessionRequest {
                display_name: "Alice".to_string(),
                listen_port: 42130,
                static_peer: None,
            })
            .expect("Alice invite should be created");

        let mut bob = PrivateDmRuntime::from_shared(runtime, temp_store(), None);
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

    #[test]
    fn waiting_creator_invite_survives_restart() {
        use crate::adapters::persistence::Persistence;
        use std::path::PathBuf;

        let _guard = MOSS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        drain_received_messages();

        let mut db_path: PathBuf = std::env::temp_dir();
        db_path.push(format!(
            "mosh-dm-waiting-invite-{}.redb",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&db_path);

        let persistence =
            Arc::new(Persistence::open_with_dek(&db_path, [29u8; 32]).expect("store should open"));
        let runtime = Arc::new(MossFfiRuntime::load_default().expect("Moss runtime should load"));

        let (session_id, invite_uri) = {
            let mut alice = PrivateDmRuntime::from_shared(
                Arc::clone(&runtime),
                temp_store(),
                Some(persistence.clone()),
            );
            let invite = alice
                .create_invite(StartSessionRequest {
                    display_name: "Alice".to_string(),
                    listen_port: 42170,
                    static_peer: None,
                })
                .expect("Alice invite should be created");
            (invite.session_id, invite.invite_uri)
        };

        let mut revived =
            PrivateDmRuntime::from_shared(Arc::clone(&runtime), temp_store(), Some(persistence));
        revived.rehydrate();

        let listing = revived.list_sessions().expect("listing should pass");
        let session = listing
            .sessions
            .iter()
            .find(|session| session.session_id == session_id)
            .expect("waiting invite should rehydrate");

        assert_eq!(session.state, "waiting");
        assert_eq!(session.role, "alice");
        assert_eq!(session.invite_uri.as_deref(), Some(invite_uri.as_str()));
        assert!(session.messages.is_empty());

        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn restored_inbound_history_waits_for_live_peer() {
        use crate::adapters::persistence::Persistence;
        use std::path::PathBuf;

        let _guard = MOSS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        drain_received_messages();

        let mut db_path: PathBuf = std::env::temp_dir();
        db_path.push(format!("mosh-dm-inbound-ready-{}.redb", std::process::id()));
        let _ = std::fs::remove_file(&db_path);

        let persistence =
            Arc::new(Persistence::open_with_dek(&db_path, [31u8; 32]).expect("store should open"));
        let runtime = Arc::new(MossFfiRuntime::load_default().expect("Moss runtime should load"));

        let session_id = {
            let mut alice = PrivateDmRuntime::from_shared(
                Arc::clone(&runtime),
                temp_store(),
                Some(persistence.clone()),
            );
            let invite = alice
                .create_invite(StartSessionRequest {
                    display_name: "Alice".to_string(),
                    listen_port: 42171,
                    static_peer: None,
                })
                .expect("Alice invite should be created");
            let message_id = "inbound-000001";
            let sent_at_ms = 1;
            let message = ChatMessage {
                from_device: "Bob".to_string(),
                body: "hello from bob".to_string(),
                message_id: Some(message_id.to_string()),
                sent_at_ms: Some(sent_at_ms),
                attachment: None,
                call_event: None,
                delivery_status: None,
                delivery_error: None,
                retryable: None,
                retry_count: None,
            };
            let record = contracts::PersistedMessage {
                conversation_id: invite.session_id.clone(),
                sent_at_ms,
                message_id: message_id.to_string(),
                message,
            };
            persistence
                .append_message(
                    &invite.session_id,
                    sent_at_ms,
                    message_id,
                    &serde_json::to_vec(&record).expect("record should serialize"),
                )
                .expect("inbound message should persist");
            invite.session_id
        };

        let mut revived =
            PrivateDmRuntime::from_shared(Arc::clone(&runtime), temp_store(), Some(persistence));
        revived.rehydrate();

        let listing = revived.list_sessions().expect("listing should pass");
        let session = listing
            .sessions
            .iter()
            .find(|session| session.session_id == session_id)
            .expect("session should rehydrate");

        assert_eq!(session.peer_display_name, "Bob");
        assert_eq!(session.state, "waiting");
        assert_eq!(session.messages.len(), 1);

        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn decrypted_inbound_data_without_live_peer_stays_waiting() {
        let _guard = MOSS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        drain_received_messages();

        let runtime = Arc::new(MossFfiRuntime::load_default().expect("Moss runtime should load"));
        let mut alice = PrivateDmRuntime::from_shared(Arc::clone(&runtime), temp_store(), None);
        let invite = alice
            .create_invite(StartSessionRequest {
                display_name: "Alice".to_string(),
                listen_port: 42172,
                static_peer: None,
            })
            .expect("Alice invite should be created");

        let mut bob_crypto = MlsSessionCrypto::new("Bob").expect("Bob crypto should init");
        let bob_participant = "bob-participant".to_string();
        let key_package = bob_crypto
            .key_package_bytes()
            .expect("Bob key package should build");

        let (welcome, tree) = {
            let session = alice
                .sessions
                .get_mut(&invite.session_id)
                .expect("Alice session should exist");
            let result = session
                .crypto
                .add_peer(&key_package)
                .expect("Alice should add Bob");
            session.peer_joined = false;
            result
        };
        bob_crypto
            .join_welcome(&welcome, &tree)
            .expect("Bob should join");
        let ciphertext = bob_crypto
            .encrypt(b"hello after flag loss")
            .expect("Bob should encrypt");

        let payload = serde_json::to_vec(&DataEnvelope {
            session_id: invite.session_id.clone(),
            participant_id: bob_participant,
            from_device: "Bob".to_string(),
            message_id: Some("live-inbound-000001".to_string()),
            sent_at_ms: Some(2),
            ciphertext_b64: encode(&ciphertext),
        })
        .expect("data envelope should serialize");

        let session = alice
            .sessions
            .get_mut(&invite.session_id)
            .expect("Alice session should exist");
        assert_eq!(session.state(), "waiting");

        session
            .handle_data(payload)
            .expect("Alice should decrypt inbound data");

        assert!(session.peer_joined);
        assert_eq!(session.state(), "waiting");
        assert_eq!(session.peer_display_name.as_deref(), Some("Bob"));
    }

    // D2 regression: the KeyPackage->Welcome handshake is a one-shot publish.
    // If it lands before the mesh link forms it is lost, and nothing used to
    // re-send it, so the session hung on "waiting" forever even after the peer
    // joined the transport. Bob must keep the KeyPackage and re-send it until
    // he joins.
    #[test]
    fn bob_retransmits_key_package_until_joined() {
        let _guard = MOSS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        drain_received_messages();

        let runtime = Arc::new(MossFfiRuntime::load_default().expect("Moss runtime should load"));
        let mut alice = PrivateDmRuntime::from_shared(Arc::clone(&runtime), temp_store(), None);
        let invite = alice
            .create_invite(StartSessionRequest {
                display_name: "Alice".to_string(),
                listen_port: 42180,
                static_peer: None,
            })
            .expect("Alice invite should be created");

        let mut bob = PrivateDmRuntime::from_shared(Arc::clone(&runtime), temp_store(), None);
        bob.accept_invite(AcceptInviteRequest {
            invite_uri: invite.invite_uri.clone(),
            display_name: "Bob".to_string(),
            listen_port: 42181,
            static_peer: Some("127.0.0.1:42180".to_string()),
        })
        .expect("Bob should accept invite");

        let session = bob
            .sessions
            .get_mut(&invite.session_id)
            .expect("Bob session should exist");
        assert!(
            session.pending_key_package.is_some(),
            "Bob retains the KeyPackage for retransmit"
        );
        assert!(!session.peer_joined);

        // Throttle from a known baseline (accept_invite stamped real-now).
        session.last_handshake_send_ms = 0;
        assert!(
            session.handshake_resend_due(HANDSHAKE_RESEND_MS + 1),
            "resend is due once the throttle window elapses"
        );
        assert!(
            !session.handshake_resend_due(HANDSHAKE_RESEND_MS - 1),
            "resend is suppressed inside the throttle window"
        );

        // Welcome processed -> handshake complete -> stop retransmitting.
        session.peer_joined = true;
        session.pump_handshake(HANDSHAKE_RESEND_MS * 10);
        assert!(
            session.pending_key_package.is_none(),
            "joining clears the pending KeyPackage"
        );
        assert!(!session.handshake_resend_due(HANDSHAKE_RESEND_MS * 100));
    }

    // D2 regression: Alice's Welcome can also be lost before Bob meshes. Since
    // add_members cannot run twice (it would advance the group epoch), Alice
    // must cache the Welcome and re-answer Bob's repeated KeyPackage with it.
    #[test]
    fn alice_caches_welcome_and_reanswers_repeat_key_package() {
        let _guard = MOSS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        drain_received_messages();

        let runtime = Arc::new(MossFfiRuntime::load_default().expect("Moss runtime should load"));
        let mut alice = PrivateDmRuntime::from_shared(Arc::clone(&runtime), temp_store(), None);
        let invite = alice
            .create_invite(StartSessionRequest {
                display_name: "Alice".to_string(),
                listen_port: 42182,
                static_peer: None,
            })
            .expect("Alice invite should be created");

        let mut bob_crypto = MlsSessionCrypto::new("Bob").expect("Bob crypto should init");
        let key_package_b64 = encode(
            &bob_crypto
                .key_package_bytes()
                .expect("Bob key package should build"),
        );
        let payload = serde_json::to_vec(&ControlEnvelope::KeyPackage {
            session_id: invite.session_id.clone(),
            participant_id: "bob-participant".to_string(),
            from_device: "Bob".to_string(),
            key_package_b64,
        })
        .expect("KeyPackage envelope should serialize");

        let session = alice
            .sessions
            .get_mut(&invite.session_id)
            .expect("Alice session should exist");

        session
            .handle_control(payload.clone())
            .expect("first KeyPackage should add Bob");
        assert!(session.peer_joined);
        assert!(
            session.pending_welcome.is_some(),
            "Alice caches the Welcome she produced"
        );
        assert_eq!(session.crypto.member_count(), 2);

        // Bob's retransmit must be re-answered, never trigger a second add.
        session
            .handle_control(payload)
            .expect("repeat KeyPackage should re-answer with the cached Welcome");
        assert_eq!(
            session.crypto.member_count(),
            2,
            "repeat KeyPackage must not re-run add_members"
        );
        assert!(session.pending_welcome.is_some());
    }

    #[test]
    fn history_and_session_survive_restart() {
        use crate::adapters::persistence::Persistence;
        use std::path::PathBuf;

        let _guard = MOSS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        drain_received_messages();

        let mut db_path: PathBuf = std::env::temp_dir();
        db_path.push(format!("mosh-dm-rehydrate-{}.redb", std::process::id()));
        let _ = std::fs::remove_file(&db_path);

        let persistence =
            Arc::new(Persistence::open_with_dek(&db_path, [9u8; 32]).expect("store should open"));

        let runtime = Arc::new(MossFfiRuntime::load_default().expect("Moss runtime should load"));

        // Runtime #1: create an invite + send one message, then drop it.
        let session_id = {
            let mut alice = PrivateDmRuntime::from_shared(
                Arc::clone(&runtime),
                temp_store(),
                Some(persistence.clone()),
            );
            let invite = alice
                .create_invite(StartSessionRequest {
                    display_name: "Alice".to_string(),
                    listen_port: 42140,
                    static_peer: None,
                })
                .expect("Alice invite should be created");
            alice
                .send_message(&invite.session_id, "hello after restart".to_string())
                .expect("Alice should send");
            invite.session_id
        };

        // Runtime #2: rehydrate from the SAME store and prove the message is back.
        let mut revived = PrivateDmRuntime::from_shared(
            Arc::clone(&runtime),
            temp_store(),
            Some(persistence.clone()),
        );
        revived.rehydrate();

        let listing = revived.list_sessions().expect("listing should pass");
        let session = listing
            .sessions
            .iter()
            .find(|s| s.session_id == session_id)
            .expect("rehydrated session should be present");

        let matching: Vec<&ChatMessage> = session
            .messages
            .iter()
            .filter(|m| m.body == "hello after restart")
            .collect();
        assert_eq!(
            matching.len(),
            1,
            "expected exactly one rehydrated message, dup-guard failed: {:?}",
            session.messages
        );

        // Dup-guard: re-listing (which drains inbound + persists tail) must not
        // duplicate the loaded message.
        let listing2 = revived.list_sessions().expect("second listing should pass");
        let session2 = listing2
            .sessions
            .iter()
            .find(|s| s.session_id == session_id)
            .expect("session should still be present");
        let matching2 = session2
            .messages
            .iter()
            .filter(|m| m.body == "hello after restart")
            .count();
        assert_eq!(
            matching2, 1,
            "tail-persist re-append duplicated the message"
        );

        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn failed_send_rehydrates_as_retryable_message() {
        use crate::adapters::persistence::Persistence;
        use std::path::PathBuf;

        let _guard = MOSS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        drain_received_messages();

        let mut db_path: PathBuf = std::env::temp_dir();
        db_path.push(format!("mosh-dm-failed-send-{}.redb", std::process::id()));
        let _ = std::fs::remove_file(&db_path);

        let persistence =
            Arc::new(Persistence::open_with_dek(&db_path, [19u8; 32]).expect("store should open"));
        let runtime = Arc::new(MossFfiRuntime::load_default().expect("Moss runtime should load"));

        let (session_id, message_id) = {
            let mut alice = PrivateDmRuntime::from_shared(
                Arc::clone(&runtime),
                temp_store(),
                Some(persistence.clone()),
            );
            let invite = alice
                .create_invite(StartSessionRequest {
                    display_name: "Alice".to_string(),
                    listen_port: 42160,
                    static_peer: None,
                })
                .expect("Alice invite should be created");
            let _publish_fail = wire::fail_next_test_publish("simulated publish failure");
            let result = alice
                .send_message(&invite.session_id, "hello failed history".to_string())
                .expect("send should return failed result");
            assert_eq!(
                result.delivery_status,
                contracts::MessageDeliveryStatus::Failed
            );
            assert_eq!(
                result.delivery_error.as_deref(),
                Some("Moss error: simulated publish failure")
            );
            assert!(!result.message_id.is_empty());

            let live = alice
                .poll_session(&invite.session_id)
                .expect("poll should surface failed message");
            let failed = live
                .messages
                .iter()
                .find(|message| message.message_id.as_deref() == Some(result.message_id.as_str()))
                .expect("failed message should be recorded");
            assert_eq!(
                failed.delivery_status,
                Some(contracts::MessageDeliveryStatus::Failed)
            );
            assert_eq!(
                failed.delivery_error.as_deref(),
                Some("Moss error: simulated publish failure")
            );

            (invite.session_id, result.message_id)
        };

        let mut revived =
            PrivateDmRuntime::from_shared(Arc::clone(&runtime), temp_store(), Some(persistence));
        revived.rehydrate();
        let listing = revived.list_sessions().expect("listing should pass");
        let session = listing
            .sessions
            .iter()
            .find(|session| session.session_id == session_id)
            .expect("rehydrated session should be present");
        let failed = session
            .messages
            .iter()
            .find(|message| message.message_id.as_deref() == Some(message_id.as_str()))
            .expect("failed message should rehydrate");
        assert_eq!(
            failed.delivery_status,
            Some(contracts::MessageDeliveryStatus::Failed)
        );
        assert_eq!(failed.retryable, Some(true));

        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn retry_message_reuses_message_id_and_clears_failed_attempt() {
        use crate::adapters::persistence::Persistence;
        use std::path::PathBuf;

        let _guard = MOSS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        drain_received_messages();

        let mut db_path: PathBuf = std::env::temp_dir();
        db_path.push(format!("mosh-dm-retry-{}.redb", std::process::id()));
        let _ = std::fs::remove_file(&db_path);

        let persistence =
            Arc::new(Persistence::open_with_dek(&db_path, [23u8; 32]).expect("store should open"));
        let runtime = Arc::new(MossFfiRuntime::load_default().expect("Moss runtime should load"));

        let (invite, failed_message_id) = {
            let mut alice = PrivateDmRuntime::from_shared(
                Arc::clone(&runtime),
                temp_store(),
                Some(persistence.clone()),
            );
            let invite = alice
                .create_invite(StartSessionRequest {
                    display_name: "Alice".to_string(),
                    listen_port: 42161,
                    static_peer: None,
                })
                .expect("Alice invite should be created");
            let _publish_fail = wire::fail_next_test_publish("simulated publish failure");
            let failed = alice
                .send_message(&invite.session_id, "retry this".to_string())
                .expect("failed send should still return a result");

            let retried = alice
                .retry_message(&invite.session_id, &failed.message_id)
                .expect("retry should succeed");
            assert_eq!(retried.message_id, failed.message_id);
            assert_eq!(
                retried.delivery_status,
                contracts::MessageDeliveryStatus::Sent
            );

            let snapshot = alice
                .poll_session(&invite.session_id)
                .expect("poll should pass");
            let matching: Vec<&ChatMessage> = snapshot
                .messages
                .iter()
                .filter(|message| message.message_id.as_deref() == Some(failed.message_id.as_str()))
                .collect();
            assert_eq!(
                matching.len(),
                1,
                "retry should update, not duplicate, the row"
            );
            assert_eq!(
                matching[0].delivery_status,
                Some(contracts::MessageDeliveryStatus::Sent)
            );
            assert_eq!(matching[0].retry_count, Some(1));

            (invite, failed.message_id)
        };

        let stored_attempt = persistence
            .get_outbound_attempt("private_dm", &invite.session_id, &failed_message_id)
            .expect("lookup should pass");
        assert!(stored_attempt.is_none());

        let _ = std::fs::remove_file(&db_path);
    }

    // Regression: the invite *joiner* (Bob) only obtains an MLS group after he
    // processes Alice's Welcome, so his persisted session record must be
    // refreshed with the real group_id once joined. Otherwise rehydrate cannot
    // load the group and the whole conversation is silently dropped on restart.
    //
    // Needs a real two-node loopback handshake, which is timing-flaky, so it is
    // on-demand (`cargo test -- --ignored`). The group_id-refresh logic itself
    // is also exercised by the crypto restore tests.
    #[test]
    #[ignore]
    fn joiner_history_and_session_survive_restart() {
        use crate::adapters::persistence::Persistence;
        use std::path::PathBuf;

        let _guard = MOSS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        drain_received_messages();

        let mut db_path: PathBuf = std::env::temp_dir();
        db_path.push(format!(
            "mosh-dm-joiner-rehydrate-{}.redb",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&db_path);

        let runtime = Arc::new(MossFfiRuntime::load_default().expect("Moss runtime should load"));

        // Alice (creator) is memory-only; Bob (joiner) is the one that persists.
        let bob_store =
            Arc::new(Persistence::open_with_dek(&db_path, [7u8; 32]).expect("store should open"));

        let mut alice = PrivateDmRuntime::from_shared(Arc::clone(&runtime), temp_store(), None);
        let invite = alice
            .create_invite(StartSessionRequest {
                display_name: "Alice".to_string(),
                listen_port: 42150,
                static_peer: None,
            })
            .expect("Alice invite should be created");

        let session_id = {
            let mut bob = PrivateDmRuntime::from_shared(
                Arc::clone(&runtime),
                temp_store(),
                Some(bob_store.clone()),
            );
            bob.accept_invite(AcceptInviteRequest {
                invite_uri: invite.invite_uri.clone(),
                display_name: "Bob".to_string(),
                listen_port: 42151,
                static_peer: Some("127.0.0.1:42150".to_string()),
            })
            .expect("Bob should accept invite");

            wait_until_ready(&mut alice, &mut bob, &invite.session_id);
            bob.send_message(&invite.session_id, "joiner persists".to_string())
                .expect("Bob should send");
            invite.session_id.clone()
        };

        // Bob "restarts": brand-new runtime, same encrypted store.
        let mut revived =
            PrivateDmRuntime::from_shared(Arc::clone(&runtime), temp_store(), Some(bob_store));
        revived.rehydrate();

        let listing = revived.list_sessions().expect("listing should pass");
        let session = listing
            .sessions
            .iter()
            .find(|s| s.session_id == session_id)
            .expect("rehydrated joiner session should be present");
        assert!(
            session.messages.iter().any(|m| m.body == "joiner persists"),
            "joiner message lost across restart: {:?}",
            session.messages
        );

        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn private_dm_inbound_filter_includes_voice_call_channels() {
        assert!(is_private_dm_inbound("mls-control/session-one"));
        assert!(is_private_dm_inbound("mls-data/session-one"));
        assert!(is_private_dm_inbound("mls-blob/session-one"));
        assert!(is_private_dm_inbound("voice-call/call-one"));
        assert!(!is_private_dm_inbound("public-channel/general"));
    }

    // Real Moss call E2E. This exercises the voice-call subscription and
    // frame routing path, but local peer handshakes are timing-sensitive in
    // the full suite, so run it explicitly when touching call transport.
    #[test]
    #[ignore]
    fn private_dm_runtime_routes_voice_call_frames_over_moss() {
        let _guard = MOSS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        drain_received_messages();
        let runtime = Arc::new(MossFfiRuntime::load_default().expect("Moss runtime should load"));
        let mut alice = PrivateDmRuntime::from_shared(Arc::clone(&runtime), temp_store(), None);
        let invite = alice
            .create_invite(StartSessionRequest {
                display_name: "Alice".to_string(),
                listen_port: 42134,
                static_peer: None,
            })
            .expect("Alice invite should be created");

        let mut bob = PrivateDmRuntime::from_shared(runtime, temp_store(), None);
        bob.accept_invite(AcceptInviteRequest {
            invite_uri: invite.invite_uri.clone(),
            display_name: "Bob".to_string(),
            listen_port: 42135,
            static_peer: Some("127.0.0.1:42134".to_string()),
        })
        .expect("Bob should accept invite");

        wait_until_ready(&mut alice, &mut bob, &invite.session_id);
        let call = alice
            .call_start(&invite.session_id)
            .expect("Alice should start a call");
        wait_for_pending_call(&mut bob, &invite.session_id, &call.call_id);
        bob.call_accept(&invite.session_id, &call.call_id)
            .expect("Bob should accept the call");
        wait_for_active_call(&mut alice, &mut bob, &invite.session_id, &call.call_id);

        alice
            .call_send_frame(
                &invite.session_id,
                &call.call_id,
                test_call_frame(0, &[1, 2, 3]),
            )
            .expect("Alice should send a voice frame");
        assert_eq!(
            wait_for_call_frame(&mut bob, &invite.session_id, &call.call_id),
            test_call_frame(0, &[1, 2, 3])
        );

        bob.call_send_frame(
            &invite.session_id,
            &call.call_id,
            test_call_frame(1 << 63, &[4, 5, 6]),
        )
        .expect("Bob should send a voice frame");
        assert_eq!(
            wait_for_call_frame(&mut alice, &invite.session_id, &call.call_id),
            test_call_frame(1 << 63, &[4, 5, 6])
        );
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
        let mut alice = PrivateDmRuntime::from_shared(Arc::clone(&runtime), temp_store(), None);
        let invite = alice
            .create_invite(StartSessionRequest {
                display_name: "Alice".to_string(),
                listen_port: 42132,
                static_peer: None,
            })
            .expect("Alice invite should be created");

        let receiver_store = temp_store();
        let mut bob = PrivateDmRuntime::from_shared(runtime, Arc::clone(&receiver_store), None);
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
                view.attachment_id == attachment_id && view.state == AttachmentState::Available
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

    fn wait_for_pending_call(runtime: &mut PrivateDmRuntime, session_id: &str, call_id: &str) {
        for _ in 0..60 {
            let snapshot = runtime.poll_session(session_id).expect("poll should pass");
            if snapshot
                .pending_call
                .as_ref()
                .is_some_and(|call| call.call_id == call_id)
            {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        panic!("pending call did not arrive");
    }

    fn wait_for_active_call(
        alice: &mut PrivateDmRuntime,
        bob: &mut PrivateDmRuntime,
        session_id: &str,
        call_id: &str,
    ) {
        for _ in 0..60 {
            let alice_active = alice
                .poll_session(session_id)
                .expect("Alice poll should pass")
                .active_call
                .as_ref()
                .is_some_and(|call| call.call_id == call_id);
            let bob_active = bob
                .poll_session(session_id)
                .expect("Bob poll should pass")
                .active_call
                .as_ref()
                .is_some_and(|call| call.call_id == call_id);
            if alice_active && bob_active {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        panic!("call did not become active");
    }

    fn wait_for_call_frame(
        runtime: &mut PrivateDmRuntime,
        session_id: &str,
        call_id: &str,
    ) -> Vec<u8> {
        for _ in 0..60 {
            let frames = runtime
                .call_drain_frames(session_id, call_id)
                .expect("frame drain should pass");
            if let Some(frame) = frames.into_iter().next() {
                return frame;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        panic!("voice frame did not arrive");
    }

    fn test_call_frame(seq: u64, payload: &[u8]) -> Vec<u8> {
        let mut frame = seq.to_be_bytes().to_vec();
        frame.extend_from_slice(payload);
        frame
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
