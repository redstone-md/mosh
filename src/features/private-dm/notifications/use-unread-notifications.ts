import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChannelSnapshot,
  GroupSnapshot,
  SessionSnapshot,
} from "../native/native-messaging-gateway";
import {
  countMessagesFromOthers,
  diffConversations,
  notificationBody,
  type ConversationCount,
} from "./unread";

interface UseUnreadNotificationsOptions {
  readonly sessions: readonly SessionSnapshot[];
  readonly channels: readonly ChannelSnapshot[];
  readonly groups: readonly GroupSnapshot[];
  readonly activeKey: string | null;
}

/** Window focus check that degrades to "focused" when the Tauri API is absent. */
async function windowFocused(): Promise<boolean> {
  try {
    return await getCurrentWindow().isFocused();
  } catch {
    return true;
  }
}

export function useUnreadNotifications({
  sessions,
  channels,
  groups,
  activeKey,
}: UseUnreadNotificationsOptions) {
  const [unread, setUnread] = useState<ReadonlyMap<string, number>>(new Map());
  const lastSeenRef = useRef<Map<string, number>>(new Map());
  const notifyReadyRef = useRef(false);

  const notificationsReady = useCallback(() => notifyReadyRef.current, []);

  const clearUnread = useCallback((key: string) => {
    setUnread((current) => {
      if (!current.has(key)) {
        return current;
      }
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        let granted = await isPermissionGranted();
        if (!granted) {
          granted = (await requestPermission()) === "granted";
        }
        notifyReadyRef.current = granted;
      } catch {
        // No Tauri host (e.g. browser dev / tests): toasts stay disabled.
        notifyReadyRef.current = false;
      }
    })();
  }, []);

  useEffect(() => {
    const counts: ConversationCount[] = [
      ...sessions.map((session) => ({
        id: `dm:${session.session_id}`,
        messageCount: countMessagesFromOthers(session.messages, session.display_name),
      })),
      ...groups.map((group) => ({
        id: `group:${group.group_id}`,
        messageCount: countMessagesFromOthers(
          group.messages,
          group.display_name,
          group.device_fingerprint,
        ),
      })),
      ...channels.map((channel) => ({
        id: `channel:${channel.name}`,
        messageCount: countMessagesFromOthers(
          channel.messages,
          channel.display_name,
          channel.device_fingerprint,
        ),
      })),
    ];
    let cancelled = false;
    void (async () => {
      const focused = await windowFocused();
      if (cancelled) {
        return;
      }
      const diff = diffConversations(
        counts,
        lastSeenRef.current,
        activeKey,
        !focused,
      );
      lastSeenRef.current = diff.nextLastSeen;
      if (focused && activeKey) {
        clearUnread(activeKey);
      }
      if (diff.newMessages.length === 0) {
        return;
      }
      setUnread((current) => {
        const next = new Map(current);
        for (const { id, delta } of diff.newMessages) {
          if (id === activeKey && focused) {
            continue;
          }
          next.set(id, (next.get(id) ?? 0) + delta);
        }
        return next;
      });
      if (!focused && notifyReadyRef.current) {
        try {
          for (const { id } of diff.newMessages) {
            sendNotification(notificationBody(id));
          }
        } catch {
          // sendNotification is synchronous (void); this guards its sync throw
          // when the host is unavailable. Unread badges still update.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessions, channels, groups, activeKey, clearUnread]);

  return {
    unread,
    clearUnread,
    notificationsReady,
  };
}
