import {
  IconActivity,
  IconCheck,
  IconCopy,
  IconCrown,
  IconHash,
  IconLock,
  IconLockOpen,
  IconLogout,
  IconMessageCircle,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconSend,
  IconShieldCheck,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  chatText,
  cryptoNotice,
  inviteText,
  setupText,
  shellText,
  stateLabels,
  channelText,
  groupText,
} from "./private-dm.content";
import {
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
  const [inviteUri, setInviteUri] = useState("");
  const [channelName, setChannelName] = useState("");
  const [groupLabel, setGroupLabel] = useState("");
  const [groupInvite, setGroupInvite] = useState("");
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
      }
    },
    [gateway],
  );

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

  const acceptInvite = () =>
    run(async () => {
      const snapshot = await gateway.acceptPrivateInvite({
        ...requestBase,
        invite_uri: inviteUri.trim(),
      });
      setInviteUri("");
      setActive({ type: "dm", id: snapshot.session_id });
      setShowSetup(false);
      await refresh(true);
    });

  const joinChannel = () =>
    run(async () => {
      const name = channelName.trim();
      if (!name) {
        return;
      }
      const snapshot = await gateway.joinChannel({
        ...requestBase,
        name,
      });
      setChannelName("");
      setActive({ type: "channel", name: snapshot.name });
      setShowSetup(false);
      await refresh(true);
    });

  const createGroup = () =>
    run(async () => {
      const created = await gateway.createPrivateGroup({
        ...requestBase,
        label: groupLabel.trim() || null,
      });
      await copyText(created.invite_uri);
      setGroupCreateState({ inviteUri: created.invite_uri, copied: true });
      setActive({ type: "group", id: created.group_id });
      setShowSetup(true);
      setGroupLabel("");
      await refresh(true);
    });

  const joinGroup = () =>
    run(async () => {
      const trimmed = groupInvite.trim();
      if (!trimmed) {
        return;
      }
      const snapshot = await gateway.joinPrivateGroup({
        ...requestBase,
        invite_uri: trimmed,
      });
      setGroupInvite("");
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

  const activeSession =
    active?.type === "dm" ? sessions.find((s) => s.session_id === active.id) ?? null : null;
  const activeChannel =
    active?.type === "channel" ? channels.find((c) => c.name === active.name) ?? null : null;
  const activeGroup =
    active?.type === "group" ? groups.find((g) => g.group_id === active.id) ?? null : null;
  const showWelcome = (!activeSession && !activeChannel && !activeGroup) || showSetup;

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
              inviteUri={inviteUri}
              channelName={channelName}
              groupLabel={groupLabel}
              groupInvite={groupInvite}
              busy={busy}
              createState={createState}
              groupCreateState={groupCreateState}
              error={error}
              onDisplayName={setDisplayName}
              onStaticPeer={setStaticPeer}
              onListenPort={setListenPort}
              onInviteUri={setInviteUri}
              onChannelName={setChannelName}
              onGroupLabel={setGroupLabel}
              onGroupInvite={setGroupInvite}
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
              onComposer={setComposer}
              onSend={sendMessage}
              onClose={closeActive}
            />
          ) : activeGroup ? (
            <ActiveGroupChat
              group={activeGroup}
              composer={composer}
              busy={busy}
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

function NewSessionPanel(props: {
  displayName: string;
  staticPeer: string;
  listenPort: number;
  inviteUri: string;
  channelName: string;
  groupLabel: string;
  groupInvite: string;
  busy: boolean;
  createState: CreateState;
  groupCreateState: GroupCreateState;
  error?: string;
  onDisplayName: (value: string) => void;
  onStaticPeer: (value: string) => void;
  onListenPort: (value: number) => void;
  onInviteUri: (value: string) => void;
  onChannelName: (value: string) => void;
  onGroupLabel: (value: string) => void;
  onGroupInvite: (value: string) => void;
  onCreate: () => void;
  onAccept: () => void;
  onJoinChannel: () => void;
  onCreateGroup: () => void;
  onJoinGroup: () => void;
  onCopyInvite: () => void;
  onCopyGroupInvite: () => void;
}) {
  const hasInvite = Boolean(props.createState.inviteUri);
  const hasGroupInvite = Boolean(props.groupCreateState.inviteUri);
  const canAccept = props.inviteUri.trim().length > 0 && !props.busy;
  const canJoinChannel = props.channelName.trim().length > 0 && !props.busy;
  const canJoinGroup = props.groupInvite.trim().length > 0 && !props.busy;
  return (
    <div className="new-session-pane">
      <header className="new-session-header">
        <h1>{inviteText.newSessionTitle}</h1>
        <p>{cryptoNotice.body}</p>
      </header>

      <section className="card" aria-label={setupText.sectionTitle}>
        <h2>{setupText.sectionTitle}</h2>
        <Field label={setupText.displayNameLabel}>
          <input
            aria-label="Display name"
            placeholder={setupText.displayNamePlaceholder}
            value={props.displayName}
            onChange={(event) => props.onDisplayName(event.target.value)}
          />
        </Field>
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
      </section>

      <div className="new-session-grid">
        <section className="card" aria-label={inviteText.createSectionTitle}>
          <h2>{inviteText.createSectionTitle}</h2>
          <p className="card-hint">{inviteText.createHint}</p>
          <div className="card-actions">
            <button
              className="btn btn-primary"
              type="button"
              onClick={props.onCreate}
              disabled={props.busy}
            >
              {hasInvite ? inviteText.recreateButton : inviteText.createButton}
            </button>
            {hasInvite ? (
              <button className="btn btn-ghost" type="button" onClick={props.onCopyInvite}>
                {props.createState.copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                {props.createState.copied ? inviteText.copiedButton : inviteText.copyButton}
              </button>
            ) : null}
          </div>
          {hasInvite ? <code className="invite-code">{props.createState.inviteUri}</code> : null}
        </section>

        <section className="card" aria-label={inviteText.joinSectionTitle}>
          <h2>{inviteText.joinSectionTitle}</h2>
          <p className="card-hint">{inviteText.joinHint}</p>
          <textarea
            aria-label="Invite URI"
            placeholder={inviteText.joinPlaceholder}
            value={props.inviteUri}
            onChange={(event) => props.onInviteUri(event.target.value)}
          />
          <div className="card-actions">
            <button
              className="btn btn-primary"
              type="button"
              onClick={props.onAccept}
              disabled={!canAccept}
            >
              {inviteText.joinButton}
            </button>
          </div>
        </section>

        <section className="card" aria-label={channelText.cardTitle}>
          <h2>{channelText.cardTitle}</h2>
          <p className="card-hint">{channelText.cardHint}</p>
          <Field label={channelText.nameLabel}>
            <input
              aria-label="Channel name"
              placeholder={channelText.namePlaceholder}
              value={props.channelName}
              onChange={(event) => props.onChannelName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && canJoinChannel) {
                  event.preventDefault();
                  props.onJoinChannel();
                }
              }}
            />
          </Field>
          <div className="card-actions">
            <button
              className="btn btn-primary"
              type="button"
              onClick={props.onJoinChannel}
              disabled={!canJoinChannel}
            >
              {channelText.joinButton}
            </button>
          </div>
        </section>

        <section className="card" aria-label={groupText.createCardTitle}>
          <h2>{groupText.createCardTitle}</h2>
          <p className="card-hint">{groupText.createHint}</p>
          <Field label={groupText.labelLabel} hint={groupText.labelHint}>
            <input
              aria-label="Group label"
              placeholder={groupText.labelPlaceholder}
              value={props.groupLabel}
              onChange={(event) => props.onGroupLabel(event.target.value)}
            />
          </Field>
          <div className="card-actions">
            <button
              className="btn btn-primary"
              type="button"
              onClick={props.onCreateGroup}
              disabled={props.busy}
            >
              {hasGroupInvite ? groupText.recreateButton : groupText.createButton}
            </button>
            {hasGroupInvite ? (
              <button className="btn btn-ghost" type="button" onClick={props.onCopyGroupInvite}>
                {props.groupCreateState.copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                {props.groupCreateState.copied ? inviteText.copiedButton : inviteText.copyButton}
              </button>
            ) : null}
          </div>
          {hasGroupInvite ? (
            <code className="invite-code">{props.groupCreateState.inviteUri}</code>
          ) : null}
        </section>

        <section className="card" aria-label={groupText.joinCardTitle}>
          <h2>{groupText.joinCardTitle}</h2>
          <p className="card-hint">{groupText.joinHint}</p>
          <textarea
            aria-label="Group invite URI"
            placeholder={groupText.joinPlaceholder}
            value={props.groupInvite}
            onChange={(event) => props.onGroupInvite(event.target.value)}
          />
          <div className="card-actions">
            <button
              className="btn btn-primary"
              type="button"
              onClick={props.onJoinGroup}
              disabled={!canJoinGroup}
            >
              {groupText.joinButton}
            </button>
          </div>
        </section>
      </div>

      {props.error ? <div className="inline-error">{props.error}</div> : null}
    </div>
  );
}

function ActiveDmChat(props: {
  session: SessionSnapshot;
  composer: string;
  confirmed: boolean;
  busy: boolean;
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

      <div className="chat-scroll scroll">
        <DmChatList messages={props.session.messages} />
      </div>

      <Composer
        value={props.composer}
        onChange={props.onComposer}
        onSend={props.onSend}
        disabled={!ready || props.busy}
      />
    </>
  );
}

function ActiveChannelChat(props: {
  channel: ChannelSnapshot;
  composer: string;
  busy: boolean;
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

      <div className="chat-scroll scroll">
        <ChannelChatList messages={props.channel.messages} />
      </div>

      <Composer
        value={props.composer}
        onChange={props.onComposer}
        onSend={props.onSend}
        disabled={props.busy}
      />
    </>
  );
}

function ActiveGroupChat(props: {
  group: GroupSnapshot;
  composer: string;
  busy: boolean;
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

      <div className="chat-scroll scroll">
        <GroupChatList messages={props.group.messages} />
      </div>

      <Composer
        value={props.composer}
        onChange={props.onComposer}
        onSend={props.onSend}
        disabled={!ready || props.busy}
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

function GroupChatList({ messages }: { messages: readonly GroupMessage[] }) {
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
        <GroupMessageRow message={message} key={`${message.from_fingerprint}-${index}`} />
      ))}
      <div ref={anchorRef} aria-hidden="true" />
    </div>
  );
}

function GroupMessageRow({ message }: { message: GroupMessage }) {
  return (
    <article className="message-row">
      <Avatar name={message.from_device} />
      <div className="message-body">
        <div className="message-meta">
          <strong>{message.from_device}</strong>
          <code className="device-fp">{shorten(message.from_fingerprint, 6)}</code>
          <code>MLS</code>
        </div>
        <p>{message.body}</p>
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

function DmChatList({ messages }: { messages: readonly ChatMessage[] }) {
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
        <DmMessageRow message={message} key={`${message.from_device}-${index}`} />
      ))}
      <div ref={anchorRef} aria-hidden="true" />
    </div>
  );
}

function DmMessageRow({ message }: { message: ChatMessage }) {
  return (
    <article className="message-row">
      <Avatar name={message.from_device} />
      <div className="message-body">
        <div className="message-meta">
          <strong>{message.from_device}</strong>
          <code>MLS</code>
        </div>
        <p>{message.body}</p>
        <div className="message-seal">
          <IconLock size={10} />
          <span>OpenMLS · sealed</span>
        </div>
      </div>
    </article>
  );
}

function ChannelChatList({ messages }: { messages: readonly ChannelMessage[] }) {
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
        <ChannelMessageRow message={message} key={`${message.from_fingerprint}-${index}`} />
      ))}
      <div ref={anchorRef} aria-hidden="true" />
    </div>
  );
}

function ChannelMessageRow({ message }: { message: ChannelMessage }) {
  return (
    <article className="message-row">
      <Avatar name={message.from_device} />
      <div className="message-body">
        <div className="message-meta">
          <strong>{message.from_device}</strong>
          <code className="device-fp">{shorten(message.from_fingerprint, 6)}</code>
        </div>
        <p>{message.body}</p>
      </div>
    </article>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  disabled,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSend: (event: FormEvent) => void;
}) {
  return (
    <form className="composer" onSubmit={onSend}>
      <div className="composer-box">
        <input
          aria-label="Message"
          placeholder={chatText.composerPlaceholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
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
