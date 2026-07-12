import {
  IconMenu2,
  IconPlugConnected,
  IconRefresh,
  IconShieldCheck,
} from "@tabler/icons-react";
import {
  useEffect,
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
  type ChatTarget,
} from "./chat-actions";
import { type ConversationFilter, type ConversationToolsState } from "./ConversationTools";
import { DiagnosticsDrawer } from "./DiagnosticsDrawer";
import { readableError } from "./format";
import { type OperationKind, useOperationBusy } from "./use-operation-busy";
import { useChatCloseFlow } from "./use-chat-close-flow";
import { useChatOrchestration } from "./use-chat-orchestration";
import { useConversationRailState } from "./use-conversation-rail-state";
import { useDmOffers } from "./use-dm-offers";
import { computeMissingRosterMembers, useOrgs } from "./org/use-orgs";
import { usePrivateDmSetup } from "./use-private-dm-setup";
import { usePrivateDmSnapshots } from "./use-private-dm-snapshots";
import { useRuntimePersistenceStatus } from "./use-runtime-persistence-status";
import { SessionRail } from "./SessionRail";
import {
  NativeMessagingGateway,
  SessionSnapshot,
  nativeMessagingGateway,
} from "./native/native-messaging-gateway";
import { MediaViewer } from "./MediaViewer";
import { CallOverlay } from "./voice-call/CallOverlay";
import { IncomingCallModal } from "./voice-call/IncomingCallModal";
import { OutgoingCallModal } from "./voice-call/OutgoingCallModal";
import { useVoiceCallOrchestration } from "./voice-call/use-voice-call-orchestration";
import { NewSessionPanel } from "./NewSessionPanel";

const READY_STATE = "ready";

/** Stable per-conversation key used for unread tracking and notifications. */
function conversationKey(item: ChatTarget): string {
  return item.type === "channel"
    ? `channel:${item.name}`
    : `${item.type}:${item.id}`;
}

export function PrivateDmScreen({
  gateway = nativeMessagingGateway,
}: {
  gateway?: NativeMessagingGateway;
}) {
  const [composer, setComposer] = useState("");
  const [active, setActive] = useState<ChatTarget | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [conversationSearch, setConversationSearch] = useState("");
  const [conversationFilter, setConversationFilter] = useState<ConversationFilter>("all");
  const [error, setError] = useState<string | undefined>(undefined);
  const { counts: operationCounts, runOperation } = useOperationBusy();
  const [showSetup, setShowSetup] = useState(false);
  const rail = useConversationRailState();
  const refreshBusy = operationCounts.refresh > 0;
  const setupBusy = operationCounts.setup > 0;
  const messageBusy = operationCounts.message > 0;
  const transferBusy = operationCounts.transfer > 0;
  const sessionBusy = operationCounts.session > 0;
  const offerBusy = operationCounts.offer > 0;
  const chatBusy = messageBusy || sessionBusy;
  const { sessions, channels, groups, refresh } = usePrivateDmSnapshots({
    gateway,
    runOperation,
    setActive,
    onError: setError,
  });
  const persistenceWarning = useRuntimePersistenceStatus(gateway);

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
    retryMessage,
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
  const orgs = useOrgs({
    gateway,
    requestBase: setup.requestBase,
    refresh,
    run,
    setActive,
    setShowSetup,
  });
  const closeFlow = useChatCloseFlow({
    active,
    sessions,
    channels,
    groups,
    gateway,
    refresh,
    run,
    setActive,
    sessionLabel: peerLabel,
  });

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

  // Spec §5 manual add: roster members not yet in the active org group,
  // offered by an org-admin with one click.
  const activeGroupOrg = activeGroup?.org_pubkey
    ? orgs.orgs.find((org) => org.org_pubkey === activeGroup.org_pubkey)
    : undefined;
  const selfIsOrgAdmin = activeGroupOrg?.members.some(
    (member) => member.is_self && member.role === "admin",
  );
  const missingRosterMembers =
    activeGroup && activeGroupOrg && selfIsOrgAdmin
      ? computeMissingRosterMembers(
          activeGroupOrg,
          activeGroup.member_peer_ids,
          orgs.offeredGroupInvites.get(activeGroup.group_id),
        )
      : [];
  const orgAddPrompt =
    activeGroup && activeGroupOrg && missingRosterMembers.length > 0
      ? {
          count: missingRosterMembers.length,
          busy: offerBusy,
          onAdd: () =>
            void orgs.inviteMembersToGroup(
              activeGroupOrg.org_pubkey,
              activeGroup.group_id,
              missingRosterMembers,
            ),
        }
      : null;

  return (
    <main className="mosh-window" aria-label={shellText.productName}>
      <header className="titlebar">
        <button
          className="btn btn-ghost btn-icon titlebar-nav"
          type="button"
          onClick={rail.toggle}
          aria-controls="conversation-rail"
          aria-expanded={rail.expanded}
          aria-label={rail.expanded ? "Collapse conversations" : "Open conversations"}
          title={rail.expanded ? "Collapse conversations" : "Open conversations"}
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

      <div className={`desktop-body${rail.expanded ? " desktop-body-rail-expanded" : ""}`}>
        <SessionRail
          expanded={rail.expanded}
          sessions={sessions}
          channels={channels}
          groups={groups}
          offers={dmOffers.pendingOffers}
          org={{
            orgs: orgs.orgs,
            busy: offerBusy || setupBusy,
            revokedDmBadges: orgs.revokedDmBadges,
            onMember: orgs.openMemberDm,
            onAcceptDmOffer: orgs.acceptDmOffer,
            onDismissDmOffer: orgs.dismissDmOffer,
            onAcceptGroupOffer: orgs.acceptGroupOffer,
            onDismissGroupOffer: orgs.dismissGroupOffer,
            onCreateGroup: orgs.createOrgGroup,
            onLeave: (org) => orgs.leaveOrg(org.org_pubkey),
          }}
          active={active}
          unread={unread}
          sessionLabel={peerLabel}
          onSelect={(item) => {
            setActive(item);
            setShowSetup(false);
            rail.closeAfterMobileAction();
            clearUnread(conversationKey(item));
          }}
          onAcceptOffer={dmOffers.acceptDmOffer}
          onDismissOffer={dmOffers.dismissDmOffer}
          onNew={() => {
            setShowSetup(true);
            setActive(null);
            rail.closeAfterMobileAction();
            setup.resetInviteState();
          }}
          onToggle={rail.toggle}
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
              persistenceWarning={persistenceWarning}
              gateway={gateway}
              onDisplayName={setup.setDisplayName}
              onStaticPeer={setup.setStaticPeer}
              onListenPort={setup.setListenPort}
              onCreate={setup.createInvite}
              onAccept={setup.acceptInvite}
              onJoinChannel={setup.joinChannel}
              onCreateGroup={setup.createGroup}
              onJoinGroup={setup.joinGroup}
              onJoinOrg={orgs.joinOrg}
              onCopyInvite={setup.copyInvite}
              onCopyGroupInvite={setup.copyGroupInvite}
            />
          ) : activeSession ? (
            <ActiveDmChat
              session={activeSession}
              peerName={peerLabel(activeSession)}
              ready={activeSession.state === READY_STATE}
              composer={composer}
              confirmed={closeFlow.confirmedFingerprints.has(activeSession.session_id)}
              busy={chatBusy}
              attachments={attachmentApi}
              tools={conversationTools}
              onComposer={setComposer}
              onRetryMessage={retryMessage}
              onSend={sendMessage}
              onConfirm={() => closeFlow.confirmFingerprint(activeSession.session_id)}
              onClose={closeFlow.closeActive}
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
              onRetryMessage={retryMessage}
              onSend={sendMessage}
              onClose={closeFlow.closeActive}
            />
          ) : activeGroup ? (
            <ActiveGroupChat
              group={activeGroup}
              ready={activeGroup.state === READY_STATE}
              orgAddPrompt={orgAddPrompt}
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
              onRetryMessage={retryMessage}
              onSend={sendMessage}
              onClose={closeFlow.closeActive}
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

      {closeFlow.pendingClose ? (
        <ConfirmDialog
          title={closeFlow.pendingClose.title}
          body={closeFlow.pendingClose.body}
          confirmLabel={closeFlow.pendingClose.confirmLabel}
          onCancel={closeFlow.cancelClose}
          onConfirm={closeFlow.confirmCloseActive}
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
