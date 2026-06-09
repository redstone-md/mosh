import type {
  AcceptInviteRequest,
  AttachmentSendResult,
  CallStarted,
  ChannelLeaveResult,
  ChannelListSnapshot,
  ChannelSnapshot,
  ChannelSendResult,
  CloseSessionResult,
  CreateGroupRequest,
  DiagnosticsSnapshot,
  GroupCreated,
  GroupLeaveResult,
  GroupListSnapshot,
  GroupSendResult,
  GroupSnapshot,
  InviteCreated,
  JoinChannelRequest,
  JoinGroupRequest,
  NativeMessagingGateway,
  NativeRuntimeStatus,
  NetworkInterfaceInfo,
  SendMessageResult,
  SessionListSnapshot,
  SessionSnapshot,
  StartSessionRequest,
  VoiceMeta,
  VpnDetection,
} from "./native-messaging-gateway";
import {
  DEMO_DEVICE,
  DEMO_MESH_ID,
  DemoNativeState,
  attachmentResult,
  channelSnapshot,
  cloneChannel,
  cloneGroup,
  cloneSession,
  dmInvite,
  groupInvite,
  groupSnapshot,
  markAttachment,
  normalizeChannel,
  sessionSnapshot,
} from "./demo-native-state";

export class DemoNativeMessagingGateway implements NativeMessagingGateway {
  private readonly state = new DemoNativeState();

  async getDiagnostics(): Promise<DiagnosticsSnapshot> {
    return {
      app_name: "Mosh",
      privacy_model: "browser demo data only",
      discovery_model: "seeded local preview",
      moss_link_mode: "demo",
    };
  }

  async getNativeRuntimeStatus(): Promise<NativeRuntimeStatus> {
    return {
      moss: {
        link_mode: "browser-demo",
        library_name: "demo",
        required_symbols: [],
        available: false,
        checked_paths: [],
      },
      secure_storage: {
        backend: "memory",
        service: "Mosh demo",
        available: false,
      },
      persistence: {
        backend: "browser-demo",
        database: "memory",
        available: false,
        encrypted_at_rest: false,
        error: null,
      },
      openmls_smoke: {
        Ok: {
          provider: "demo",
          ciphersuite: "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519",
          protected_message_created: true,
        },
      },
      openmls_roundtrip: {
        Ok: {
          provider: "demo",
          ciphersuite: "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519",
          welcome_joined: true,
          plaintext_roundtrip: true,
        },
      },
    };
  }

  async createPrivateInvite(request: StartSessionRequest): Promise<InviteCreated> {
    const sessionId = this.state.next("demo-dm");
    const fingerprint = this.state.fingerprint("invite");
    const inviteUri = dmInvite(sessionId, fingerprint);
    const session = sessionSnapshot({
      session_id: sessionId,
      role: "alice",
      display_name: request.display_name || DEMO_DEVICE,
      peer_display_name: "Waiting peer",
      state: "waiting",
      invite_uri: inviteUri,
      fingerprint,
      messages: [
        {
          from_device: "Mosh demo",
          body: "Invite created. In the desktop app this link can be shared with a real Moss peer.",
        },
      ],
    });
    this.state.addSession(session);
    return {
      invite_uri: inviteUri,
      session_id: sessionId,
      mesh_id: DEMO_MESH_ID,
      fingerprint,
      listen_address: "browser-demo",
    };
  }

  async acceptPrivateInvite(request: AcceptInviteRequest): Promise<SessionSnapshot> {
    const sessionId = this.state.next("demo-join");
    const session = sessionSnapshot({
      session_id: sessionId,
      role: "bob",
      display_name: request.display_name || DEMO_DEVICE,
      peer_display_name: "Demo peer",
      state: "ready",
      invite_uri: request.invite_uri,
      fingerprint: this.state.fingerprint("peer"),
      messages: [
        {
          from_device: "Demo peer",
          body: "This browser preview accepted a demo invite without touching the native runtime.",
        },
      ],
    });
    this.state.addSession(session);
    return cloneSession(session);
  }

  async sendPrivateMessage(sessionId: string, body: string): Promise<SendMessageResult> {
    this.state.updateSession(sessionId, (session) => ({
      ...session,
      messages: [
        ...session.messages,
        this.state.stampMessage({
          from_device: session.display_name || DEMO_DEVICE,
          body,
        }),
      ],
    }));
    const session = this.state.sessionOrThrow(sessionId);
    return {
      session_id: sessionId,
      state: session.state,
      ciphertext_bytes: body.length + 96,
    };
  }

  async pollPrivateSession(sessionId: string): Promise<SessionSnapshot> {
    return cloneSession(this.state.sessionOrThrow(sessionId));
  }

  async listPrivateSessions(): Promise<SessionListSnapshot> {
    return { sessions: this.state.listSessions() };
  }

  async closePrivateSession(sessionId: string): Promise<CloseSessionResult> {
    this.state.closeSession(sessionId);
    return { session_id: sessionId, closed: true };
  }

  async joinChannel(request: JoinChannelRequest): Promise<ChannelSnapshot> {
    const name = normalizeChannel(request.name);
    const existing = this.state.findChannel(name);
    if (existing) {
      return cloneChannel(existing);
    }
    const channel = channelSnapshot({
      name,
      display_name: request.display_name || DEMO_DEVICE,
      messages: [
        {
          from_device: "Nia",
          from_fingerprint: "N1A7000000000004",
          body: `Welcome to #${name}. Browser demo mode keeps this local.`,
        },
      ],
    });
    this.state.addChannel(channel);
    return cloneChannel(channel);
  }

  async leaveChannel(name: string): Promise<ChannelLeaveResult> {
    const normalized = normalizeChannel(name);
    this.state.closeChannel(normalized);
    return { name: normalized, closed: true };
  }

  async sendChannelMessage(name: string, body: string): Promise<ChannelSendResult> {
    const normalized = normalizeChannel(name);
    this.state.updateChannel(normalized, (channel) => ({
      ...channel,
      messages: [
        ...channel.messages,
        this.state.stampMessage({
          from_device: channel.display_name,
          from_fingerprint: channel.device_fingerprint,
          body,
        }),
      ],
    }));
    return { name: normalized, bytes: body.length + 32 };
  }

  async pollChannel(name: string): Promise<ChannelSnapshot> {
    return cloneChannel(this.state.channelOrThrow(normalizeChannel(name)));
  }

  async listChannels(): Promise<ChannelListSnapshot> {
    return { channels: this.state.listChannels() };
  }

  async createPrivateGroup(request: CreateGroupRequest): Promise<GroupCreated> {
    const groupId = this.state.next("demo-group");
    const fingerprint = this.state.fingerprint("group");
    const inviteUri = groupInvite(groupId, fingerprint);
    const group = groupSnapshot({
      group_id: groupId,
      label: request.label?.trim() || "Design review",
      display_name: request.display_name || DEMO_DEVICE,
      creator_fingerprint: fingerprint,
      device_fingerprint: fingerprint,
      is_admin: true,
      invite_uri: inviteUri,
      messages: [
        {
          from_device: request.display_name || DEMO_DEVICE,
          from_fingerprint: fingerprint,
          body: "Group created in browser demo mode.",
        },
      ],
    });
    this.state.addGroup(group);
    return {
      group_id: groupId,
      mesh_id: DEMO_MESH_ID,
      invite_uri: inviteUri,
      fingerprint,
      label: group.label,
    };
  }

  async joinPrivateGroup(request: JoinGroupRequest): Promise<GroupSnapshot> {
    const groupId = this.state.next("demo-joined-group");
    const group = groupSnapshot({
      group_id: groupId,
      label: "Joined preview group",
      display_name: request.display_name || DEMO_DEVICE,
      is_admin: false,
      invite_uri: null,
      messages: [
        {
          from_device: "Mina",
          from_fingerprint: "M1NA000000000005",
          body: "Joined group preview. Native MLS group state is not used in this browser run.",
        },
      ],
    });
    this.state.addGroup(group);
    return cloneGroup(group);
  }

  async sendGroupMessage(groupId: string, body: string): Promise<GroupSendResult> {
    this.state.updateGroup(groupId, (group) => ({
      ...group,
      messages: [
        ...group.messages,
        this.state.stampMessage({
          from_device: group.display_name,
          from_fingerprint: group.device_fingerprint,
          body,
        }),
      ],
    }));
    return { group_id: groupId, bytes: body.length + 48 };
  }

  async pollPrivateGroup(groupId: string): Promise<GroupSnapshot> {
    return cloneGroup(this.state.groupOrThrow(groupId));
  }

  async listPrivateGroups(): Promise<GroupListSnapshot> {
    return { groups: this.state.listGroups() };
  }

  async closePrivateGroup(groupId: string): Promise<GroupLeaveResult> {
    this.state.closeGroup(groupId);
    return { group_id: groupId, closed: true };
  }

  async sendPrivateAttachment(
    sessionId: string,
    fileName: string,
    mime: string,
    dataBase64: string,
    thumbnailBase64?: string,
    voice?: VoiceMeta,
  ): Promise<AttachmentSendResult> {
    const payload = this.state.attachment(fileName, mime, dataBase64, thumbnailBase64, voice);
    this.state.updateSession(sessionId, (session) => ({
      ...session,
      attachments: [...session.attachments, payload.view],
      messages: [
        ...session.messages,
        this.state.stampMessage({
          from_device: session.display_name,
          body: "",
          attachment: payload.descriptor,
        }),
      ],
    }));
    return attachmentResult(sessionId, payload.descriptor);
  }

  async downloadPrivateAttachment(sessionId: string, attachmentId: string): Promise<void> {
    this.state.updateSession(sessionId, (session) =>
      markAttachment(session, attachmentId, "available"),
    );
  }

  async cancelPrivateAttachment(sessionId: string, attachmentId: string): Promise<void> {
    this.state.updateSession(sessionId, (session) =>
      markAttachment(session, attachmentId, "cancelled"),
    );
  }

  async sendGroupAttachment(
    groupId: string,
    fileName: string,
    mime: string,
    dataBase64: string,
    thumbnailBase64?: string,
    voice?: VoiceMeta,
  ): Promise<AttachmentSendResult> {
    const payload = this.state.attachment(fileName, mime, dataBase64, thumbnailBase64, voice);
    this.state.updateGroup(groupId, (group) => ({
      ...group,
      attachments: [...group.attachments, payload.view],
      messages: [
        ...group.messages,
        this.state.stampMessage({
          from_device: group.display_name,
          from_fingerprint: group.device_fingerprint,
          body: "",
          attachment: payload.descriptor,
        }),
      ],
    }));
    return attachmentResult(groupId, payload.descriptor);
  }

  async downloadGroupAttachment(groupId: string, attachmentId: string): Promise<void> {
    this.state.updateGroup(groupId, (group) =>
      markAttachment(group, attachmentId, "available"),
    );
  }

  async cancelGroupAttachment(groupId: string, attachmentId: string): Promise<void> {
    this.state.updateGroup(groupId, (group) =>
      markAttachment(group, attachmentId, "cancelled"),
    );
  }

  async sendChannelAttachment(
    name: string,
    fileName: string,
    mime: string,
    dataBase64: string,
    thumbnailBase64?: string,
    voice?: VoiceMeta,
  ): Promise<AttachmentSendResult> {
    const normalized = normalizeChannel(name);
    const payload = this.state.attachment(fileName, mime, dataBase64, thumbnailBase64, voice);
    this.state.updateChannel(normalized, (channel) => ({
      ...channel,
      attachments: [...channel.attachments, payload.view],
      messages: [
        ...channel.messages,
        this.state.stampMessage({
          from_device: channel.display_name,
          from_fingerprint: channel.device_fingerprint,
          body: "",
          attachment: payload.descriptor,
        }),
      ],
    }));
    return attachmentResult(normalized, payload.descriptor);
  }

  async downloadChannelAttachment(name: string, attachmentId: string): Promise<void> {
    this.state.updateChannel(normalizeChannel(name), (channel) =>
      markAttachment(channel, attachmentId, "available"),
    );
  }

  async cancelChannelAttachment(name: string, attachmentId: string): Promise<void> {
    this.state.updateChannel(normalizeChannel(name), (channel) =>
      markAttachment(channel, attachmentId, "cancelled"),
    );
  }

  async sendChannelDmOffer(): Promise<void> {}

  async dismissChannelDmOffer(name: string, offerId: string): Promise<void> {
    this.state.updateChannel(normalizeChannel(name), (channel) => ({
      ...channel,
      dm_offers: channel.dm_offers.filter((offer) => offer.offer_id !== offerId),
    }));
  }

  async sendGroupDmOffer(): Promise<void> {}

  async dismissGroupDmOffer(groupId: string, offerId: string): Promise<void> {
    this.state.updateGroup(groupId, (group) => ({
      ...group,
      dm_offers: group.dm_offers.filter((offer) => offer.offer_id !== offerId),
    }));
  }

  async callStart(sessionId: string): Promise<CallStarted> {
    const callId = this.state.next("demo-call");
    this.state.updateSession(sessionId, (session) => ({
      ...session,
      messages: [
        ...session.messages,
        this.state.stampMessage({
          from_device: session.display_name,
          body: "",
          call_event: { kind: "missed", duration_ms: 0, call_id: callId },
        }),
      ],
    }));
    return {
      session_id: sessionId,
      call_id: callId,
      key_b64: "",
      nonce_prefix_b64: "",
    };
  }

  async callAccept(): Promise<void> {}
  async callDecline(): Promise<void> {}
  async callEnd(sessionId: string, callId: string): Promise<void> {
    this.state.updateSession(sessionId, (session) => ({
      ...session,
      messages: [
        ...session.messages,
        {
          from_device: session.display_name,
          body: "",
          call_event: { kind: "completed", duration_ms: 74_000, call_id: callId },
        },
      ],
    }));
  }
  async callSendFrame(): Promise<void> {}
  async callDrainFrames(): Promise<readonly string[]> {
    return [];
  }

  async listNetworkInterfaces(): Promise<readonly NetworkInterfaceInfo[]> {
    return [
      {
        name: "demo0",
        description: "Browser demo interface",
        index: 1,
        ipv4: "127.0.0.1",
        is_loopback: true,
        is_up: true,
        is_virtual: true,
        is_vpn: false,
        is_default_route: true,
      },
    ];
  }

  async detectVpn(): Promise<VpnDetection> {
    return {
      vpn_likely: false,
      suspect_interfaces: [],
      vpn_owns_default_route: false,
    };
  }

  async setBindInterface(value: string | null): Promise<void> {
    this.state.setBindInterface(value);
  }

  async getBindInterface(): Promise<string | null> {
    return this.state.getBindInterface();
  }
}
