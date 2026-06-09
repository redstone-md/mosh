import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PrivateDmScreen } from "./private-dm-screen";
import { createGateway, SESSION_ID, snapshot } from "./private-dm-test-utils";

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
});
