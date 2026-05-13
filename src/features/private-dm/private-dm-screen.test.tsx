import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  MeshInfo,
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
    state: "ready",
    invite_uri: INVITE,
    fingerprint: FINGERPRINT,
    messages: [{ from_device: "Alice", body: "hello from moss" }],
    mesh: MESH_READY,
    events: EVENTS,
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
      mesh: MESH_READY,
      events: [],
    })),
    listPrivateGroups: vi.fn(async () => ({ groups: [] })),
    closePrivateGroup: vi.fn(async (group_id) => ({ group_id, closed: true })),
  };
}

describe("PrivateDmScreen", () => {
  it("renders welcome state when there are no sessions", async () => {
    render(<PrivateDmScreen gateway={createGateway()} />);

    expect(screen.getByRole("main", { name: "MOSH" })).toBeInTheDocument();
    expect(await screen.findByRole("complementary", { name: "Active sessions" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Peer status" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Static peer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create invite" })).toBeInTheDocument();
  });

  it("creates and copies an invite, then surfaces the active session", async () => {
    const user = userEvent.setup();
    const gateway = createGateway();
    render(<PrivateDmScreen gateway={gateway} />);

    await user.click(screen.getByRole("button", { name: "Create invite" }));

    expect(gateway.createPrivateInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        display_name: expect.stringMatching(/^mosh-[a-z0-9]+$/),
        listen_port: 0,
        static_peer: null,
      }),
    );
    await screen.findByRole("button", { name: "Copied" });
    expect(screen.getByText(INVITE)).toBeInTheDocument();
  });

  it("accepts an invite + opens chat for the new session", async () => {
    const user = userEvent.setup();
    const gateway = createGateway();
    render(<PrivateDmScreen gateway={gateway} />);

    await user.type(screen.getByRole("textbox", { name: "Invite URI" }), INVITE);
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

  it("closes the active session and returns to the empty state", async () => {
    const gateway = createGateway([snapshot()]);
    render(<PrivateDmScreen gateway={gateway} />);

    await screen.findByText("hello from moss");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Close session" }));

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

  it("does not overclaim tracker privacy", async () => {
    render(<PrivateDmScreen gateway={createGateway()} />);
    expect(
      await screen.findByText(/peer discovery metadata is NOT hidden/i),
    ).toBeInTheDocument();
  });

  it("joins a public channel and surfaces it in the rail", async () => {
    const user = userEvent.setup();
    const gateway = createGateway();
    render(<PrivateDmScreen gateway={gateway} />);

    await user.type(screen.getByRole("textbox", { name: "Channel name" }), "@mosh-dev");
    await user.click(screen.getByRole("button", { name: "Join channel" }));

    expect(gateway.joinChannel).toHaveBeenCalledWith(
      expect.objectContaining({ name: "@mosh-dev" }),
    );
    expect(await screen.findByRole("button", { name: /Open channel mosh-dev/ })).toBeInTheDocument();
  });
});
