import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { type ChatTarget } from "./chat-actions";
import { readableError } from "./format";
import type {
  ChannelSnapshot,
  GroupSnapshot,
  NativeMessagingGateway,
  SessionSnapshot,
} from "./native/native-messaging-gateway";

const AUTO_POLL_MS = 1000;

type RunRefreshOperation = <T>(
  kind: "refresh",
  action: () => Promise<T>,
) => Promise<T>;

interface UsePrivateDmSnapshotsOptions {
  readonly gateway: NativeMessagingGateway;
  readonly runOperation: RunRefreshOperation;
  readonly setActive: Dispatch<SetStateAction<ChatTarget | null>>;
  readonly onError: Dispatch<SetStateAction<string | undefined>>;
}

function nextActiveTarget(
  current: ChatTarget | null,
  sessions: readonly SessionSnapshot[],
  channels: readonly ChannelSnapshot[],
  groups: readonly GroupSnapshot[],
): ChatTarget | null {
  if (current?.type === "dm" && sessions.some((session) => session.session_id === current.id)) {
    return current;
  }
  if (current?.type === "channel" && channels.some((channel) => channel.name === current.name)) {
    return current;
  }
  if (current?.type === "group" && groups.some((group) => group.group_id === current.id)) {
    return current;
  }
  if (sessions.length > 0) {
    return { type: "dm", id: sessions[0].session_id };
  }
  if (groups.length > 0) {
    return { type: "group", id: groups[0].group_id };
  }
  if (channels.length > 0) {
    return { type: "channel", name: channels[0].name };
  }
  return null;
}

export function usePrivateDmSnapshots({
  gateway,
  runOperation,
  setActive,
  onError,
}: UsePrivateDmSnapshotsOptions) {
  const [sessions, setSessions] = useState<readonly SessionSnapshot[]>([]);
  const [channels, setChannels] = useState<readonly ChannelSnapshot[]>([]);
  const [groups, setGroups] = useState<readonly GroupSnapshot[]>([]);
  const pollInFlight = useRef(false);
  const pollPending = useRef(false);
  const refreshRef = useRef<((quiet?: boolean) => Promise<void>) | null>(null);

  const refresh = useCallback(
    async (quiet = false) => {
      if (pollInFlight.current) {
        // Coalesce bursts from mutations so the roster gets exactly one
        // follow-up snapshot refresh after the in-flight request settles.
        pollPending.current = true;
        return;
      }
      pollInFlight.current = true;
      if (!quiet) {
        onError(undefined);
      }
      const loadSnapshots = async () => {
        const [sessionList, channelList, groupList] = await Promise.all([
          gateway.listPrivateSessions(),
          gateway.listChannels(),
          gateway.listPrivateGroups(),
        ]);
        setSessions(sessionList.sessions);
        setChannels(channelList.channels);
        setGroups(groupList.groups);
        setActive((current) =>
          nextActiveTarget(
            current,
            sessionList.sessions,
            channelList.channels,
            groupList.groups,
          ),
        );
      };
      try {
        await (quiet ? loadSnapshots() : runOperation("refresh", loadSnapshots));
      } catch (err) {
        onError(readableError(err));
      } finally {
        pollInFlight.current = false;
        if (pollPending.current && refreshRef.current) {
          pollPending.current = false;
          const followUp = refreshRef.current;
          window.setTimeout(() => void followUp(true), 0);
        }
      }
    },
    [gateway, onError, runOperation, setActive],
  );
  refreshRef.current = refresh;

  useEffect(() => {
    void refresh(true);
    const intervalId = window.setInterval(() => void refresh(true), AUTO_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [refresh]);

  return {
    channels,
    groups,
    refresh,
    sessions,
  };
}
