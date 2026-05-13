import {
  IconActivity,
  IconCheck,
  IconCopy,
  IconLock,
  IconMessageCircle,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconSend,
  IconShieldCheck,
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
} from "./private-dm.content";
import {
  ChatMessage,
  MeshInfo,
  NativeMessagingGateway,
  SessionSnapshot,
  SnapshotEvent,
  nativeMessagingGateway,
} from "./native/native-messaging-gateway";

const AUTO_POLL_MS = 1000;
const READY_STATE = "ready";
const DEFAULT_LISTEN_PORT = 0;

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
  const [composer, setComposer] = useState("");
  const [sessions, setSessions] = useState<readonly SessionSnapshot[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [confirmedFingerprints, setConfirmedFingerprints] = useState<Set<string>>(new Set());
  const [createState, setCreateState] = useState<CreateState>({ copied: false });
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const pollInFlight = useRef(false);

  const sessionRequestBase = useMemo(
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
        const list = await gateway.listPrivateSessions();
        setSessions(list.sessions);
        setActiveSessionId((current) => {
          if (current && list.sessions.some((session) => session.session_id === current)) {
            return current;
          }
          return list.sessions[0]?.session_id ?? null;
        });
        if (!quiet) {
          setBusy(false);
          setError(undefined);
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
      const invite = await gateway.createPrivateInvite(sessionRequestBase);
      await copyText(invite.invite_uri);
      setCreateState({ inviteUri: invite.invite_uri, copied: true });
      setActiveSessionId(invite.session_id);
      setShowSetup(true);
      await refresh(true);
    });

  const acceptInvite = () =>
    run(async () => {
      const snapshot = await gateway.acceptPrivateInvite({
        ...sessionRequestBase,
        invite_uri: inviteUri.trim(),
      });
      setInviteUri("");
      setActiveSessionId(snapshot.session_id);
      setShowSetup(false);
      await refresh(true);
    });

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
    if (!body || !activeSessionId) {
      return;
    }
    void run(async () => {
      await gateway.sendPrivateMessage(activeSessionId, body);
      setComposer("");
      await refresh(true);
    });
  };

  const closeSession = (sessionId: string) =>
    run(async () => {
      await gateway.closePrivateSession(sessionId);
      setConfirmedFingerprints((current) => {
        const next = new Set(current);
        next.delete(sessionId);
        return next;
      });
      await refresh(true);
    });

  const confirmFingerprint = (sessionId: string) =>
    setConfirmedFingerprints((current) => new Set(current).add(sessionId));

  const activeSession = sessions.find((session) => session.session_id === activeSessionId) ?? null;
  const showWelcome = sessions.length === 0 || showSetup;

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
        ) : null}
      </header>

      <div className="desktop-body">
        <SessionRail
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={(id) => {
            setActiveSessionId(id);
            setShowSetup(false);
          }}
          onNew={() => {
            setShowSetup(true);
            setActiveSessionId(null);
            setCreateState({ copied: false });
          }}
        />

        <section className="chat-pane" aria-labelledby="chat-title">
          {showWelcome ? (
            <NewSessionPanel
              displayName={displayName}
              staticPeer={staticPeer}
              listenPort={listenPort}
              inviteUri={inviteUri}
              busy={busy}
              createState={createState}
              error={error}
              onDisplayName={setDisplayName}
              onStaticPeer={setStaticPeer}
              onListenPort={setListenPort}
              onInviteUri={setInviteUri}
              onCreate={createInvite}
              onAccept={acceptInvite}
              onCopyInvite={copyInvite}
            />
          ) : activeSession ? (
            <ActiveChat
              session={activeSession}
              composer={composer}
              confirmed={confirmedFingerprints.has(activeSession.session_id)}
              busy={busy}
              error={error}
              onComposer={setComposer}
              onSend={sendMessage}
              onConfirm={() => confirmFingerprint(activeSession.session_id)}
              onClose={() => closeSession(activeSession.session_id)}
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
  activeSessionId,
  onSelect,
  onNew,
}: {
  sessions: readonly SessionSnapshot[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
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
            key={session.session_id}
            session={session}
            active={session.session_id === activeSessionId}
            onClick={() => onSelect(session.session_id)}
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
      className={`rail-item ${active ? "rail-item-active" : ""} rail-item-${session.state}`}
      onClick={onClick}
      title={`${label} · ${stateLabels[session.state] ?? session.state}`}
      aria-label={`Open session with ${label}`}
    >
      <Avatar name={label} />
      <span className={`rail-dot rail-dot-${session.state}`} />
    </button>
  );
}

function NewSessionPanel(props: {
  displayName: string;
  staticPeer: string;
  listenPort: number;
  inviteUri: string;
  busy: boolean;
  createState: CreateState;
  error?: string;
  onDisplayName: (value: string) => void;
  onStaticPeer: (value: string) => void;
  onListenPort: (value: number) => void;
  onInviteUri: (value: string) => void;
  onCreate: () => void;
  onAccept: () => void;
  onCopyInvite: () => void;
}) {
  const hasInvite = Boolean(props.createState.inviteUri);
  const canAccept = props.inviteUri.trim().length > 0 && !props.busy;
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
      </div>

      {props.error ? <div className="inline-error">{props.error}</div> : null}
    </div>
  );
}

function ActiveChat(props: {
  session: SessionSnapshot;
  composer: string;
  confirmed: boolean;
  busy: boolean;
  error?: string;
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
        <ChatList messages={props.session.messages} />
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

function ChatList({ messages }: { messages: readonly ChatMessage[] }) {
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
        <MessageRow message={message} key={`${message.from_device}-${index}`} />
      ))}
      <div ref={anchorRef} aria-hidden="true" />
    </div>
  );
}

function MessageRow({ message }: { message: ChatMessage }) {
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
