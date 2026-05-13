import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  MeshInfo,
  NativeMessagingGateway,
  SessionSnapshot,
  SnapshotEvent,
} from "./native/native-messaging-gateway";
import { PrivateDmScreen } from "./private-dm-screen";

const FINGERPRINT = "AABBCCDDEEFF0011";
const INVITE = `mosh://invite?mesh=mesh-one&session=session-one#fp=${FINGERPRINT}`;

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
  channels: ["mosh.private.control.v1", "mosh.private.data.v1"],
  nat_type: "endpoint-independent",
  supernode_ready: false,
  public_key: "abcdef0123456789",
};

const EVENTS: SnapshotEvent[] = [
  {
    event_type: 5,
    event_name: "tracker_announce",
    detail_json: '{"candidate_peers":2,"connected_peers":1}',
    epoch_millis: Date.now() - 4000,
  },
  {
    event_type: 1,
    event_name: "peer_joined",
    detail_json: '{"peer_id":"abc123"}',
    epoch_millis: Date.now() - 1000,
  },
];

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    role: "bob",
    state: "ready",
    invite_uri: INVITE,
    fingerprint: FINGERPRINT,
    messages: [{ from_device: "Alice", body: "hello from moss" }],
    mesh: MESH_READY,
    events: EVENTS,
    ...overrides,
  };
}

function createGateway(): NativeMessagingGateway {
  return {
    getDiagnostics: vi.fn(),
    getNativeRuntimeStatus: vi.fn(),
    createPrivateInvite: vi.fn(async () => ({
      invite_uri: INVITE,
      session_id: "session-one",
      mesh_id: "mesh-one",
      fingerprint: FINGERPRINT,
      listen_address: "default-public-trackers",
    })),
    acceptPrivateInvite: vi.fn(async () => snapshot({ role: "bob" })),
    sendPrivateMessage: vi.fn(async () => ({ state: "ready", ciphertext_bytes: 128 })),
    pollPrivateSession: vi.fn(async () => snapshot()),
  };
}

describe("PrivateDmScreen", () => {
  it("renders the redesigned Mosh DM shell without mocked contacts", () => {
    render(<PrivateDmScreen gateway={createGateway()} />);

    expect(screen.getByRole("main", { name: "MOSH" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Session setup" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Peer status" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Static peer" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Listen port" })).toBeInTheDocument();
    expect(screen.queryByText("Alice Park")).not.toBeInTheDocument();
  });

  it("creates and copies an invite", async () => {
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

  it("passes static_peer override to create + accept", async () => {
    const user = userEvent.setup();
    const gateway = createGateway();
    render(<PrivateDmScreen gateway={gateway} />);

    await user.clear(screen.getByRole("textbox", { name: "Display name" }));
    await user.type(screen.getByRole("textbox", { name: "Display name" }), "Juno");
    await user.type(screen.getByRole("textbox", { name: "Static peer" }), "10.0.0.5:42130");
    await user.click(screen.getByRole("button", { name: "Create invite" }));

    expect(gateway.createPrivateInvite).toHaveBeenCalledWith({
      display_name: "Juno",
      listen_port: 0,
      static_peer: "10.0.0.5:42130",
    });
  });

  it("accepts an invite via the join card", async () => {
    const user = userEvent.setup();
    const gateway = createGateway();
    render(<PrivateDmScreen gateway={gateway} />);

    await user.type(screen.getByRole("textbox", { name: "Invite URI" }), INVITE);
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(gateway.acceptPrivateInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        display_name: expect.stringMatching(/^mosh-[a-z0-9]+$/),
        listen_port: 0,
        static_peer: null,
        invite_uri: INVITE,
      }),
    );
  });

  it("confirms fingerprint only after the snapshot supplies one", async () => {
    const user = userEvent.setup();
    const gateway = createGateway();
    render(<PrivateDmScreen gateway={gateway} />);

    expect(screen.getByRole("button", { name: "Confirm fingerprint" })).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: "Invite URI" }), INVITE);
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Confirm fingerprint" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Confirm fingerprint" }));
    expect(screen.getByRole("button", { name: "Fingerprint confirmed" })).toBeInTheDocument();
  });

  it("auto-polls and renders runtime plaintext", async () => {
    const user = userEvent.setup();
    const gateway = createGateway();
    render(<PrivateDmScreen gateway={gateway} />);

    await user.click(screen.getByRole("button", { name: "Create invite" }));
    await waitFor(() => expect(gateway.pollPrivateSession).toHaveBeenCalled());
    expect(await screen.findByText("hello from moss")).toBeInTheDocument();
  });

  it("sends through the gateway and surfaces mesh diagnostics", async () => {
    const user = userEvent.setup();
    const gateway = createGateway();
    render(<PrivateDmScreen gateway={gateway} />);

    await user.click(screen.getByRole("button", { name: "Create invite" }));
    await waitFor(() => expect(gateway.pollPrivateSession).toHaveBeenCalled());

    await user.type(screen.getByRole("textbox", { name: "Message" }), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(gateway.sendPrivateMessage).toHaveBeenCalledWith("hello");
    expect(screen.getByText("endpoint-independent")).toBeInTheDocument();
    expect(screen.getByText("203.0.113.7:42130")).toBeInTheDocument();
  });

  it("does not overclaim tracker privacy", () => {
    render(<PrivateDmScreen gateway={createGateway()} />);

    expect(
      screen.getByText(/peer discovery metadata is NOT hidden/i),
    ).toBeInTheDocument();
    expect(screen.getByText("End-to-end encrypted")).toBeInTheDocument();
  });
});
