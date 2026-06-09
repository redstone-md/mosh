import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PrivateDmScreen } from "./private-dm-screen";
import { createGateway, SESSION_ID, snapshot } from "./private-dm-test-utils";

describe("PrivateDmScreen conversations", () => {
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

  it("toggles the conversation rail between compact and expanded states", async () => {
    const user = userEvent.setup();
    render(<PrivateDmScreen gateway={createGateway([snapshot()])} />);

    const toggle = await screen.findByRole("button", { name: "Open conversations" });
    const rail = await screen.findByRole("complementary", { name: "Active sessions" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(rail).not.toHaveClass("session-rail-expanded");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(rail).toHaveClass("session-rail-expanded");
    expect(screen.getByRole("button", { name: "Close conversations" })).toBeInTheDocument();
  });

  it("accepts an incoming voice call from the modal", async () => {
    const user = userEvent.setup();
    const gateway = createGateway([
      snapshot({
        pending_call: {
          call_id: "call-incoming",
          from_device: "Alice phone",
        },
      }),
    ]);
    render(<PrivateDmScreen gateway={gateway} />);

    expect(await screen.findByRole("dialog", { name: "Incoming call" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Accept call" }));

    await waitFor(() =>
      expect(gateway.callAccept).toHaveBeenCalledWith(SESSION_ID, "call-incoming"),
    );
  });

  it("keeps files and delete behind the chat actions menu", async () => {
    const user = userEvent.setup();
    const gateway = createGateway([
      snapshot({
        messages: [
          { from_device: "Alice", body: "plain update" },
          {
            from_device: "Alice",
            body: "",
            attachment: {
              attachment_id: "brief-file",
              content_hash: "2".repeat(64),
              file_name: "brief.pdf",
              mime: "application/pdf",
              total_size: 1800,
            },
          },
        ],
      }),
    ]);
    render(<PrivateDmScreen gateway={gateway} />);

    expect(await screen.findByText("plain update")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More chat actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Files" }));

    expect(screen.getByText("brief.pdf")).toBeInTheDocument();
    expect(screen.queryByText("plain update")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "More chat actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete chat" }));
    expect(
      screen.getByRole("dialog", { name: "Delete chat with Alice?" }),
    ).toBeInTheDocument();
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

  it("does not show the encryption explainer inside active DM chats", async () => {
    render(<PrivateDmScreen gateway={createGateway([snapshot()])} />);

    await screen.findByText("hello from moss");

    expect(
      screen.queryByRole("region", { name: "End-to-end encrypted" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/peer discovery metadata is NOT hidden/i),
    ).not.toBeInTheDocument();
  });
});
