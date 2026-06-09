import { act, render, waitFor } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ChatTarget } from "./chat-actions";
import type {
  NativeMessagingGateway,
  SessionListSnapshot,
} from "./native/native-messaging-gateway";
import { usePrivateDmSnapshots } from "./use-private-dm-snapshots";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("usePrivateDmSnapshots", () => {
  it("coalesces burst refreshes into one follow-up poll", async () => {
    const firstPoll = deferred<SessionListSnapshot>();
    const gateway = {
      listPrivateSessions: vi
        .fn()
        .mockReturnValueOnce(firstPoll.promise)
        .mockResolvedValue({ sessions: [] }),
      listChannels: vi.fn(async () => ({ channels: [] })),
      listPrivateGroups: vi.fn(async () => ({ groups: [] })),
    } as unknown as NativeMessagingGateway;
    const setActiveSpy = vi.fn();
    const setActive: Dispatch<SetStateAction<ChatTarget | null>> = (value) => {
      setActiveSpy(value);
    };
    const onErrorSpy = vi.fn();
    const onError: Dispatch<SetStateAction<string | undefined>> = (value) => {
      onErrorSpy(value);
    };
    const runOperationSpy = vi.fn();
    const runOperation = async <T,>(
      kind: "refresh",
      action: () => Promise<T>,
    ): Promise<T> => {
      runOperationSpy(kind);
      return action();
    };
    let refresh: ((quiet?: boolean) => Promise<void>) | null = null;

    function Harness() {
      refresh = usePrivateDmSnapshots({
        gateway,
        runOperation,
        setActive,
        onError,
      }).refresh;
      return null;
    }

    render(<Harness />);

    await waitFor(() => expect(gateway.listPrivateSessions).toHaveBeenCalledTimes(1));

    await act(async () => {
      void refresh?.(true);
      void refresh?.(true);
    });

    expect(gateway.listPrivateSessions).toHaveBeenCalledTimes(1);

    firstPoll.resolve({ sessions: [] });

    await waitFor(() => expect(gateway.listPrivateSessions).toHaveBeenCalledTimes(2));
  });
});
