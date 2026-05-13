import {
  IconActivity,
  IconCheck,
  IconCopy,
  IconLock,
  IconPlugConnected,
  IconRefresh,
  IconSend,
  IconShieldCheck,
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

interface RuntimeState {
  readonly createdInvite?: string;
  readonly listenAddress?: string;
  readonly snapshot?: SessionSnapshot;
  readonly error?: string;
  readonly busy: boolean;
  readonly copied: boolean;
}

const INITIAL_RUNTIME: RuntimeState = { busy: false, copied: false };

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
  const [fingerprintConfirmed, setFingerprintConfirmed] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeState>(INITIAL_RUNTIME);
  const pollInFlight = useRef(false);

  const run = async (action: () => Promise<Partial<RuntimeState>>) => {
    setRuntime((state) => ({ ...state, busy: true, error: undefined }));
    try {
      const next = await action();
      setRuntime((state) => ({ ...state, ...next, busy: false }));
    } catch (error) {
      setRuntime((state) => ({ ...state, busy: false, error: readableError(error) }));
    }
  };

  const refreshSession = useCallback(
    async (quiet = false) => {
      if (pollInFlight.current) {
        return;
      }
      pollInFlight.current = true;
      if (!quiet) {
        setRuntime((state) => ({ ...state, busy: true, error: undefined }));
      }
      try {
        const snapshot = await gateway.pollPrivateSession();
        setRuntime((state) => ({
          ...state,
          snapshot,
          busy: quiet ? state.busy : false,
          error: undefined,
        }));
      } catch (error) {
        setRuntime((state) => ({
          ...state,
          busy: quiet ? state.busy : false,
          error: readableError(error),
        }));
      } finally {
        pollInFlight.current = false;
      }
    },
    [gateway],
  );

  useEffect(() => {
    if (!sessionActive) {
      return;
    }
    void refreshSession(true);
    const intervalId = window.setInterval(() => void refreshSession(true), AUTO_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [refreshSession, sessionActive]);

  const sessionRequestBase = useMemo(
    () => ({
      display_name: displayName.trim() || defaultDisplayName(),
      listen_port: Number.isFinite(listenPort) ? listenPort : DEFAULT_LISTEN_PORT,
      static_peer: staticPeer.trim() ? staticPeer.trim() : null,
    }),
    [displayName, listenPort, staticPeer],
  );

  const createInvite = () =>
    run(async () => {
      const invite = await gateway.createPrivateInvite(sessionRequestBase);
      await copyText(invite.invite_uri);
      setSessionActive(true);
      setFingerprintConfirmed(false);
      return {
        createdInvite: invite.invite_uri,
        listenAddress: invite.listen_address,
        copied: true,
      };
    });

  const acceptInvite = () =>
    run(async () => {
      const snapshot = await gateway.acceptPrivateInvite({
        ...sessionRequestBase,
        invite_uri: inviteUri.trim(),
      });
      setSessionActive(true);
      setFingerprintConfirmed(false);
      return { snapshot };
    });

  const copyInvite = async () => {
    const uri = runtime.createdInvite;
    if (!uri) {
      return;
    }
    await copyText(uri);
    setRuntime((state) => ({ ...state, copied: true }));
  };

  const send = (event: FormEvent) => {
    event.preventDefault();
    const body = composer.trim();
    if (!body) {
      return;
    }
    void run(async () => {
      await gateway.sendPrivateMessage(body);
      setComposer("");
      return { snapshot: await gateway.pollPrivateSession() };
    });
  };

  const snapshot = runtime.snapshot;
  const state = snapshot?.state ?? (sessionActive ? "waiting" : "idle");
  const stateLabel = stateLabels[state] ?? state;
  const ready = state === READY_STATE;
  const fingerprint = snapshot?.fingerprint ?? "";
  const canConnect = inviteUri.trim().length > 0 && !runtime.busy;

  return (
    <main className="mosh-window" aria-label={shellText.productName}>
      <header className="titlebar">
        <div className="brand">
          <IconShieldCheck size={18} />
          <strong>{shellText.productName}</strong>
        </div>
        <span className="titlebar-subtitle">{shellText.windowSubtitle}</span>
        <StatePill state={state} label={stateLabel} />
      </header>

      <div className="desktop-body">
        <aside className="side-panel" aria-label="Session setup">
          <SetupCard
            displayName={displayName}
            staticPeer={staticPeer}
            listenPort={listenPort}
            sessionActive={sessionActive}
            onDisplayName={setDisplayName}
            onStaticPeer={setStaticPeer}
            onListenPort={setListenPort}
          />

          <InviteCreateCard
            invite={runtime.createdInvite}
            copied={runtime.copied}
            busy={runtime.busy}
            onCreate={createInvite}
            onCopy={copyInvite}
          />

          <InviteJoinCard
            value={inviteUri}
            onChange={setInviteUri}
            onConnect={acceptInvite}
            canConnect={canConnect}
          />

          <FingerprintCard
            fingerprint={fingerprint}
            confirmed={fingerprintConfirmed}
            ready={ready}
            onConfirm={() => setFingerprintConfirmed(true)}
          />
        </aside>

        <section className="chat-pane" aria-labelledby="chat-title">
          <header className="chat-header">
            <div className="chat-title-block">
              <h1 id="chat-title">Direct channel</h1>
              <p>
                {fingerprintConfirmed
                  ? `MLS ${state} · fingerprint confirmed`
                  : `MLS ${state} · fingerprint unverified`}
              </p>
            </div>
            <div className="chat-state-line">
              <IconLock size={12} />
              <span>{chatText.cryptoFooter}</span>
            </div>
          </header>

          <CryptoNotice />

          <div className="chat-scroll scroll">
            <ChatList messages={snapshot?.messages ?? []} />
          </div>

          <Composer
            value={composer}
            onChange={setComposer}
            onSend={send}
            disabled={!ready || runtime.busy}
          />
        </section>

        <aside className="diagnostics-panel" aria-labelledby="diagnostics-title">
          <header>
            <IconPlugConnected size={16} />
            <h2 id="diagnostics-title">Peer status</h2>
            <button
              className="btn btn-ghost btn-icon"
              type="button"
              onClick={() => void refreshSession(false)}
              aria-label="Refresh status"
            >
              <IconRefresh size={14} />
            </button>
          </header>

          <DiagnosticGroup label="Session">
            <Row k="MLS state" v={stateLabel} />
            <Row k="Role" v={snapshot?.role ?? "—"} />
            <Row k="Channels" v={snapshot?.mesh?.channels?.join(", ") || "—"} />
          </DiagnosticGroup>

          <MeshDiagnostics mesh={snapshot?.mesh ?? null} listenAddress={runtime.listenAddress} />

          <EventLog events={snapshot?.events ?? []} />

          {runtime.error ? (
            <div className="diagnostic-row diagnostic-error">
              <span>Runtime error</span>
              <strong>{runtime.error}</strong>
            </div>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

function SetupCard(props: {
  displayName: string;
  staticPeer: string;
  listenPort: number;
  sessionActive: boolean;
  onDisplayName: (value: string) => void;
  onStaticPeer: (value: string) => void;
  onListenPort: (value: number) => void;
}) {
  return (
    <section className="card" aria-label={setupText.sectionTitle}>
      <div className="card-head">
        <h2>{setupText.sectionTitle}</h2>
        {props.sessionActive ? (
          <span className="badge">applies on next session</span>
        ) : null}
      </div>
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
  );
}

function InviteCreateCard(props: {
  invite: string | undefined;
  copied: boolean;
  busy: boolean;
  onCreate: () => void;
  onCopy: () => void;
}) {
  const hasInvite = Boolean(props.invite);
  return (
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
          <button className="btn btn-ghost" type="button" onClick={props.onCopy}>
            {props.copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            {props.copied ? inviteText.copiedButton : inviteText.copyButton}
          </button>
        ) : null}
      </div>
      {hasInvite ? <code className="invite-code">{props.invite}</code> : null}
    </section>
  );
}

function InviteJoinCard(props: {
  value: string;
  canConnect: boolean;
  onChange: (value: string) => void;
  onConnect: () => void;
}) {
  return (
    <section className="card" aria-label={inviteText.joinSectionTitle}>
      <h2>{inviteText.joinSectionTitle}</h2>
      <p className="card-hint">{inviteText.joinHint}</p>
      <textarea
        aria-label="Invite URI"
        placeholder={inviteText.joinPlaceholder}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <div className="card-actions">
        <button
          className="btn btn-primary"
          type="button"
          onClick={props.onConnect}
          disabled={!props.canConnect}
        >
          {inviteText.joinButton}
        </button>
      </div>
    </section>
  );
}

function FingerprintCard(props: {
  fingerprint: string;
  confirmed: boolean;
  ready: boolean;
  onConfirm: () => void;
}) {
  const display = props.fingerprint
    ? props.fingerprint.match(/.{1,4}/g)?.join(" ")
    : "— waiting for peer —";
  return (
    <section className="card" aria-label={inviteText.fingerprintLabel}>
      <h2>{inviteText.fingerprintLabel}</h2>
      <p className="card-hint">{inviteText.fingerprintHint}</p>
      <code className="fingerprint-display">{display}</code>
      <div className="card-actions">
        <button
          className="btn btn-primary btn-full"
          type="button"
          onClick={props.onConfirm}
          disabled={!props.fingerprint || props.confirmed}
        >
          <IconCheck size={14} />
          {props.confirmed ? inviteText.confirmedButton : inviteText.confirmButton}
        </button>
      </div>
    </section>
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

function MeshDiagnostics({
  mesh,
  listenAddress,
}: {
  mesh: MeshInfo | null;
  listenAddress: string | undefined;
}) {
  if (!mesh) {
    return (
      <DiagnosticGroup label="Moss network">
        <Row k="Discovery" v={listenAddress || "default public trackers"} />
        <Row k="Peers" v="—" />
      </DiagnosticGroup>
    );
  }
  return (
    <DiagnosticGroup label="Moss network">
      <Row k="NAT type" v={mesh.nat_type || "unknown"} />
      <Row k="Advertised" v={mesh.advertised_addr || "—"} />
      <Row k="Listen port" v={String(mesh.listen_port)} />
      <Row k="Peers" v={`${mesh.peer_count} (${mesh.direct_peer_count} direct / ${mesh.relayed_peer_count} relayed)`} />
      <Row k="Known" v={String(mesh.known_peer_count)} />
      <Row k="Relay sessions" v={String(mesh.relay_session_count)} />
      <Row k="Supernode" v={mesh.supernode_ready ? "ready" : "no"} />
      <Row k="Mesh id" v={shorten(mesh.mesh_id, 16)} />
      <Row k="Public key" v={shorten(mesh.public_key, 16)} />
    </DiagnosticGroup>
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

function DiagnosticGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="diagnostic-group">
      <div className="diagnostic-group-label">{label}</div>
      {children}
    </div>
  );
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
