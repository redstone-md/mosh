import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import {
  closeChatTarget,
  sameChatTarget,
  type ChatTarget,
} from "./chat-actions";
import { shorten } from "./format";
import type {
  ChannelSnapshot,
  GroupSnapshot,
  NativeMessagingGateway,
  SessionSnapshot,
} from "./native/native-messaging-gateway";

interface PendingCloseConfirmation {
  readonly item: ChatTarget;
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
}

type RunSessionOperation = (
  kind: "session",
  action: () => Promise<void>,
) => Promise<void>;

interface UseChatCloseFlowOptions {
  readonly active: ChatTarget | null;
  readonly sessions: readonly SessionSnapshot[];
  readonly channels: readonly ChannelSnapshot[];
  readonly groups: readonly GroupSnapshot[];
  readonly gateway: NativeMessagingGateway;
  readonly refresh: (quiet?: boolean) => Promise<void>;
  readonly run: RunSessionOperation;
  readonly setActive: Dispatch<SetStateAction<ChatTarget | null>>;
  readonly sessionLabel: (session: SessionSnapshot) => string;
}

function closeConfirmationFor(
  item: ChatTarget,
  sessions: readonly SessionSnapshot[],
  channels: readonly ChannelSnapshot[],
  groups: readonly GroupSnapshot[],
  sessionLabel: (session: SessionSnapshot) => string,
): PendingCloseConfirmation {
  if (item.type === "dm") {
    const session = sessions.find((candidate) => candidate.session_id === item.id);
    const label = session ? sessionLabel(session) : "this private chat";
    return {
      item,
      title: `Delete chat with ${label}?`,
      body:
        "Saved history for this private chat will be removed from this device. You cannot undo this.",
      confirmLabel: "Delete chat",
    };
  }
  if (item.type === "channel") {
    const channel = channels.find((candidate) => candidate.name === item.name);
    const label = channel?.name ?? item.name;
    return {
      item,
      title: `Leave #${label}?`,
      body:
        "You will stop receiving new messages from this public channel until you join it again.",
      confirmLabel: "Leave channel",
    };
  }
  const group = groups.find((candidate) => candidate.group_id === item.id);
  const label = group?.label ?? (group ? shorten(group.group_id, 6) : "this group");
  return {
    item,
    title: `Leave ${label}?`,
    body:
      "Saved group history will be removed from this device. You will need a new invite to rejoin.",
    confirmLabel: "Leave group",
  };
}

export function useChatCloseFlow({
  active,
  sessions,
  channels,
  groups,
  gateway,
  refresh,
  run,
  setActive,
  sessionLabel,
}: UseChatCloseFlowOptions) {
  const [pendingClose, setPendingClose] = useState<PendingCloseConfirmation | null>(null);
  const [confirmedFingerprints, setConfirmedFingerprints] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const closeActive = useCallback(() => {
    if (!active) {
      return;
    }
    setPendingClose(
      closeConfirmationFor(active, sessions, channels, groups, sessionLabel),
    );
  }, [active, channels, groups, sessions, sessionLabel]);

  const cancelClose = useCallback(() => setPendingClose(null), []);

  const confirmCloseActive = useCallback(() => {
    const target = pendingClose?.item;
    if (!target) {
      return;
    }
    setPendingClose(null);
    void run("session", async () => {
      await closeChatTarget(gateway, target);
      if (target.type === "dm") {
        setConfirmedFingerprints((current) => {
          const next = new Set(current);
          next.delete(target.id);
          return next;
        });
      }
      setActive((current) =>
        current && sameChatTarget(current, target) ? null : current,
      );
      await refresh(true);
    });
  }, [gateway, pendingClose, refresh, run, setActive]);

  const confirmFingerprint = useCallback(
    (sessionId: string) =>
      setConfirmedFingerprints((current) => new Set(current).add(sessionId)),
    [],
  );

  return {
    cancelClose,
    closeActive,
    confirmCloseActive,
    confirmedFingerprints,
    confirmFingerprint,
    pendingClose,
  };
}
