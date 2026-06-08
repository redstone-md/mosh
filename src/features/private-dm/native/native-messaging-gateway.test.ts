import { describe, expect, it } from "vitest";
import { nativeMessagingGateway } from "./native-messaging-gateway";

describe("nativeMessagingGateway", () => {
  it("falls back to an empty browser-safe gateway outside Tauri", async () => {
    await expect(nativeMessagingGateway.listPrivateSessions()).resolves.toEqual({
      sessions: [],
    });
    await expect(nativeMessagingGateway.listChannels()).resolves.toEqual({
      channels: [],
    });
    await expect(nativeMessagingGateway.listPrivateGroups()).resolves.toEqual({
      groups: [],
    });
  });

  it("surfaces a readable runtime error outside Tauri", async () => {
    await expect(
      nativeMessagingGateway.createPrivateInvite({
        display_name: "mosh-test",
        listen_port: 0,
        static_peer: null,
      }),
    ).rejects.toThrow("Mosh desktop runtime is unavailable");
  });
});
