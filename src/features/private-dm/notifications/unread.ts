/** A conversation and its current total message count. */
export interface ConversationCount {
  readonly id: string;
  readonly messageCount: number;
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
