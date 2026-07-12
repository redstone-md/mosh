import type {
  JoinOrgRequest,
  OrgDmOfferView,
  OrgGroupOfferView,
  OrgSnapshot,
  AttachmentDescriptor,
  AttachmentSendResult,
  AttachmentView,
  ChannelMessage,
  ChannelSnapshot,
  ChatMessage,
  GroupMessage,
  GroupSnapshot,
  MeshInfo,
  SessionSnapshot,
  SnapshotEvent,
  VoiceMeta,
} from "./native-messaging-gateway";

export const DEMO_MESH_ID = "demo-mesh";
export const DEMO_DEVICE = "mosh-demo";
export const DEMO_FINGERPRINT = "D3M0A11CE0000001";

const PEER_FINGERPRINT = "51RA7E5EED000002";
const GROUP_FINGERPRINT = "9R0UP5EED000003";
const STARTED_AT = Date.now() - 1000 * 60 * 12;
const MESSAGE_STEP_MS = 62_000;

export class DemoNativeState {
  private sequence = 100;
  private bindInterface: string | null = null;
  private sessions: SessionSnapshot[] = [seedSession()];
  private channels: ChannelSnapshot[] = [seedChannel()];
  private groups: GroupSnapshot[] = [seedGroup()];
  private orgs: OrgSnapshot[] = [];

  listSessions(): readonly SessionSnapshot[] {
    return this.sessions.map(cloneSession);
  }

  listChannels(): readonly ChannelSnapshot[] {
    return this.channels.map(cloneChannel);
  }

  listGroups(): readonly GroupSnapshot[] {
    return this.groups.map(cloneGroup);
  }

  addSession(session: SessionSnapshot): void {
    this.sessions = [session, ...this.sessions];
  }

  addChannel(channel: ChannelSnapshot): void {
    this.channels = [channel, ...this.channels];
  }

  addGroup(group: GroupSnapshot): void {
    this.groups = [group, ...this.groups];
  }

  closeSession(sessionId: string): void {
    this.sessions = this.sessions.filter((session) => session.session_id !== sessionId);
  }

  closeChannel(name: string): void {
    this.channels = this.channels.filter((channel) => channel.name !== name);
  }

  joinOrg(request: JoinOrgRequest): OrgSnapshot {
    const orgPubkey = request.bundle_uri.split("#org=")[1] ?? this.next("demo-org");
    const ownPeerId = "aa11bb22cc33dd44ee55ff6600112233aa11bb22cc33dd44ee55ff6600112233";
    const org: OrgSnapshot = {
      org_pubkey: orgPubkey,
      org_name: /name=([^&#]+)/.exec(request.bundle_uri)?.[1] ?? "demo org",
      mesh_id: "demo-org-mesh",
      own_peer_id: ownPeerId,
      confirmation_code: "aa11-bb22-cc33",
      in_roster: true,
      roster_version: 1,
      members: [
        { moss_peer_id: ownPeerId, name: request.display_name || "you", role: "admin", is_self: true },
        { moss_peer_id: "b".repeat(64), name: "demo bob", role: "member", is_self: false },
        { moss_peer_id: "c".repeat(64), name: "demo carol", role: "member", is_self: false },
      ],
      dm_offers: [],
      group_offers: [],
      dm_links: [],
    };
    this.orgs = [org, ...this.orgs.filter((o) => o.org_pubkey !== org.org_pubkey)];
    return org;
  }

  leaveOrg(orgPubkey: string): void {
    this.orgs = this.orgs.filter((org) => org.org_pubkey !== orgPubkey);
  }

  listOrgs(): readonly OrgSnapshot[] {
    return this.orgs.map((org) => ({ ...org }));
  }

  pollOrg(orgPubkey: string): OrgSnapshot {
    const org = this.orgs.find((candidate) => candidate.org_pubkey === orgPubkey);
    if (!org) {
      throw new Error(`not joined to org ${orgPubkey}`);
    }
    return { ...org };
  }

  linkOrgDm(orgPubkey: string, peerId: string, sessionId: string): void {
    this.orgs = this.orgs.map((org) =>
      org.org_pubkey === orgPubkey
        ? {
            ...org,
            dm_links: [
              ...org.dm_links.filter((link) => link.peer_id !== peerId),
              { peer_id: peerId, session_id: sessionId },
            ],
          }
        : org,
    );
  }

  takeOrgDmOffer(orgPubkey: string, offerId: string): OrgDmOfferView {
    const org = this.pollOrg(orgPubkey);
    const offer = org.dm_offers.find((candidate) => candidate.offer_id === offerId);
    if (!offer) {
      throw new Error(`unknown dm offer ${offerId}`);
    }
    this.dismissOrgDmOffer(orgPubkey, offerId);
    return offer;
  }

  dismissOrgDmOffer(orgPubkey: string, offerId: string): void {
    this.orgs = this.orgs.map((org) =>
      org.org_pubkey === orgPubkey
        ? { ...org, dm_offers: org.dm_offers.filter((offer) => offer.offer_id !== offerId) }
        : org,
    );
  }

  takeOrgGroupOffer(orgPubkey: string, offerId: string): OrgGroupOfferView {
    const org = this.pollOrg(orgPubkey);
    const offer = org.group_offers.find((candidate) => candidate.offer_id === offerId);
    if (!offer) {
      throw new Error(`unknown group offer ${offerId}`);
    }
    this.dismissOrgGroupOffer(orgPubkey, offerId);
    return offer;
  }

  dismissOrgGroupOffer(orgPubkey: string, offerId: string): void {
    this.orgs = this.orgs.map((org) =>
      org.org_pubkey === orgPubkey
        ? { ...org, group_offers: org.group_offers.filter((offer) => offer.offer_id !== offerId) }
        : org,
    );
  }

  closeGroup(groupId: string): void {
    this.groups = this.groups.filter((group) => group.group_id !== groupId);
  }

  findChannel(name: string): ChannelSnapshot | undefined {
    return this.channels.find((channel) => channel.name === name);
  }

  sessionOrThrow(sessionId: string): SessionSnapshot {
    const session = this.sessions.find((candidate) => candidate.session_id === sessionId);
    if (!session) {
      throw new Error(`Demo session not found: ${sessionId}`);
    }
    return session;
  }

  channelOrThrow(name: string): ChannelSnapshot {
    const channel = this.channels.find((candidate) => candidate.name === name);
    if (!channel) {
      throw new Error(`Demo channel not found: ${name}`);
    }
    return channel;
  }

  groupOrThrow(groupId: string): GroupSnapshot {
    const group = this.groups.find((candidate) => candidate.group_id === groupId);
    if (!group) {
      throw new Error(`Demo group not found: ${groupId}`);
    }
    return group;
  }

  updateSession(
    sessionId: string,
    update: (session: SessionSnapshot) => SessionSnapshot,
  ): void {
    this.sessionOrThrow(sessionId);
    this.sessions = this.sessions.map((session) =>
      session.session_id === sessionId ? update(session) : session,
    );
  }

  updateChannel(
    name: string,
    update: (channel: ChannelSnapshot) => ChannelSnapshot,
  ): void {
    this.channelOrThrow(name);
    this.channels = this.channels.map((channel) =>
      channel.name === name ? update(channel) : channel,
    );
  }

  updateGroup(groupId: string, update: (group: GroupSnapshot) => GroupSnapshot): void {
    this.groupOrThrow(groupId);
    this.groups = this.groups.map((group) =>
      group.group_id === groupId ? update(group) : group,
    );
  }

  attachment(
    fileName: string,
    mime: string,
    dataBase64: string,
    thumbnailBase64?: string,
    voice?: VoiceMeta,
  ): { descriptor: AttachmentDescriptor; view: AttachmentView } {
    const attachmentId = this.next("demo-attachment");
    const descriptor = {
      attachment_id: attachmentId,
      content_hash: `${attachmentId}-hash`,
      file_name: fileName,
      mime,
      total_size: estimateBase64Bytes(dataBase64),
      thumbnail_b64: thumbnailBase64,
      voice,
    };
    return {
      descriptor,
      view: {
        attachment_id: attachmentId,
        direction: "outgoing",
        state: "available",
        completed_chunks: 1,
        chunk_count: 1,
      },
    };
  }

  next(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  stampMessage<T extends MessageWithMetadata>(
    message: T,
  ): T & { readonly message_id: string; readonly sent_at_ms: number } {
    return {
      ...message,
      message_id: message.message_id ?? this.next("demo-message"),
      sent_at_ms: message.sent_at_ms ?? Date.now(),
    };
  }

  fingerprint(seed: string): string {
    return `${seed}${this.sequence}`.toUpperCase().padEnd(16, "0").slice(0, 16);
  }

  setBindInterface(value: string | null): void {
    this.bindInterface = value;
  }

  getBindInterface(): string | null {
    return this.bindInterface;
  }
}

export function seedSession(): SessionSnapshot {
  const descriptor = {
    attachment_id: "demo-attachment-1",
    content_hash: "demo-attachment-1-hash",
    file_name: "moss-handshake-notes.txt",
    mime: "text/plain",
    total_size: 1840,
  };
  return sessionSnapshot({
    session_id: "demo-dm-sera",
    role: "bob",
    display_name: DEMO_DEVICE,
    peer_display_name: "Sera",
    state: "ready",
    invite_uri: dmInvite("demo-dm-sera", PEER_FINGERPRINT),
    fingerprint: PEER_FINGERPRINT,
    messages: [
      {
        from_device: "Sera",
        body: "Browser preview is live. This data is local and seeded for UI review.",
      },
      { from_device: DEMO_DEVICE, body: "Good. I can test messages and attachments here." },
      { from_device: "Sera", body: "Attachment handoff is visible too.", attachment: descriptor },
      {
        from_device: "Sera",
        body: "",
        call_event: { kind: "completed", duration_ms: 142_000, call_id: "demo-call-1" },
      },
    ],
    attachments: [
      {
        attachment_id: descriptor.attachment_id,
        direction: "incoming",
        state: "offered",
        completed_chunks: 0,
        chunk_count: 1,
      },
    ],
  });
}

export function seedChannel(): ChannelSnapshot {
  return channelSnapshot({
    name: "design-lab",
    display_name: DEMO_DEVICE,
    messages: [
      {
        from_device: "Nia",
        from_fingerprint: "N1A7000000000004",
        body: "The right diagnostics column is finally out of the main chat.",
      },
      {
        from_device: DEMO_DEVICE,
        from_fingerprint: DEMO_FINGERPRINT,
        body: "Now the preview has enough data to review channel states.",
      },
    ],
    dm_offers: [
      {
        offer_id: "demo-offer-1",
        from_device: "Ivo",
        from_fingerprint: "1V00000000000006",
        target_fingerprint: DEMO_FINGERPRINT,
        invite_uri: dmInvite("demo-offer-ivo", "1V00000000000006"),
      },
    ],
  });
}

export function seedGroup(): GroupSnapshot {
  return groupSnapshot({
    group_id: "demo-group-core",
    label: "Core team",
    display_name: DEMO_DEVICE,
    creator_fingerprint: GROUP_FINGERPRINT,
    is_admin: true,
    invite_uri: groupInvite("demo-group-core", GROUP_FINGERPRINT),
    messages: [
      {
        from_device: "Mina",
        from_fingerprint: "M1NA000000000005",
        body: "Group MLS state reads as ready in demo mode.",
      },
      {
        from_device: DEMO_DEVICE,
        from_fingerprint: DEMO_FINGERPRINT,
        body: "Useful for checking member labels, admin badges, and group copy.",
      },
    ],
  });
}

export function sessionSnapshot(overrides: Partial<SessionSnapshot>): SessionSnapshot {
  const messages = stampSeedMessages(overrides.messages ?? [], "demo-dm-message");
  return {
    session_id: "",
    mesh_id: DEMO_MESH_ID,
    role: "bob",
    display_name: DEMO_DEVICE,
    peer_display_name: "",
    state: "ready",
    path: "direct",
    invite_uri: null,
    fingerprint: PEER_FINGERPRINT,
    attachments: [],
    mesh: demoMesh(),
    events: demoEvents(),
    ...overrides,
    messages,
  };
}

export function channelSnapshot(overrides: Partial<ChannelSnapshot>): ChannelSnapshot {
  const messages = stampSeedMessages(
    overrides.messages ?? [],
    `demo-channel-${overrides.name ?? "design-lab"}-message`,
  );
  return {
    name: "design-lab",
    topic: `public-channel/${overrides.name ?? "design-lab"}`,
    mesh_id: DEMO_MESH_ID,
    display_name: DEMO_DEVICE,
    device_fingerprint: DEMO_FINGERPRINT,
    attachments: [],
    dm_offers: [],
    mesh: demoMesh(["design-lab"]),
    events: demoEvents(),
    ...overrides,
    messages,
  };
}

export function groupSnapshot(overrides: Partial<GroupSnapshot>): GroupSnapshot {
  const messages = stampSeedMessages(
    overrides.messages ?? [],
    `demo-group-${overrides.group_id ?? "core"}-message`,
  );
  return {
    group_id: "",
    mesh_id: DEMO_MESH_ID,
    label: null,
    display_name: DEMO_DEVICE,
    device_fingerprint: DEMO_FINGERPRINT,
    creator_fingerprint: GROUP_FINGERPRINT,
    is_admin: false,
    state: "ready",
    member_count: 3,
    invite_uri: null,
    attachments: [],
    dm_offers: [],
    mesh: demoMesh(),
    events: demoEvents(),
    needs_rejoin: false,
    org_pubkey: null,
    member_peer_ids: [],
    ...overrides,
    messages,
  };
}

export function cloneSession(session: SessionSnapshot): SessionSnapshot {
  return {
    ...session,
    messages: [...session.messages],
    attachments: [...session.attachments],
    events: [...session.events],
    mesh: cloneMesh(session.mesh),
  };
}

export function cloneChannel(channel: ChannelSnapshot): ChannelSnapshot {
  return {
    ...channel,
    messages: [...channel.messages],
    attachments: [...channel.attachments],
    dm_offers: [...channel.dm_offers],
    events: [...channel.events],
    mesh: cloneMesh(channel.mesh),
  };
}

export function cloneGroup(group: GroupSnapshot): GroupSnapshot {
  return {
    ...group,
    messages: [...group.messages],
    attachments: [...group.attachments],
    dm_offers: [...group.dm_offers],
    events: [...group.events],
    mesh: cloneMesh(group.mesh),
  };
}

export function markAttachment<
  T extends { readonly attachments: readonly AttachmentView[] },
>(target: T, attachmentId: string, state: AttachmentView["state"]): T {
  return {
    ...target,
    attachments: target.attachments.map((view) =>
      view.attachment_id === attachmentId
        ? {
            ...view,
            state,
            completed_chunks: state === "available" ? view.chunk_count : view.completed_chunks,
          }
        : view,
    ),
  };
}

export function normalizeChannel(name: string): string {
  return name.trim().toLowerCase().replace(/^[@#]+/, "") || "design-lab";
}

export function dmInvite(sessionId: string, fingerprint: string): string {
  return `mosh://invite?mesh=${DEMO_MESH_ID}&session=${sessionId}#fp=${fingerprint}`;
}

export function groupInvite(groupId: string, fingerprint: string): string {
  return `mosh://group?mesh=${DEMO_MESH_ID}&group=${groupId}#fp=${fingerprint}`;
}

export function attachmentResult(
  host: string,
  descriptor: AttachmentDescriptor,
): AttachmentSendResult {
  return {
    session_id: host,
    attachment_id: descriptor.attachment_id,
    content_hash: descriptor.content_hash,
  };
}

function demoMesh(channels: readonly string[] = []): MeshInfo {
  return {
    mesh_id: DEMO_MESH_ID,
    listen_port: 42130,
    advertised_addr: "browser-demo",
    peer_count: 3,
    direct_peer_count: 2,
    relayed_peer_count: 1,
    relay_capable_peer_count: 1,
    relay_session_count: 1,
    relay_route_count: 0,
    known_peer_count: 5,
    channels,
    nat_type: "demo",
    supernode_ready: true,
    public_key: "demo-public-key",
  };
}

function demoEvents(): readonly SnapshotEvent[] {
  return [
    event("peer_joined", { peer_id: "sera" }, STARTED_AT),
    event("tracker_announce", { mode: "browser-demo" }, STARTED_AT + 4_000),
  ];
}

function event(event_name: string, detail: Record<string, string>, epoch: number): SnapshotEvent {
  return {
    event_type: 1,
    event_name,
    detail_json: JSON.stringify(detail),
    epoch_millis: epoch,
  };
}

type MessageWithMetadata = ChatMessage | ChannelMessage | GroupMessage;
type StampedMessage<T extends MessageWithMetadata> = T & {
  readonly message_id: string;
  readonly sent_at_ms: number;
};

function stampSeedMessages<T extends MessageWithMetadata>(
  messages: readonly T[],
  prefix: string,
): StampedMessage<T>[] {
  return messages.map((message, index) => ({
    ...message,
    message_id: message.message_id ?? `${prefix}-${index + 1}`,
    sent_at_ms: message.sent_at_ms ?? STARTED_AT + index * MESSAGE_STEP_MS,
  }));
}

function cloneMesh(mesh: MeshInfo | null): MeshInfo | null {
  return mesh ? { ...mesh, channels: [...mesh.channels] } : null;
}

function estimateBase64Bytes(value: string): number {
  return Math.max(1, Math.floor((value.length * 3) / 4));
}
