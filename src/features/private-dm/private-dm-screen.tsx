import {
  IconActivity,
  IconArrowLeft,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconCrown,
  IconHash,
  IconLink,
  IconLock,
  IconLockOpen,
  IconLogout,
  IconMessageCircle,
  IconPencil,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconSend,
  IconShieldCheck,
  IconSettings,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import {
  ClipboardEvent,
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  chatText,
  cryptoNotice,
  inviteText,
  onboardText,
  setupText,
  shellText,
  stateLabels,
  channelText,
  groupText,
} from "./private-dm.content";
import {
  AttachmentView,
  ChannelMessage,
  ChannelSnapshot,
  ChatMessage,
  GroupMessage,
  GroupSnapshot,
  MeshInfo,
  NativeMessagingGateway,
  SessionSnapshot,
  SnapshotEvent,
  nativeMessagingGateway,
} from "./native/native-messaging-gateway";
import {
  AttachmentCard,
  AttachmentPicker,
  createThumbnail,
  isAttachmentTooLarge,
  readFileAsBase64,
} from "./attachments";

interface AttachmentApi {
  readonly views: ReadonlyMap<string, AttachmentView>;
  readonly busy: boolean;
  readonly onSend: (file: File) => void;
  readonly onDownload: (attachmentId: string) => void;
  readonly onCancel: (attachmentId: string) => void;
}

const AUTO_POLL_MS = 1000;
const READY_STATE = "ready";
const DEFAULT_LISTEN_PORT = 0;

type ActiveItem =
  | { readonly type: "dm"; readonly id: string }
  | { readonly type: "channel"; readonly name: string }
  | { readonly type: "group"; readonly id: string };

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
  const [active, setActive] = useState<ActiveItem | null>(null);
  const [confirmedFingerprints, setConfirmedFingerprints] = useState<Set<string>>(new Set());
  const [createState, setCreateState] = useState<CreateState>({ copied: false });
  const [groupCreateState, setGroupCreateState] = useState<GroupCreateState>({ copied: false });
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const pollInFlight = useRef(false);
  const pollPending = useRef(false);
  const refreshRef = useRef<((quiet?: boolean) => Promise<void>) | null>(null);

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
        setBusy(true);
        setError(undefined);
      }
      try {
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
        if (!quiet) {
          setBusy(false);
        }
      } catch (err) {
        if (!quiet) {
          setBusy(false);
        }
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
    [gateway],
  );
  refreshRef.current = refresh;

  useEffect(() => {
    void refresh(true);
    const intervalId = window.setInterval(() => void refresh(true), AUTO_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [refresh]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      setBusy(false);
    } catch (err) {
      setError(readableError(err));
      setBusy(false);
    }
  };

  const createInvite = () =>
    run(async () => {
      const invite = await gateway.createPrivateInvite(requestBase);
      await copyText(invite.invite_uri);
      setCreateState({ inviteUri: invite.invite_uri, copied: true });
      setActive({ type: "dm", id: invite.session_id });
      setShowSetup(true);
      await refresh(true);
    });

  const acceptInvite = (uri: string) =>
    run(async () => {
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
    run(async () => {
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
    run(async () => {
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
    run(async () => {
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

  const sendMessage = (event: FormEvent) => {
    event.preventDefault();
    const body = composer.trim();
    if (!body || !active) {
      return;
    }
    void run(async () => {
      if (active.type === "dm") {
        await gateway.sendPrivateMessage(active.id, body);
      } else if (active.type === "channel") {
        await gateway.sendChannelMessage(active.name, body);
      } else {
        await gateway.sendGroupMessage(active.id, body);
      }
      setComposer("");
      await refresh(true);
    });
  };

  const closeActive = () => {
    if (!active) {
      return;
    }
    void run(async () => {
      if (active.type === "dm") {
        await gateway.closePrivateSession(active.id);
        setConfirmedFingerprints((current) => {
          const next = new Set(current);
          next.delete(active.id);
          return next;
        });
      } else if (active.type === "channel") {
        await gateway.leaveChannel(active.name);
      } else {
        await gateway.closePrivateGroup(active.id);
      }
      setActive(null);
      await refresh(true);
    });
  };

  const confirmFingerprint = (sessionId: string) =>
    setConfirmedFingerprints((current) => new Set(current).add(sessionId));

  const sendAttachment = (file: File) => {
    if (!active) {
      return;
    }
    if (isAttachmentTooLarge(file)) {
      setError("Attachment exceeds the 50 MB limit");
      return;
    }
    const target = active;
    void run(async () => {
      const dataBase64 = await readFileAsBase64(file);
      const thumbnail = await createThumbnail(file);
      const mime = file.type ?? "";
      if (target.type === "dm") {
        await gateway.sendPrivateAttachment(
          target.id,
          file.name,
          mime,
          dataBase64,
          thumbnail,
        );
      } else if (target.type === "channel") {
        await gateway.sendChannelAttachment(
          target.name,
          file.name,
          mime,
          dataBase64,
          thumbnail,
        );
      } else {
        await gateway.sendGroupAttachment(
          target.id,
          file.name,
          mime,
          dataBase64,
          thumbnail,
        );
      }
      await refresh(true);
    });
  };

  const downloadAttachment = (attachmentId: string) => {
    if (!active) {
      return;
    }
    const target = active;
    void run(async () => {
      if (target.type === "dm") {
        await gateway.downloadPrivateAttachment(target.id, attachmentId);
      } else if (target.type === "channel") {
        await gateway.downloadChannelAttachment(target.name, attachmentId);
      } else {
        await gateway.downloadGroupAttachment(target.id, attachmentId);
      }
      await refresh(true);
    });
  };

  const cancelAttachment = (attachmentId: string) => {
    if (!active) {
      return;
    }
    const target = active;
    void run(async () => {
      if (target.type === "dm") {
        await gateway.cancelPrivateAttachment(target.id, attachmentId);
      } else if (target.type === "channel") {
        await gateway.cancelChannelAttachment(target.name, attachmentId);
      } else {
        await gateway.cancelGroupAttachment(target.id, attachmentId);
      }
      await refresh(true);
    });
  };

  const activeSession =
    active?.type === "dm" ? sessions.find((s) => s.session_id === active.id) ?? null : null;
  const activeChannel =
    active?.type === "channel" ? channels.find((c) => c.name === active.name) ?? null : null;
  const activeGroup =
    active?.type === "group" ? groups.find((g) => g.group_id === active.id) ?? null : null;
  const showWelcome = (!activeSession && !activeChannel && !activeGroup) || showSetup;

  const activeAttachments =
    activeSession?.attachments ??
    activeChannel?.attachments ??
    activeGroup?.attachments ??
    [];
  const attachmentApi: AttachmentApi = {
    views: new Map(activeAttachments.map((view) => [view.attachment_id, view])),
    busy,
    onSend: sendAttachment,
    onDownload: downloadAttachment,
    onCancel: cancelAttachment,
  };

  return (
    <main className="mosh-window" aria-label={shellText.productName}>
      <header className="titlebar">
        <div className="brand">
          <IconShieldCheck size={18} />
          <strong>{shellText.productName}</strong>
        </div>
        <span className="titlebar-subtitle">{shellText.windowSubtitle}</span>
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
          active={active}
          onSelect={(item) => {
            setActive(item);
            setShowSetup(false);
          }}
          onNew={() => {
            setShowSetup(true);
            setActive(null);
            setCreateState({ copied: false });
            setGroupCreateState({ copied: false });
          }}
        />

        <section className="chat-pane" aria-labelledby="chat-title">
          {showWelcome ? (
            <NewSessionPanel
              displayName={displayName}
              staticPeer={staticPeer}
              listenPort={listenPort}
              busy={busy}
              createState={createState}
              groupCreateState={groupCreateState}
              error={error}
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
              busy={busy}
              attachments={attachmentApi}
              onComposer={setComposer}
              onSend={sendMessage}
              onConfirm={() => confirmFingerprint(activeSession.session_id)}
              onClose={closeActive}
            />
          ) : activeChannel ? (
            <ActiveChannelChat
              channel={activeChannel}
              composer={composer}
              busy={busy}
              attachments={attachmentApi}
              onComposer={setComposer}
              onSend={sendMessage}
              onClose={closeActive}
            />
          ) : activeGroup ? (
            <ActiveGroupChat
              group={activeGroup}
              composer={composer}
              busy={busy}
              attachments={attachmentApi}
              onComposer={setComposer}
              onSend={sendMessage}
              onClose={closeActive}
            />
          ) : (
            <EmptyState onNew={() => setShowSetup(true)} />
          )}
        </section>

        <aside className="diagnostics-panel" aria-labelledby="diagnostics-title">
          <header>
            <IconPlugConnected size={16} />
            <h2 id="diagnostics-title">Peer status</h2>
            <button
              className="btn btn-ghost btn-icon"
              type="button"
              onClick={() => void refresh(false)}
              aria-label="Refresh status"
            >
              <IconRefresh size={14} />
            </button>
          </header>

          {activeSession ? (
            <SessionDiagnostics session={activeSession} />
          ) : activeChannel ? (
            <ChannelDiagnostics channel={activeChannel} />
          ) : activeGroup ? (
            <GroupDiagnostics group={activeGroup} />
          ) : (
            <div className="diagnostic-group">
              <div className="diagnostic-group-label">Session</div>
              <div className="diagnostic-row">
                <span>State</span>
                <strong>{shellText.noActive}</strong>
              </div>
            </div>
          )}

          {error ? (
            <div className="diagnostic-row diagnostic-error">
              <span>Runtime error</span>
              <strong>{error}</strong>
            </div>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

function SessionRail({
  sessions,
  channels,
  groups,
  active,
  onSelect,
  onNew,
}: {
  sessions: readonly SessionSnapshot[];
  channels: readonly ChannelSnapshot[];
  groups: readonly GroupSnapshot[];
  active: ActiveItem | null;
  onSelect: (item: ActiveItem) => void;
  onNew: () => void;
}) {
  return (
    <aside className="session-rail" aria-label="Active sessions">
      <button className="rail-new" type="button" onClick={onNew} aria-label={shellText.newSession}>
        <IconPlus size={18} />
      </button>
      <div className="rail-divider" />
      <div className="rail-list">
        {sessions.map((session) => (
          <SessionRailItem
            key={`dm-${session.session_id}`}
            session={session}
            active={active?.type === "dm" && active.id === session.session_id}
            onClick={() => onSelect({ type: "dm", id: session.session_id })}
          />
        ))}
        {groups.length > 0 && sessions.length > 0 ? <div className="rail-divider" /> : null}
        {groups.map((group) => (
          <GroupRailItem
            key={`gr-${group.group_id}`}
            group={group}
            active={active?.type === "group" && active.id === group.group_id}
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
            onClick={() => onSelect({ type: "channel", name: channel.name })}
          />
        ))}
      </div>
    </aside>
  );
}

function SessionRailItem({
  session,
  active,
  onClick,
}: {
  session: SessionSnapshot;
  active: boolean;
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
    </button>
  );
}

function ChannelRailItem({
  channel,
  active,
  onClick,
}: {
  channel: ChannelSnapshot;
  active: boolean;
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
      <span className="rail-channel-label">{channel.name}</span>
    </button>
  );
}

function GroupRailItem({
  group,
  active,
  onClick,
}: {
  group: GroupSnapshot;
  active: boolean;
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
      <span className="rail-channel-label">{label}</span>
      <span className={`rail-dot rail-dot-${group.state}`} />
    </button>
  );
}

type OnboardStep = "menu" | "chat" | "group" | "join" | "channel";

function detectInviteKind(value: string): "dm" | "group" | "empty" | "unknown" {
  const trimmed = value.trim();
  if (!trimmed) {
    return "empty";
  }
  if (trimmed.startsWith("mosh://invite")) {
    return "dm";
  }
  if (trimmed.startsWith("mosh://group")) {
    return "group";
  }
  return "unknown";
}

function NewSessionPanel(props: {
  displayName: string;
  staticPeer: string;
  listenPort: number;
  busy: boolean;
  createState: CreateState;
  groupCreateState: GroupCreateState;
  error?: string;
  onDisplayName: (value: string) => void;
  onStaticPeer: (value: string) => void;
  onListenPort: (value: number) => void;
  onCreate: () => void;
  onAccept: (uri: string) => void;
  onJoinChannel: (name: string) => void;
  onCreateGroup: (label: string) => void;
  onJoinGroup: (uri: string) => void;
  onCopyInvite: () => void;
  onCopyGroupInvite: () => void;
}) {
  const [step, setStep] = useState<OnboardStep>("menu");
  const [joinValue, setJoinValue] = useState("");
  const [channelValue, setChannelValue] = useState("");
  const [groupLabelValue, setGroupLabelValue] = useState("");

  return (
    <div className="onboard scroll">
      <div className="onboard-shell">
        {step === "menu" ? (
          <OnboardMenu
            displayName={props.displayName}
            staticPeer={props.staticPeer}
            listenPort={props.listenPort}
            onDisplayName={props.onDisplayName}
            onStaticPeer={props.onStaticPeer}
            onListenPort={props.onListenPort}
            onPick={setStep}
          />
        ) : step === "chat" ? (
          <OnboardStepFrame title={onboardText.tileChatTitle} onBack={() => setStep("menu")}>
            <p className="step-body">{onboardText.chatStepBody}</p>
            <button
              className="btn btn-primary btn-block"
              type="button"
              onClick={props.onCreate}
              disabled={props.busy}
            >
              {props.createState.inviteUri ? onboardText.chatRecreate : onboardText.chatCreate}
            </button>
            {props.createState.inviteUri ? (
              <InviteResult
                note={onboardText.inviteReady}
                uri={props.createState.inviteUri}
                copied={props.createState.copied}
                onCopy={props.onCopyInvite}
              />
            ) : null}
          </OnboardStepFrame>
        ) : step === "group" ? (
          <OnboardStepFrame title={onboardText.tileGroupTitle} onBack={() => setStep("menu")}>
            <p className="step-body">{onboardText.groupStepBody}</p>
            <input
              className="step-input"
              aria-label="Group label"
              placeholder={onboardText.groupNamePlaceholder}
              value={groupLabelValue}
              onChange={(event) => setGroupLabelValue(event.target.value)}
            />
            <button
              className="btn btn-primary btn-block"
              type="button"
              onClick={() => props.onCreateGroup(groupLabelValue)}
              disabled={props.busy}
            >
              {props.groupCreateState.inviteUri
                ? onboardText.groupRecreate
                : onboardText.groupCreate}
            </button>
            {props.groupCreateState.inviteUri ? (
              <InviteResult
                note={onboardText.groupInviteReady}
                uri={props.groupCreateState.inviteUri}
                copied={props.groupCreateState.copied}
                onCopy={props.onCopyGroupInvite}
              />
            ) : null}
          </OnboardStepFrame>
        ) : step === "join" ? (
          <OnboardJoinStep
            value={joinValue}
            busy={props.busy}
            onChange={setJoinValue}
            onBack={() => setStep("menu")}
            onAccept={props.onAccept}
            onJoinGroup={props.onJoinGroup}
          />
        ) : (
          <OnboardStepFrame
            title={onboardText.tileChannelTitle}
            onBack={() => setStep("menu")}
          >
            <p className="step-body">{onboardText.channelStepBody}</p>
            <div className="step-channel-input">
              <span aria-hidden="true">#</span>
              <input
                aria-label="Channel name"
                placeholder={onboardText.channelPlaceholder}
                value={channelValue}
                onChange={(event) => setChannelValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && channelValue.trim() && !props.busy) {
                    event.preventDefault();
                    props.onJoinChannel(channelValue);
                  }
                }}
              />
            </div>
            <button
              className="btn btn-primary btn-block"
              type="button"
              onClick={() => props.onJoinChannel(channelValue)}
              disabled={props.busy || !channelValue.trim()}
            >
              {onboardText.channelJoin}
            </button>
          </OnboardStepFrame>
        )}

        {props.error ? <div className="inline-error">{props.error}</div> : null}
      </div>
    </div>
  );
}

function OnboardMenu(props: {
  displayName: string;
  staticPeer: string;
  listenPort: number;
  onDisplayName: (value: string) => void;
  onStaticPeer: (value: string) => void;
  onListenPort: (value: number) => void;
  onPick: (step: OnboardStep) => void;
}) {
  return (
    <div className="onboard-menu">
      <IdentityChip name={props.displayName} onRename={props.onDisplayName} />

      <header className="onboard-head">
        <h1>{onboardText.title}</h1>
        <p>{onboardText.subtitle}</p>
      </header>

      <div className="onboard-section-label">{onboardText.startLabel}</div>
      <div className="onboard-tiles">
        <OnboardTile
          icon={<IconMessageCircle size={20} />}
          title={onboardText.tileChatTitle}
          desc={onboardText.tileChatDesc}
          onClick={() => props.onPick("chat")}
        />
        <OnboardTile
          icon={<IconUsers size={20} />}
          title={onboardText.tileGroupTitle}
          desc={onboardText.tileGroupDesc}
          onClick={() => props.onPick("group")}
        />
      </div>

      <div className="onboard-section-label">{onboardText.joinLabel}</div>
      <div className="onboard-tiles">
        <OnboardTile
          icon={<IconLink size={20} />}
          title={onboardText.tileJoinTitle}
          desc={onboardText.tileJoinDesc}
          onClick={() => props.onPick("join")}
        />
        <OnboardTile
          icon={<IconHash size={20} />}
          title={onboardText.tileChannelTitle}
          desc={onboardText.tileChannelDesc}
          onClick={() => props.onPick("channel")}
        />
      </div>

      <div className="onboard-foot">
        <Disclosure
          icon={<IconSettings size={14} />}
          label={onboardText.advancedToggle}
        >
          <Field label={setupText.staticPeerLabel} hint={setupText.staticPeerHint}>
            <input
              aria-label="Static peer"
              placeholder={setupText.staticPeerPlaceholder}
              value={props.staticPeer}
              onChange={(event) => props.onStaticPeer(event.target.value)}
            />
          </Field>
          <Field label={setupText.listenPortLabel} hint={setupText.listenPortHint}>
            <input
              type="number"
              min={0}
              max={65535}
              aria-label="Listen port"
              value={props.listenPort}
              onChange={(event) => props.onListenPort(Number(event.target.value) || 0)}
            />
          </Field>
        </Disclosure>
        <Disclosure icon={<IconShieldCheck size={14} />} label={onboardText.aboutToggle}>
          <p className="disclosure-text">{cryptoNotice.body}</p>
        </Disclosure>
      </div>
    </div>
  );
}

function IdentityChip({
  name,
  onRename,
}: {
  name: string;
  onRename: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="onboard-identity">
      <Avatar name={name} />
      {editing ? (
        <input
          className="identity-input"
          aria-label="Display name"
          autoFocus
          value={name}
          onChange={(event) => onRename(event.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Escape") {
              event.preventDefault();
              setEditing(false);
            }
          }}
        />
      ) : (
        <div className="identity-text">
          <strong>{name}</strong>
          <span>{onboardText.identityHint}</span>
        </div>
      )}
      {editing ? null : (
        <button
          type="button"
          className="identity-edit"
          aria-label="Edit display name"
          title="Edit display name"
          onClick={() => setEditing(true)}
        >
          <IconPencil size={13} />
        </button>
      )}
    </div>
  );
}

function OnboardTile({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="onboard-tile" onClick={onClick}>
      <span className="tile-icon">{icon}</span>
      <span className="tile-text">
        <strong>{title}</strong>
        <span>{desc}</span>
      </span>
      <IconChevronRight size={16} className="tile-chevron" />
    </button>
  );
}

function OnboardStepFrame({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="step-frame">
      <button type="button" className="step-back" onClick={onBack}>
        <IconArrowLeft size={14} />
        {onboardText.back}
      </button>
      <h1 className="step-title">{title}</h1>
      {children}
    </div>
  );
}

function OnboardJoinStep(props: {
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onBack: () => void;
  onAccept: (uri: string) => void;
  onJoinGroup: (uri: string) => void;
}) {
  const kind = detectInviteKind(props.value);
  const ready = (kind === "dm" || kind === "group") && !props.busy;
  const detectClass =
    kind === "dm" || kind === "group"
      ? "detect-badge detect-badge-ok"
      : kind === "unknown"
        ? "detect-badge detect-badge-bad"
        : "detect-badge";
  const detectLabel =
    kind === "dm"
      ? onboardText.joinDetectChat
      : kind === "group"
        ? onboardText.joinDetectGroup
        : kind === "unknown"
          ? onboardText.joinDetectBad
          : onboardText.joinDetectNone;
  const connect = () => {
    if (kind === "dm") {
      props.onAccept(props.value);
    } else if (kind === "group") {
      props.onJoinGroup(props.value);
    }
  };
  return (
    <OnboardStepFrame title={onboardText.tileJoinTitle} onBack={props.onBack}>
      <p className="step-body">{onboardText.joinStepBody}</p>
      <textarea
        className="step-textarea"
        aria-label="Invite link"
        placeholder={onboardText.joinPlaceholder}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <div className={detectClass}>
        {kind === "dm" || kind === "group" ? <IconCheck size={13} /> : null}
        <span>{detectLabel}</span>
      </div>
      <button
        className="btn btn-primary btn-block"
        type="button"
        onClick={connect}
        disabled={!ready}
      >
        {onboardText.joinConnect}
      </button>
    </OnboardStepFrame>
  );
}

function InviteResult({
  note,
  uri,
  copied,
  onCopy,
}: {
  note: string;
  uri: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="invite-ready">
      <div className="invite-ready-note">
        <IconCheck size={14} />
        <span>{note}</span>
      </div>
      <code className="invite-code">{uri}</code>
      <button className="btn btn-ghost btn-block" type="button" onClick={onCopy}>
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
        {copied ? onboardText.copied : onboardText.copyLink}
      </button>
    </div>
  );
}

function Disclosure({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`disclosure${open ? " disclosure-open" : ""}`}>
      <button
        type="button"
        className="disclosure-head"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        <span>{label}</span>
        <IconChevronDown size={14} className="disclosure-caret" />
      </button>
      {open ? <div className="disclosure-body">{children}</div> : null}
    </div>
  );
}

function ActiveDmChat(props: {
  session: SessionSnapshot;
  composer: string;
  confirmed: boolean;
  busy: boolean;
  attachments: AttachmentApi;
  onComposer: (value: string) => void;
  onSend: (event: FormEvent) => void;
  onConfirm: () => void;
  onClose: () => void;
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
        <FingerprintBadge
          fingerprint={props.session.fingerprint}
          confirmed={props.confirmed}
          onConfirm={props.onConfirm}
        />
        <button
          className="btn btn-ghost btn-icon"
          type="button"
          onClick={props.onClose}
          aria-label={shellText.closeSession}
          title={shellText.closeSession}
        >
          <IconX size={16} />
        </button>
      </header>

      <CryptoNotice />

      <ChatDropZone disabled={!ready || props.busy} onAttach={props.attachments.onSend}>
        <DmChatList messages={props.session.messages} attachments={props.attachments} />
      </ChatDropZone>

      <Composer
        value={props.composer}
        onChange={props.onComposer}
        onSend={props.onSend}
        onAttach={props.attachments.onSend}
        disabled={!ready || props.busy}
      />
    </>
  );
}

function ActiveChannelChat(props: {
  channel: ChannelSnapshot;
  composer: string;
  busy: boolean;
  attachments: AttachmentApi;
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
        <button
          className="btn btn-ghost btn-icon"
          type="button"
          onClick={props.onClose}
          aria-label={channelText.leaveLabel}
          title={channelText.leaveLabel}
        >
          <IconLogout size={16} />
        </button>
      </header>

      <PublicNotice />

      <ChatDropZone disabled={props.busy} onAttach={props.attachments.onSend}>
        <ChannelChatList messages={props.channel.messages} attachments={props.attachments} />
      </ChatDropZone>

      <Composer
        value={props.composer}
        onChange={props.onComposer}
        onSend={props.onSend}
        onAttach={props.attachments.onSend}
        disabled={props.busy}
      />
    </>
  );
}

function ActiveGroupChat(props: {
  group: GroupSnapshot;
  composer: string;
  busy: boolean;
  attachments: AttachmentApi;
  onComposer: (value: string) => void;
  onSend: (event: FormEvent) => void;
  onClose: () => void;
}) {
  const ready = props.group.state === READY_STATE;
  const label = props.group.label ?? groupText.untitled;
  const inviteUri = props.group.invite_uri;
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
            onClick={() => void navigator.clipboard?.writeText?.(inviteUri)}
            aria-label={groupText.copyInvite}
            title={groupText.copyInvite}
          >
            <IconCopy size={14} />
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
      </header>

      <GroupNotice />

      <ChatDropZone disabled={!ready || props.busy} onAttach={props.attachments.onSend}>
        <GroupChatList messages={props.group.messages} attachments={props.attachments} />
      </ChatDropZone>

      <Composer
        value={props.composer}
        onChange={props.onComposer}
        onSend={props.onSend}
        onAttach={props.attachments.onSend}
        disabled={!ready || props.busy}
      />
    </>
  );
}

/** Wraps the scroll area and turns a file drop into an attachment send. */
function ChatDropZone({
  disabled,
  onAttach,
  children,
}: {
  disabled: boolean;
  onAttach: (file: File) => void;
  children: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`chat-scroll scroll${dragging ? " chat-scroll-dragging" : ""}`}
      onDragOver={(event) => {
        if (disabled) {
          return;
        }
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (disabled) {
          return;
        }
        const file = event.dataTransfer.files?.[0];
        if (file) {
          onAttach(file);
        }
      }}
    >
      {children}
      {dragging ? <div className="chat-drop-overlay">{chatText.dropHint}</div> : null}
    </div>
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

function GroupChatList({
  messages,
  attachments,
}: {
  messages: readonly GroupMessage[];
  attachments: AttachmentApi;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    anchorRef.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="chat-empty">
        <strong>{groupText.emptyTitle}</strong>
        <p>{groupText.emptyBody}</p>
      </div>
    );
  }
  return (
    <div className="message-stack">
      {messages.map((message, index) => (
        <GroupMessageRow
          message={message}
          attachments={attachments}
          key={`${message.from_fingerprint}-${index}`}
        />
      ))}
      <div ref={anchorRef} aria-hidden="true" />
    </div>
  );
}

function GroupMessageRow({
  message,
  attachments,
}: {
  message: GroupMessage;
  attachments: AttachmentApi;
}) {
  return (
    <article className="message-row">
      <Avatar name={message.from_device} />
      <div className="message-body">
        <div className="message-meta">
          <strong>{message.from_device}</strong>
          <code className="device-fp">{shorten(message.from_fingerprint, 6)}</code>
          <code>MLS</code>
        </div>
        {message.body ? <p>{message.body}</p> : null}
        {message.attachment ? (
          <AttachmentCard
            descriptor={message.attachment}
            view={attachments.views.get(message.attachment.attachment_id)}
            busy={attachments.busy}
            onDownload={attachments.onDownload}
            onCancel={attachments.onCancel}
          />
        ) : null}
        <div className="message-seal">
          <IconLockOpen size={10} />
          <span>OpenMLS · sealed</span>
        </div>
      </div>
    </article>
  );
}

function GroupDiagnostics({ group }: { group: GroupSnapshot }) {
  return (
    <>
      <div className="diagnostic-group">
        <div className="diagnostic-group-label">Group</div>
        <Row k="Label" v={group.label ?? "—"} />
        <Row k="Members" v={String(group.member_count)} />
        <Row k="Role" v={group.is_admin ? "admin" : "member"} />
        <Row k="MLS state" v={stateLabels[group.state] ?? group.state} />
        <Row k="Group id" v={shorten(group.group_id, 12)} />
        <Row k="Creator" v={shorten(group.creator_fingerprint, 8)} />
        <Row k="Display" v={group.display_name} />
        <Row k="Device" v={shorten(group.device_fingerprint, 10)} />
      </div>
      <MeshDiagnostics mesh={group.mesh} />
      <EventLog events={group.events} />
    </>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
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

function DmChatList({
  messages,
  attachments,
}: {
  messages: readonly ChatMessage[];
  attachments: AttachmentApi;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    anchorRef.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="chat-empty">
        <strong>{chatText.emptyTitle}</strong>
        <p>{chatText.emptyBody}</p>
      </div>
    );
  }
  return (
    <div className="message-stack">
      {messages.map((message, index) => (
        <DmMessageRow
          message={message}
          attachments={attachments}
          key={`${message.from_device}-${index}`}
        />
      ))}
      <div ref={anchorRef} aria-hidden="true" />
    </div>
  );
}

function DmMessageRow({
  message,
  attachments,
}: {
  message: ChatMessage;
  attachments: AttachmentApi;
}) {
  return (
    <article className="message-row">
      <Avatar name={message.from_device} />
      <div className="message-body">
        <div className="message-meta">
          <strong>{message.from_device}</strong>
          <code>MLS</code>
        </div>
        {message.body ? <p>{message.body}</p> : null}
        {message.attachment ? (
          <AttachmentCard
            descriptor={message.attachment}
            view={attachments.views.get(message.attachment.attachment_id)}
            busy={attachments.busy}
            onDownload={attachments.onDownload}
            onCancel={attachments.onCancel}
          />
        ) : null}
        <div className="message-seal">
          <IconLock size={10} />
          <span>OpenMLS · sealed</span>
        </div>
      </div>
    </article>
  );
}

function ChannelChatList({
  messages,
  attachments,
}: {
  messages: readonly ChannelMessage[];
  attachments: AttachmentApi;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    anchorRef.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="chat-empty">
        <strong>{channelText.emptyTitle}</strong>
        <p>{channelText.emptyBody}</p>
      </div>
    );
  }
  return (
    <div className="message-stack">
      {messages.map((message, index) => (
        <ChannelMessageRow
          message={message}
          attachments={attachments}
          key={`${message.from_fingerprint}-${index}`}
        />
      ))}
      <div ref={anchorRef} aria-hidden="true" />
    </div>
  );
}

function ChannelMessageRow({
  message,
  attachments,
}: {
  message: ChannelMessage;
  attachments: AttachmentApi;
}) {
  return (
    <article className="message-row">
      <Avatar name={message.from_device} />
      <div className="message-body">
        <div className="message-meta">
          <strong>{message.from_device}</strong>
          <code className="device-fp">{shorten(message.from_fingerprint, 6)}</code>
        </div>
        {message.body ? <p>{message.body}</p> : null}
        {message.attachment ? (
          <AttachmentCard
            descriptor={message.attachment}
            view={attachments.views.get(message.attachment.attachment_id)}
            busy={attachments.busy}
            onDownload={attachments.onDownload}
            onCancel={attachments.onCancel}
          />
        ) : null}
      </div>
    </article>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  onAttach,
  disabled,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSend: (event: FormEvent) => void;
  onAttach?: (file: File) => void;
}) {
  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    if (disabled || !onAttach) {
      return;
    }
    const file = Array.from(event.clipboardData.items)
      .find((item) => item.kind === "file")
      ?.getAsFile();
    if (file) {
      event.preventDefault();
      onAttach(file);
    }
  };
  return (
    <form className="composer" onSubmit={onSend}>
      <div className="composer-box">
        {onAttach ? (
          <AttachmentPicker
            disabled={disabled}
            onPick={onAttach}
            ariaLabel={chatText.attachLabel}
          />
        ) : null}
        <input
          aria-label="Message"
          placeholder={chatText.composerPlaceholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onPaste={handlePaste}
          disabled={disabled}
        />
        <button
          className="send-button"
          type="submit"
          aria-label={chatText.sendLabel}
          disabled={disabled || !value.trim()}
        >
          <IconSend size={14} />
        </button>
      </div>
    </form>
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

function SessionDiagnostics({ session }: { session: SessionSnapshot }) {
  return (
    <>
      <div className="diagnostic-group">
        <div className="diagnostic-group-label">Session</div>
        <Row k="MLS state" v={stateLabels[session.state] ?? session.state} />
        <Row k="Role" v={session.role} />
        <Row k="Display" v={session.display_name} />
        <Row k="Session" v={shorten(session.session_id, 14)} />
      </div>
      <MeshDiagnostics mesh={session.mesh} />
      <EventLog events={session.events} />
    </>
  );
}

function ChannelDiagnostics({ channel }: { channel: ChannelSnapshot }) {
  return (
    <>
      <div className="diagnostic-group">
        <div className="diagnostic-group-label">Channel</div>
        <Row k="Name" v={`#${channel.name}`} />
        <Row k="Display" v={channel.display_name} />
        <Row k="Device" v={shorten(channel.device_fingerprint, 10)} />
        <Row k="Topic" v={channel.topic} />
      </div>
      <MeshDiagnostics mesh={channel.mesh} />
      <EventLog events={channel.events} />
    </>
  );
}

function MeshDiagnostics({ mesh }: { mesh: MeshInfo | null }) {
  if (!mesh) {
    return (
      <div className="diagnostic-group">
        <div className="diagnostic-group-label">Moss network</div>
        <div className="diagnostic-row">
          <span>Status</span>
          <strong>booting…</strong>
        </div>
      </div>
    );
  }
  return (
    <div className="diagnostic-group">
      <div className="diagnostic-group-label">Moss network</div>
      <Row k="NAT type" v={mesh.nat_type || "unknown"} />
      <Row k="Advertised" v={mesh.advertised_addr || "—"} />
      <Row k="Listen port" v={String(mesh.listen_port)} />
      <Row
        k="Peers"
        v={`${mesh.peer_count} (${mesh.direct_peer_count}d / ${mesh.relayed_peer_count}r)`}
      />
      <Row k="Known" v={String(mesh.known_peer_count)} />
      <Row k="Relay" v={String(mesh.relay_session_count)} />
      <Row k="Supernode" v={mesh.supernode_ready ? "ready" : "no"} />
      <Row k="Mesh id" v={shorten(mesh.mesh_id, 14)} />
    </div>
  );
}

function EventLog({ events }: { events: readonly SnapshotEvent[] }) {
  const slice = events.slice(-12).reverse();
  return (
    <div className="diagnostic-group">
      <div className="diagnostic-group-label">
        <IconActivity size={11} style={{ marginRight: 6, verticalAlign: "-1px" }} />
        Moss events
      </div>
      {slice.length === 0 ? (
        <div className="diagnostic-row event-empty">
          <span>—</span>
          <strong>no events yet</strong>
        </div>
      ) : (
        slice.map((event, index) => {
          const detail = compactDetail(event.detail_json);
          const time = formatTime(event.epoch_millis);
          return (
            <div className={`diagnostic-row event-row event-${event.event_name}`} key={index}>
              <span>{time}</span>
              <strong>
                <span className="event-name">{event.event_name}</span>
                {detail ? <span className="event-detail">{detail}</span> : null}
              </strong>
            </div>
          );
        })
      )}
    </div>
  );
}

function compactDetail(raw: string): string {
  if (!raw) {
    return "";
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed)
        .map(([key, value]) => `${key}=${value}`)
        .join(" ");
    }
    return String(parsed);
  } catch {
    return raw;
  }
}

function formatTime(epoch: number): string {
  if (!epoch) {
    return "—";
  }
  const date = new Date(epoch);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="diagnostic-row">
      <span>{k}</span>
      <strong>{v}</strong>
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

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/[\s_-]+/)
    .map((part) => part[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return <span className="avatar">{initials || "?"}</span>;
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function copyText(value: string): Promise<void> {
  await navigator.clipboard?.writeText?.(value);
}

function shorten(value: string, head: number): string {
  if (!value) {
    return "—";
  }
  if (value.length <= head * 2 + 1) {
    return value;
  }
  return `${value.slice(0, head)}…${value.slice(-4)}`;
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
