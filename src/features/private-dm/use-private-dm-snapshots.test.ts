import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatTarget } from "./chat-actions";
import type { NativeMessagingGateway } from "./native/native-messaging-gateway";
import type { SessionSnapshot } from "./native/native-messaging-gateway";
import { nextActiveTarget, usePrivateDmSnapshots } from "./use-private-dm-snapshots";

const session = (id: string) => ({ session_id: id }) as SessionSnapshot;

describe("nextActiveTarget", () => {
  it("keeps a just-created target a stale in-flight poll has not listed yet", () => {
    // User created session B (active = {dm, B}); a poll that started before B
    // existed returns only [A]. It must NOT yank the user back to A.
    const current: ChatTarget = { type: "dm", id: "B" };
    const seen = new Set(["dm:A"]); // only A was ever observed
    expect(nextActiveTarget(current, [session("A")], [], [], seen)).toEqual(current);
  });

  it("switches away from a target that was listed before and is now gone", () => {
    const current: ChatTarget = { type: "dm", id: "A" };
    const seen = new Set(["dm:A"]); // A really existed, now deleted → leave it
    expect(nextActiveTarget(current, [], [], [], seen)).toBeNull();
  });

  it("auto-selects the first session when there is no current target", () => {
    expect(nextActiveTarget(null, [session("A")], [], [], new Set())).toEqual({
      type: "dm",
      id: "A",
    });
  });

  it("keeps the current target when it is still listed", () => {
    const current: ChatTarget = { type: "dm", id: "A" };
    expect(
      nextActiveTarget(current, [session("A")], [], [], new Set(["dm:A"])),
    ).toEqual(current);
  });
});

describe("usePrivateDmSnapshots follow-up timer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not fire a coalesced follow-up poll after unmount", async () => {
    let calls = 0;
    let resolveFirst: () => void = () => {};
    const listPrivateSessions = vi.fn(() => {
      calls += 1;
      if (calls === 1) {
        return new Promise((res) => {
          resolveFirst = () => res({ sessions: [] });
        });
      }
      return Promise.resolve({ sessions: [] });
    });
    const gateway = {
      listPrivateSessions,
      listChannels: vi.fn().mockResolvedValue({ channels: [] }),
      listPrivateGroups: vi.fn().mockResolvedValue({ groups: [] }),
    } as unknown as NativeMessagingGateway;

    const { result, unmount } = renderHook(() =>
      usePrivateDmSnapshots({
        gateway,
        runOperation: (<T,>(_k: "refresh", action: () => Promise<T>) => action()) as never,
        setActive: vi.fn(),
        onError: vi.fn(),
      }),
    );

    // First poll (mount effect) is in-flight; a second refresh coalesces into
    // pollPending, so settling the first schedules the follow-up setTimeout.
    act(() => void result.current.refresh(true));
    await act(async () => {
      resolveFirst();
      await Promise.resolve();
    });

    unmount();
    act(() => void vi.advanceTimersByTime(10));

    // The follow-up must have been cancelled on unmount, so no second poll.
    expect(listPrivateSessions).toHaveBeenCalledTimes(1);
  });
});
