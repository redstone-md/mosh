import { describe, expect, it } from "vitest";
import { retryChatMessage } from "./chat-actions";
import { createGateway, SESSION_ID } from "./private-dm-test-utils";

describe("retryChatMessage", () => {
  it("routes historical retries to the matching gateway method", async () => {
    const gateway = createGateway();

    await retryChatMessage(gateway, { type: "dm", id: SESSION_ID }, "dm-message-1");
    await retryChatMessage(gateway, { type: "channel", name: "design-lab" }, "channel-message-1");
    await retryChatMessage(gateway, { type: "group", id: "group-test" }, "group-message-1");

    expect(gateway.retryPrivateMessage).toHaveBeenCalledWith(SESSION_ID, "dm-message-1");
    expect(gateway.retryChannelMessage).toHaveBeenCalledWith(
      "design-lab",
      "channel-message-1",
    );
    expect(gateway.retryGroupMessage).toHaveBeenCalledWith("group-test", "group-message-1");
  });
});
