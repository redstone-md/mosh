import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NativeMessagingGateway } from "./native/native-messaging-gateway";
import { PrivateDmScreen } from "./private-dm-screen";

function createGateway(): NativeMessagingGateway {
  return {
    getDiagnostics: vi.fn(),
    getNativeRuntimeStatus: vi.fn(),
    createPrivateInvite: vi.fn(async () => ({
      invite_uri: "mosh://invite?mesh=mesh-one&session=session-one#fp=AABBCCDDEEFF0011",
      session_id: "session-one",
      mesh_id: "mesh-one",
      fingerprint: "AABBCCDDEEFF0011",
      listen_address: "default-public-trackers",
    })),
    acceptPrivateInvite: vi.fn(async () => ({
      role: "bob",
      state: "ready",
      invite_uri: "mosh://invite?mesh=mesh-one&session=session-one#fp=AABBCCDDEEFF0011",
      fingerprint: "AABBCCDDEEFF0011",
      messages: [],
    })),
    sendPrivateMessage: vi.fn(async () => ({ state: "ready", ciphertext_bytes: 128 })),
    pollPrivateSession: vi.fn(async () => ({
      role: "bob",
      state: "ready",
      invite_uri: null,
      fingerprint: "AABBCCDDEEFF0011",
      messages: [{ from_device: "Alice", body: "hello from moss" }],
    })),
  };
}

describe("PrivateDmScreen", () => {
  it("renders the Mosh desktop DM shell from the design structure", () => {
    render(<PrivateDmScreen gateway={createGateway()} />);

    expect(screen.getByRole("main", { name: "MOSH" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Direct messages" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Alice Park" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Peer status" })).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "Listen port" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Static peer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Poll" })).not.toBeInTheDocument();
  });

  it("confirms a fingerprint through the visible invite flow", async () => {
    const user = userEvent.setup();

    render(<PrivateDmScreen gateway={createGateway()} />);
    await user.click(screen.getByRole("button", { name: "Confirm fingerprint" }));

    expect(screen.getByRole("button", { name: "Fingerprint confirmed" })).toBeInTheDocument();
    expect(screen.getByText("Direct · fingerprint confirmed · MLS waiting")).toBeInTheDocument();
  });

  it("creates a copyable invite and accepts it after manual fingerprint confirmation", async () => {
    const user = userEvent.setup();
    const gateway = createGateway();

    render(<PrivateDmScreen gateway={gateway} />);
    await user.click(screen.getAllByRole("button", { name: "Create invite" })[1]);
    await user.click(screen.getByRole("button", { name: "Confirm fingerprint" }));
    await user.type(screen.getByRole("textbox", { name: "Invite URI" }), "mosh://invite?mesh=mesh-one&session=session-one#fp=AABBCCDDEEFF0011");
    await user.click(screen.getByRole("button", { name: "Paste invite" }));

    expect(gateway.createPrivateInvite).toHaveBeenCalledWith({
      display_name: "Mosh Device",
      listen_port: 0,
      static_peer: null,
    });
    expect(gateway.acceptPrivateInvite).toHaveBeenCalled();
    expect(screen.getByText("ready")).toBeInTheDocument();
  });

  it("automatically polls after a session starts", async () => {
    const user = userEvent.setup();
    const gateway = createGateway();

    render(<PrivateDmScreen gateway={gateway} />);
    await user.click(screen.getAllByRole("button", { name: "Create invite" })[1]);

    await waitFor(() => expect(gateway.pollPrivateSession).toHaveBeenCalled());
    expect(await screen.findByText("hello from moss")).toBeInTheDocument();
  });
  it("sends through the native private DM gateway and renders polled plaintext", async () => {
    const user = userEvent.setup();
    const gateway = createGateway();

    render(<PrivateDmScreen gateway={gateway} />);
    await user.type(screen.getByRole("textbox", { name: "Message Alice Park" }), "hello");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(gateway.sendPrivateMessage).toHaveBeenCalledWith("hello");
    expect(screen.getByText("hello from moss")).toBeInTheDocument();
  });

  it("does not overclaim tracker privacy", () => {
    render(<PrivateDmScreen gateway={createGateway()} />);

    expect(screen.getByText(/Public trackers help discovery but do not hide metadata/i)).toBeInTheDocument();
    expect(screen.getByText("OpenMLS E2EE over Moss transport")).toBeInTheDocument();
  });
});
