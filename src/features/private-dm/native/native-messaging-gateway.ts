import { invoke, isTauri } from "@tauri-apps/api/core";
import { DemoNativeMessagingGateway } from "./demo-native-messaging-gateway";

const APP_DIAGNOSTICS_COMMAND = "app_diagnostics";
const NATIVE_RUNTIME_STATUS_COMMAND = "native_runtime_status";
const PRIVATE_DM_CREATE_INVITE_COMMAND = "private_dm_create_invite";
const PRIVATE_DM_ACCEPT_INVITE_COMMAND = "private_dm_accept_invite";
const PRIVATE_DM_SEND_MESSAGE_COMMAND = "private_dm_send_message";
const PRIVATE_DM_RETRY_MESSAGE_COMMAND = "private_dm_retry_message";
const PRIVATE_DM_POLL_SESSION_COMMAND = "private_dm_poll_session";
const PRIVATE_DM_LIST_SESSIONS_COMMAND = "private_dm_list_sessions";
const PRIVATE_DM_CLOSE_SESSION_COMMAND = "private_dm_close_session";
const CHANNEL_JOIN_COMMAND = "channel_join";
const CHANNEL_LEAVE_COMMAND = "channel_leave";
const CHANNEL_SEND_COMMAND = "channel_send";
const CHANNEL_RETRY_MESSAGE_COMMAND = "channel_retry_message";
const CHANNEL_POLL_COMMAND = "channel_poll";
const CHANNEL_LIST_COMMAND = "channel_list";
const PRIVATE_GROUP_CREATE_COMMAND = "private_group_create";
const PRIVATE_GROUP_JOIN_COMMAND = "private_group_join";
const PRIVATE_GROUP_SEND_COMMAND = "private_group_send";
const PRIVATE_GROUP_RETRY_MESSAGE_COMMAND = "private_group_retry_message";
const PRIVATE_GROUP_POLL_COMMAND = "private_group_poll";
const PRIVATE_GROUP_LIST_COMMAND = "private_group_list";
const PRIVATE_GROUP_CLOSE_COMMAND = "private_group_close";
const PRIVATE_DM_SEND_ATTACHMENT_COMMAND = "private_dm_send_attachment";
const PRIVATE_DM_DOWNLOAD_ATTACHMENT_COMMAND = "private_dm_download_attachment";
const PRIVATE_DM_CANCEL_ATTACHMENT_COMMAND = "private_dm_cancel_attachment";
const PRIVATE_DM_CALL_START_COMMAND = "private_dm_call_start";
const PRIVATE_DM_CALL_ACCEPT_COMMAND = "private_dm_call_accept";
const PRIVATE_DM_CALL_DECLINE_COMMAND = "private_dm_call_decline";
const PRIVATE_DM_CALL_END_COMMAND = "private_dm_call_end";
const PRIVATE_DM_CALL_SEND_FRAME_COMMAND = "private_dm_call_send_frame";
const PRIVATE_DM_CALL_DRAIN_FRAMES_COMMAND = "private_dm_call_drain_frames";
const LIST_NETWORK_INTERFACES_COMMAND = "list_network_interfaces";
const DETECT_VPN_COMMAND = "detect_vpn";
const SET_BIND_INTERFACE_COMMAND = "set_bind_interface";
const GET_BIND_INTERFACE_COMMAND = "get_bind_interface";
const PRIVATE_GROUP_SEND_ATTACHMENT_COMMAND = "private_group_send_attachment";
const PRIVATE_GROUP_DOWNLOAD_ATTACHMENT_COMMAND = "private_group_download_attachment";
const PRIVATE_GROUP_CANCEL_ATTACHMENT_COMMAND = "private_group_cancel_attachment";
const CHANNEL_SEND_ATTACHMENT_COMMAND = "channel_send_attachment";
const CHANNEL_DOWNLOAD_ATTACHMENT_COMMAND = "channel_download_attachment";
const CHANNEL_CANCEL_ATTACHMENT_COMMAND = "channel_cancel_attachment";
const CHANNEL_SEND_DM_OFFER_COMMAND = "channel_send_dm_offer";
const CHANNEL_DISMISS_DM_OFFER_COMMAND = "channel_dismiss_dm_offer";
const PRIVATE_GROUP_SEND_DM_OFFER_COMMAND = "private_group_send_dm_offer";
const PRIVATE_GROUP_DISMISS_DM_OFFER_COMMAND = "private_group_dismiss_dm_offer";
const ORG_JOIN_COMMAND = "org_join";
const ORG_LEAVE_COMMAND = "org_leave";
const ORG_LIST_COMMAND = "org_list";
const ORG_POLL_COMMAND = "org_poll";
const ORG_SEND_DM_OFFER_COMMAND = "org_send_dm_offer";
const ORG_ACCEPT_DM_OFFER_COMMAND = "org_accept_dm_offer";
const ORG_DISMISS_DM_OFFER_COMMAND = "org_dismiss_dm_offer";
const ORG_CREATE_GROUP_COMMAND = "org_create_group";
const ORG_ACCEPT_GROUP_OFFER_COMMAND = "org_accept_group_offer";
const ORG_DISMISS_GROUP_OFFER_COMMAND = "org_dismiss_group_offer";
const ORG_GROUP_INVITE_MEMBERS_COMMAND = "org_group_invite_members";

export interface DiagnosticsSnapshot {
  readonly app_name: string;
  readonly privacy_model: string;
  readonly discovery_model: string;
  readonly moss_link_mode: string;
}

export interface NativeRuntimeStatus {
  readonly moss: {
    readonly link_mode: string;
    readonly library_name: string;
    readonly required_symbols: readonly string[];
    readonly available: boolean;
    readonly checked_paths: readonly string[];
  };
  readonly secure_storage: {
    readonly backend: string;
    readonly service: string;
    readonly available: boolean;
  };
  readonly persistence: {
    readonly backend: string;
    readonly database: string;
    readonly available: boolean;
    readonly encrypted_at_rest: boolean;
    readonly error?: string | null;
  };
  readonly openmls_smoke: OpenMlsSmokeResult;
  readonly openmls_roundtrip: OpenMlsRoundTripResult;
}

export type OpenMlsSmokeResult =
  | {
      readonly Ok: {
        readonly provider: string;
        readonly ciphersuite: string;
        readonly protected_message_created: boolean;
      };
    }
  | { readonly Err: string };

export type OpenMlsRoundTripResult =
  | {
      readonly Ok: {
        readonly provider: string;
        readonly ciphersuite: string;
        readonly welcome_joined: boolean;
        readonly plaintext_roundtrip: boolean;
      };
    }
  | { readonly Err: string };

export interface StartSessionRequest {
  readonly display_name: string;
  readonly listen_port: number;
  readonly static_peer?: string | null;
}

export interface AcceptInviteRequest {
  readonly invite_uri: string;
  readonly display_name: string;
  readonly listen_port: number;
  readonly static_peer?: string | null;
}

export interface InviteCreated {
  readonly invite_uri: string;
  readonly session_id: string;
  readonly mesh_id: string;
  readonly fingerprint: string;
  readonly listen_address: string;
}

export type AttachmentState =
  | "available"
  | "offered"
  | "downloading"
  | "failed"
  | "cancelled";

export interface VoiceMeta {
  readonly duration_ms: number;
  /** 64 amplitude buckets (one byte each, 0-255), base64-encoded. */
  readonly peaks_b64: string;
}

export interface AttachmentDescriptor {
  readonly attachment_id: string;
  readonly content_hash: string;
  readonly file_name: string;
  readonly mime: string;
  readonly total_size: number;
  readonly thumbnail_b64?: string;
  readonly voice?: VoiceMeta;
}

export interface AttachmentView {
  readonly attachment_id: string;
  readonly direction: "incoming" | "outgoing";
  readonly state: AttachmentState;
  readonly completed_chunks: number;
  readonly chunk_count: number;
  readonly local_path?: string;
}

export interface AttachmentSendResult {
  readonly session_id: string;
  readonly attachment_id: string;
  readonly content_hash: string;
}

export interface DmOffer {
  readonly offer_id: string;
  readonly from_device: string;
  readonly from_fingerprint: string;
  readonly target_fingerprint: string;
  readonly invite_uri: string;
}

export interface ChatMessage {
  readonly from_device: string;
  readonly body: string;
  readonly message_id?: string;
  readonly sent_at_ms?: number;
  readonly delivery_status?: "pending" | "sent" | "failed";
  readonly delivery_error?: string | null;
  readonly retryable?: boolean;
  readonly retry_count?: number;
  readonly attachment?: AttachmentDescriptor;
  readonly call_event?: CallEvent;
}

export interface PendingCall {
  readonly call_id: string;
  readonly from_device: string;
}

/** The caller-side "ringing" state while waiting for the peer to answer. */
export interface OutgoingCall {
  readonly call_id: string;
}

export interface ActiveCall {
  readonly call_id: string;
  readonly direction: "caller" | "callee";
  readonly key_b64: string;
  readonly nonce_prefix_b64: string;
  readonly started_at_ms: number;
}

export interface CallEvent {
  readonly kind: "completed" | "missed";
  readonly duration_ms: number;
  readonly call_id: string;
}

export interface CallStarted {
  readonly session_id: string;
  readonly call_id: string;
  readonly key_b64: string;
  readonly nonce_prefix_b64: string;
}

export interface MeshInfo {
  readonly mesh_id: string;
  readonly listen_port: number;
  readonly advertised_addr: string;
  readonly peer_count: number;
  readonly direct_peer_count: number;
  readonly relayed_peer_count: number;
  readonly relay_capable_peer_count: number;
  readonly relay_session_count: number;
  readonly relay_route_count: number;
  readonly known_peer_count: number;
  readonly channels: readonly string[];
  readonly nat_type: string;
  readonly supernode_ready: boolean;
  readonly public_key: string;
}

export interface SessionSnapshot {
  readonly session_id: string;
  readonly mesh_id: string;
  readonly role: string;
  /** The local device's own display name. */
  readonly display_name: string;
  /** The remote peer's display name (empty until first inbound frame). */
  readonly peer_display_name: string;
  readonly state: string;
  /** Transport path: "direct", "relayed", or "connecting". Relayed is E2E. */
  readonly path: string;
  readonly invite_uri: string | null;
  readonly fingerprint: string;
  readonly messages: readonly ChatMessage[];
  readonly attachments: readonly AttachmentView[];
  readonly mesh: MeshInfo | null;
  readonly events: readonly SnapshotEvent[];
  readonly pending_call?: PendingCall;
  readonly outgoing_call?: OutgoingCall;
  readonly active_call?: ActiveCall;
}

export interface SnapshotEvent {
  readonly event_type: number;
  readonly event_name: string;
  readonly detail_json: string;
  readonly epoch_millis: number;
}

export interface SessionListSnapshot {
  readonly sessions: readonly SessionSnapshot[];
}

export interface SendMessageResult {
  readonly session_id: string;
  readonly state: string;
  readonly ciphertext_bytes: number;
  readonly message_id: string;
  readonly sent_at_ms: number;
  readonly delivery_status: "pending" | "sent" | "failed";
  readonly delivery_error?: string | null;
}

export interface CloseSessionResult {
  readonly session_id: string;
  readonly closed: boolean;
}

export interface JoinChannelRequest {
  readonly name: string;
  readonly display_name: string;
  readonly listen_port: number;
  readonly static_peer?: string | null;
}

export interface ChannelMessage {
  readonly from_device: string;
  readonly from_fingerprint: string;
  readonly body: string;
  readonly message_id?: string;
  readonly sent_at_ms?: number;
  readonly delivery_status?: "pending" | "sent" | "failed";
  readonly delivery_error?: string | null;
  readonly retryable?: boolean;
  readonly retry_count?: number;
  readonly attachment?: AttachmentDescriptor;
}

export interface ChannelSnapshot {
  readonly name: string;
  readonly topic: string;
  readonly mesh_id: string;
  readonly display_name: string;
  readonly device_fingerprint: string;
  readonly messages: readonly ChannelMessage[];
  readonly attachments: readonly AttachmentView[];
  readonly dm_offers: readonly DmOffer[];
  readonly mesh: MeshInfo | null;
  readonly events: readonly SnapshotEvent[];
}

export interface ChannelListSnapshot {
  readonly channels: readonly ChannelSnapshot[];
}

export interface ChannelSendResult {
  readonly name: string;
  readonly bytes: number;
  readonly message_id: string;
  readonly sent_at_ms: number;
  readonly delivery_status: "pending" | "sent" | "failed";
  readonly delivery_error?: string | null;
}

export interface ChannelLeaveResult {
  readonly name: string;
  readonly closed: boolean;
}

export interface CreateGroupRequest {
  readonly label?: string | null;
  readonly display_name: string;
  readonly listen_port: number;
  readonly static_peer?: string | null;
  readonly org_pubkey?: string | null;
}

export interface JoinGroupRequest {
  readonly invite_uri: string;
  readonly display_name: string;
  readonly listen_port: number;
  readonly static_peer?: string | null;
  readonly org_pubkey?: string | null;
}

export interface GroupCreated {
  readonly group_id: string;
  readonly mesh_id: string;
  readonly invite_uri: string;
  readonly fingerprint: string;
  readonly label: string | null;
}

export interface GroupMessage {
  readonly from_device: string;
  readonly from_fingerprint: string;
  readonly body: string;
  readonly message_id?: string;
  readonly sent_at_ms?: number;
  readonly delivery_status?: "pending" | "sent" | "failed";
  readonly delivery_error?: string | null;
  readonly retryable?: boolean;
  readonly retry_count?: number;
  readonly attachment?: AttachmentDescriptor;
}

export interface GroupSnapshot {
  readonly group_id: string;
  readonly mesh_id: string;
  readonly label: string | null;
  readonly display_name: string;
  readonly device_fingerprint: string;
  readonly creator_fingerprint: string;
  readonly is_admin: boolean;
  readonly state: string;
  readonly member_count: number;
  readonly invite_uri: string | null;
  readonly messages: readonly GroupMessage[];
  readonly attachments: readonly AttachmentView[];
  readonly dm_offers: readonly DmOffer[];
  readonly mesh: MeshInfo | null;
  readonly events: readonly SnapshotEvent[];
  readonly needs_rejoin: boolean;
  readonly org_pubkey: string | null;
  readonly member_peer_ids: readonly string[];
}

export interface GroupListSnapshot {
  readonly groups: readonly GroupSnapshot[];
}

export interface GroupSendResult {
  readonly group_id: string;
  readonly bytes: number;
  readonly message_id: string;
  readonly sent_at_ms: number;
  readonly delivery_status: "pending" | "sent" | "failed";
  readonly delivery_error?: string | null;
}

export interface GroupLeaveResult {
  readonly group_id: string;
  readonly closed: boolean;
}

export interface OrgMemberView {
  readonly moss_peer_id: string;
  readonly name: string;
  readonly role: string;
  readonly is_self: boolean;
}

export interface OrgDmOfferView {
  readonly offer_id: string;
  readonly from_peer_id: string;
  readonly from_name: string;
  readonly invite_uri: string;
}

export interface OrgGroupOfferView {
  readonly offer_id: string;
  readonly from_peer_id: string;
  readonly from_name: string;
  readonly group_label: string | null;
  readonly group_invite_uri: string;
}

export interface OrgDmLink {
  readonly peer_id: string;
  readonly session_id: string | null;
}

export interface OrgSnapshot {
  readonly org_pubkey: string;
  readonly org_name: string;
  readonly mesh_id: string;
  readonly own_peer_id: string;
  readonly confirmation_code: string;
  readonly in_roster: boolean;
  readonly roster_version: number | null;
  readonly members: readonly OrgMemberView[];
  readonly dm_offers: readonly OrgDmOfferView[];
  readonly group_offers: readonly OrgGroupOfferView[];
  readonly dm_links: readonly OrgDmLink[];
}

export interface JoinOrgRequest {
  readonly bundle_uri: string;
  readonly display_name: string;
  readonly listen_port: number;
  readonly static_peer?: string | null;
}

export interface OrgCreateGroupRequest {
  readonly org_pubkey: string;
  readonly label?: string | null;
  readonly member_peer_ids: readonly string[];
  readonly display_name: string;
  readonly listen_port: number;
  readonly static_peer?: string | null;
}

export interface NativeMessagingGateway {
  getDiagnostics(): Promise<DiagnosticsSnapshot>;
  getNativeRuntimeStatus(): Promise<NativeRuntimeStatus>;
  createPrivateInvite(request: StartSessionRequest): Promise<InviteCreated>;
  acceptPrivateInvite(request: AcceptInviteRequest): Promise<SessionSnapshot>;
  sendPrivateMessage(sessionId: string, body: string): Promise<SendMessageResult>;
  retryPrivateMessage(sessionId: string, messageId: string): Promise<SendMessageResult>;
  pollPrivateSession(sessionId: string): Promise<SessionSnapshot>;
  listPrivateSessions(): Promise<SessionListSnapshot>;
  closePrivateSession(sessionId: string): Promise<CloseSessionResult>;
  joinChannel(request: JoinChannelRequest): Promise<ChannelSnapshot>;
  leaveChannel(name: string): Promise<ChannelLeaveResult>;
  sendChannelMessage(name: string, body: string): Promise<ChannelSendResult>;
  retryChannelMessage(name: string, messageId: string): Promise<ChannelSendResult>;
  pollChannel(name: string): Promise<ChannelSnapshot>;
  listChannels(): Promise<ChannelListSnapshot>;
  createPrivateGroup(request: CreateGroupRequest): Promise<GroupCreated>;
  joinPrivateGroup(request: JoinGroupRequest): Promise<GroupSnapshot>;
  sendGroupMessage(groupId: string, body: string): Promise<GroupSendResult>;
  retryGroupMessage(groupId: string, messageId: string): Promise<GroupSendResult>;
  pollPrivateGroup(groupId: string): Promise<GroupSnapshot>;
  listPrivateGroups(): Promise<GroupListSnapshot>;
  closePrivateGroup(groupId: string): Promise<GroupLeaveResult>;
  sendPrivateAttachment(
    sessionId: string,
    fileName: string,
    mime: string,
    dataBase64: string,
    thumbnailBase64?: string,
    voice?: VoiceMeta,
  ): Promise<AttachmentSendResult>;
  downloadPrivateAttachment(sessionId: string, attachmentId: string): Promise<void>;
  cancelPrivateAttachment(sessionId: string, attachmentId: string): Promise<void>;
  sendGroupAttachment(
    groupId: string,
    fileName: string,
    mime: string,
    dataBase64: string,
    thumbnailBase64?: string,
    voice?: VoiceMeta,
  ): Promise<AttachmentSendResult>;
  downloadGroupAttachment(groupId: string, attachmentId: string): Promise<void>;
  cancelGroupAttachment(groupId: string, attachmentId: string): Promise<void>;
  sendChannelAttachment(
    name: string,
    fileName: string,
    mime: string,
    dataBase64: string,
    thumbnailBase64?: string,
    voice?: VoiceMeta,
  ): Promise<AttachmentSendResult>;
  downloadChannelAttachment(name: string, attachmentId: string): Promise<void>;
  cancelChannelAttachment(name: string, attachmentId: string): Promise<void>;
  sendChannelDmOffer(
    name: string,
    targetFingerprint: string,
    inviteUri: string,
  ): Promise<void>;
  dismissChannelDmOffer(name: string, offerId: string): Promise<void>;
  sendGroupDmOffer(
    groupId: string,
    targetFingerprint: string,
    inviteUri: string,
  ): Promise<void>;
  dismissGroupDmOffer(groupId: string, offerId: string): Promise<void>;
  callStart(sessionId: string): Promise<CallStarted>;
  callAccept(sessionId: string, callId: string): Promise<void>;
  callDecline(sessionId: string, callId: string, reason: string): Promise<void>;
  callEnd(sessionId: string, callId: string, reason: string): Promise<void>;
  callSendFrame(sessionId: string, callId: string, frameBase64: string): Promise<void>;
  callDrainFrames(sessionId: string, callId: string): Promise<readonly string[]>;
  joinOrg(request: JoinOrgRequest): Promise<OrgSnapshot>;
  leaveOrg(orgPubkey: string): Promise<void>;
  listOrgs(): Promise<readonly OrgSnapshot[]>;
  pollOrg(orgPubkey: string): Promise<OrgSnapshot>;
  orgSendDmOffer(
    orgPubkey: string,
    targetPeerId: string,
    displayName: string,
    listenPort: number,
    staticPeer?: string | null,
  ): Promise<InviteCreated>;
  orgAcceptDmOffer(
    orgPubkey: string,
    offerId: string,
    displayName: string,
    listenPort: number,
    staticPeer?: string | null,
  ): Promise<SessionSnapshot>;
  orgDismissDmOffer(orgPubkey: string, offerId: string): Promise<void>;
  orgCreateGroup(request: OrgCreateGroupRequest): Promise<GroupCreated>;
  orgAcceptGroupOffer(
    orgPubkey: string,
    offerId: string,
    displayName: string,
    listenPort: number,
    staticPeer?: string | null,
  ): Promise<GroupSnapshot>;
  orgDismissGroupOffer(orgPubkey: string, offerId: string): Promise<void>;
  orgGroupInviteMembers(
    orgPubkey: string,
    groupId: string,
    memberPeerIds: readonly string[],
  ): Promise<void>;
  listNetworkInterfaces(): Promise<readonly NetworkInterfaceInfo[]>;
  detectVpn(): Promise<VpnDetection>;
  setBindInterface(value: string | null): Promise<void>;
  getBindInterface(): Promise<string | null>;
}

export interface NetworkInterfaceInfo {
  readonly name: string;
  readonly description: string;
  readonly index: number;
  readonly ipv4: string | null;
  readonly is_loopback: boolean;
  readonly is_up: boolean;
  readonly is_virtual: boolean;
  readonly is_vpn: boolean;
  readonly is_default_route: boolean;
}

export interface VpnDetection {
  readonly vpn_likely: boolean;
  readonly suspect_interfaces: readonly string[];
  readonly vpn_owns_default_route: boolean;
}

export class TauriNativeMessagingGateway implements NativeMessagingGateway {
  async getDiagnostics(): Promise<DiagnosticsSnapshot> {
    return invoke<DiagnosticsSnapshot>(APP_DIAGNOSTICS_COMMAND);
  }

  async getNativeRuntimeStatus(): Promise<NativeRuntimeStatus> {
    return invoke<NativeRuntimeStatus>(NATIVE_RUNTIME_STATUS_COMMAND);
  }

  async createPrivateInvite(request: StartSessionRequest): Promise<InviteCreated> {
    return invoke<InviteCreated>(PRIVATE_DM_CREATE_INVITE_COMMAND, { request });
  }

  async acceptPrivateInvite(request: AcceptInviteRequest): Promise<SessionSnapshot> {
    return invoke<SessionSnapshot>(PRIVATE_DM_ACCEPT_INVITE_COMMAND, { request });
  }

  async sendPrivateMessage(sessionId: string, body: string): Promise<SendMessageResult> {
    return invoke<SendMessageResult>(PRIVATE_DM_SEND_MESSAGE_COMMAND, {
      sessionId,
      body,
    });
  }

  async retryPrivateMessage(
    sessionId: string,
    messageId: string,
  ): Promise<SendMessageResult> {
    return invoke<SendMessageResult>(PRIVATE_DM_RETRY_MESSAGE_COMMAND, {
      sessionId,
      messageId,
    });
  }

  async pollPrivateSession(sessionId: string): Promise<SessionSnapshot> {
    return invoke<SessionSnapshot>(PRIVATE_DM_POLL_SESSION_COMMAND, { sessionId });
  }

  async listPrivateSessions(): Promise<SessionListSnapshot> {
    return invoke<SessionListSnapshot>(PRIVATE_DM_LIST_SESSIONS_COMMAND);
  }

  async closePrivateSession(sessionId: string): Promise<CloseSessionResult> {
    return invoke<CloseSessionResult>(PRIVATE_DM_CLOSE_SESSION_COMMAND, { sessionId });
  }

  async joinChannel(request: JoinChannelRequest): Promise<ChannelSnapshot> {
    return invoke<ChannelSnapshot>(CHANNEL_JOIN_COMMAND, { request });
  }

  async leaveChannel(name: string): Promise<ChannelLeaveResult> {
    return invoke<ChannelLeaveResult>(CHANNEL_LEAVE_COMMAND, { name });
  }

  async sendChannelMessage(name: string, body: string): Promise<ChannelSendResult> {
    return invoke<ChannelSendResult>(CHANNEL_SEND_COMMAND, { name, body });
  }

  async retryChannelMessage(
    name: string,
    messageId: string,
  ): Promise<ChannelSendResult> {
    return invoke<ChannelSendResult>(CHANNEL_RETRY_MESSAGE_COMMAND, { name, messageId });
  }

  async pollChannel(name: string): Promise<ChannelSnapshot> {
    return invoke<ChannelSnapshot>(CHANNEL_POLL_COMMAND, { name });
  }

  async listChannels(): Promise<ChannelListSnapshot> {
    return invoke<ChannelListSnapshot>(CHANNEL_LIST_COMMAND);
  }

  async createPrivateGroup(request: CreateGroupRequest): Promise<GroupCreated> {
    return invoke<GroupCreated>(PRIVATE_GROUP_CREATE_COMMAND, { request });
  }

  async joinPrivateGroup(request: JoinGroupRequest): Promise<GroupSnapshot> {
    return invoke<GroupSnapshot>(PRIVATE_GROUP_JOIN_COMMAND, { request });
  }

  async sendGroupMessage(groupId: string, body: string): Promise<GroupSendResult> {
    return invoke<GroupSendResult>(PRIVATE_GROUP_SEND_COMMAND, { groupId, body });
  }

  async retryGroupMessage(
    groupId: string,
    messageId: string,
  ): Promise<GroupSendResult> {
    return invoke<GroupSendResult>(PRIVATE_GROUP_RETRY_MESSAGE_COMMAND, {
      groupId,
      messageId,
    });
  }

  async pollPrivateGroup(groupId: string): Promise<GroupSnapshot> {
    return invoke<GroupSnapshot>(PRIVATE_GROUP_POLL_COMMAND, { groupId });
  }

  async listPrivateGroups(): Promise<GroupListSnapshot> {
    return invoke<GroupListSnapshot>(PRIVATE_GROUP_LIST_COMMAND);
  }

  async closePrivateGroup(groupId: string): Promise<GroupLeaveResult> {
    return invoke<GroupLeaveResult>(PRIVATE_GROUP_CLOSE_COMMAND, { groupId });
  }

  async sendPrivateAttachment(
    sessionId: string,
    fileName: string,
    mime: string,
    dataBase64: string,
    thumbnailBase64?: string,
    voice?: VoiceMeta,
  ): Promise<AttachmentSendResult> {
    return invoke<AttachmentSendResult>(PRIVATE_DM_SEND_ATTACHMENT_COMMAND, {
      sessionId,
      fileName,
      mime,
      dataBase64,
      thumbnailBase64: thumbnailBase64 ?? null,
      voice: voice ?? null,
    });
  }

  async downloadPrivateAttachment(sessionId: string, attachmentId: string): Promise<void> {
    await invoke(PRIVATE_DM_DOWNLOAD_ATTACHMENT_COMMAND, { sessionId, attachmentId });
  }

  async cancelPrivateAttachment(sessionId: string, attachmentId: string): Promise<void> {
    await invoke(PRIVATE_DM_CANCEL_ATTACHMENT_COMMAND, { sessionId, attachmentId });
  }

  async sendGroupAttachment(
    groupId: string,
    fileName: string,
    mime: string,
    dataBase64: string,
    thumbnailBase64?: string,
    voice?: VoiceMeta,
  ): Promise<AttachmentSendResult> {
    return invoke<AttachmentSendResult>(PRIVATE_GROUP_SEND_ATTACHMENT_COMMAND, {
      groupId,
      fileName,
      mime,
      dataBase64,
      thumbnailBase64: thumbnailBase64 ?? null,
      voice: voice ?? null,
    });
  }

  async downloadGroupAttachment(groupId: string, attachmentId: string): Promise<void> {
    await invoke(PRIVATE_GROUP_DOWNLOAD_ATTACHMENT_COMMAND, { groupId, attachmentId });
  }

  async cancelGroupAttachment(groupId: string, attachmentId: string): Promise<void> {
    await invoke(PRIVATE_GROUP_CANCEL_ATTACHMENT_COMMAND, { groupId, attachmentId });
  }

  async sendChannelAttachment(
    name: string,
    fileName: string,
    mime: string,
    dataBase64: string,
    thumbnailBase64?: string,
    voice?: VoiceMeta,
  ): Promise<AttachmentSendResult> {
    return invoke<AttachmentSendResult>(CHANNEL_SEND_ATTACHMENT_COMMAND, {
      name,
      fileName,
      mime,
      dataBase64,
      thumbnailBase64: thumbnailBase64 ?? null,
      voice: voice ?? null,
    });
  }

  async downloadChannelAttachment(name: string, attachmentId: string): Promise<void> {
    await invoke(CHANNEL_DOWNLOAD_ATTACHMENT_COMMAND, { name, attachmentId });
  }

  async cancelChannelAttachment(name: string, attachmentId: string): Promise<void> {
    await invoke(CHANNEL_CANCEL_ATTACHMENT_COMMAND, { name, attachmentId });
  }

  async sendChannelDmOffer(
    name: string,
    targetFingerprint: string,
    inviteUri: string,
  ): Promise<void> {
    await invoke(CHANNEL_SEND_DM_OFFER_COMMAND, {
      name,
      targetFingerprint,
      inviteUri,
    });
  }

  async dismissChannelDmOffer(name: string, offerId: string): Promise<void> {
    await invoke(CHANNEL_DISMISS_DM_OFFER_COMMAND, { name, offerId });
  }

  async sendGroupDmOffer(
    groupId: string,
    targetFingerprint: string,
    inviteUri: string,
  ): Promise<void> {
    await invoke(PRIVATE_GROUP_SEND_DM_OFFER_COMMAND, {
      groupId,
      targetFingerprint,
      inviteUri,
    });
  }

  async dismissGroupDmOffer(groupId: string, offerId: string): Promise<void> {
    await invoke(PRIVATE_GROUP_DISMISS_DM_OFFER_COMMAND, { groupId, offerId });
  }

  async callStart(sessionId: string): Promise<CallStarted> {
    return invoke<CallStarted>(PRIVATE_DM_CALL_START_COMMAND, { sessionId });
  }

  async callAccept(sessionId: string, callId: string): Promise<void> {
    await invoke(PRIVATE_DM_CALL_ACCEPT_COMMAND, { sessionId, callId });
  }

  async callDecline(sessionId: string, callId: string, reason: string): Promise<void> {
    await invoke(PRIVATE_DM_CALL_DECLINE_COMMAND, { sessionId, callId, reason });
  }

  async callEnd(sessionId: string, callId: string, reason: string): Promise<void> {
    await invoke(PRIVATE_DM_CALL_END_COMMAND, { sessionId, callId, reason });
  }

  async callSendFrame(
    sessionId: string,
    callId: string,
    frameBase64: string,
  ): Promise<void> {
    await invoke(PRIVATE_DM_CALL_SEND_FRAME_COMMAND, {
      sessionId,
      callId,
      frameB64: frameBase64,
    });
  }

  async callDrainFrames(
    sessionId: string,
    callId: string,
  ): Promise<readonly string[]> {
    return invoke<readonly string[]>(PRIVATE_DM_CALL_DRAIN_FRAMES_COMMAND, {
      sessionId,
      callId,
    });
  }

  async joinOrg(request: JoinOrgRequest): Promise<OrgSnapshot> {
    return invoke<OrgSnapshot>(ORG_JOIN_COMMAND, { request });
  }

  async leaveOrg(orgPubkey: string): Promise<void> {
    await invoke(ORG_LEAVE_COMMAND, { orgPubkey });
  }

  async listOrgs(): Promise<readonly OrgSnapshot[]> {
    return invoke<readonly OrgSnapshot[]>(ORG_LIST_COMMAND);
  }

  async pollOrg(orgPubkey: string): Promise<OrgSnapshot> {
    return invoke<OrgSnapshot>(ORG_POLL_COMMAND, { orgPubkey });
  }

  async orgSendDmOffer(
    orgPubkey: string,
    targetPeerId: string,
    displayName: string,
    listenPort: number,
    staticPeer?: string | null,
  ): Promise<InviteCreated> {
    return invoke<InviteCreated>(ORG_SEND_DM_OFFER_COMMAND, {
      orgPubkey,
      targetPeerId,
      displayName,
      listenPort,
      staticPeer: staticPeer ?? null,
    });
  }

  async orgAcceptDmOffer(
    orgPubkey: string,
    offerId: string,
    displayName: string,
    listenPort: number,
    staticPeer?: string | null,
  ): Promise<SessionSnapshot> {
    return invoke<SessionSnapshot>(ORG_ACCEPT_DM_OFFER_COMMAND, {
      orgPubkey,
      offerId,
      displayName,
      listenPort,
      staticPeer: staticPeer ?? null,
    });
  }

  async orgDismissDmOffer(orgPubkey: string, offerId: string): Promise<void> {
    await invoke(ORG_DISMISS_DM_OFFER_COMMAND, { orgPubkey, offerId });
  }

  async orgCreateGroup(request: OrgCreateGroupRequest): Promise<GroupCreated> {
    return invoke<GroupCreated>(ORG_CREATE_GROUP_COMMAND, { request });
  }

  async orgAcceptGroupOffer(
    orgPubkey: string,
    offerId: string,
    displayName: string,
    listenPort: number,
    staticPeer?: string | null,
  ): Promise<GroupSnapshot> {
    return invoke<GroupSnapshot>(ORG_ACCEPT_GROUP_OFFER_COMMAND, {
      orgPubkey,
      offerId,
      displayName,
      listenPort,
      staticPeer: staticPeer ?? null,
    });
  }

  async orgDismissGroupOffer(orgPubkey: string, offerId: string): Promise<void> {
    await invoke(ORG_DISMISS_GROUP_OFFER_COMMAND, { orgPubkey, offerId });
  }

  async orgGroupInviteMembers(
    orgPubkey: string,
    groupId: string,
    memberPeerIds: readonly string[],
  ): Promise<void> {
    await invoke(ORG_GROUP_INVITE_MEMBERS_COMMAND, {
      orgPubkey,
      groupId,
      memberPeerIds,
    });
  }

  async listNetworkInterfaces(): Promise<readonly NetworkInterfaceInfo[]> {
    return invoke<readonly NetworkInterfaceInfo[]>(LIST_NETWORK_INTERFACES_COMMAND);
  }

  async detectVpn(): Promise<VpnDetection> {
    return invoke<VpnDetection>(DETECT_VPN_COMMAND);
  }

  async setBindInterface(value: string | null): Promise<void> {
    await invoke(SET_BIND_INTERFACE_COMMAND, { value });
  }

  async getBindInterface(): Promise<string | null> {
    return invoke<string | null>(GET_BIND_INTERFACE_COMMAND);
  }
}

function isTauriRuntimeAvailable(): boolean {
  return isTauri();
}

export const nativeMessagingGateway: NativeMessagingGateway = isTauriRuntimeAvailable()
  ? new TauriNativeMessagingGateway()
  : new DemoNativeMessagingGateway();
