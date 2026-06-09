import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  MeshInfo,
  GroupSnapshot,
  NativeMessagingGateway,
  SessionListSnapshot,
  SessionSnapshot,
  SnapshotEvent,
} from "./native/native-messaging-gateway";
import { PrivateDmScreen } from "./private-dm-screen";

const FINGERPRINT = "AABBCCDDEEFF0011";
const SESSION_ID = "session-one";
const INVITE = `mosh://invite?mesh=mesh-one&session=${SESSION_ID}#fp=${FINGERPRINT}`;

const MESH_READY: MeshInfo = {
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

const EVENTS: SnapshotEvent[] = [
  {
    event_type: 1,
    event_name: "peer_joined",
    detail_json: '{"peer_id":"abc123"}',
    epoch_millis: Date.now() - 1000,
  },
];

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    session_id: SESSION_ID,
    mesh_id: "mesh-one",
    role: "bob",
    display_name: "mosh-bob",
    peer_display_name: "Alice",
    state: "ready",
    invite_uri: INVITE,
    fingerprint: FINGERPRINT,
    messages: [{ from_device: "Alice", body: "hello from moss" }],
    attachments: [],
    mesh: MESH_READY,
    events: EVENTS,
    ...overrides,
  };
}

function groupSnapshot(overrides: Partial<GroupSnapshot> = {}): GroupSnapshot {
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
    ...overrides,
  };
}

function createGateway(initial: SessionSnapshot[] = []): NativeMessagingGateway {
  let sessions: SessionSnapshot[] = initial;
  let channels: Array<{
    name: string;
    topic: string;
    mesh_id: string;
    display_name: string;
    device_fingerprint: string;
    messages: Array<{ from_device: string; from_fingerprint: string; body: string }>;
    attachments: never[];
    dm_offers: never[];
    mesh: typeof MESH_READY | null;
    events: SnapshotEvent[];
  }> = [];
  return {
    getDiagnostics: vi.fn(),
    getNativeRuntimeStatus: vi.fn(),
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
    sendPrivateMessage: vi.fn(async () => ({
      session_id: SESSION_ID,
      state: "ready",
      ciphertext_bytes: 128,
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
    sendChannelMessage: vi.fn(async (name, _body) => ({ name, bytes: 32 })),
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
    })),
    sendGroupMessage: vi.fn(async (group_id) => ({ group_id, bytes: 64 })),
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
    setBindInterface: vi.fn(async () => {}),
    getBindInterface: vi.fn(async () => null),
  };
}

describe("PrivateDmScreen", () => {
  it("renders welcome state when there are no sessions", async () => {
    const user = userEvent.setup();
    render(<PrivateDmScreen gateway={createGateway()} />);

    expect(screen.getByRole("main", { name: "MOSH" })).toBeInTheDocument();
    expect(await screen.findByRole("complementary", { name: "Active sessions" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open peer status" }));
    expect(screen.getByRole("dialog", { name: "Peer status" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close peer status" }));
    expect(screen.queryByRole("dialog", { name: "Peer status" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New private chat/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Join a public channel/ })).toBeInTheDocument();
  });

  it("creates and copies an invite, then surfaces the active session", async () => {
    const user = userEvent.setup();
    const gateway = createGateway();
    render(<PrivateDmScreen gateway={gateway} />);

    await user.click(screen.getByRole("button", { name: /New private chat/ }));
    await user.click(screen.getByRole("button", { name: "Create invite link" }));

    expect(gateway.createPrivateInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        display_name: expect.stringMatching(/^mosh-[a-z0-9]+$/),
        listen_port: 0,
        static_peer: null,
      }),
    );
    await screen.findByRole("button", { name: /Copied/ });
    expect(screen.getByText(INVITE)).toBeInTheDocument();
  });

  it("accepts an invite + opens chat for the new session", async () => {
    const user = userEvent.setup();
    const gateway = createGateway();
    render(<PrivateDmScreen gateway={gateway} />);

    await user.click(screen.getByRole("button", { name: /Join with a link/ }));
    await user.type(screen.getByRole("textbox", { name: "Invite link" }), INVITE);
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(gateway.acceptPrivateInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        invite_uri: INVITE,
        display_name: expect.stringMatching(/^mosh-[a-z0-9]+$/),
        listen_port: 0,
        static_peer: null,
      }),
    );
    await waitFor(() =>
      expect(screen.getByText("hello from moss")).toBeInTheDocument(),
    );
  });

  it("keeps malformed invite links from looking ready to connect", async () => {
    const user = userEvent.setup();
    const gateway = createGateway();
    render(<PrivateDmScreen gateway={gateway} />);

    await user.click(screen.getByRole("button", { name: /Join with a link/ }));
    await user.type(screen.getByRole("textbox", { name: "Invite link" }), "mosh://invite?bad=1");

    expect(screen.getByText("Invite link is missing mesh=...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
  });

  it("confirms active group invite copies", async () => {
    const user = userEvent.setup();
    const group = groupSnapshot();
    const gateway: NativeMessagingGateway = {
      ...createGateway(),
      listPrivateGroups: vi.fn(async () => ({ groups: [group] })),
    };
    render(<PrivateDmScreen gateway={gateway} />);

    expect(await screen.findByRole("heading", { name: "Friends" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy invite" }));

    expect(screen.getByRole("button", { name: "Invite copied" })).toBeInTheDocument();
  });

  it("lists active sessions in the rail and switches between them", async () => {
    const second = snapshot({
      session_id: "session-two",
      messages: [{ from_device: "Charlie", body: "yo from charlie" }],
    });
    const gateway = createGateway([snapshot(), second]);
    render(<PrivateDmScreen gateway={gateway} />);

    await waitFor(() => expect(gateway.listPrivateSessions).toHaveBeenCalled());
    const railButtons = await screen.findAllByRole("button", { name: /Open session with/ });
    expect(railButtons).toHaveLength(2);

    const user = userEvent.setup();
    await user.click(railButtons[1]);
    expect(await screen.findByText("yo from charlie")).toBeInTheDocument();
  });

  it("filters active messages by text and attachments", async () => {
    const user = userEvent.setup();
    const gateway = createGateway([
      snapshot({
        messages: [
          { from_device: "Alice", body: "hello from moss" },
          { from_device: "Bob", body: "release notes are ready" },
          {
            from_device: "Alice",
            body: "",
            attachment: {
              attachment_id: "notes-file",
              content_hash: "1".repeat(64),
              file_name: "handshake-notes.txt",
              mime: "text/plain",
              total_size: 1200,
            },
          },
        ],
      }),
    ]);
    render(<PrivateDmScreen gateway={gateway} />);

    await screen.findByText("release notes are ready");
    const search = screen.getByRole("textbox", { name: "Search messages" });
    await user.type(search, "release");

    expect(screen.getByText("release notes are ready")).toBeInTheDocument();
    expect(screen.queryByText("hello from moss")).not.toBeInTheDocument();

    await user.clear(search);
    await user.click(screen.getByRole("button", { name: "Files" }));

    expect(screen.getByText("handshake-notes.txt")).toBeInTheDocument();
    expect(screen.queryByText("release notes are ready")).not.toBeInTheDocument();
  });

  it("shows timestamps and groups adjacent stamped messages", async () => {
    const sentAt = Date.UTC(2026, 0, 1, 10, 0);
    const gateway = createGateway([
      snapshot({
        messages: [
          {
            from_device: "Alice",
            body: "first stamped message",
            message_id: "message-1",
            sent_at_ms: sentAt,
          },
          {
            from_device: "Alice",
            body: "second grouped message",
            message_id: "message-2",
            sent_at_ms: sentAt + 60_000,
          },
          {
            from_device: "Alice",
            body: "later message",
            message_id: "message-3",
            sent_at_ms: sentAt + 10 * 60_000,
          },
        ],
      }),
    ]);
    render(<PrivateDmScreen gateway={gateway} />);

    await screen.findByText("first stamped message");
    const expectedTime = new Date(sentAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(screen.getByText(expectedTime)).toBeInTheDocument();
    expect(screen.getByText("second grouped message").closest(".message-row")).toHaveClass(
      "message-row-grouped",
    );
    expect(screen.getByText("later message").closest(".message-row")).not.toHaveClass(
      "message-row-grouped",
    );
    expect(screen.queryByText("OpenMLS · sealed")).not.toBeInTheDocument();
  });

  it("closes the active session and returns to the empty state", async () => {
    const gateway = createGateway([snapshot()]);
    render(<PrivateDmScreen gateway={gateway} />);

    await screen.findByText("hello from moss");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Close session" }));
    expect(
      screen.getByRole("dialog", { name: "Delete chat with Alice?" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete chat" }));

    expect(gateway.closePrivateSession).toHaveBeenCalledWith(SESSION_ID);
    await waitFor(() =>
      expect(screen.queryByText("hello from moss")).not.toBeInTheDocument(),
    );
  });

  it("sends through the gateway for the active session", async () => {
    const gateway = createGateway([snapshot()]);
    render(<PrivateDmScreen gateway={gateway} />);

    await screen.findByText("hello from moss");
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Message" }), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(gateway.sendPrivateMessage).toHaveBeenCalledWith(SESSION_ID, "hello");
  });

  it("surfaces message send failures in the active chat", async () => {
    const gateway = createGateway([snapshot()]);
    gateway.sendPrivateMessage = vi.fn(async () => {
      throw new Error("send failed");
    });
    render(<PrivateDmScreen gateway={gateway} />);

    await screen.findByText("hello from moss");
    const user = userEvent.setup();
    const composer = screen.getByRole("textbox", { name: "Message" });
    await user.type(composer, "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("send failed");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(composer).toHaveValue("hello");
  });

  it("retries the last failed message send", async () => {
    const gateway = createGateway([snapshot()]);
    gateway.sendPrivateMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("send failed"))
      .mockResolvedValue({
        session_id: SESSION_ID,
        state: "ready",
        ciphertext_bytes: 128,
      });
    render(<PrivateDmScreen gateway={gateway} />);

    await screen.findByText("hello from moss");
    const user = userEvent.setup();
    const composer = screen.getByRole("textbox", { name: "Message" });
    await user.type(composer, "retry me");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.click(await screen.findByRole("button", { name: "Retry" }));

    await waitFor(() => expect(gateway.sendPrivateMessage).toHaveBeenCalledTimes(2));
    expect(gateway.sendPrivateMessage).toHaveBeenLastCalledWith(SESSION_ID, "retry me");
    await waitFor(() => expect(composer).toHaveValue(""));
  });

  it("downloads voice attachments before playback", async () => {
    const user = userEvent.setup();
    const gateway = createGateway([
      snapshot({
        messages: [
          {
            from_device: "Alice",
            body: "",
            attachment: {
              attachment_id: "voice-test",
              content_hash: "1".repeat(64),
              file_name: "voice-message.webm",
              mime: "audio/webm",
              total_size: 4096,
              voice: { duration_ms: 1200, peaks_b64: "" },
            },
          },
        ],
        attachments: [
          {
            attachment_id: "voice-test",
            direction: "incoming",
            state: "offered",
            completed_chunks: 0,
            chunk_count: 1,
          },
        ],
      }),
    ]);
    const { container } = render(<PrivateDmScreen gateway={gateway} />);

    await screen.findByRole("button", { name: "Play voice message" });
    const audio = container.querySelector("audio");
    expect(audio?.getAttribute("src")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Play voice message" }));

    await waitFor(() =>
      expect(gateway.downloadPrivateAttachment).toHaveBeenCalledWith(
        SESSION_ID,
        "voice-test",
      ),
    );
  });

  it("does not overclaim tracker privacy", async () => {
    const user = userEvent.setup();
    render(<PrivateDmScreen gateway={createGateway()} />);

    await user.click(
      await screen.findByRole("button", { name: /How Mosh protects you/ }),
    );
    expect(
      await screen.findByText(/peer discovery metadata is NOT hidden/i),
    ).toBeInTheDocument();
  });

  it("joins a public channel and surfaces it in the rail", async () => {
    const user = userEvent.setup();
    const gateway = createGateway();
    render(<PrivateDmScreen gateway={gateway} />);

    await user.click(screen.getByRole("button", { name: /Join a public channel/ }));
    await user.type(screen.getByRole("textbox", { name: "Channel name" }), "@mosh-dev");
    await user.click(screen.getByRole("button", { name: "Join channel" }));

    expect(gateway.joinChannel).toHaveBeenCalledWith(
      expect.objectContaining({ name: "@mosh-dev" }),
    );
    expect(await screen.findByRole("button", { name: /Open channel mosh-dev/ })).toBeInTheDocument();
  });
});
