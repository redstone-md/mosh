import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type ChatTarget } from "./chat-actions";
import type { NativeMessagingGateway } from "./native/native-messaging-gateway";
import type { PrivateDmRequestBase } from "./private-dm-setup.types";
import { useDmOffers } from "./use-dm-offers";

function makeProps(active: ChatTarget) {
  return {
    active,
    channels: [],
    groups: [],
    gateway: {
      createPrivateInvite: vi
        .fn()
        .mockResolvedValue({ invite_uri: "mosh://invite", session_id: "sess-new" }),
      sendChannelDmOffer: vi.fn().mockResolvedValue(undefined),
      sendGroupDmOffer: vi.fn().mockResolvedValue(undefined),
    } as unknown as NativeMessagingGateway,
    refresh: vi.fn().mockResolvedValue(undefined),
    requestBase: {} as PrivateDmRequestBase,
    run: (_kind: "offer", action: () => Promise<void>) => action(),
    setActive: vi.fn(),
    setShowSetup: vi.fn(),
  };
}

describe("useDmOffers", () => {
  it("resets offered fingerprints when the active conversation changes", async () => {
    const { result, rerender } = renderHook((props) => useDmOffers(props), {
      initialProps: makeProps({ type: "channel", name: "A" }),
    });

    await act(async () => {
      result.current.offerDm("FP1");
    });
    await waitFor(() =>
      expect(result.current.offeredFingerprints.has("FP1")).toBe(true),
    );

    // Switching to a different host must not carry the offered marker over.
    rerender(makeProps({ type: "channel", name: "B" }));
    expect(result.current.offeredFingerprints.has("FP1")).toBe(false);
  });
});
