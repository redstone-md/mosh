use crate::{
    callback_state::shared_callback_state,
    chat_protocol::{
        direct_room_name, secret_room_name, ChatPayload, IdentityPresence, CONTROL_ROOM,
    },
    ffi::{MeshInfo, MossLibrary},
    models::DesktopSnapshot,
    runtime_settings::{DesktopRuntimeConfig, RuntimeSettingsInput},
    snapshot_view,
};
use std::sync::Mutex;

const DEV_BRANCH: &str = "dev";

pub struct DesktopShellState {
    library: Option<MossLibrary>,
    library_error: Option<String>,
    handle: Option<i64>,
    settings: DesktopRuntimeConfig,
    identity_presence: Option<IdentityPresence>,
}

impl DesktopShellState {
    pub fn new() -> Self {
        let mut state = Self {
            library: None,
            library_error: None,
            handle: None,
            settings: DesktopRuntimeConfig::default(),
            identity_presence: None,
        };
        state.reload_library();
        if let Ok(mut callbacks) = shared_callback_state().lock() {
            callbacks.reset();
            callbacks.note_runtime("Desktop backend initialized. Waiting for runtime start.");
        }
        state
    }

    pub fn snapshot(&mut self) -> DesktopSnapshot {
        if self.library.is_none() {
            self.reload_library();
        }

        let live_mesh = self.live_mesh_info();
        let settings = self.settings.summary();
        let diagnostics = self
            .settings
            .diagnostics(live_mesh.as_ref().ok().and_then(|mesh| mesh.as_ref()));

        match live_mesh {
            Ok(Some(mesh)) => snapshot_view::online_snapshot(
                &mesh,
                settings,
                diagnostics,
                self.library_path(),
                DEV_BRANCH,
            ),
            Ok(None) => snapshot_view::offline_snapshot(
                settings,
                diagnostics,
                self.shared_bridge_summary(),
                DEV_BRANCH,
            ),
            Err(err) => snapshot_view::failed_snapshot(settings, diagnostics, err, DEV_BRANCH),
        }
    }

    pub fn toggle_runtime(&mut self) -> Result<DesktopSnapshot, String> {
        if self.handle.is_some() {
            self.stop_runtime("Runtime stopped from desktop shell.")?;
            return Ok(self.snapshot());
        }

        self.start_runtime()?;
        Ok(self.snapshot())
    }

    pub fn update_runtime_settings(
        &mut self,
        input: RuntimeSettingsInput,
    ) -> Result<DesktopSnapshot, String> {
        let previous_settings = self.settings.clone();
        let previous_nickname = self.settings.nickname().to_string();
        let was_running = self.handle.is_some();
        self.settings.apply(input)?;

        if was_running && self.settings.requires_runtime_restart(&previous_settings) {
            if let Ok(mut callbacks) = shared_callback_state().lock() {
                callbacks.note_runtime(
                    "Updated desktop runtime settings. Restarting runtime to join the new mesh.",
                );
            }
            self.stop_runtime("Runtime restarting to apply desktop runtime settings.")?;
            self.start_runtime()?;
            return Ok(self.snapshot());
        }

        if let Ok(mut callbacks) = shared_callback_state().lock() {
            callbacks.note_runtime("Updated desktop runtime settings.");
        }

        if was_running {
            if let Some(handle) = self.handle {
                if let Some(library) = self.library.as_ref() {
                    if previous_nickname != self.settings.nickname() {
                        let _ = self.configure_live_chat_identity(library, handle);
                        let _ = self.publish_presence(library, handle);
                    }
                    if previous_settings.startup_peer() != self.settings.startup_peer() {
                        self.connect_startup_peer(library, handle);
                    }
                }
            }
        }
        Ok(self.snapshot())
    }

    pub fn subscribe_room(&mut self, room: &str) -> Result<DesktopSnapshot, String> {
        let handle = self
            .handle
            .ok_or_else(|| "runtime is offline; start it first".to_string())?;
        let library = self
            .library
            .as_ref()
            .ok_or_else(|| "shared library is not loaded".to_string())?;
        library.subscribe(handle, room)?;
        if let Ok(mut callbacks) = shared_callback_state().lock() {
            callbacks.record_subscribed_room(room);
        }
        self.publish_presence(library, handle)?;
        if let Ok(mut callbacks) = shared_callback_state().lock() {
            callbacks.note_runtime(format!("Subscribed desktop runtime to #{room}."));
        }
        Ok(self.snapshot())
    }

    pub fn unsubscribe_room(&mut self, room: &str) -> Result<DesktopSnapshot, String> {
        let handle = self
            .handle
            .ok_or_else(|| "runtime is offline; start it first".to_string())?;
        let library = self
            .library
            .as_ref()
            .ok_or_else(|| "shared library is not loaded".to_string())?;
        library.unsubscribe(handle, room)?;
        if let Ok(mut callbacks) = shared_callback_state().lock() {
            callbacks.record_unsubscribed_room(room);
            callbacks.note_runtime(format!("Unsubscribed desktop runtime from #{room}."));
        }
        self.publish_presence(library, handle)?;
        Ok(self.snapshot())
    }

    pub fn connect_peer(&mut self, addr: &str) -> Result<DesktopSnapshot, String> {
        let handle = self
            .handle
            .ok_or_else(|| "runtime is offline; start it first".to_string())?;
        let library = self
            .library
            .as_ref()
            .ok_or_else(|| "shared library is not loaded".to_string())?;
        library.connect(handle, addr)?;
        if let Ok(mut callbacks) = shared_callback_state().lock() {
            callbacks.note_runtime(format!("Attempting direct connect to {addr}."));
        }
        Ok(self.snapshot())
    }

    pub fn publish_message(&mut self, room: &str, body: &str) -> Result<DesktopSnapshot, String> {
        let handle = self
            .handle
            .ok_or_else(|| "runtime is offline; start it first".to_string())?;
        let library = self
            .library
            .as_ref()
            .ok_or_else(|| "shared library is not loaded".to_string())?;
        let payload =
            serde_json::to_vec(&ChatPayload::room_message(self.settings.nickname(), body))
                .map_err(|err| format!("failed to encode room message: {err}"))?;
        library.publish(handle, room, &payload).map_err(|err| {
            if MossLibrary::is_no_peers_error(&err) {
                "No connected peers yet. Message stayed local until another peer joins.".to_string()
            } else {
                err
            }
        })?;
        if let Ok(mut callbacks) = shared_callback_state().lock() {
            callbacks.note_runtime(format!("Published desktop message to #{room}."));
        }
        Ok(self.snapshot())
    }

    pub fn set_identity_presence(
        &mut self,
        identity: IdentityPresence,
    ) -> Result<DesktopSnapshot, String> {
        self.identity_presence = Some(identity);
        if let (Some(handle), Some(library)) = (self.handle, self.library.as_ref()) {
            self.publish_presence(library, handle)?;
        }
        Ok(self.snapshot())
    }

    pub fn open_direct_room(&mut self, target: &str) -> Result<DesktopSnapshot, String> {
        let handle = self
            .handle
            .ok_or_else(|| "runtime is offline; start it first".to_string())?;
        let library = self
            .library
            .as_ref()
            .ok_or_else(|| "shared library is not loaded".to_string())?;

        let (_target_peer, target_label, _room) =
            self.ensure_direct_room_for_target(library, handle, target)?;
        if let Ok(mut callbacks) = shared_callback_state().lock() {
            callbacks.note_runtime(format!("Direct chat opened with {target_label}."));
        }
        Ok(self.snapshot())
    }

    pub fn open_secret_room(&mut self, target: &str) -> Result<DesktopSnapshot, String> {
        let handle = self
            .handle
            .ok_or_else(|| "runtime is offline; start it first".to_string())?;
        let library = self
            .library
            .as_ref()
            .ok_or_else(|| "shared library is not loaded".to_string())?;

        let (target_peer, target_label) = {
            let callback_state = shared_callback_state();
            let state = callback_state
                .lock()
                .map_err(|_| "callback state lock poisoned".to_string())?;
            state.resolve_peer_target(target).ok_or_else(|| {
                format!("peer {target:?} not found; wait for presence or use connect")
            })?
        };
        let mesh = self
            .live_mesh_info()?
            .ok_or_else(|| "runtime mesh info unavailable".to_string())?;
        let room = secret_room_name(&mesh.public_key, &target_peer);
        library.subscribe(handle, &room)?;
        if let Ok(mut callbacks) = shared_callback_state().lock() {
            callbacks.record_secret_room(&room, &target_peer, &target_label);
        }
        let invite = serde_json::to_vec(&ChatPayload::secret_dm_invite(
            self.settings.nickname(),
            &room,
            &target_peer,
        ))
        .map_err(|err| format!("failed to encode secret chat invite: {err}"))?;
        self.publish_control_payload(
            library,
            handle,
            &invite,
            format!("Queued secret-chat invite for {target_label} until a peer path is ready."),
        )?;
        self.publish_presence(library, handle)?;
        if let Ok(mut callbacks) = shared_callback_state().lock() {
            callbacks.note_runtime(format!("Secret chat opened with {target_label}."));
        }
        Ok(self.snapshot())
    }

    pub fn publish_secret_message(
        &mut self,
        room: &str,
        payload_json: &str,
    ) -> Result<DesktopSnapshot, String> {
        let handle = self
            .handle
            .ok_or_else(|| "runtime is offline; start it first".to_string())?;
        let library = self
            .library
            .as_ref()
            .ok_or_else(|| "shared library is not loaded".to_string())?;
        library
            .publish(handle, room, payload_json.as_bytes())
            .map_err(|err| {
                if MossLibrary::is_no_peers_error(&err) {
                    "No connected peers yet. Secret message stayed local until another peer joins."
                        .to_string()
                } else {
                    err
                }
            })?;
        if let Ok(mut callbacks) = shared_callback_state().lock() {
            callbacks.record_secret_message(room, payload_json.to_string());
            callbacks.note_runtime(format!("Published encrypted secret message to #{room}."));
        }
        Ok(self.snapshot())
    }

    pub fn start_call(&mut self, target: &str) -> Result<DesktopSnapshot, String> {
        let handle = self
            .handle
            .ok_or_else(|| "runtime is offline; start it first".to_string())?;
        let library = self
            .library
            .as_ref()
            .ok_or_else(|| "shared library is not loaded".to_string())?;

        let (target_peer, target_label, room) =
            self.ensure_direct_room_for_target(library, handle, target)?;
        let call_id = {
            let callback_state = shared_callback_state();
            let mut state = callback_state
                .lock()
                .map_err(|_| "callback state lock poisoned".to_string())?;
            state.begin_outgoing_call(target_peer.clone(), target_label.clone(), room.clone())
        };
        let payload = serde_json::to_vec(&ChatPayload::call_control(
            self.settings.nickname(),
            "call_invite",
            &room,
            &target_peer,
            &call_id,
        ))
        .map_err(|err| format!("failed to encode call invite: {err}"))?;
        self.publish_control_payload(
            library,
            handle,
            &payload,
            format!("Queued call invite for {target_label} until a peer path is ready."),
        )?;
        if let Ok(mut callbacks) = shared_callback_state().lock() {
            callbacks.note_runtime(format!("Dialing {target_label}."));
        }
        Ok(self.snapshot())
    }

    pub fn answer_call(&mut self) -> Result<DesktopSnapshot, String> {
        let handle = self
            .handle
            .ok_or_else(|| "runtime is offline; start it first".to_string())?;
        let library = self
            .library
            .as_ref()
            .ok_or_else(|| "shared library is not loaded".to_string())?;
        let call_state = {
            let callback_state = shared_callback_state();
            let mut state = callback_state
                .lock()
                .map_err(|_| "callback state lock poisoned".to_string())?;
            state.answer_current_call()?
        };
        let payload = serde_json::to_vec(&ChatPayload::call_control(
            self.settings.nickname(),
            "call_accept",
            &call_state.room_id,
            &call_state.peer_id,
            &call_state.call_id,
        ))
        .map_err(|err| format!("failed to encode call accept: {err}"))?;
        self.publish_control_payload(
            library,
            handle,
            &payload,
            format!(
                "Queued call accept for {} until a peer path is ready.",
                call_state.peer_name
            ),
        )?;
        if let Ok(mut callbacks) = shared_callback_state().lock() {
            callbacks.note_runtime(format!("Call answered: {}.", call_state.peer_name));
        }
        Ok(self.snapshot())
    }

    pub fn decline_call(&mut self) -> Result<DesktopSnapshot, String> {
        let handle = self
            .handle
            .ok_or_else(|| "runtime is offline; start it first".to_string())?;
        let library = self
            .library
            .as_ref()
            .ok_or_else(|| "shared library is not loaded".to_string())?;
        let call_state = {
            let callback_state = shared_callback_state();
            let mut state = callback_state
                .lock()
                .map_err(|_| "callback state lock poisoned".to_string())?;
            state.decline_current_call()?
        };
        let payload = serde_json::to_vec(&ChatPayload::call_control(
            self.settings.nickname(),
            "call_decline",
            &call_state.room_id,
            &call_state.peer_id,
            &call_state.call_id,
        ))
        .map_err(|err| format!("failed to encode call decline: {err}"))?;
        self.publish_control_payload(
            library,
            handle,
            &payload,
            format!(
                "Queued call decline for {} until a peer path is ready.",
                call_state.peer_name
            ),
        )?;
        Ok(self.snapshot())
    }

    pub fn hangup_call(&mut self) -> Result<DesktopSnapshot, String> {
        let handle = self
            .handle
            .ok_or_else(|| "runtime is offline; start it first".to_string())?;
        let library = self
            .library
            .as_ref()
            .ok_or_else(|| "shared library is not loaded".to_string())?;
        let call_state = {
            let callback_state = shared_callback_state();
            let mut state = callback_state
                .lock()
                .map_err(|_| "callback state lock poisoned".to_string())?;
            state.hangup_current_call()?
        };
        let payload = serde_json::to_vec(&ChatPayload::call_control(
            self.settings.nickname(),
            "call_hangup",
            &call_state.room_id,
            &call_state.peer_id,
            &call_state.call_id,
        ))
        .map_err(|err| format!("failed to encode call hangup: {err}"))?;
        self.publish_control_payload(
            library,
            handle,
            &payload,
            format!(
                "Queued call hangup for {} until a peer path is ready.",
                call_state.peer_name
            ),
        )?;
        Ok(self.snapshot())
    }

    pub fn send_call_signal(
        &mut self,
        target_peer_id: &str,
        call_id: &str,
        room: &str,
        signal_type: &str,
        signal_data: &str,
    ) -> Result<DesktopSnapshot, String> {
        let handle = self
            .handle
            .ok_or_else(|| "runtime is offline; start it first".to_string())?;
        let library = self
            .library
            .as_ref()
            .ok_or_else(|| "shared library is not loaded".to_string())?;
        let payload = serde_json::to_vec(&ChatPayload::webrtc_signal(
            self.settings.nickname(),
            room,
            target_peer_id,
            call_id,
            signal_type,
            signal_data,
        ))
        .map_err(|err| format!("failed to encode call signal: {err}"))?;
        self.publish_control_payload(
            library,
            handle,
            &payload,
            "Queued WebRTC signal until a peer path is ready.".to_string(),
        )?;
        Ok(self.snapshot())
    }

    pub fn join_voice_room(&mut self, room: &str) -> Result<DesktopSnapshot, String> {
        let handle = self
            .handle
            .ok_or_else(|| "runtime is offline; start it first".to_string())?;
        let library = self
            .library
            .as_ref()
            .ok_or_else(|| "shared library is not loaded".to_string())?;
        let room_id = room.trim().trim_start_matches('#').to_lowercase();
        if room_id.is_empty() {
            return Err("voice room is required".to_string());
        }
        library.subscribe(handle, &room_id)?;
        if let Ok(mut callbacks) = shared_callback_state().lock() {
            callbacks.record_subscribed_room(&room_id);
            callbacks.join_voice_room(&room_id);
        }
        let payload = serde_json::to_vec(&ChatPayload::voice_presence(
            self.settings.nickname(),
            "voice_join",
            &room_id,
        ))
        .map_err(|err| format!("failed to encode voice join: {err}"))?;
        self.publish_control_payload(
            library,
            handle,
            &payload,
            "Queued voice-room join until a peer path is ready.".to_string(),
        )?;
        Ok(self.snapshot())
    }

    pub fn leave_voice_room(&mut self) -> Result<DesktopSnapshot, String> {
        let handle = self
            .handle
            .ok_or_else(|| "runtime is offline; start it first".to_string())?;
        let library = self
            .library
            .as_ref()
            .ok_or_else(|| "shared library is not loaded".to_string())?;
        let room = {
            let callback_state = shared_callback_state();
            let mut state = callback_state
                .lock()
                .map_err(|_| "callback state lock poisoned".to_string())?;
            state.leave_voice_room()
        };
        let Some(room_id) = room else {
            return Ok(self.snapshot());
        };
        let payload = serde_json::to_vec(&ChatPayload::voice_presence(
            self.settings.nickname(),
            "voice_leave",
            &room_id,
        ))
        .map_err(|err| format!("failed to encode voice leave: {err}"))?;
        self.publish_control_payload(
            library,
            handle,
            &payload,
            "Queued voice-room leave until a peer path is ready.".to_string(),
        )?;
        Ok(self.snapshot())
    }

    fn start_runtime(&mut self) -> Result<(), String> {
        if self.library.is_none() {
            self.reload_library();
        }
        let library = self
            .library
            .as_ref()
            .ok_or_else(|| self.shared_bridge_summary())?;
        let config_json = self.settings.config_json()?;

        if let Ok(mut callbacks) = shared_callback_state().lock() {
            callbacks.reset();
            callbacks.note_runtime(format!(
                "Starting live runtime for mesh {}.",
                self.settings.mesh_id()
            ));
        }

        let handle = library.init_handle(self.settings.mesh_id(), &config_json)?;
        library.set_callbacks(handle)?;
        library.start(handle)?;
        library.subscribe(handle, CONTROL_ROOM)?;
        library.subscribe(handle, self.settings.initial_room())?;
        self.configure_live_chat_identity(library, handle)?;
        self.publish_presence(library, handle)?;
        self.connect_startup_peer(library, handle);
        self.handle = Some(handle);
        Ok(())
    }

    fn stop_runtime(&mut self, note: &str) -> Result<(), String> {
        let Some(handle) = self.handle.take() else {
            return Ok(());
        };
        let library = self
            .library
            .as_ref()
            .ok_or_else(|| "shared library is not loaded".to_string())?;
        library.clear_callbacks(handle);
        library.stop(handle)?;
        if let Ok(mut callbacks) = shared_callback_state().lock() {
            callbacks.note_runtime(note);
        }
        Ok(())
    }

    fn connect_startup_peer(&self, library: &MossLibrary, handle: i64) {
        let Some(startup_peer) = self.settings.startup_peer() else {
            return;
        };
        if let Err(err) = library.connect(handle, startup_peer) {
            if let Ok(mut callbacks) = shared_callback_state().lock() {
                callbacks.note_runtime(format!(
                    "Startup peer {startup_peer} did not connect immediately: {err}"
                ));
            }
        }
    }

    fn live_mesh_info(&self) -> Result<Option<MeshInfo>, String> {
        let Some(handle) = self.handle else {
            return Ok(None);
        };
        let library = self
            .library
            .as_ref()
            .ok_or_else(|| "shared library not loaded".to_string())?;
        let mut mesh = library.mesh_info(handle)?;
        if let Ok(nat_type) = library.nat_type(handle) {
            mesh.nat_type = nat_type;
        }
        Ok(Some(mesh))
    }

    fn reload_library(&mut self) {
        match MossLibrary::load() {
            Ok(library) => {
                self.library = Some(library);
                self.library_error = None;
            }
            Err(err) => {
                self.library = None;
                self.library_error = Some(err);
            }
        }
    }

    fn shared_bridge_summary(&self) -> String {
        self.library
            .as_ref()
            .map(|library| format!("Loaded from {}", library.path_display()))
            .unwrap_or_else(|| {
                self.library_error
                    .clone()
                    .unwrap_or_else(|| "shared library not loaded".to_string())
            })
    }

    fn library_path(&self) -> String {
        self.library
            .as_ref()
            .map(|library| library.path_display())
            .unwrap_or_else(|| "not loaded".to_string())
    }

    fn configure_live_chat_identity(
        &self,
        library: &MossLibrary,
        handle: i64,
    ) -> Result<(), String> {
        let mesh = library.mesh_info(handle)?;
        let callback_state = shared_callback_state();
        let mut callbacks = callback_state
            .lock()
            .map_err(|_| "callback state lock poisoned".to_string())?;
        callbacks.configure_local_profile(
            mesh.public_key,
            self.settings.nickname().to_string(),
            &[self.settings.initial_room().to_string()],
        );
        Ok(())
    }

    fn publish_presence(&self, library: &MossLibrary, handle: i64) -> Result<(), String> {
        let rooms = {
            let callback_state = shared_callback_state();
            let callbacks = callback_state
                .lock()
                .map_err(|_| "callback state lock poisoned".to_string())?;
            callbacks.subscribed_rooms()
        };
        let payload = serde_json::to_vec(&ChatPayload::presence(
            self.settings.nickname(),
            &rooms,
            self.identity_presence.as_ref(),
        ))
        .map_err(|err| format!("failed to encode presence payload: {err}"))?;
        self.publish_control_payload(
            library,
            handle,
            &payload,
            "No peers connected yet. Presence will fan out once a peer joins.".to_string(),
        )?;
        Ok(())
    }

    fn ensure_direct_room_for_target(
        &self,
        library: &MossLibrary,
        handle: i64,
        target: &str,
    ) -> Result<(String, String, String), String> {
        let (target_peer, target_label) = {
            let callback_state = shared_callback_state();
            let state = callback_state
                .lock()
                .map_err(|_| "callback state lock poisoned".to_string())?;
            state.resolve_peer_target(target).ok_or_else(|| {
                format!("peer {target:?} not found; wait for presence or use connect")
            })?
        };

        let mesh = self
            .live_mesh_info()?
            .ok_or_else(|| "runtime mesh info unavailable".to_string())?;
        let room = direct_room_name(&mesh.public_key, &target_peer);
        library.subscribe(handle, &room)?;
        if let Ok(mut callbacks) = shared_callback_state().lock() {
            callbacks.record_subscribed_room(&room);
        }

        let invite = serde_json::to_vec(&ChatPayload::dm_invite(
            self.settings.nickname(),
            &room,
            &target_peer,
        ))
        .map_err(|err| format!("failed to encode direct chat invite: {err}"))?;
        self.publish_control_payload(
            library,
            handle,
            &invite,
            format!("Queued direct-chat invite for {target_label} until a peer path is ready."),
        )?;
        self.publish_presence(library, handle)?;
        Ok((target_peer, target_label, room))
    }

    fn publish_control_payload(
        &self,
        library: &MossLibrary,
        handle: i64,
        payload: &[u8],
        no_peer_note: String,
    ) -> Result<(), String> {
        match library.publish(handle, CONTROL_ROOM, payload) {
            Ok(()) => Ok(()),
            Err(err) if MossLibrary::is_no_peers_error(&err) => {
                if let Ok(mut callbacks) = shared_callback_state().lock() {
                    callbacks.note_runtime(no_peer_note);
                }
                Ok(())
            }
            Err(err) => Err(err),
        }
    }
}

impl Drop for DesktopShellState {
    fn drop(&mut self) {
        if let (Some(handle), Some(library)) = (self.handle.take(), self.library.as_ref()) {
            library.clear_callbacks(handle);
            let _ = library.stop(handle);
        }
    }
}

pub type SharedDesktopState = Mutex<DesktopShellState>;
