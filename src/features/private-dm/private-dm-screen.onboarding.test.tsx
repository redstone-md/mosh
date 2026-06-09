import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { NativeMessagingGateway } from "./native/native-messaging-gateway";
import { PrivateDmScreen } from "./private-dm-screen";
import {
  createGateway,
  groupSnapshot,
  INVITE,
  RUNTIME_STATUS_READY,
} from "./private-dm-test-utils";

describe("PrivateDmScreen onboarding", () => {
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

  it("warns when encrypted history persistence is unavailable", async () => {
    const gateway: NativeMessagingGateway = {
      ...createGateway(),
      getNativeRuntimeStatus: vi.fn(async () => ({
        ...RUNTIME_STATUS_READY,
        persistence: {
          ...RUNTIME_STATUS_READY.persistence,
          available: false,
          encrypted_at_rest: false,
          error: "DEK unavailable but database exists",
        },
      })),
    };

    render(<PrivateDmScreen gateway={gateway} />);

    expect(await screen.findByText("Encrypted history unavailable")).toBeInTheDocument();
    expect(
      screen.getByText(/private DM history and session continuity may be lost/i),
    ).toBeInTheDocument();
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
    expect(screen.getByRole("status")).toHaveTextContent(
      "Invite link is missing mesh=...",
    );
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
  });

  it("announces setup failures as onboarding alerts", async () => {
    const user = userEvent.setup();
    const gateway: NativeMessagingGateway = {
      ...createGateway(),
      createPrivateInvite: vi.fn(async () => {
        throw new Error("Invite service offline");
      }),
    };
    render(<PrivateDmScreen gateway={gateway} />);

    await user.click(screen.getByRole("button", { name: /New private chat/ }));
    await user.click(screen.getByRole("button", { name: "Create invite link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invite service offline",
    );
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
