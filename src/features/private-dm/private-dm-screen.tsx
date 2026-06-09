import {
  IconCheck,
  IconCopy,
  IconCrown,
  IconHash,
  IconLock,
  IconLogout,
  IconMessageCircle,
  IconPhone,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconShieldCheck,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { diffConversations, type ConversationCount } from "./notifications/unread";
import { Avatar } from "./Avatar";
import {
  chatText,
  cryptoNotice,
  inviteText,
  shellText,
  stateLabels,
  channelText,
  groupText,
} from "./private-dm.content";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  closeChatTarget,
  sameChatTarget,
  type ChatTarget,
} from "./chat-actions";
import {
  ConversationTools,
  type ConversationFilter,
  type ConversationToolsState,
} from "./ConversationTools";
import { DiagnosticsDrawer } from "./DiagnosticsDrawer";
import { readableError, shorten } from "./format";
import {
  ChannelChatList,
  DmChatList,
  GroupChatList,
  type PeerActions,
} from "./MessageLists";
import { type OperationKind, useOperationBusy } from "./use-operation-busy";
import {
  useChatOrchestration,
  type AttachmentApi,
} from "./use-chat-orchestration";
import {
  ChannelSnapshot,
  GroupSnapshot,
  NativeMessagingGateway,
  SessionSnapshot,
  nativeMessagingGateway,
} from "./native/native-messaging-gateway";
import { MediaViewer } from "./attachments";
import type { DmOffer } from "./native/native-messaging-gateway";
import { ChatDropZone, Composer } from "./ChatComposer";
import { CallOverlay } from "./voice-call/CallOverlay";
import { IncomingCallModal } from "./voice-call/IncomingCallModal";
import { OutgoingCallModal } from "./voice-call/OutgoingCallModal";
import { NewSessionPanel } from "./NewSessionPanel";
import {
  CALLEE_DIRECTION_BIT,
  CALLER_DIRECTION_BIT,
  bytesFromBase64,
  bytesToBase64,
  importCallKey,
  openFrame,
  sealFrame,
} from "./voice-call/frame-crypto";
import { JitterBuffer } from "./voice-call/jitter-buffer";
import {
  isCallAudioSupported,
  startVoiceCapture,
  type VoiceCaptureHandle,
} from "./voice-call/audio-capture";
import {
  startVoicePlayback,
  type VoicePlaybackHandle,
} from "./voice-call/audio-playback";

type PendingDmOffer = DmOffer & {
  readonly kind: "channel" | "group";
  readonly host: string;
};

const AUTO_POLL_MS = 1000;
const READY_STATE = "ready";
const DEFAULT_LISTEN_PORT = 0;

interface PendingCloseConfirmation {
  readonly item: ChatTarget;
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
}

/** Stable per-conversation key used for unread tracking and notifications. */
function conversationKey(item: ChatTarget): string {
  return item.type === "channel"
    ? `channel:${item.name}`
    : `${item.type}:${item.id}`;
}

function closeConfirmationFor(
  item: ChatTarget,
  sessions: readonly SessionSnapshot[],
  channels: readonly ChannelSnapshot[],
  groups: readonly GroupSnapshot[],
): PendingCloseConfirmation {
  if (item.type === "dm") {
    const session = sessions.find((candidate) => candidate.session_id === item.id);
    const label = session ? peerLabel(session) : "this private chat";
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

/** Window focus check that degrades to "focused" when the Tauri API is absent. */
async function windowFocused(): Promise<boolean> {
  try {
    return await getCurrentWindow().isFocused();
  } catch {
    return true;
  }
}

interface GroupCreateState {
  readonly inviteUri?: string;
  readonly copied: boolean;
}

function defaultDisplayName(): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `mosh-${suffix}`;
}

interface CreateState {
  readonly inviteUri?: string;
  readonly copied: boolean;
}

export function PrivateDmScreen({
  gateway = nativeMessagingGateway,
}: {
  gateway?: NativeMessagingGateway;
}) {
  const [displayName, setDisplayName] = useState(defaultDisplayName);
  const [staticPeer, setStaticPeer] = useState("");
  const [listenPort, setListenPort] = useState<number>(DEFAULT_LISTEN_PORT);
  const [composer, setComposer] = useState("");
  const [sessions, setSessions] = useState<readonly SessionSnapshot[]>([]);
  const [channels, setChannels] = useState<readonly ChannelSnapshot[]>([]);
  const [groups, setGroups] = useState<readonly GroupSnapshot[]>([]);
  const [active, setActive] = useState<ChatTarget | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [conversationSearch, setConversationSearch] = useState("");
  const [conversationFilter, setConversationFilter] = useState<ConversationFilter>("all");
  const [pendingClose, setPendingClose] = useState<PendingCloseConfirmation | null>(null);
  const [confirmedFingerprints, setConfirmedFingerprints] = useState<Set<string>>(new Set());
  const [createState, setCreateState] = useState<CreateState>({ copied: false });
  const [groupCreateState, setGroupCreateState] = useState<GroupCreateState>({ copied: false });
  const [error, setError] = useState<string | undefined>(undefined);
  const { counts: operationCounts, runOperation } = useOperationBusy();
  const [showSetup, setShowSetup] = useState(false);
  const [offeredFingerprints, setOfferedFingerprints] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const pollInFlight = useRef(false);
  const pollPending = useRef(false);
  const refreshRef = useRef<((quiet?: boolean) => Promise<void>) | null>(null);
  const [unread, setUnread] = useState<ReadonlyMap<string, number>>(new Map());
  const lastSeenRef = useRef<Map<string, number>>(new Map());
  const notifyReadyRef = useRef(false);
  const callCaptureRef = useRef<VoiceCaptureHandle | null>(null);
  const callPlaybackRef = useRef<VoicePlaybackHandle | null>(null);
  const callKeyRef = useRef<CryptoKey | null>(null);
  const callSeqRef = useRef<bigint>(0n);
  const callJitterRef = useRef<JitterBuffer | null>(null);
  const callPollRef = useRef<number | undefined>(undefined);
  const callMutedRef = useRef(false);
  const [callMuted, setCallMuted] = useState(false);
  const refreshBusy = operationCounts.refresh > 0;
  const setupBusy = operationCounts.setup > 0;
  const messageBusy = operationCounts.message > 0;
  const transferBusy = operationCounts.transfer > 0;
  const sessionBusy = operationCounts.session > 0;
  const offerBusy = operationCounts.offer > 0;
  const chatBusy = messageBusy || sessionBusy;

  const requestBase = useMemo(
    () => ({
      display_name: displayName.trim() || defaultDisplayName(),
      listen_port: Number.isFinite(listenPort) ? listenPort : DEFAULT_LISTEN_PORT,
      static_peer: staticPeer.trim() ? staticPeer.trim() : null,
    }),
    [displayName, listenPort, staticPeer],
  );

  const refresh = useCallback(
    async (quiet = false) => {
      if (pollInFlight.current) {
        // Coalesce: remember that another refresh was requested so we can
        // run it once the in-flight call completes. Without this, a rapid
        // burst of session/channel/group mutations could leave the UI
        // showing a stale roster until the next AUTO_POLL_MS tick.
        pollPending.current = true;
        return;
      }
      pollInFlight.current = true;
      if (!quiet) {
        setError(undefined);
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
        setActive((current) => {
          if (current?.type === "dm" && sessionList.sessions.some((s) => s.session_id === current.id)) {
            return current;
          }
          if (current?.type === "channel" && channelList.channels.some((c) => c.name === current.name)) {
            return current;
          }
          if (current?.type === "group" && groupList.groups.some((g) => g.group_id === current.id)) {
            return current;
          }
          if (sessionList.sessions.length > 0) {
            return { type: "dm", id: sessionList.sessions[0].session_id };
          }
          if (groupList.groups.length > 0) {
            return { type: "group", id: groupList.groups[0].group_id };
          }
          if (channelList.channels.length > 0) {
            return { type: "channel", name: channelList.channels[0].name };
          }
          return null;
        });
      };
      try {
        await (quiet ? loadSnapshots() : runOperation("refresh", loadSnapshots));
      } catch (err) {
        setError(readableError(err));
      } finally {
        pollInFlight.current = false;
        if (pollPending.current && refreshRef.current) {
          pollPending.current = false;
          const followUp = refreshRef.current;
          // Defer so the next refresh runs on a fresh task and does not
          // recursively extend the current finally block.
          window.setTimeout(() => void followUp(true), 0);
        }
      }
    },
    [gateway, runOperation],
  );
  refreshRef.current = refresh;

  useEffect(() => {
    void refresh(true);
    const intervalId = window.setInterval(() => void refresh(true), AUTO_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [refresh]);

  // Ask for OS notification permission once on mount.
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

  // Diff each poll's per-conversation message counts to drive unread badges
  // and OS toasts. A first-seen conversation sets a baseline and never
  // notifies. While the window is focused, the active conversation is kept
  // clear; while unfocused, every new message raises a toast.
  useEffect(() => {
    const counts: ConversationCount[] = [
      ...sessions.map((s) => ({
        id: `dm:${s.session_id}`,
        messageCount: s.messages.length,
      })),
      ...groups.map((g) => ({
        id: `group:${g.group_id}`,
        messageCount: g.messages.length,
      })),
      ...channels.map((c) => ({
        id: `channel:${c.name}`,
        messageCount: c.messages.length,
      })),
    ];
    const activeKey = active ? conversationKey(active) : null;
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
        setUnread((current) => {
          if (!current.has(activeKey)) {
            return current;
          }
          const next = new Map(current);
          next.delete(activeKey);
          return next;
        });
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
            const label = id.startsWith("channel:")
              ? `#${id.slice("channel:".length)}`
              : "New message";
            sendNotification({ title: "Mosh", body: `${label} — new message` });
          }
        } catch {
          // Notification host unavailable — unread badges still update.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessions, channels, groups, active]);

  const activeSession =
    active?.type === "dm" ? sessions.find((s) => s.session_id === active.id) ?? null : null;
  const activeChannel =
    active?.type === "channel" ? channels.find((c) => c.name === active.name) ?? null : null;
  const activeGroup =
    active?.type === "group" ? groups.find((g) => g.group_id === active.id) ?? null : null;
  const activeAttachments =
    activeSession?.attachments ??
    activeChannel?.attachments ??
    activeGroup?.attachments ??
    [];
  const {
    attachmentApi,
    canRetrySend,
    clearFailedSend,
    retryFailedSend,
    sendMessage,
    setViewer,
    viewer,
  } = useChatOrchestration({
    active,
    activeAttachments,
    composer,
    gateway,
    refresh,
    runOperation,
    setComposer,
    transferBusy,
    onError: setError,
  });

  const run = async (
    kind: OperationKind,
    action: () => Promise<void>,
    onError?: (message: string) => void,
  ) => {
    setError(undefined);
    if (kind !== "message") {
      clearFailedSend();
    }
    try {
      await runOperation(kind, action);
    } catch (err) {
      const message = readableError(err);
      setError(message);
      onError?.(message);
    }
  };

  const createInvite = () =>
    run("setup", async () => {
      const invite = await gateway.createPrivateInvite(requestBase);
      await copyText(invite.invite_uri);
      setCreateState({ inviteUri: invite.invite_uri, copied: true });
      setActive({ type: "dm", id: invite.session_id });
      setShowSetup(true);
      await refresh(true);
    });

  const acceptInvite = (uri: string) =>
    run("setup", async () => {
      const trimmed = uri.trim();
      if (!trimmed) {
        return;
      }
      const snapshot = await gateway.acceptPrivateInvite({
        ...requestBase,
        invite_uri: trimmed,
      });
      setActive({ type: "dm", id: snapshot.session_id });
      setShowSetup(false);
      await refresh(true);
    });

  const joinChannel = (name: string) =>
    run("setup", async () => {
      const trimmed = name.trim();
      if (!trimmed) {
        return;
      }
      const snapshot = await gateway.joinChannel({
        ...requestBase,
        name: trimmed,
      });
      setActive({ type: "channel", name: snapshot.name });
      setShowSetup(false);
      await refresh(true);
    });

  const createGroup = (label: string) =>
    run("setup", async () => {
      const created = await gateway.createPrivateGroup({
        ...requestBase,
        label: label.trim() || null,
      });
      await copyText(created.invite_uri);
      setGroupCreateState({ inviteUri: created.invite_uri, copied: true });
      setActive({ type: "group", id: created.group_id });
      setShowSetup(true);
      await refresh(true);
    });

  const joinGroup = (uri: string) =>
    run("setup", async () => {
      const trimmed = uri.trim();
      if (!trimmed) {
        return;
      }
      const snapshot = await gateway.joinPrivateGroup({
        ...requestBase,
        invite_uri: trimmed,
      });
      setActive({ type: "group", id: snapshot.group_id });
      setShowSetup(false);
      await refresh(true);
    });

  const copyGroupInvite = async () => {
    const uri = groupCreateState.inviteUri;
    if (!uri) {
      return;
    }
    await copyText(uri);
    setGroupCreateState((state) => ({ ...state, copied: true }));
  };

  const copyInvite = async () => {
    const uri = createState.inviteUri;
    if (!uri) {
      return;
    }
    await copyText(uri);
    setCreateState((state) => ({ ...state, copied: true }));
  };

  const closeActive = () => {
    if (!active) {
      return;
    }
    setPendingClose(closeConfirmationFor(active, sessions, channels, groups));
  };

  const confirmCloseActive = () => {
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
  };

  const confirmFingerprint = (sessionId: string) =>
    setConfirmedFingerprints((current) => new Set(current).add(sessionId));

  const startCall = useCallback(
    (sessionId: string) => {
      void (async () => {
        try {
          await gateway.callStart(sessionId);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not start call");
        }
      })();
    },
    [gateway],
  );
  const acceptCall = useCallback(
    (sessionId: string, callId: string) => {
      void (async () => {
        try {
          await gateway.callAccept(sessionId, callId);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not accept call");
        }
      })();
    },
    [gateway],
  );
  const declineCall = useCallback(
    (sessionId: string, callId: string, reason: string) => {
      void gateway.callDecline(sessionId, callId, reason).catch((err) => {
        setError(err instanceof Error ? err.message : "Could not decline call");
      });
    },
    [gateway],
  );
  const endCall = useCallback(
    (sessionId: string, callId: string, reason: string) => {
      void gateway.callEnd(sessionId, callId, reason).catch((err) => {
        setError(err instanceof Error ? err.message : "Could not end call");
      });
    },
    [gateway],
  );

  // Initiate a private DM with a member seen in a channel or group: mint an
  // invite and publish it as an offer the targeted peer can accept.
  const offerDm = (targetFingerprint: string) => {
    if (!active || active.type === "dm" || offeredFingerprints.has(targetFingerprint)) {
      return;
    }
    const target = active;
    void run("offer", async () => {
      const invite = await gateway.createPrivateInvite(requestBase);
      if (target.type === "channel") {
        await gateway.sendChannelDmOffer(target.name, targetFingerprint, invite.invite_uri);
      } else {
        await gateway.sendGroupDmOffer(target.id, targetFingerprint, invite.invite_uri);
      }
      setOfferedFingerprints((prev) => new Set(prev).add(targetFingerprint));
      setActive({ type: "dm", id: invite.session_id });
      setShowSetup(false);
      await refresh(true);
    });
  };

  const acceptDmOffer = (offer: PendingDmOffer) => {
    void run("offer", async () => {
      const snapshot = await gateway.acceptPrivateInvite({
        ...requestBase,
        invite_uri: offer.invite_uri,
      });
      if (offer.kind === "channel") {
        await gateway.dismissChannelDmOffer(offer.host, offer.offer_id);
      } else {
        await gateway.dismissGroupDmOffer(offer.host, offer.offer_id);
      }
      setActive({ type: "dm", id: snapshot.session_id });
      setShowSetup(false);
      await refresh(true);
    });
  };

  const dismissDmOffer = (offer: PendingDmOffer) => {
    void run("offer", async () => {
      if (offer.kind === "channel") {
        await gateway.dismissChannelDmOffer(offer.host, offer.offer_id);
      } else {
        await gateway.dismissGroupDmOffer(offer.host, offer.offer_id);
      }
      await refresh(true);
    });
  };

  const pendingOffers: PendingDmOffer[] = [
    ...channels.flatMap((channel) =>
      channel.dm_offers.map((offer) => ({
        ...offer,
        kind: "channel" as const,
        host: channel.name,
      })),
    ),
    ...groups.flatMap((group) =>
      group.dm_offers.map((offer) => ({
        ...offer,
        kind: "group" as const,
        host: group.group_id,
      })),
    ),
  ];

  const showWelcome = (!activeSession && !activeChannel && !activeGroup) || showSetup;
  const activeConversationKey = active ? conversationKey(active) : "";
  const conversationTools: ConversationToolsState = {
    search: conversationSearch,
    filter: conversationFilter,
    onSearch: setConversationSearch,
    onFilter: setConversationFilter,
  };

  useEffect(() => {
    setConversationSearch("");
    setConversationFilter("all");
  }, [activeConversationKey]);

  const pendingCallSession = sessions.find((session) => session.pending_call);
  const activeDmSession = activeSession;
  const activeCall = activeDmSession?.active_call ?? null;
  const activeCallSessionId = activeDmSession?.session_id ?? null;
  const callSupported = isCallAudioSupported();
  const activeCallId = activeCall?.call_id ?? null;
  const activeCallKey = activeCall?.key_b64 ?? null;
  const activeCallNoncePrefix = activeCall?.nonce_prefix_b64 ?? null;
  const activeCallDirection = activeCall?.direction ?? null;

  useEffect(() => {
    if (
      !activeCallSessionId ||
      !activeCallId ||
      !activeCallKey ||
      !activeCallNoncePrefix ||
      !activeCallDirection
    ) {
      return;
    }
    let cancelled = false;
    const direction =
      activeCallDirection === "caller"
        ? CALLER_DIRECTION_BIT
        : CALLEE_DIRECTION_BIT;
    const sessionId = activeCallSessionId;
    const callId = activeCallId;
    const noncePrefix = activeCallNoncePrefix;
    void (async () => {
      try {
        callKeyRef.current = await importCallKey(activeCallKey);
        callSeqRef.current = 0n;
        callJitterRef.current = new JitterBuffer();
        callPlaybackRef.current = await startVoicePlayback();
        callCaptureRef.current = await startVoiceCapture((frame) => {
          if (cancelled || !callKeyRef.current || callMutedRef.current) {
            return;
          }
          void (async () => {
            const seal = await sealFrame(
              callKeyRef.current!,
              noncePrefix,
              callSeqRef.current,
              direction,
              frame,
            );
            callSeqRef.current += 1n;
            try {
              await gateway.callSendFrame(
                sessionId,
                callId,
                bytesToBase64(seal),
              );
            } catch (err) {
              console.warn("[voice-call] send failed", err);
            }
          })();
        });
        callPollRef.current = window.setInterval(() => {
          void (async () => {
            try {
              const frames = await gateway.callDrainFrames(sessionId, callId);
              if (frames.length === 0 || !callKeyRef.current) {
                return;
              }
              for (const frameB64 of frames) {
                const opened = await openFrame(
                  callKeyRef.current,
                  noncePrefix,
                  bytesFromBase64(frameB64),
                );
                if (opened) {
                  callJitterRef.current?.push({
                    seq: opened.seq,
                    payload: opened.payload,
                  });
                }
              }
              const ready = callJitterRef.current?.drainReady() ?? [];
              for (const buffered of ready) {
                callPlaybackRef.current?.pushFrame(buffered.payload);
              }
            } catch (err) {
              console.warn("[voice-call] poll failed", err);
            }
          })();
        }, 20);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Voice call setup failed");
        endCall(sessionId, callId, "setup_failed");
      }
    })();

    return () => {
      cancelled = true;
      if (callPollRef.current !== undefined) {
        window.clearInterval(callPollRef.current);
        callPollRef.current = undefined;
      }
      void callCaptureRef.current?.stop();
      void callPlaybackRef.current?.stop();
      callCaptureRef.current = null;
      callPlaybackRef.current = null;
      callKeyRef.current = null;
      callJitterRef.current = null;
      setCallMuted(false);
      callMutedRef.current = false;
    };
  }, [
    activeCallSessionId,
    activeCallId,
    activeCallKey,
    activeCallNoncePrefix,
    activeCallDirection,
    endCall,
    gateway,
  ]);

  useEffect(() => {
    if (!pendingCallSession?.pending_call) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const focused = await getCurrentWindow().isFocused();
        if (cancelled || focused || !notifyReadyRef.current) {
          return;
        }
        sendNotification({
          title: "Mosh",
          body: `Incoming call from ${pendingCallSession.display_name}`,
        });
      } catch {
        // Notification host unavailable; the in-app modal is the user's signal.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    pendingCallSession?.session_id,
    pendingCallSession?.pending_call?.call_id,
    pendingCallSession?.display_name,
  ]);

  return (
    <main className="mosh-window" aria-label={shellText.productName}>
      <header className="titlebar">
        <div className="brand">
          <IconShieldCheck size={18} />
          <strong>{shellText.productName}</strong>
        </div>
        <span className="titlebar-subtitle">{shellText.windowSubtitle}</span>
        <button
          className="btn btn-ghost titlebar-action"
          type="button"
          onClick={() => setShowDiagnostics(true)}
          aria-label="Open peer status"
        >
          <IconPlugConnected size={14} />
          <span>Peer status</span>
        </button>
        {activeSession ? (
          <StatePill
            state={activeSession.state}
            label={stateLabels[activeSession.state] ?? activeSession.state}
          />
        ) : activeChannel ? (
          <span className="state-pill state-pill-ready">
            <span className="state-dot" />
            {channelText.broadcastBadge}
          </span>
        ) : activeGroup ? (
          <StatePill
            state={activeGroup.state}
            label={stateLabels[activeGroup.state] ?? activeGroup.state}
          />
        ) : null}
      </header>

      <div className="desktop-body">
        <SessionRail
          sessions={sessions}
          channels={channels}
          groups={groups}
          offers={pendingOffers}
          active={active}
          unread={unread}
          onSelect={(item) => {
            setActive(item);
            setShowSetup(false);
            const key = conversationKey(item);
            setUnread((current) => {
              if (!current.has(key)) {
                return current;
              }
              const next = new Map(current);
              next.delete(key);
              return next;
            });
          }}
          onAcceptOffer={acceptDmOffer}
          onDismissOffer={dismissDmOffer}
          onNew={() => {
            setShowSetup(true);
            setActive(null);
            setCreateState({ copied: false });
            setGroupCreateState({ copied: false });
          }}
        />

        <section className="chat-pane" aria-labelledby="chat-title">
          {!showWelcome && error ? (
            <ChatError
              message={error}
              onRetry={canRetrySend ? retryFailedSend : undefined}
            />
          ) : null}
          {showWelcome ? (
            <NewSessionPanel
              displayName={displayName}
              staticPeer={staticPeer}
              listenPort={listenPort}
              busy={setupBusy}
              createState={createState}
              groupCreateState={groupCreateState}
              error={error}
              gateway={gateway}
              onDisplayName={setDisplayName}
              onStaticPeer={setStaticPeer}
              onListenPort={setListenPort}
              onCreate={createInvite}
              onAccept={acceptInvite}
              onJoinChannel={joinChannel}
              onCreateGroup={createGroup}
              onJoinGroup={joinGroup}
              onCopyInvite={copyInvite}
              onCopyGroupInvite={copyGroupInvite}
            />
          ) : activeSession ? (
            <ActiveDmChat
              session={activeSession}
              composer={composer}
              confirmed={confirmedFingerprints.has(activeSession.session_id)}
              busy={chatBusy}
              attachments={attachmentApi}
              tools={conversationTools}
              onComposer={setComposer}
              onSend={sendMessage}
              onConfirm={() => confirmFingerprint(activeSession.session_id)}
              onClose={closeActive}
              callSupported={callSupported}
              callBusy={!!activeSession.active_call}
              onStartCall={() => startCall(activeSession.session_id)}
            />
          ) : activeChannel ? (
            <ActiveChannelChat
              channel={activeChannel}
              composer={composer}
              busy={chatBusy}
              attachments={attachmentApi}
              tools={conversationTools}
              peer={{
                ownFingerprint: activeChannel.device_fingerprint,
                offered: offeredFingerprints,
                busy: offerBusy,
                onMessage: offerDm,
              }}
              onComposer={setComposer}
              onSend={sendMessage}
              onClose={closeActive}
            />
          ) : activeGroup ? (
            <ActiveGroupChat
              group={activeGroup}
              composer={composer}
              busy={chatBusy}
              attachments={attachmentApi}
              tools={conversationTools}
              peer={{
                ownFingerprint: activeGroup.device_fingerprint,
                offered: offeredFingerprints,
                busy: offerBusy,
                onMessage: offerDm,
              }}
              onComposer={setComposer}
              onSend={sendMessage}
              onClose={closeActive}
            />
          ) : (
            <EmptyState onNew={() => setShowSetup(true)} />
          )}
        </section>

      </div>

      {showDiagnostics ? (
        <DiagnosticsDrawer
          session={activeSession}
          channel={activeChannel}
          group={activeGroup}
          error={error}
          refreshing={refreshBusy}
          onRefresh={() => void refresh(false)}
          onClose={() => setShowDiagnostics(false)}
        />
      ) : null}

      {viewer ? (
        <MediaViewer
          descriptor={viewer.descriptor}
          src={viewer.src}
          onClose={() => setViewer(null)}
        />
      ) : null}

      {pendingClose ? (
        <ConfirmDialog
          title={pendingClose.title}
          body={pendingClose.body}
          confirmLabel={pendingClose.confirmLabel}
          onCancel={() => setPendingClose(null)}
          onConfirm={confirmCloseActive}
        />
      ) : null}

      {pendingCallSession?.pending_call ? (
        <IncomingCallModal
          pending={pendingCallSession.pending_call}
          peerLabel={pendingCallSession.pending_call.from_device || "Peer"}
          onAccept={() =>
            acceptCall(
              pendingCallSession.session_id,
              pendingCallSession.pending_call!.call_id,
            )
          }
          onDecline={(reason) =>
            declineCall(
              pendingCallSession.session_id,
              pendingCallSession.pending_call!.call_id,
              reason,
            )
          }
        />
      ) : null}
      {activeDmSession?.outgoing_call && !activeCall ? (
        <OutgoingCallModal
          callId={activeDmSession.outgoing_call.call_id}
          peerLabel={activeDmSession.peer_display_name || "Peer"}
          onCancel={() =>
            endCall(
              activeDmSession.session_id,
              activeDmSession.outgoing_call!.call_id,
              "hangup",
            )
          }
        />
      ) : null}
      {activeCall && activeCallSessionId && activeDmSession ? (
        <CallOverlay
          active={activeCall}
          peerLabel={activeDmSession.peer_display_name || "Peer"}
          muted={callMuted}
          onToggleMute={() => {
            const next = !callMuted;
            setCallMuted(next);
            callMutedRef.current = next;
          }}
          onHangUp={() =>
            endCall(activeCallSessionId, activeCall.call_id, "hangup")
          }
        />
      ) : null}
    </main>
  );
}

function SessionRail({
  sessions,
  channels,
  groups,
  offers,
  active,
  unread,
  onSelect,
  onAcceptOffer,
  onDismissOffer,
  onNew,
}: {
  sessions: readonly SessionSnapshot[];
  channels: readonly ChannelSnapshot[];
  groups: readonly GroupSnapshot[];
  offers: readonly PendingDmOffer[];
  active: ChatTarget | null;
  unread: ReadonlyMap<string, number>;
  onSelect: (item: ChatTarget) => void;
  onAcceptOffer: (offer: PendingDmOffer) => void;
  onDismissOffer: (offer: PendingDmOffer) => void;
  onNew: () => void;
}) {
  return (
    <aside className="session-rail" aria-label="Active sessions">
      <button className="rail-new" type="button" onClick={onNew} aria-label={shellText.newSession}>
        <IconPlus size={18} />
      </button>
      <div className="rail-divider" />
      <div className="rail-list">
        {offers.map((offer) => (
          <OfferRailItem
            key={`offer-${offer.offer_id}`}
            offer={offer}
            onAccept={() => onAcceptOffer(offer)}
            onDismiss={() => onDismissOffer(offer)}
          />
        ))}
        {offers.length > 0 ? <div className="rail-divider" /> : null}
        {sessions.map((session) => (
          <SessionRailItem
            key={`dm-${session.session_id}`}
            session={session}
            active={active?.type === "dm" && active.id === session.session_id}
            unreadCount={unread.get(`dm:${session.session_id}`) ?? 0}
            onClick={() => onSelect({ type: "dm", id: session.session_id })}
          />
        ))}
        {groups.length > 0 && sessions.length > 0 ? <div className="rail-divider" /> : null}
        {groups.map((group) => (
          <GroupRailItem
            key={`gr-${group.group_id}`}
            group={group}
            active={active?.type === "group" && active.id === group.group_id}
            unreadCount={unread.get(`group:${group.group_id}`) ?? 0}
            onClick={() => onSelect({ type: "group", id: group.group_id })}
          />
        ))}
        {channels.length > 0 && (sessions.length > 0 || groups.length > 0) ? (
          <div className="rail-divider" />
        ) : null}
        {channels.map((channel) => (
          <ChannelRailItem
            key={`ch-${channel.name}`}
            channel={channel}
            active={active?.type === "channel" && active.name === channel.name}
            unreadCount={unread.get(`channel:${channel.name}`) ?? 0}
            onClick={() => onSelect({ type: "channel", name: channel.name })}
          />
        ))}
      </div>
    </aside>
  );
}

function OfferRailItem({
  offer,
  onAccept,
  onDismiss,
}: {
  offer: PendingDmOffer;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="rail-offer">
      <button
        type="button"
        className="rail-item rail-offer-accept"
        onClick={onAccept}
        title={`${offer.from_device} wants to chat — accept`}
        aria-label={`Accept chat invite from ${offer.from_device}`}
      >
        <Avatar name={offer.from_device} />
        <span className="rail-offer-badge" aria-hidden="true">
          <IconMessageCircle size={10} />
        </span>
      </button>
      <button
        type="button"
        className="rail-offer-dismiss"
        onClick={onDismiss}
        title="Dismiss invite"
        aria-label={`Dismiss invite from ${offer.from_device}`}
      >
        <IconX size={10} />
      </button>
    </div>
  );
}

/** Small overlay badge showing a conversation's unread message count. */
function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) {
    return null;
  }
  return (
    <span className="unread-badge" aria-label={`${count} unread`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

function SessionRailItem({
  session,
  active,
  unreadCount,
  onClick,
}: {
  session: SessionSnapshot;
  active: boolean;
  unreadCount: number;
  onClick: () => void;
}) {
  const label = peerLabel(session);
  return (
    <button
      type="button"
      className={`rail-item ${active ? "rail-item-active" : ""}`}
      onClick={onClick}
      title={`${label} · ${stateLabels[session.state] ?? session.state}`}
      aria-label={`Open session with ${label}`}
    >
      <Avatar name={label} />
      <span className={`rail-dot rail-dot-${session.state}`} />
      <UnreadBadge count={unreadCount} />
    </button>
  );
}

function ChannelRailItem({
  channel,
  active,
  unreadCount,
  onClick,
}: {
  channel: ChannelSnapshot;
  active: boolean;
  unreadCount: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`rail-item rail-channel ${active ? "rail-item-active" : ""}`}
      onClick={onClick}
      title={`#${channel.name}`}
      aria-label={`Open channel ${channel.name}`}
    >
      <IconHash size={18} />
      <UnreadBadge count={unreadCount} />
    </button>
  );
}

function GroupRailItem({
  group,
  active,
  unreadCount,
  onClick,
}: {
  group: GroupSnapshot;
  active: boolean;
  unreadCount: number;
  onClick: () => void;
}) {
  const label = group.label ?? shorten(group.group_id, 6);
  return (
    <button
      type="button"
      className={`rail-item rail-group ${active ? "rail-item-active" : ""}`}
      onClick={onClick}
      title={`${label} · ${group.member_count} members${group.is_admin ? " · admin" : ""}`}
      aria-label={`Open group ${label}`}
    >
      <IconUsers size={18} />
      {group.is_admin ? (
        <span className="rail-admin-crown" title={groupText.adminBadge}>
          <IconCrown size={11} />
        </span>
      ) : null}
      <span className={`rail-dot rail-dot-${group.state}`} />
      <UnreadBadge count={unreadCount} />
    </button>
  );
}

function ActiveDmChat(props: {
  session: SessionSnapshot;
  composer: string;
  confirmed: boolean;
  busy: boolean;
  attachments: AttachmentApi;
  tools: ConversationToolsState;
  onComposer: (value: string) => void;
  onSend: (event: FormEvent) => void;
  onConfirm: () => void;
  onClose: () => void;
  callSupported: boolean;
  callBusy: boolean;
  onStartCall: () => void;
}) {
  const ready = props.session.state === READY_STATE;
  const peerName = peerLabel(props.session);
  return (
    <>
      <header className="chat-header">
        <Avatar name={peerName} />
        <div className="chat-title-block">
          <h1 id="chat-title">{peerName}</h1>
          <p>
            {props.confirmed
              ? `MLS ${props.session.state} · fingerprint confirmed`
              : `MLS ${props.session.state} · fingerprint unverified`}
          </p>
        </div>
        <div className="chat-header-actions">
          <FingerprintBadge
            fingerprint={props.session.fingerprint}
            confirmed={props.confirmed}
            onConfirm={props.onConfirm}
          />
          <button
            className="btn btn-ghost btn-icon"
            type="button"
            aria-label="Start voice call"
            title={
              props.callSupported
                ? "Start voice call"
                : "Voice calls require a newer WebView"
            }
            disabled={
              !props.callSupported || props.callBusy || props.busy || !ready
            }
            onClick={props.onStartCall}
          >
            <IconPhone size={16} />
          </button>
          <button
            className="btn btn-ghost btn-icon"
            type="button"
            onClick={props.onClose}
            aria-label={shellText.closeSession}
            title={shellText.closeSession}
          >
            <IconX size={16} />
          </button>
        </div>
      </header>

      <CryptoNotice />
      <ConversationTools tools={props.tools} />

      <ChatDropZone disabled={!ready || props.busy} onAttach={props.attachments.onSend}>
        <DmChatList
          messages={props.session.messages}
          attachments={props.attachments}
          tools={props.tools}
        />
      </ChatDropZone>

      <Composer
        value={props.composer}
        onChange={props.onComposer}
        onSend={props.onSend}
        onAttach={props.attachments.onSend}
        onSendVoice={props.attachments.onSendVoice}
        onVoiceError={props.attachments.onVoiceError}
        disabled={!ready || props.busy}
        sending={props.busy}
      />
    </>
  );
}

function ActiveChannelChat(props: {
  channel: ChannelSnapshot;
  composer: string;
  busy: boolean;
  attachments: AttachmentApi;
  tools: ConversationToolsState;
  peer: PeerActions;
  onComposer: (value: string) => void;
  onSend: (event: FormEvent) => void;
  onClose: () => void;
}) {
  return (
    <>
      <header className="chat-header">
        <div className="channel-icon">
          <IconHash size={18} />
        </div>
        <div className="chat-title-block">
          <h1 id="chat-title">{props.channel.name}</h1>
          <p>{channelText.subtitle}</p>
        </div>
        <div className="chat-header-actions">
          <button
            className="btn btn-ghost btn-icon"
            type="button"
            onClick={props.onClose}
            aria-label={channelText.leaveLabel}
            title={channelText.leaveLabel}
          >
            <IconLogout size={16} />
          </button>
        </div>
      </header>

      <PublicNotice />
      <ConversationTools tools={props.tools} />

      <ChatDropZone disabled={props.busy} onAttach={props.attachments.onSend}>
        <ChannelChatList
          messages={props.channel.messages}
          attachments={props.attachments}
          tools={props.tools}
          peer={props.peer}
        />
      </ChatDropZone>

      <Composer
        value={props.composer}
        onChange={props.onComposer}
        onSend={props.onSend}
        onAttach={props.attachments.onSend}
        onSendVoice={props.attachments.onSendVoice}
        onVoiceError={props.attachments.onVoiceError}
        disabled={props.busy}
        sending={props.busy}
      />
    </>
  );
}

function ActiveGroupChat(props: {
  group: GroupSnapshot;
  composer: string;
  busy: boolean;
  attachments: AttachmentApi;
  tools: ConversationToolsState;
  peer: PeerActions;
  onComposer: (value: string) => void;
  onSend: (event: FormEvent) => void;
  onClose: () => void;
}) {
  const ready = props.group.state === READY_STATE;
  const label = props.group.label ?? groupText.untitled;
  const inviteUri = props.group.invite_uri;
  const [inviteCopied, setInviteCopied] = useState(false);
  const inviteCopyTimer = useRef<number | null>(null);
  useEffect(() => {
    setInviteCopied(false);
    return () => {
      if (inviteCopyTimer.current) {
        window.clearTimeout(inviteCopyTimer.current);
        inviteCopyTimer.current = null;
      }
    };
  }, [inviteUri]);
  const copyGroupInvite = () => {
    if (!inviteUri) {
      return;
    }
    void copyText(inviteUri).then(() => {
      setInviteCopied(true);
      if (inviteCopyTimer.current) {
        window.clearTimeout(inviteCopyTimer.current);
      }
      inviteCopyTimer.current = window.setTimeout(() => {
        setInviteCopied(false);
        inviteCopyTimer.current = null;
      }, 1600);
    });
  };
  return (
    <>
      <header className="chat-header">
        <div className="group-icon">
          <IconUsers size={18} />
        </div>
        <div className="chat-title-block">
          <h1 id="chat-title">{label}</h1>
          <p>
            {props.group.is_admin ? `${groupText.adminBadge} · ` : ""}
            {`${props.group.member_count} member${props.group.member_count === 1 ? "" : "s"} · MLS ${
              props.group.state
            }`}
          </p>
        </div>
        <div className="chat-header-actions">
          {props.group.is_admin ? (
            <span className="admin-pill" title={groupText.adminBadge}>
              <IconCrown size={14} />
              <span>{groupText.adminBadge}</span>
            </span>
          ) : null}
          {inviteUri ? (
            <button
              className="btn btn-ghost btn-icon"
              type="button"
              onClick={copyGroupInvite}
              aria-label={inviteCopied ? groupText.copyInviteDone : groupText.copyInvite}
              title={inviteCopied ? groupText.copyInviteDone : groupText.copyInvite}
            >
              {inviteCopied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </button>
          ) : null}
          <button
            className="btn btn-ghost btn-icon"
            type="button"
            onClick={props.onClose}
            aria-label={groupText.leaveLabel}
            title={groupText.leaveLabel}
          >
            <IconLogout size={16} />
          </button>
        </div>
      </header>

      <GroupNotice />
      <ConversationTools tools={props.tools} />

      <ChatDropZone disabled={!ready || props.busy} onAttach={props.attachments.onSend}>
        <GroupChatList
          messages={props.group.messages}
          attachments={props.attachments}
          tools={props.tools}
          peer={props.peer}
        />
      </ChatDropZone>

      <Composer
        value={props.composer}
        onChange={props.onComposer}
        onSend={props.onSend}
        onAttach={props.attachments.onSend}
        onSendVoice={props.attachments.onSendVoice}
        onVoiceError={props.attachments.onVoiceError}
        disabled={!ready || props.busy}
        sending={props.busy}
      />
    </>
  );
}

function GroupNotice() {
  return (
    <section className="crypto-banner crypto-banner-group" aria-label={groupText.noticeTitle}>
      <div className="crypto-icon">
        <IconLock size={18} />
      </div>
      <div>
        <strong>{groupText.noticeTitle}</strong>
        <p>{groupText.noticeBody}</p>
      </div>
    </section>
  );
}

function EmptyState({
  onNew,
}: {
  onNew: () => void;
}) {
  return (
    <div className="chat-empty welcome-empty">
      <IconMessageCircle size={28} />
      <strong>{chatText.noSessionTitle}</strong>
      <p>{chatText.noSessionBody}</p>
      <button className="btn btn-primary" type="button" onClick={onNew}>
        <IconPlus size={14} />
        {chatText.startCta}
      </button>
    </div>
  );
}

function FingerprintBadge({
  fingerprint,
  confirmed,
  onConfirm,
}: {
  fingerprint: string;
  confirmed: boolean;
  onConfirm: () => void;
}) {
  if (!fingerprint) {
    return null;
  }
  const display = fingerprint.match(/.{1,4}/g)?.slice(0, 4).join(" ");
  return (
    <button
      type="button"
      className={`fingerprint-badge ${confirmed ? "fingerprint-badge-confirmed" : ""}`}
      onClick={confirmed ? undefined : onConfirm}
      title={confirmed ? inviteText.confirmedButton : inviteText.fingerprintHint}
      aria-label={confirmed ? inviteText.confirmedButton : inviteText.confirmButton}
    >
      <IconShieldCheck size={12} />
      <code>{display}</code>
    </button>
  );
}

function ChatError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="inline-error chat-error" role="alert">
      <span>{message}</span>
      {onRetry ? (
        <button type="button" className="chat-error-retry" onClick={onRetry}>
          <IconRefresh size={13} />
          Retry
        </button>
      ) : null}
    </div>
  );
}

function CryptoNotice() {
  return (
    <section className="crypto-banner" aria-label={cryptoNotice.title}>
      <div className="crypto-icon">
        <IconShieldCheck size={18} />
      </div>
      <div>
        <strong>{cryptoNotice.title}</strong>
        <p>{cryptoNotice.body}</p>
      </div>
    </section>
  );
}

function PublicNotice() {
  return (
    <section className="crypto-banner crypto-banner-public" aria-label={channelText.noticeTitle}>
      <div className="crypto-icon">
        <IconHash size={18} />
      </div>
      <div>
        <strong>{channelText.noticeTitle}</strong>
        <p>{channelText.noticeBody}</p>
      </div>
    </section>
  );
}

function StatePill({ state, label }: { state: string; label: string }) {
  return (
    <span className={`state-pill state-pill-${state}`}>
      <span className="state-dot" />
      {label}
    </span>
  );
}

async function copyText(value: string): Promise<void> {
  await navigator.clipboard?.writeText?.(value);
}

function peerLabel(session: SessionSnapshot): string {
  const peer = session.messages.find((message) => message.from_device !== session.display_name);
  if (peer) {
    return peer.from_device;
  }
  if (session.state === READY_STATE) {
    return "peer";
  }
  return session.role === "alice" ? "invite sent" : "joining";
}
