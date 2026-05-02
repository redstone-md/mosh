use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, Mutex, OnceLock},
};

use serde_json::Value;

use crate::{
    chat_protocol::{format_peer, is_secret_room, normalize_room_id, ChatPayload, CONTROL_ROOM},
    models::{
        CallStateSummary, Message, PeerSummary, RoomSummary, SecretMessageEvent, SignalingEvent,
        VoiceParticipantSummary, VoiceRoomSummary,
    },
};

const MAX_WEBRTC_SIGNAL_DATA_BYTES: usize = 400_000;

#[derive(Default)]
pub struct CallbackState {
    next_id: u64,
    local_peer_id: String,
    local_nickname: String,
    self_rooms: BTreeSet<String>,
    presence_seen: BTreeSet<String>,
    peer_names: BTreeMap<String, String>,
    peer_rooms: BTreeMap<String, BTreeSet<String>>,
    local_voice_room: Option<String>,
    voice_room_members: BTreeMap<String, BTreeSet<String>>,
    messages: Vec<Message>,
    secret_messages: Vec<SecretMessageEvent>,
    rooms: BTreeMap<String, RoomSummary>,
    peers: BTreeMap<String, PeerSummary>,
    call_state: Option<CallStateSummary>,
    signaling_events: Vec<SignalingEvent>,
    tracker_candidate_count: usize,
    tracker_connected_count: usize,
}

impl CallbackState {
    pub fn new() -> Self {
        let mut state = Self::default();
        state.ensure_room("system", "System", "system");
        state.ensure_room("lobby", "#lobby", "channel");
        state
    }

    pub fn reset(&mut self) {
        self.next_id = 0;
        self.local_peer_id.clear();
        self.local_nickname.clear();
        self.self_rooms.clear();
        self.presence_seen.clear();
        self.peer_names.clear();
        self.peer_rooms.clear();
        self.local_voice_room = None;
        self.voice_room_members.clear();
        self.messages.clear();
        self.secret_messages.clear();
        self.rooms.clear();
        self.peers.clear();
        self.call_state = None;
        self.signaling_events.clear();
        self.tracker_candidate_count = 0;
        self.tracker_connected_count = 0;
        self.ensure_room("system", "System", "system");
        self.ensure_room("lobby", "#lobby", "channel");
    }

    pub fn note_runtime(&mut self, body: impl Into<String>) {
        let body = body.into();
        log::info!("runtime: {body}");
        self.push_message("system", "System", body, "system");
    }

    pub fn configure_local_profile(&mut self, peer_id: String, nickname: String, rooms: &[String]) {
        self.local_peer_id = peer_id.clone();
        self.local_nickname = nickname.clone();
        self.peer_names.insert(peer_id.clone(), nickname.clone());
        self.self_rooms = rooms.iter().map(|room| normalize_room_id(room)).collect();

        let room_labels = self
            .self_rooms
            .iter()
            .map(|room| format!("#{room}"))
            .collect::<Vec<_>>();

        self.peers.insert(
            peer_id,
            PeerSummary {
                id: self.local_peer_id.clone(),
                display_name: format!("{nickname} (you)"),
                route: "local shell".to_string(),
                latency: "--".to_string(),
                status: "self".to_string(),
                rooms: room_labels,
                identity_version: None,
                secure_fingerprint: None,
                signing_public_key_jwk: None,
                encryption_public_key_jwk: None,
            },
        );

        let self_rooms = self.self_rooms.iter().cloned().collect::<Vec<_>>();
        for room in self_rooms {
            self.ensure_room(&room, &format!("#{room}"), "channel");
        }
        self.bump_room_participants();
    }

    pub fn record_subscribed_room(&mut self, room: &str) {
        let normalized = normalize_room_id(room);
        self.self_rooms.insert(normalized.clone());
        self.ensure_room(&normalized, &format!("#{normalized}"), "channel");
        if let Some(peer) = self.self_peer_mut() {
            let label = format!("#{normalized}");
            if !peer.rooms.iter().any(|room| room == &label) {
                peer.rooms.push(label);
                peer.rooms.sort();
            }
        }
        self.bump_room_participants();
    }

    pub fn record_unsubscribed_room(&mut self, room: &str) {
        let normalized = normalize_room_id(room);
        self.self_rooms.remove(&normalized);
        if let Some(peer) = self.self_peer_mut() {
            let label = format!("#{normalized}");
            peer.rooms.retain(|r| r != &label);
        }
        self.bump_room_participants();
    }

    pub fn subscribed_rooms(&self) -> Vec<String> {
        self.self_rooms.iter().cloned().collect()
    }

    pub fn on_channel_message(&mut self, channel: String, sender_hex: String, data: Vec<u8>) {
        if channel == CONTROL_ROOM {
            self.handle_control_message(sender_hex, data);
            return;
        }

        let room_id = normalize_room_id(&channel);
        if is_secret_room(&room_id) {
            self.ensure_room(&room_id, &format!("secret #{room_id}"), "secret-dm");
            let payload_json = String::from_utf8_lossy(&data).into_owned();
            let id = self.next_message_id();
            self.secret_messages.push(SecretMessageEvent {
                id,
                room_id,
                sender_peer_id: sender_hex,
                payload_json,
                received_at: "now".to_string(),
            });
            return;
        }
        self.ensure_room(&room_id, &format!("#{room_id}"), "channel");

        let parsed_payload = serde_json::from_slice::<ChatPayload>(&data).ok();
        let author = parsed_payload
            .as_ref()
            .and_then(|payload| {
                let nick = payload.nick.trim();
                if nick.is_empty() {
                    None
                } else if sender_hex == self.local_peer_id {
                    Some("you".to_string())
                } else {
                    self.peer_names.insert(sender_hex.clone(), nick.to_string());
                    Some(nick.to_string())
                }
            })
            .unwrap_or_else(|| self.display_name_for_peer(&sender_hex));

        let body = parsed_payload
            .as_ref()
            .map(|payload| payload.text.trim().to_string())
            .filter(|text| !text.is_empty())
            .unwrap_or_else(|| String::from_utf8_lossy(&data).into_owned());

        let timestamp = parsed_payload
            .as_ref()
            .map(|payload| payload.sent_at.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "now".to_string());

        let message_id = self.next_message_id();
        self.messages.push(Message {
            id: message_id,
            room_id,
            author,
            body,
            timestamp,
            emphasis: "normal".to_string(),
        });
    }

    pub fn on_event(&mut self, event_type: i32, detail_json: String) {
        let detail: Value = serde_json::from_str(&detail_json).unwrap_or(Value::Null);
        match event_type {
            1 => {
                let peer = detail_field(&detail, "peer");
                if peer.is_empty() || peer == self.local_peer_id {
                    return;
                }
                let addr = detail_field(&detail, "addr");
                self.peers.insert(
                    peer.clone(),
                    PeerSummary {
                        id: peer.clone(),
                        display_name: self.display_name_for_peer(&peer),
                        route: fallback_text(&addr, "connected peer"),
                        latency: "live".to_string(),
                        status: "connected".to_string(),
                        rooms: vec!["#lobby".to_string()],
                        identity_version: None,
                        secure_fingerprint: None,
                        signing_public_key_jwk: None,
                        encryption_public_key_jwk: None,
                    },
                );
                self.bump_room_participants();
            }
            2 => {
                let peer = detail_field(&detail, "peer");
                if peer.is_empty() {
                    return;
                }
                let name = self.display_name_for_peer(&peer);
                self.peers.remove(&peer);
                self.peer_rooms.remove(&peer);
                self.presence_seen.remove(&peer);
                let voice_rooms = self.voice_room_members.keys().cloned().collect::<Vec<_>>();
                for room in voice_rooms {
                    self.remove_voice_member(&room, &peer);
                }
                self.bump_room_participants();
                self.push_message(
                    "lobby",
                    "System",
                    format!("{name} left the chat."),
                    "system",
                );
            }
            5 => {
                let candidates = detail
                    .get("candidate_peers")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                let connected = detail
                    .get("connected_peers")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                self.tracker_candidate_count = candidates as usize;
                self.tracker_connected_count = connected as usize;
                self.push_message(
                    "system",
                    "System",
                    format!("Tracker returned {candidates} candidates; connected now {connected}."),
                    "system",
                );
            }
            6 => {
                self.push_message(
                    "system",
                    "System",
                    format!("Tracker failure: {}", detail_field(&detail, "error")),
                    "system",
                );
            }
            7 => {
                self.push_message(
                    "system",
                    "System",
                    format!(
                        "Relay migrated to direct route for {} via {}.",
                        format_peer(&detail_field(&detail, "peer")),
                        detail_field(&detail, "via")
                    ),
                    "system",
                );
            }
            _ => {
                self.push_message("system", "System", detail_json, "system");
            }
        }
    }

    pub fn rooms(&self) -> Vec<RoomSummary> {
        self.rooms.values().cloned().collect()
    }

    pub fn messages(&self) -> Vec<Message> {
        self.messages.clone()
    }

    pub fn secret_messages(&self) -> Vec<SecretMessageEvent> {
        self.secret_messages.clone()
    }

    pub fn peers(&self) -> Vec<PeerSummary> {
        self.peers.values().cloned().collect()
    }

    pub fn current_call(&self) -> Option<CallStateSummary> {
        self.call_state.clone()
    }

    pub fn signaling_events(&self) -> Vec<SignalingEvent> {
        self.signaling_events.clone()
    }

    pub fn tracker_counters(&self) -> (usize, usize) {
        (self.tracker_candidate_count, self.tracker_connected_count)
    }

    pub fn voice_rooms(&self) -> Vec<VoiceRoomSummary> {
        let mut rooms = Vec::new();
        for (room_id, members) in &self.voice_room_members {
            let mut participants = members
                .iter()
                .map(|peer_id| VoiceParticipantSummary {
                    peer_id: peer_id.clone(),
                    peer_name: if peer_id == &self.local_peer_id {
                        format!("{} (you)", self.local_nickname)
                    } else {
                        self.display_name_for_peer(peer_id)
                    },
                    is_self: peer_id == &self.local_peer_id,
                })
                .collect::<Vec<_>>();
            participants.sort_by(|left, right| left.peer_name.cmp(&right.peer_name));
            rooms.push(VoiceRoomSummary {
                room_id: room_id.clone(),
                joined: self.local_voice_room.as_deref() == Some(room_id.as_str()),
                participants,
            });
        }
        rooms
    }

    pub fn begin_outgoing_call(
        &mut self,
        peer_id: String,
        peer_name: String,
        room_id: String,
    ) -> String {
        let call_id = format!("call-{}", self.next_message_id());
        self.call_state = Some(CallStateSummary {
            call_id: call_id.clone(),
            peer_id,
            peer_name,
            room_id,
            status: "dialing".to_string(),
            direction: "outgoing".to_string(),
        });
        call_id
    }

    pub fn answer_current_call(&mut self) -> Result<CallStateSummary, String> {
        let Some(call_state) = self.call_state.as_mut() else {
            return Err("there is no incoming call to answer".to_string());
        };
        if call_state.status != "ringing" {
            return Err("there is no incoming call to answer".to_string());
        }
        call_state.status = "active".to_string();
        Ok(call_state.clone())
    }

    pub fn decline_current_call(&mut self) -> Result<CallStateSummary, String> {
        let Some(call_state) = self.call_state.clone() else {
            return Err("there is no incoming call to decline".to_string());
        };
        if call_state.status != "ringing" {
            return Err("there is no incoming call to decline".to_string());
        }
        self.call_state = None;
        Ok(call_state)
    }

    pub fn hangup_current_call(&mut self) -> Result<CallStateSummary, String> {
        let Some(call_state) = self.call_state.clone() else {
            return Err("there is no active call".to_string());
        };
        self.call_state = None;
        Ok(call_state)
    }

    pub fn join_voice_room(&mut self, room: &str) {
        let room_id = normalize_room_id(room);
        if let Some(previous_room) = self.local_voice_room.replace(room_id.clone()) {
            if previous_room != room_id {
                self.remove_voice_member(&previous_room, &self.local_peer_id.clone());
            }
        }
        self.voice_room_members
            .entry(room_id)
            .or_default()
            .insert(self.local_peer_id.clone());
    }

    pub fn leave_voice_room(&mut self) -> Option<String> {
        let room = self.local_voice_room.take()?;
        self.remove_voice_member(&room, &self.local_peer_id.clone());
        Some(room)
    }

    pub fn resolve_peer_target(&self, target: &str) -> Option<(String, String)> {
        let needle = target.trim().to_lowercase();
        if needle.is_empty() {
            return None;
        }
        for (peer_id, peer_name) in &self.peer_names {
            if peer_id == &self.local_peer_id {
                continue;
            }
            if peer_name.eq_ignore_ascii_case(target)
                || peer_id.to_lowercase().starts_with(&needle)
                || format_peer(peer_id).to_lowercase().starts_with(&needle)
            {
                return Some((peer_id.clone(), peer_name.clone()));
            }
        }
        None
    }

    pub fn record_secret_room(&mut self, room: &str, target_peer: &str, target_label: &str) {
        let room = normalize_room_id(room);
        self.self_rooms.insert(room.clone());
        self.ensure_room(&room, &format!("secret @{target_label}"), "secret-dm");
        if let Some(summary) = self.rooms.get_mut(&room) {
            summary.label = format!("secret @{target_label}");
            summary.kind = "secret-dm".to_string();
        }
        self.peer_rooms
            .entry(target_peer.to_string())
            .or_default()
            .insert(room.clone());
        if let Some(peer) = self.peers.get_mut(target_peer) {
            let label = format!("#{room}");
            if !peer.rooms.iter().any(|candidate| candidate == &label) {
                peer.rooms.push(label);
                peer.rooms.sort();
            }
        }
        if let Some(peer) = self.self_peer_mut() {
            let label = format!("#{room}");
            if !peer.rooms.iter().any(|candidate| candidate == &label) {
                peer.rooms.push(label);
                peer.rooms.sort();
            }
        }
        self.bump_room_participants();
    }

    pub fn record_secret_message(&mut self, room: &str, payload_json: String) {
        let room_id = normalize_room_id(room);
        let id = self.next_message_id();
        self.secret_messages.push(SecretMessageEvent {
            id,
            room_id,
            sender_peer_id: self.local_peer_id.clone(),
            payload_json,
            received_at: "now".to_string(),
        });
    }

    fn handle_control_message(&mut self, sender_hex: String, data: Vec<u8>) {
        let Ok(payload) = serde_json::from_slice::<ChatPayload>(&data) else {
            return;
        };
        if !payload.target.is_empty() && payload.target != self.local_peer_id {
            return;
        }

        if !payload.nick.trim().is_empty() {
            self.peer_names
                .insert(sender_hex.clone(), payload.nick.trim().to_string());
        }

        match payload.kind.as_str() {
            "presence" => {
                if sender_hex == self.local_peer_id {
                    return;
                }
                let first_seen = self.presence_seen.insert(sender_hex.clone());
                let peer_name = self.display_name_for_peer(&sender_hex);
                let peer_rooms = payload
                    .rooms
                    .iter()
                    .map(|room| normalize_room_id(room))
                    .collect::<BTreeSet<_>>();
                self.peer_rooms
                    .insert(sender_hex.clone(), peer_rooms.clone());
                self.peers
                    .entry(sender_hex.clone())
                    .and_modify(|peer| {
                        peer.display_name = peer_name.clone();
                        peer.rooms = peer_rooms
                            .iter()
                            .map(|room| format!("#{room}"))
                            .collect::<Vec<_>>();
                        peer.identity_version = payload.identity_version;
                        peer.secure_fingerprint = non_empty(payload.secure_fingerprint.clone());
                        peer.signing_public_key_jwk = payload.signing_public_key_jwk.clone();
                        peer.encryption_public_key_jwk = payload.encryption_public_key_jwk.clone();
                    })
                    .or_insert(PeerSummary {
                        id: sender_hex.clone(),
                        display_name: peer_name.clone(),
                        route: "connected peer".to_string(),
                        latency: "live".to_string(),
                        status: "connected".to_string(),
                        rooms: peer_rooms
                            .iter()
                            .map(|room| format!("#{room}"))
                            .collect::<Vec<_>>(),
                        identity_version: payload.identity_version,
                        secure_fingerprint: non_empty(payload.secure_fingerprint.clone()),
                        signing_public_key_jwk: payload.signing_public_key_jwk.clone(),
                        encryption_public_key_jwk: payload.encryption_public_key_jwk.clone(),
                    });
                for room in peer_rooms {
                    self.ensure_room(&room, &format!("#{room}"), "channel");
                }
                self.bump_room_participants();
                if first_seen {
                    self.push_message(
                        "lobby",
                        "System",
                        format!("{peer_name} joined the chat."),
                        "system",
                    );
                }
            }
            "dm_invite" => {
                let room = normalize_room_id(&payload.room);
                let peer_name = self.display_name_for_peer(&sender_hex);
                self.ensure_room(&room, &format!("@{peer_name}"), "dm");
                if let Some(summary) = self.rooms.get_mut(&room) {
                    summary.label = format!("@{peer_name}");
                }
                self.peer_rooms
                    .entry(sender_hex.clone())
                    .or_default()
                    .insert(room.clone());
                if let Some(peer) = self.peers.get_mut(&sender_hex) {
                    let label = format!("#{room}");
                    if !peer.rooms.iter().any(|candidate| candidate == &label) {
                        peer.rooms.push(label);
                        peer.rooms.sort();
                    }
                }
                self.push_message(
                    "system",
                    "System",
                    format!("Direct chat ready with {peer_name}."),
                    "system",
                );
            }
            "secret_dm_invite" => {
                let room = normalize_room_id(&payload.room);
                let peer_name = self.display_name_for_peer(&sender_hex);
                self.record_secret_room(&room, &sender_hex, &peer_name);
                self.push_message(
                    "system",
                    "System",
                    format!("Secret chat ready with {peer_name}."),
                    "system",
                );
            }
            "call_invite" => {
                let room = normalize_room_id(&payload.room);
                let peer_name = self.display_name_for_peer(&sender_hex);
                self.ensure_room(&room, &format!("@{peer_name}"), "dm");
                self.call_state = Some(CallStateSummary {
                    call_id: payload.call_id.clone(),
                    peer_id: sender_hex.clone(),
                    peer_name: peer_name.clone(),
                    room_id: room,
                    status: "ringing".to_string(),
                    direction: "incoming".to_string(),
                });
                self.push_message(
                    "system",
                    "System",
                    format!("Incoming call from {peer_name}."),
                    "system",
                );
            }
            "call_accept" => {
                let peer_name = self.display_name_for_peer(&sender_hex);
                if let Some(call_state) = self.call_state.as_mut() {
                    if call_state.call_id == payload.call_id {
                        call_state.status = "active".to_string();
                    }
                }
                self.push_message(
                    "system",
                    "System",
                    format!("Call connected: {peer_name}."),
                    "system",
                );
            }
            "call_decline" => {
                let peer_name = self.display_name_for_peer(&sender_hex);
                let should_clear = self
                    .call_state
                    .as_ref()
                    .map(|state| state.call_id == payload.call_id)
                    .unwrap_or(false);
                if should_clear {
                    self.call_state = None;
                }
                self.push_message(
                    "system",
                    "System",
                    format!("Call declined by {peer_name}."),
                    "system",
                );
            }
            "call_hangup" => {
                let peer_name = self.display_name_for_peer(&sender_hex);
                let should_clear = self
                    .call_state
                    .as_ref()
                    .map(|state| {
                        state.call_id == payload.call_id
                            || state.peer_id.eq_ignore_ascii_case(&sender_hex)
                    })
                    .unwrap_or(false);
                if should_clear {
                    self.call_state = None;
                }
                self.push_message(
                    "system",
                    "System",
                    format!("Call ended by {peer_name}."),
                    "system",
                );
            }
            "webrtc_signal" => {
                if !valid_webrtc_signal(&payload) {
                    return;
                }
                let signal_id = self.next_message_id();
                self.signaling_events.push(SignalingEvent {
                    id: signal_id,
                    call_id: payload.call_id.clone(),
                    room_id: normalize_room_id(&payload.room),
                    peer_id: sender_hex,
                    signal_type: payload.signal_type.clone(),
                    signal_data: payload.signal_data.clone(),
                    sent_at: payload.sent_at.clone(),
                });
                if self.signaling_events.len() > 256 {
                    let overflow = self.signaling_events.len() - 256;
                    self.signaling_events.drain(0..overflow);
                }
            }
            "voice_join" => {
                let room = normalize_room_id(&payload.room);
                let peer_name = self.display_name_for_peer(&sender_hex);
                self.voice_room_members
                    .entry(room.clone())
                    .or_default()
                    .insert(sender_hex);
                self.push_message(
                    "system",
                    "System",
                    format!("{peer_name} joined voice in #{room}."),
                    "system",
                );
            }
            "voice_leave" => {
                let room = normalize_room_id(&payload.room);
                let peer_name = self.display_name_for_peer(&sender_hex);
                self.remove_voice_member(&room, &sender_hex);
                self.push_message(
                    "system",
                    "System",
                    format!("{peer_name} left voice in #{room}."),
                    "system",
                );
            }
            _ => {}
        }
    }

    fn ensure_room(&mut self, id: &str, label: &str, kind: &str) {
        self.rooms.entry(id.to_string()).or_insert(RoomSummary {
            id: id.to_string(),
            label: label.to_string(),
            unread: 0,
            participants: 1,
            kind: kind.to_string(),
        });
    }

    fn display_name_for_peer(&self, peer_id: &str) -> String {
        self.peer_names
            .get(peer_id)
            .filter(|name| !name.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| format_peer(peer_id))
    }

    fn self_peer_mut(&mut self) -> Option<&mut PeerSummary> {
        self.peers.values_mut().find(|peer| peer.status == "self")
    }

    fn push_message(&mut self, room_id: &str, author: &str, body: String, emphasis: &str) {
        let message_id = self.next_message_id();
        self.messages.push(Message {
            id: message_id,
            room_id: room_id.to_string(),
            author: author.to_string(),
            body,
            timestamp: "now".to_string(),
            emphasis: emphasis.to_string(),
        });
    }

    fn bump_room_participants(&mut self) {
        for room in self.rooms.values_mut() {
            if room.kind == "system" {
                continue;
            }
            let room_name = room.id.clone();
            let peer_count = self
                .peer_rooms
                .values()
                .filter(|rooms| rooms.contains(&room_name))
                .count() as u32;
            let local_present = self.self_rooms.contains(&room_name) as u32;
            room.participants = (peer_count + local_present).max(1);
        }
    }

    fn next_message_id(&mut self) -> String {
        self.next_id += 1;
        format!("cb-{}", self.next_id)
    }

    fn remove_voice_member(&mut self, room: &str, peer_id: &str) {
        let should_remove = if let Some(members) = self.voice_room_members.get_mut(room) {
            members.remove(peer_id);
            members.is_empty()
        } else {
            false
        };
        if should_remove {
            self.voice_room_members.remove(room);
        }
    }
}

fn detail_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn fallback_text(value: &str, fallback: &str) -> String {
    if value.trim().is_empty() {
        fallback.to_string()
    } else {
        value.to_string()
    }
}

fn non_empty(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn valid_webrtc_signal(payload: &ChatPayload) -> bool {
    if payload.call_id.trim().is_empty() || payload.signal_data.trim().is_empty() {
        return false;
    }
    if payload.signal_data.len() > MAX_WEBRTC_SIGNAL_DATA_BYTES {
        return false;
    }

    matches!(
        payload.signal_type.trim(),
        "offer" | "answer" | "ice-candidate"
    ) && serde_json::from_str::<Value>(&payload.signal_data).is_ok()
}

static CALLBACK_STATE: OnceLock<Arc<Mutex<CallbackState>>> = OnceLock::new();

pub fn shared_callback_state() -> Arc<Mutex<CallbackState>> {
    CALLBACK_STATE
        .get_or_init(|| Arc::new(Mutex::new(CallbackState::new())))
        .clone()
}

#[cfg(test)]
mod tests;
