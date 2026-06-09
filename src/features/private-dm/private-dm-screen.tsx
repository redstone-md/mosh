import {
  IconMenu2,
  IconPlugConnected,
  IconRefresh,
  IconShieldCheck,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useUnreadNotifications } from "./notifications/use-unread-notifications";
import {
  shellText,
  stateLabels,
  channelText,
} from "./private-dm.content";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  ActiveChannelChat,
  ActiveDmChat,
  ActiveGroupChat,
  EmptyState,
} from "./ActiveChatPanes";
import {
  closeChatTarget,
  sameChatTarget,
  type ChatTarget,
} from "./chat-actions";
import { type ConversationFilter, type ConversationToolsState } from "./ConversationTools";
import { DiagnosticsDrawer } from "./DiagnosticsDrawer";
import { readableError, shorten } from "./format";
import { type OperationKind, useOperationBusy } from "./use-operation-busy";
import { useChatOrchestration } from "./use-chat-orchestration";
import { useDmOffers } from "./use-dm-offers";
import { usePrivateDmSetup } from "./use-private-dm-setup";
import { SessionRail } from "./SessionRail";
import {
  ChannelSnapshot,
  GroupSnapshot,
  NativeMessagingGateway,
  SessionSnapshot,
  nativeMessagingGateway,
} from "./native/native-messaging-gateway";
import { MediaViewer } from "./attachments";
import { CallOverlay } from "./voice-call/CallOverlay";
import { IncomingCallModal } from "./voice-call/IncomingCallModal";
import { OutgoingCallModal } from "./voice-call/OutgoingCallModal";
import { useVoiceCallOrchestration } from "./voice-call/use-voice-call-orchestration";
import { NewSessionPanel } from "./NewSessionPanel";

const AUTO_POLL_MS = 1000;
const READY_STATE = "ready";

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

export function PrivateDmScreen({
  gateway = nativeMessagingGateway,
}: {
  gateway?: NativeMessagingGateway;
}) {
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
  const [error, setError] = useState<string | undefined>(undefined);
  const { counts: operationCounts, runOperation } = useOperationBusy();
  const [showSetup, setShowSetup] = useState(false);
  const [railExpanded, setRailExpanded] = useState(false);
  const [railOverlay, setRailOverlay] = useState(false);
  const pollInFlight = useRef(false);
  const pollPending = useRef(false);
  const refreshRef = useRef<((quiet?: boolean) => Promise<void>) | null>(null);
  const refreshBusy = operationCounts.refresh > 0;
  const setupBusy = operationCounts.setup > 0;
  const messageBusy = operationCounts.message > 0;
  const transferBusy = operationCounts.transfer > 0;
  const sessionBusy = operationCounts.session > 0;
  const offerBusy = operationCounts.offer > 0;
  const chatBusy = messageBusy || sessionBusy;

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

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(max-width: 580px)");
    const sync = () => {
      setRailOverlay(query.matches);
      if (query.matches) {
        setRailExpanded(false);
      }
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

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
  const activeConversationKey = active ? conversationKey(active) : "";
  const { unread, clearUnread, notificationsReady } = useUnreadNotifications({
    sessions,
    channels,
    groups,
    activeKey: activeConversationKey || null,
  });
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

  const setup = usePrivateDmSetup({
    gateway,
    refresh,
    run,
    setActive,
    setShowSetup,
  });
  const dmOffers = useDmOffers({
    active,
    channels,
    gateway,
    groups,
    refresh,
    requestBase: setup.requestBase,
    run,
    setActive,
    setShowSetup,
  });

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

  const showWelcome = (!activeSession && !activeChannel && !activeGroup) || showSetup;
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

  const {
    pendingCallSession,
    activeCall,
    activeCallSessionId,
    callSupported,
    callMuted,
    startCall,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
  } = useVoiceCallOrchestration({
    gateway,
    sessions,
    activeSession,
    notificationsReady,
    onError: setError,
  });
  const activeDmSession = activeSession;

  return (
    <main className="mosh-window" aria-label={shellText.productName}>
      <header className="titlebar">
        <button
          className="btn btn-ghost btn-icon titlebar-nav"
          type="button"
          onClick={() => setRailExpanded((open) => !open)}
          aria-controls="conversation-rail"
          aria-expanded={railExpanded}
          aria-label={railExpanded ? "Collapse conversations" : "Open conversations"}
          title={railExpanded ? "Collapse conversations" : "Open conversations"}
        >
          <IconMenu2 size={16} />
        </button>
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

      <div className={`desktop-body${railExpanded ? " desktop-body-rail-expanded" : ""}`}>
        <SessionRail
          expanded={railExpanded}
          sessions={sessions}
          channels={channels}
          groups={groups}
          offers={dmOffers.pendingOffers}
          active={active}
          unread={unread}
          sessionLabel={peerLabel}
          onSelect={(item) => {
            setActive(item);
            setShowSetup(false);
            if (railOverlay) {
              setRailExpanded(false);
            }
            clearUnread(conversationKey(item));
          }}
          onAcceptOffer={dmOffers.acceptDmOffer}
          onDismissOffer={dmOffers.dismissDmOffer}
          onNew={() => {
            setShowSetup(true);
            setActive(null);
            if (railOverlay) {
              setRailExpanded(false);
            }
            setup.resetInviteState();
          }}
          onToggle={() => setRailExpanded((open) => !open)}
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
              displayName={setup.displayName}
              staticPeer={setup.staticPeer}
              listenPort={setup.listenPort}
              busy={setupBusy}
              createState={setup.createState}
              groupCreateState={setup.groupCreateState}
              error={error}
              gateway={gateway}
              onDisplayName={setup.setDisplayName}
              onStaticPeer={setup.setStaticPeer}
              onListenPort={setup.setListenPort}
              onCreate={setup.createInvite}
              onAccept={setup.acceptInvite}
              onJoinChannel={setup.joinChannel}
              onCreateGroup={setup.createGroup}
              onJoinGroup={setup.joinGroup}
              onCopyInvite={setup.copyInvite}
              onCopyGroupInvite={setup.copyGroupInvite}
            />
          ) : activeSession ? (
            <ActiveDmChat
              session={activeSession}
              peerName={peerLabel(activeSession)}
              ready={activeSession.state === READY_STATE}
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
                offered: dmOffers.offeredFingerprints,
                busy: offerBusy,
                onMessage: dmOffers.offerDm,
              }}
              onComposer={setComposer}
              onSend={sendMessage}
              onClose={closeActive}
            />
          ) : activeGroup ? (
            <ActiveGroupChat
              group={activeGroup}
              ready={activeGroup.state === READY_STATE}
              composer={composer}
              busy={chatBusy}
              attachments={attachmentApi}
              tools={conversationTools}
              peer={{
                ownFingerprint: activeGroup.device_fingerprint,
                offered: dmOffers.offeredFingerprints,
                busy: offerBusy,
                onMessage: dmOffers.offerDm,
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
          onToggleMute={toggleMute}
          onHangUp={() =>
            endCall(activeCallSessionId, activeCall.call_id, "hangup")
          }
        />
      ) : null}
    </main>
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

function StatePill({ state, label }: { state: string; label: string }) {
  return (
    <span className={`state-pill state-pill-${state}`}>
      <span className="state-dot" />
      {label}
    </span>
  );
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
