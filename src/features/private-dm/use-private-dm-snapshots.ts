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

function targetKey(target: ChatTarget): string {
  return target.type === "channel" ? `channel:${target.name}` : `${target.type}:${target.id}`;
}

export function nextActiveTarget(
  current: ChatTarget | null,
  sessions: readonly SessionSnapshot[],
  channels: readonly ChannelSnapshot[],
  groups: readonly GroupSnapshot[],
  seen: ReadonlySet<string>,
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
  // current set but not in this snapshot. If we've never observed it, it's a
  // freshly-created target the backend hasn't listed yet (an in-flight poll
  // raced the create) — keep it. Only auto-switch away once it was seen and is
  // now gone (genuinely deleted), or when there is no current at all.
  if (current && !seen.has(targetKey(current))) {
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
  const followUpTimer = useRef<number | undefined>(undefined);
  // Every target id we've ever seen in a snapshot. Lets nextActiveTarget tell a
  // never-listed (freshly created) target apart from a once-listed deleted one.
  const seenRef = useRef(new Set<string>());

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
        const seen = seenRef.current;
        for (const session of sessionList.sessions) seen.add(`dm:${session.session_id}`);
        for (const group of groupList.groups) seen.add(`group:${group.group_id}`);
        for (const channel of channelList.channels) seen.add(`channel:${channel.name}`);
        setActive((current) =>
          nextActiveTarget(
            current,
            sessionList.sessions,
            channelList.channels,
            groupList.groups,
            seen,
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
          followUpTimer.current = window.setTimeout(() => void followUp(true), 0);
        }
      }
    },
    [gateway, onError, runOperation, setActive],
  );

  useEffect(() => {
    refreshRef.current = refresh;
    void refresh(true);
    const intervalId = window.setInterval(() => void refresh(true), AUTO_POLL_MS);
    return () => {
      window.clearInterval(intervalId);
      if (followUpTimer.current !== undefined) {
        window.clearTimeout(followUpTimer.current);
      }
    };
  }, [refresh]);

  return {
    channels,
    groups,
    refresh,
    sessions,
  };
}
