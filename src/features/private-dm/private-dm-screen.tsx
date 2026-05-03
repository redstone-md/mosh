import {
  IconAt,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconCompass,
  IconCopy,
  IconDots,
  IconLock,
  IconMessageCircle,
  IconMicrophone,
  IconPaperclip,
  IconPhone,
  IconPlus,
  IconRefresh,
  IconSend,
  IconSettings,
  IconShieldCheck,
  IconVideo,
} from "@tabler/icons-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { contacts, diagnostics, dmText, inviteText, messages, shellText, trustSteps } from "./private-dm.content";
import { ChatMessage, NativeMessagingGateway, SessionSnapshot, nativeMessagingGateway } from "./native/native-messaging-gateway";

const ICON_SIZE = 16;
const RAIL_ICON_SIZE = 20;
const DEFAULT_LISTEN_PORT = 42130;
const DEFAULT_DISPLAY_NAME = "Mosh Device";
const READY_STATE = "ready";
const AUTO_POLL_MS = 1000;

interface RuntimeUiState {
  readonly createdInvite?: string;
  readonly listenAddress?: string;
  readonly snapshot?: SessionSnapshot;
  readonly error?: string;
  readonly busy: boolean;
}

export function PrivateDmScreen({ gateway = nativeMessagingGateway }: { gateway?: NativeMessagingGateway }) {
  const [fingerprintConfirmed, setFingerprintConfirmed] = useState(false);
  const [displayName, setDisplayName] = useState(DEFAULT_DISPLAY_NAME);
  const [listenPort, setListenPort] = useState(DEFAULT_LISTEN_PORT);
  const [staticPeer, setStaticPeer] = useState("");
  const [inviteUri, setInviteUri] = useState("");
  const [composer, setComposer] = useState("");
  const [sessionActive, setSessionActive] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeUiState>({ busy: false });
  const pollInFlight = useRef(false);

  const run = async (action: () => Promise<Partial<RuntimeUiState>>) => {
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
        setRuntime((state) => ({ ...state, snapshot, busy: quiet ? state.busy : false, error: undefined }));
      } catch (error) {
        setRuntime((state) => ({ ...state, busy: quiet ? state.busy : false, error: readableError(error) }));
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

  const createInvite = () =>
    run(async () => {
      const invite = await gateway.createPrivateInvite({
        display_name: displayName,
        listen_port: listenPort,
        static_peer: emptyToNull(staticPeer),
      });
      await copyText(invite.invite_uri);
      setSessionActive(true);
      return { createdInvite: invite.invite_uri, listenAddress: invite.listen_address };
    });

  const acceptInvite = () =>
    run(async () => {
      const snapshot = await gateway.acceptPrivateInvite({
        invite_uri: inviteUri,
        display_name: displayName,
        listen_port: listenPort,
        static_peer: emptyToNull(staticPeer),
      });
      setSessionActive(true);
      return { snapshot };
    });

  const poll = () => void refreshSession(false);

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

  return (
    <main className="mosh-window" aria-label={shellText.productName}>
      <TitleBar />
      <div className="desktop-body">
        <SpacesRail />
        <DirectColumn
          confirmed={fingerprintConfirmed}
          displayName={displayName}
          inviteUri={inviteUri}
          listenPort={listenPort}
          runtime={runtime}
          staticPeer={staticPeer}
          onAccept={acceptInvite}
          onConfirm={() => setFingerprintConfirmed(true)}
          onCreate={createInvite}
          onDisplayName={setDisplayName}
          onInviteUri={setInviteUri}
          onListenPort={setListenPort}
          onStaticPeer={setStaticPeer}
        />
        <ChatPane
          composer={composer}
          confirmed={fingerprintConfirmed}
          runtimeMessages={runtime.snapshot?.messages ?? []}
          state={runtime.snapshot?.state ?? "waiting"}
          onComposer={setComposer}
          onPoll={poll}
          onSend={send}
        />
        <DiagnosticsPanel runtime={runtime} onPoll={poll} />
      </div>
    </main>
  );
}

function TitleBar() {
  return (
    <header className="titlebar">
      <div className="traffic-dots" aria-hidden="true"><span className="dot-danger" /><span className="dot-warn" /><span className="dot-moss" /></div>
      <div className="titlebar-copy"><span>{shellText.productName}</span><span>{shellText.windowSubtitle}</span></div>
      <div className="titlebar-spacer" />
    </header>
  );
}

function SpacesRail() {
  return (
    <aside className="spaces-rail" aria-label={shellText.productName}>
      <RailButton active label={shellText.directTooltip}><IconAt size={RAIL_ICON_SIZE} /></RailButton>
      <div className="rail-divider" />
      <RailSpace label="Moss Core" short="MC" active />
      <RailSpace label="Signal Hut" short="SH" unread="2" />
      <RailSpace label="North Field" short="NF" />
      <button className="rail-add" type="button" aria-label="Add space"><IconPlus size={18} /></button>
      <div className="rail-fill" />
      <RailButton label={shellText.exploreTooltip}><IconCompass size={RAIL_ICON_SIZE} /></RailButton>
      <RailButton label={shellText.settingsTooltip}><IconSettings size={RAIL_ICON_SIZE} /></RailButton>
    </aside>
  );
}

function DirectColumn(props: {
  confirmed: boolean;
  displayName: string;
  inviteUri: string;
  listenPort: number;
  runtime: RuntimeUiState;
  staticPeer: string;
  onAccept: () => void;
  onConfirm: () => void;
  onCreate: () => void;
  onDisplayName: (value: string) => void;
  onInviteUri: (value: string) => void;
  onListenPort: (value: number) => void;
  onStaticPeer: (value: string) => void;
}) {
  return (
    <aside className="middle-column" aria-label={inviteText.header}>
      <header className="middle-header"><strong>{inviteText.header}</strong><button className="btn btn-ghost btn-icon" type="button" onClick={props.onCreate} aria-label={inviteText.createLabel}><IconPlus size={ICON_SIZE} /></button></header>
      <div className="middle-scroll scroll">
        <RuntimeFields {...props} />
        <SectionLabel>{inviteText.pinnedLabel}</SectionLabel>
        {contacts.map((contact) => <ContactRow contact={contact} key={contact.id} />)}
        <InviteCard {...props} />
        <TrustRail />
      </div>
      <UserCard />
    </aside>
  );
}

function RuntimeFields(props: Parameters<typeof DirectColumn>[0]) {
  return (
    <section className="runtime-fields" aria-label="Mosh device setup">
      <input aria-label="Display name" value={props.displayName} onChange={(event) => props.onDisplayName(event.target.value)} />
      <input aria-label="Listen port" type="number" value={props.listenPort} onChange={(event) => props.onListenPort(Number(event.target.value))} />
      <input aria-label="Static peer" placeholder="peer host:port" value={props.staticPeer} onChange={(event) => props.onStaticPeer(event.target.value)} />
      <textarea aria-label="Invite URI" placeholder="mosh://invite?..." value={props.inviteUri} onChange={(event) => props.onInviteUri(event.target.value)} />
    </section>
  );
}

function InviteCard(props: Parameters<typeof DirectColumn>[0]) {
  const shownInvite = props.runtime.createdInvite || props.inviteUri || inviteText.inviteValue;
  const shownFingerprint = props.runtime.snapshot?.fingerprint || inviteText.fingerprintValue;
  return (
    <section className="invite-card" aria-label={inviteText.createLabel}>
      <div className="invite-actions">
        <button className="btn btn-primary" type="button" onClick={props.onCreate} disabled={props.runtime.busy}><IconCopy size={14} />{inviteText.createLabel}</button>
        <button className="btn btn-ghost" type="button" onClick={props.onAccept} disabled={!props.confirmed || props.runtime.busy}>{inviteText.pasteLabel}</button>
      </div>
      <code>{shownInvite}</code>
      <div className="fingerprint-line"><span>{inviteText.fingerprintLabel}</span><strong>{shownFingerprint}</strong></div>
      <button className="btn btn-primary btn-full" type="button" onClick={props.onConfirm}><IconCheck size={14} />{props.confirmed ? inviteText.confirmedLabel : inviteText.confirmLabel}</button>
    </section>
  );
}

function ChatPane(props: { composer: string; confirmed: boolean; runtimeMessages: readonly ChatMessage[]; state: string; onComposer: (value: string) => void; onPoll: () => void; onSend: (event: FormEvent) => void }) {
  const ready = props.state === READY_STATE;
  return (
    <section className="chat-pane" aria-labelledby="dm-title">
      <header className="chat-header"><Avatar name={dmText.contactName} presence={ready ? "online" : "pending"} size="small" /><div className="chat-title"><h1 id="dm-title">{dmText.contactName}</h1><p>{props.confirmed ? `Direct · fingerprint confirmed · MLS ${props.state}` : dmText.contactSubtitle}</p></div><div className="chat-actions"><IconButton label="Poll" onClick={props.onPoll}><IconRefresh size={ICON_SIZE} /></IconButton><IconButton label="Call"><IconPhone size={ICON_SIZE} /></IconButton><IconButton label="Video"><IconVideo size={ICON_SIZE} /></IconButton><IconButton label="More"><IconDots size={ICON_SIZE} /></IconButton></div></header>
      <div className="chat-scroll scroll"><CryptoBanner /><DayDivider />{messages.map((message) => <MessageRow message={message} key={message.id} />)}{props.runtimeMessages.map((message, index) => <RuntimeMessageRow message={message} key={`${message.from_device}-${index}`} />)}</div>
      <Composer value={props.composer} onChange={props.onComposer} onSend={props.onSend} />
    </section>
  );
}

function DiagnosticsPanel({ runtime, onPoll }: { runtime: RuntimeUiState; onPoll: () => void }) {
  return (
    <aside className="diagnostics-panel" aria-labelledby="diagnostics-title">
      <header><IconMessageCircle size={18} /><h2 id="diagnostics-title">Peer status</h2><button className="btn btn-ghost btn-icon" type="button" onClick={onPoll} aria-label="Poll session"><IconChevronDown size={14} /></button></header>
      {diagnostics.map(([label, value]) => <div className="diagnostic-row" key={label}><span>{label}</span><strong>{value}</strong></div>)}
      <div className="diagnostic-row"><span>MLS state</span><strong>{runtime.snapshot?.state ?? "waiting"}</strong></div>
      <div className="diagnostic-row"><span>Listen address</span><strong>{runtime.listenAddress ?? "local"}</strong></div>
      {runtime.error ? <div className="diagnostic-row diagnostic-error"><span>Runtime error</span><strong>{runtime.error}</strong></div> : null}
    </aside>
  );
}

function Composer({ value, onChange, onSend }: { value: string; onChange: (value: string) => void; onSend: (event: FormEvent) => void }) {
  return <form className="composer" onSubmit={onSend}><div className="composer-box"><IconButton label="Add"><IconPlus size={ICON_SIZE} /></IconButton><input aria-label={dmText.composerPlaceholder} placeholder={dmText.composerPlaceholder} value={value} onChange={(event) => onChange(event.target.value)} /><IconButton label="Attach"><IconPaperclip size={ICON_SIZE} /></IconButton><button className="send-button" type="submit" aria-label="Send message"><IconSend size={14} /></button></div><div className="composer-footnote"><IconLock size={10} /><span>{dmText.footerCrypto}</span></div></form>;
}

function ContactRow({ contact }: { contact: (typeof contacts)[number] }) {
  return <article className={contact.active ? "dm-row dm-row-active" : "dm-row"}><Avatar name={contact.name} presence={contact.presence} /><div className="dm-row-copy"><div className="dm-row-title"><strong>{contact.name}</strong><span>{contact.time}</span></div><div className="dm-row-preview">{contact.presence === "pending" ? <IconClock size={11} /> : null}<span>{contact.preview}</span>{contact.unread ? <b>{contact.unread}</b> : null}</div></div></article>;
}

function RuntimeMessageRow({ message }: { message: ChatMessage }) {
  return <article className="message-row"><Avatar name={message.from_device} /><div className="message-body"><div className="message-meta"><strong>{message.from_device}</strong><code>MLS</code><span>now</span></div><p>{message.body}</p><div className="message-seal"><IconLock size={10} /><span>OpenMLS · sealed</span></div></div></article>;
}

function MessageRow({ message }: { message: (typeof messages)[number] }) {
  const isMe = message.from === "me";
  return <article className="message-row"><Avatar name={message.name} /><div className="message-body"><div className="message-meta"><strong className={isMe ? "message-author-self" : undefined}>{message.name}</strong><code>{message.key}</code><span>{message.time}</span></div><p>{message.body}</p><div className="message-seal"><IconLock size={10} /><span>OpenMLS · sealed</span></div></div></article>;
}

function TrustRail() { return <ol className="trust-list" aria-label="Private trust setup">{trustSteps.map(([label, state]) => <li key={label}><span>{label}</span><strong>{state}</strong></li>)}</ol>; }
function CryptoBanner() { return <section className="crypto-banner"><div className="crypto-icon"><IconShieldCheck size={18} /></div><div><strong>{dmText.bannerTitle}</strong><p>{dmText.bannerBody}</p></div></section>; }
function DayDivider() { return <div className="day-divider"><span>{dmText.dayLabel}</span></div>; }
function SectionLabel({ children }: { children: React.ReactNode }) { return <div className="section-label">{children}</div>; }
function UserCard() { return <footer className="user-card"><Avatar name={shellText.userName} presence="online" size="small" /><div><strong>{shellText.userName}</strong><code>{shellText.userKey}</code></div><IconButton label="Copy key"><IconCopy size={14} /></IconButton><IconButton label="Mute"><IconMicrophone size={14} /></IconButton></footer>; }
function RailButton({ active, label, children }: { active?: boolean; label: string; children: React.ReactNode }) { return <div className="rail-slot"><span className={active ? "rail-pill rail-pill-active" : "rail-pill"} /><button className={active ? "rail-button rail-button-active" : "rail-button"} type="button" aria-label={label}>{children}</button></div>; }
function RailSpace({ active, label, short, unread }: { active?: boolean; label: string; short: string; unread?: string }) { return <div className="rail-slot"><span className={active ? "rail-pill rail-pill-active" : "rail-pill"} /><button className={active ? "space-button space-button-active" : "space-button"} type="button" title={label}>{short}{unread ? <span className="space-unread">{unread}</span> : null}</button></div>; }
function Avatar({ name, presence, size }: { name: string; presence?: string; size?: "small" }) { const initials = name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(); return <span className={size === "small" ? "avatar avatar-small" : "avatar"}>{initials}{presence ? <span className={`avatar-presence presence-${presence}`} /> : null}</span>; }
function IconButton({ children, label, onClick }: { children: React.ReactNode; label: string; onClick?: () => void }) { return <button className="btn btn-ghost btn-icon" type="button" aria-label={label} onClick={onClick}>{children}</button>; }
function emptyToNull(value: string): string | null { const trimmed = value.trim(); return trimmed ? trimmed : null; }
function readableError(error: unknown): string { return error instanceof Error ? error.message : String(error); }
async function copyText(value: string): Promise<void> { await navigator.clipboard?.writeText?.(value); }

