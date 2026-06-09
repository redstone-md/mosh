import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  ChannelListSnapshot,
  SendMessageResult,
} from "./native/native-messaging-gateway";
import { describe, expect, it, vi } from "vitest";
import { PrivateDmScreen } from "./private-dm-screen";
import {
  createGateway,
  groupSnapshot,
  MESH_READY,
  SESSION_ID,
  snapshot,
} from "./private-dm-test-utils";

describe("PrivateDmScreen messaging", () => {
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
        message_id: "message-sent-2",
        sent_at_ms: Date.now(),
        delivery_status: "sent",
        delivery_error: null,
      } satisfies SendMessageResult);
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

  it("retries failed retryable DM rows by message id", async () => {
    const gateway = createGateway([
      snapshot({
        display_name: "mosh-bob",
        messages: [
          {
            from_device: "mosh-bob",
            body: "needs resend",
            message_id: "dm-failed-1",
            sent_at_ms: Date.UTC(2026, 0, 1, 10, 0),
            delivery_status: "failed",
            delivery_error: "peer offline",
            retryable: true,
            retry_count: 1,
          },
        ],
      }),
    ]);
    render(<PrivateDmScreen gateway={gateway} />);

    const user = userEvent.setup();
    expect(await screen.findByText("needs resend")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry failed message" }));

    await waitFor(() =>
      expect(gateway.retryPrivateMessage).toHaveBeenCalledWith(SESSION_ID, "dm-failed-1"),
    );
  });

  it("only shows row retry controls for outbound failed messages with retry metadata", async () => {
    const gateway = createGateway([
      snapshot({
        display_name: "mosh-bob",
        messages: [
          {
            from_device: "Alice",
            body: "inbound failure",
            message_id: "dm-inbound-failed-1",
            sent_at_ms: Date.UTC(2026, 0, 1, 9, 58),
            delivery_status: "failed",
            delivery_error: "remote queue rejected",
            retryable: true,
            retry_count: 1,
          },
          {
            from_device: "mosh-bob",
            body: "not retryable",
            message_id: "dm-failed-2",
            sent_at_ms: Date.UTC(2026, 0, 1, 9, 59),
            delivery_status: "failed",
            delivery_error: "policy blocked",
            retryable: false,
            retry_count: 1,
          },
          {
            from_device: "mosh-bob",
            body: "missing id",
            sent_at_ms: Date.UTC(2026, 0, 1, 10, 0),
            delivery_status: "failed",
            delivery_error: "temporary outage",
            retryable: true,
            retry_count: 2,
          },
        ],
      }),
    ]);
    render(<PrivateDmScreen gateway={gateway} />);

    expect(await screen.findByText("inbound failure")).toBeInTheDocument();
    expect(screen.getByText("not retryable")).toBeInTheDocument();
    expect(screen.getByText("missing id")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry failed message" })).not.toBeInTheDocument();
  });

  it("retries failed retryable channel rows by message id", async () => {
    const gateway = createGateway([]);
    gateway.listChannels = vi.fn(async (): Promise<ChannelListSnapshot> => ({
      channels: [
        {
          name: "design-lab",
          topic: "public-channel/design-lab",
          mesh_id: "channel/design-lab",
          display_name: "mosh-test",
          device_fingerprint: "abcdef0123456789",
          messages: [
            {
              from_device: "mosh-test",
              from_fingerprint: "abcdef0123456789",
              body: "channel resend",
              message_id: "channel-failed-1",
              sent_at_ms: Date.UTC(2026, 0, 1, 10, 0),
              delivery_status: "failed",
              delivery_error: "tracker publish failed",
              retryable: true,
              retry_count: 2,
            },
          ],
          attachments: [],
          dm_offers: [],
          mesh: MESH_READY,
          events: [],
        },
      ],
    }));
    gateway.listPrivateGroups = vi.fn(async () => ({ groups: [] }));
    render(<PrivateDmScreen gateway={gateway} />);

    const user = userEvent.setup();
    expect(await screen.findByText("channel resend")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry failed message" }));

    await waitFor(() =>
      expect(gateway.retryChannelMessage).toHaveBeenCalledWith(
        "design-lab",
        "channel-failed-1",
      ),
    );
  });

  it("retries failed retryable group rows by message id", async () => {
    const gateway = createGateway([]);
    gateway.listChannels = vi.fn(async () => ({ channels: [] }));
    gateway.listPrivateGroups = vi.fn(async () => ({
      groups: [
        groupSnapshot({
          messages: [
            {
              from_device: "mosh-test",
              from_fingerprint: "abcdef",
              body: "group resend",
              message_id: "group-failed-1",
              sent_at_ms: Date.UTC(2026, 0, 1, 10, 0),
              delivery_status: "failed",
              delivery_error: "mesh fanout failed",
              retryable: true,
              retry_count: 1,
            },
          ],
        }),
      ],
    }));
    render(<PrivateDmScreen gateway={gateway} />);

    const user = userEvent.setup();
    expect(await screen.findByText("group resend")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry failed message" }));

    await waitFor(() =>
      expect(gateway.retryGroupMessage).toHaveBeenCalledWith(
        "group-test",
        "group-failed-1",
      ),
    );
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

  it("labels failed attachment transfers with retry affordance", async () => {
    const gateway = createGateway([
      snapshot({
        messages: [
          {
            from_device: "Alice",
            body: "",
            attachment: {
              attachment_id: "failed-file",
              content_hash: "1".repeat(64),
              file_name: "brief.pdf",
              mime: "application/pdf",
              total_size: 2048,
            },
          },
        ],
        attachments: [
          {
            attachment_id: "failed-file",
            direction: "incoming",
            state: "failed",
            completed_chunks: 0,
            chunk_count: 2,
          },
        ],
      }),
    ]);
    render(<PrivateDmScreen gateway={gateway} />);

    expect(
      await screen.findByRole("status", { name: "Transfer failed for brief.pdf" }),
    ).toHaveTextContent("2.0 KB · Transfer failed");
    expect(screen.getByRole("button", { name: "Retry brief.pdf" })).toBeEnabled();
  });

  it("exposes active attachment download progress and cancel action", async () => {
    const user = userEvent.setup();
    const gateway = createGateway([
      snapshot({
        messages: [
          {
            from_device: "Alice",
            body: "",
            attachment: {
              attachment_id: "downloading-file",
              content_hash: "2".repeat(64),
              file_name: "report.zip",
              mime: "application/zip",
              total_size: 8192,
            },
          },
        ],
        attachments: [
          {
            attachment_id: "downloading-file",
            direction: "incoming",
            state: "downloading",
            completed_chunks: 1,
            chunk_count: 4,
          },
        ],
      }),
    ]);
    render(<PrivateDmScreen gateway={gateway} />);

    expect(
      await screen.findByRole("status", { name: "Downloading 25% for report.zip" }),
    ).toHaveTextContent("8.0 KB · Downloading 25%");
    expect(
      screen.getByRole("progressbar", { name: "Download progress for report.zip" }),
    ).toHaveAttribute("aria-valuenow", "25");

    await user.click(screen.getByRole("button", { name: "Cancel download for report.zip" }));

    await waitFor(() =>
      expect(gateway.cancelPrivateAttachment).toHaveBeenCalledWith(
        SESSION_ID,
        "downloading-file",
      ),
    );
  });
});
