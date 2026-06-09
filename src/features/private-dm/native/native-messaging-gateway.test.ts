import { describe, expect, it } from "vitest";
import { nativeMessagingGateway } from "./native-messaging-gateway";

describe("nativeMessagingGateway", () => {
  it("uses seeded demo data outside Tauri", async () => {
    await expect(nativeMessagingGateway.listPrivateSessions()).resolves.toMatchObject({
      sessions: [expect.objectContaining({ peer_display_name: "Sera" })],
    });
    await expect(nativeMessagingGateway.listChannels()).resolves.toMatchObject({
      channels: [expect.objectContaining({ name: "design-lab" })],
    });
    await expect(nativeMessagingGateway.listPrivateGroups()).resolves.toMatchObject({
      groups: [expect.objectContaining({ label: "Core team" })],
    });
  });

  it("mutates demo conversations for browser preview", async () => {
    const before = await nativeMessagingGateway.listPrivateSessions();
    const session = before.sessions[0];
    await nativeMessagingGateway.sendPrivateMessage(session.session_id, "preview message");

    await expect(nativeMessagingGateway.pollPrivateSession(session.session_id)).resolves.toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({ body: "preview message" }),
      ]),
    });
  });
});
