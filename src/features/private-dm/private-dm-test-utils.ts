import { vi } from "vitest";
import type {
  OrgSnapshot,
  ChannelMessage,
  ChannelSendResult,
  GroupSendResult,
  GroupSnapshot,
  MeshInfo,
  NativeMessagingGateway,
  NativeRuntimeStatus,
  SendMessageResult,
  SessionListSnapshot,
  SessionSnapshot,
  SnapshotEvent,
} from "./native/native-messaging-gateway";

export const FINGERPRINT = "AABBCCDDEEFF0011";
export const SESSION_ID = "session-one";
export const INVITE = `mosh://invite?mesh=mesh-one&session=${SESSION_ID}#fp=${FINGERPRINT}`;

export const MESH_READY: MeshInfo = {
  mesh_id: "mesh-one",
  listen_port: 42130,
  advertised_addr: "203.0.113.7:42130",
  peer_count: 1,
  direct_peer_count: 1,
  relayed_peer_count: 0,
  relay_capable_peer_count: 0,
  relay_session_count: 0,
  relay_route_count: 0,
  known_peer_count: 1,
  channels: ["mls-control/session-one", "mls-data/session-one"],
  nat_type: "endpoint-independent",
  supernode_ready: false,
  public_key: "abcdef0123456789",
};

export const EVENTS: SnapshotEvent[] = [
  {
    event_type: 1,
    event_name: "peer_joined",
    detail_json: '{"peer_id":"abc123"}',
    epoch_millis: Date.now() - 1000,
  },
];

export const RUNTIME_STATUS_READY: NativeRuntimeStatus = {
  moss: {
    link_mode: "dynamic",
    library_name: "moss",
    required_symbols: [],
    available: true,
    checked_paths: [],
  },
  secure_storage: {
    backend: "os-keychain",
    service: "app.mosh.desktop",
    available: true,
  },
  persistence: {
    backend: "redb+aes-256-gcm+os-keychain",
    database: "test-history.redb",
    available: true,
    encrypted_at_rest: true,
    error: null,
  },
  openmls_smoke: {
    Ok: {
      provider: "openmls_rust_crypto",
      ciphersuite: "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519",
      protected_message_created: true,
    },
  },
  openmls_roundtrip: {
    Ok: {
      provider: "openmls_rust_crypto",
      ciphersuite: "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519",
      welcome_joined: true,
      plaintext_roundtrip: true,
    },
  },
};

export function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    session_id: SESSION_ID,
    mesh_id: "mesh-one",
    role: "bob",
    display_name: "mosh-bob",
    peer_display_name: "Alice",
    state: "ready",
    path: "direct",
    invite_uri: INVITE,
    fingerprint: FINGERPRINT,
    messages: [{ from_device: "Alice", body: "hello from moss" }],
    attachments: [],
    mesh: MESH_READY,
    events: EVENTS,
    ...overrides,
  };
}

export function groupSnapshot(overrides: Partial<GroupSnapshot> = {}): GroupSnapshot {
  return {
    group_id: "group-test",
    mesh_id: "groupmesh-test",
    label: "Friends",
    display_name: "mosh-test",
    device_fingerprint: "abcdef",
    creator_fingerprint: "AABB",
    is_admin: true,
    state: "ready",
    member_count: 2,
    invite_uri:
      "mosh://group?mesh=groupmesh-test&group=group-test#fp=AABBCCDDEEFF00112233445566778899",
    messages: [],
    attachments: [],
    dm_offers: [],
    mesh: MESH_READY,
    events: [],
    needs_rejoin: false,
    org_pubkey: null,
    member_peer_ids: [],
    ...overrides,
  };
}

export function createGateway(initial: SessionSnapshot[] = []): NativeMessagingGateway {
  let sessions: SessionSnapshot[] = initial;
  let channels: Array<{
    name: string;
    topic: string;
    mesh_id: string;
    display_name: string;
    device_fingerprint: string;
    messages: ChannelMessage[];
    attachments: never[];
    dm_offers: never[];
    mesh: typeof MESH_READY | null;
    events: SnapshotEvent[];
  }> = [];
  return {
    getDiagnostics: vi.fn(),
    getNativeRuntimeStatus: vi.fn(async () => RUNTIME_STATUS_READY),
    createPrivateInvite: vi.fn(async (_request) => {
      const created = snapshot({ role: "alice", state: "waiting", messages: [] });
      sessions = [...sessions, created];
      return {
        invite_uri: INVITE,
        session_id: created.session_id,
        mesh_id: created.mesh_id,
        fingerprint: created.fingerprint,
        listen_address: "default-public-trackers",
      };
    }),
    acceptPrivateInvite: vi.fn(async () => {
      const joined = snapshot();
      sessions = [...sessions, joined];
      return joined;
    }),
    sendPrivateMessage: vi.fn(async (): Promise<SendMessageResult> => ({
      session_id: SESSION_ID,
      state: "ready",
      ciphertext_bytes: 128,
      message_id: "message-sent-1",
      sent_at_ms: Date.now(),
      delivery_status: "sent",
      delivery_error: null,
    })),
    retryPrivateMessage: vi.fn(async (sessionId, messageId): Promise<SendMessageResult> => ({
      session_id: sessionId,
      state: "ready",
      ciphertext_bytes: 128,
      message_id: messageId,
      sent_at_ms: Date.now(),
      delivery_status: "sent",
      delivery_error: null,
    })),
    pollPrivateSession: vi.fn(async (sessionId: string) => {
      const found = sessions.find((session) => session.session_id === sessionId);
      if (!found) {
        throw new Error("missing");
      }
      return found;
    }),
    listPrivateSessions: vi.fn(async (): Promise<SessionListSnapshot> => ({ sessions })),
    closePrivateSession: vi.fn(async (sessionId: string) => {
      sessions = sessions.filter((session) => session.session_id !== sessionId);
      return { session_id: sessionId, closed: true };
    }),
    joinChannel: vi.fn(async (request) => {
      const channel = {
        name: request.name.toLowerCase().replace(/^[@#]/, ""),
        topic: `public-channel/${request.name.toLowerCase().replace(/^[@#]/, "")}`,
        mesh_id: `channel/${request.name.toLowerCase().replace(/^[@#]/, "")}`,
        display_name: request.display_name,
        device_fingerprint: "abcdef0123456789",
        messages: [],
        attachments: [],
        dm_offers: [],
        mesh: MESH_READY,
        events: [],
      };
      channels = [...channels, channel];
      return channel;
    }),
    leaveChannel: vi.fn(async (name) => {
      channels = channels.filter((channel) => channel.name !== name);
      return { name, closed: true };
    }),
    sendChannelMessage: vi.fn(async (name, _body): Promise<ChannelSendResult> => ({
      name,
      bytes: 32,
      message_id: "channel-message-1",
      sent_at_ms: Date.now(),
      delivery_status: "sent",
      delivery_error: null,
    })),
    retryChannelMessage: vi.fn(async (name, messageId): Promise<ChannelSendResult> => ({
      name,
      bytes: 32,
      message_id: messageId,
      sent_at_ms: Date.now(),
      delivery_status: "sent",
      delivery_error: null,
    })),
    pollChannel: vi.fn(async (name) => {
      const found = channels.find((channel) => channel.name === name);
      if (!found) {
        throw new Error("missing");
      }
      return found;
    }),
    listChannels: vi.fn(async () => ({ channels })),
    createPrivateGroup: vi.fn(async (_request) => ({
      group_id: "group-test",
      mesh_id: "groupmesh-test",
      invite_uri: "mosh://group?mesh=groupmesh-test&group=group-test#fp=AABB",
      fingerprint: "AABB",
      label: _request.label ?? null,
    })),
    joinPrivateGroup: vi.fn(async () => ({
      group_id: "group-test",
      mesh_id: "groupmesh-test",
      label: "Friends",
      display_name: "mosh-test",
      device_fingerprint: "abcdef",
      creator_fingerprint: "AABB",
      is_admin: false,
      state: "ready",
      member_count: 2,
      invite_uri: null,
      messages: [],
      attachments: [],
      dm_offers: [],
      mesh: MESH_READY,
      events: [],
      needs_rejoin: false,
      org_pubkey: null,
      member_peer_ids: [],
    })),
    sendGroupMessage: vi.fn(async (group_id): Promise<GroupSendResult> => ({
      group_id,
      bytes: 64,
      message_id: "group-message-1",
      sent_at_ms: Date.now(),
      delivery_status: "sent",
      delivery_error: null,
    })),
    retryGroupMessage: vi.fn(async (group_id, messageId): Promise<GroupSendResult> => ({
      group_id,
      bytes: 64,
      message_id: messageId,
      sent_at_ms: Date.now(),
      delivery_status: "sent",
      delivery_error: null,
    })),
    pollPrivateGroup: vi.fn(async () => ({
      group_id: "group-test",
      mesh_id: "groupmesh-test",
      label: "Friends",
      display_name: "mosh-test",
      device_fingerprint: "abcdef",
      creator_fingerprint: "AABB",
      is_admin: false,
      state: "ready",
      member_count: 2,
      invite_uri: null,
      messages: [],
      attachments: [],
      dm_offers: [],
      mesh: MESH_READY,
      events: [],
      needs_rejoin: false,
      org_pubkey: null,
      member_peer_ids: [],
    })),
    listPrivateGroups: vi.fn(async () => ({ groups: [] })),
    closePrivateGroup: vi.fn(async (group_id) => ({ group_id, closed: true })),
    sendPrivateAttachment: vi.fn(async (session_id, _file, _mime, _data) => ({
      session_id,
      attachment_id: "attachment-test",
      content_hash: "0".repeat(64),
    })),
    downloadPrivateAttachment: vi.fn(async () => {}),
    cancelPrivateAttachment: vi.fn(async () => {}),
    sendGroupAttachment: vi.fn(async (group_id, _file, _mime, _data) => ({
      session_id: group_id,
      attachment_id: "attachment-test",
      content_hash: "0".repeat(64),
    })),
    downloadGroupAttachment: vi.fn(async () => {}),
    cancelGroupAttachment: vi.fn(async () => {}),
    sendChannelAttachment: vi.fn(async (name, _file, _mime, _data) => ({
      session_id: name,
      attachment_id: "attachment-test",
      content_hash: "0".repeat(64),
    })),
    downloadChannelAttachment: vi.fn(async () => {}),
    cancelChannelAttachment: vi.fn(async () => {}),
    sendChannelDmOffer: vi.fn(async () => {}),
    dismissChannelDmOffer: vi.fn(async () => {}),
    sendGroupDmOffer: vi.fn(async () => {}),
    dismissGroupDmOffer: vi.fn(async () => {}),
    callStart: vi.fn(async (sessionId: string) => ({
      session_id: sessionId,
      call_id: "call-test",
      key_b64: "",
      nonce_prefix_b64: "",
    })),
    callAccept: vi.fn(async () => {}),
    callDecline: vi.fn(async () => {}),
    callEnd: vi.fn(async () => {}),
    callSendFrame: vi.fn(async () => {}),
    callDrainFrames: vi.fn(async () => [] as readonly string[]),
    listNetworkInterfaces: vi.fn(async () => []),
    detectVpn: vi.fn(async () => ({
      vpn_likely: false,
      suspect_interfaces: [],
      vpn_owns_default_route: false,
    })),
    joinOrg: vi.fn(async () => orgSnapshot()),
    leaveOrg: vi.fn(async () => {}),
    listOrgs: vi.fn(async () => []),
    pollOrg: vi.fn(async () => orgSnapshot()),
    orgSendDmOffer: vi.fn(async () => ({
      invite_uri: INVITE,
      session_id: SESSION_ID,
      mesh_id: "mesh-one",
      fingerprint: FINGERPRINT,
      listen_address: "default-public-trackers",
    })),
    orgAcceptDmOffer: vi.fn(async () => snapshot()),
    orgDismissDmOffer: vi.fn(async () => {}),
    orgCreateGroup: vi.fn(async (request) => ({
      group_id: "group-test",
      mesh_id: "groupmesh-test",
      invite_uri: "mosh://group?mesh=groupmesh-test&group=group-test#fp=AABB",
      fingerprint: "AABB",
      label: request.label ?? null,
    })),
    orgAcceptGroupOffer: vi.fn(async () => groupSnapshot()),
    orgDismissGroupOffer: vi.fn(async () => {}),
    orgGroupInviteMembers: vi.fn(async () => {}),
    setBindInterface: vi.fn(async () => {}),
    getBindInterface: vi.fn(async () => null),
  };
}

export const ORG_PUBKEY = "e".repeat(64);
export const OWN_PEER_ID = "f".repeat(64);

export function orgSnapshot(overrides: Partial<OrgSnapshot> = {}): OrgSnapshot {
  return {
    org_pubkey: ORG_PUBKEY,
    org_name: "acme",
    mesh_id: "orgmesh-test",
    own_peer_id: OWN_PEER_ID,
    confirmation_code: "ffff-ffff-ffff",
    in_roster: true,
    roster_version: 1,
    members: [
      { moss_peer_id: OWN_PEER_ID, name: "you", role: "admin", is_self: true },
      { moss_peer_id: "b".repeat(64), name: "bob", role: "member", is_self: false },
    ],
    dm_offers: [],
    group_offers: [],
    dm_links: [],
    ...overrides,
  };
}
