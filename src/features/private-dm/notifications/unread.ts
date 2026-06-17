/** A conversation and its current total message count. */
export interface ConversationCount {
  readonly id: string;
  readonly messageCount: number;
}

export interface MessageAuthor {
  readonly from_device: string;
  readonly from_fingerprint?: string;
}

/**
 * Counts messages not authored by the local participant. When both an own
 * fingerprint and the message's fingerprint are present (channels/groups),
 * identity is compared by fingerprint — display names are not unique, so a
 * same-named peer must still count, and a renamed self must not. DMs carry no
 * fingerprint and fall back to the display name (2-party, unambiguous).
 */
export function countMessagesFromOthers(
  messages: readonly MessageAuthor[],
  ownDeviceName: string,
  ownFingerprint?: string,
): number {
  return messages.filter((message) =>
    ownFingerprint && message.from_fingerprint
      ? message.from_fingerprint !== ownFingerprint
      : message.from_device !== ownDeviceName,
  ).length;
}

/** Builds the toast title/body for a conversation that gained messages. */
export function notificationBody(id: string): { title: string; body: string } {
  const label = id.startsWith("channel:")
    ? `#${id.slice("channel:".length)}`
    : "New message";
  return { title: "Mosh", body: `${label} - new message` };
}

/** A conversation that gained `delta` messages since it was last seen. */
export interface NewMessages {
  readonly id: string;
  readonly delta: number;
}

/** Result of one poll diff. */
export interface UnreadDiff {
  readonly newMessages: readonly NewMessages[];
  readonly nextLastSeen: Map<string, number>;
}

/**
 * Compares the current per-conversation message counts against the
 * last-seen counts and reports which conversations gained messages worth
 * notifying about.
 *
 * A conversation reports new messages when its count grew AND it is not the
 * currently-active conversation — unless the window is unfocused, in which
 * case even the active conversation reports (the user is not looking at it).
 * A conversation seen for the first time never reports (no baseline).
 *
 * `nextLastSeen` always advances every conversation to its current count;
 * callers persist it for the next poll.
 */
export function diffConversations(
  current: readonly ConversationCount[],
  lastSeen: ReadonlyMap<string, number>,
  activeId: string | null,
  windowUnfocused: boolean,
): UnreadDiff {
  const newMessages: NewMessages[] = [];
  const nextLastSeen = new Map<string, number>();
  for (const { id, messageCount } of current) {
    nextLastSeen.set(id, messageCount);
    const previous = lastSeen.get(id);
    if (previous === undefined) {
      continue;
    }
    const delta = messageCount - previous;
    if (delta <= 0) {
      continue;
    }
    const isActive = id === activeId;
    if (isActive && !windowUnfocused) {
      continue;
    }
    newMessages.push({ id, delta });
  }
  return { newMessages, nextLastSeen };
}
