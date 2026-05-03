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
  IconSearch,
  IconSend,
  IconSettings,
  IconShieldCheck,
  IconVideo,
} from "@tabler/icons-react";
import { useState } from "react";
import { contacts, diagnostics, dmText, inviteText, messages, shellText, trustSteps } from "./private-dm.content";

const ICON_SIZE = 16;
const RAIL_ICON_SIZE = 20;

export function PrivateDmScreen() {
  const [fingerprintConfirmed, setFingerprintConfirmed] = useState(false);

  return (
    <main className="mosh-window" aria-label={shellText.productName}>
      <TitleBar />
      <div className="desktop-body">
        <SpacesRail />
        <DirectColumn onConfirm={() => setFingerprintConfirmed(true)} confirmed={fingerprintConfirmed} />
        <ChatPane confirmed={fingerprintConfirmed} />
        <DiagnosticsPanel />
      </div>
    </main>
  );
}

function TitleBar() {
  return (
    <header className="titlebar">
      <div className="traffic-dots" aria-hidden="true">
        <span className="dot-danger" />
        <span className="dot-warn" />
        <span className="dot-moss" />
      </div>
      <div className="titlebar-copy">
        <span>{shellText.productName}</span>
        <span>{shellText.windowSubtitle}</span>
      </div>
      <div className="titlebar-spacer" />
    </header>
  );
}

function SpacesRail() {
  return (
    <aside className="spaces-rail" aria-label={shellText.productName}>
      <RailButton active label={shellText.directTooltip}>
        <IconAt size={RAIL_ICON_SIZE} />
      </RailButton>
      <div className="rail-divider" />
      <RailSpace label="Moss Core" short="MC" active />
      <RailSpace label="Signal Hut" short="SH" unread="2" />
      <RailSpace label="North Field" short="NF" />
      <button className="rail-add" type="button" aria-label="Add space">
        <IconPlus size={18} />
      </button>
      <div className="rail-fill" />
      <RailButton label={shellText.exploreTooltip}>
        <IconCompass size={RAIL_ICON_SIZE} />
      </RailButton>
      <RailButton label={shellText.settingsTooltip}>
        <IconSettings size={RAIL_ICON_SIZE} />
      </RailButton>
    </aside>
  );
}

function RailButton({ active, label, children }: { active?: boolean; label: string; children: React.ReactNode }) {
  return (
    <div className="rail-slot">
      <span className={active ? "rail-pill rail-pill-active" : "rail-pill"} />
      <button className={active ? "rail-button rail-button-active" : "rail-button"} type="button" aria-label={label}>
        {children}
      </button>
    </div>
  );
}

function RailSpace({ active, label, short, unread }: { active?: boolean; label: string; short: string; unread?: string }) {
  return (
    <div className="rail-slot">
      <span className={active ? "rail-pill rail-pill-active" : "rail-pill"} />
      <button className={active ? "space-button space-button-active" : "space-button"} type="button" title={label}>
        {short}
        {unread ? <span className="space-unread">{unread}</span> : null}
      </button>
    </div>
  );
}

function DirectColumn({ confirmed, onConfirm }: { confirmed: boolean; onConfirm: () => void }) {
  return (
    <aside className="middle-column" aria-label={inviteText.header}>
      <header className="middle-header">
        <strong>{inviteText.header}</strong>
        <button className="btn btn-ghost btn-icon" type="button" aria-label={inviteText.createLabel}>
          <IconPlus size={ICON_SIZE} />
        </button>
      </header>
      <div className="middle-scroll scroll">
        <div className="search-box">
          <IconSearch size={14} />
          <span>{inviteText.searchPlaceholder}</span>
        </div>
        <SectionLabel>{inviteText.pinnedLabel}</SectionLabel>
        {contacts.map((contact) => (
          <ContactRow contact={contact} key={contact.id} />
        ))}
        <InviteCard confirmed={confirmed} onConfirm={onConfirm} />
        <TrustRail />
      </div>
      <UserCard />
    </aside>
  );
}

function ContactRow({ contact }: { contact: (typeof contacts)[number] }) {
  return (
    <article className={contact.active ? "dm-row dm-row-active" : "dm-row"}>
      <Avatar name={contact.name} presence={contact.presence} />
      <div className="dm-row-copy">
        <div className="dm-row-title">
          <strong>{contact.name}</strong>
          <span>{contact.time}</span>
        </div>
        <div className="dm-row-preview">
          {contact.presence === "pending" ? <IconClock size={11} /> : null}
          <span>{contact.preview}</span>
          {contact.unread ? <b>{contact.unread}</b> : null}
        </div>
      </div>
    </article>
  );
}

function InviteCard({ confirmed, onConfirm }: { confirmed: boolean; onConfirm: () => void }) {
  return (
    <section className="invite-card" aria-label={inviteText.createLabel}>
      <div className="invite-actions">
        <button className="btn btn-primary" type="button">
          <IconCopy size={14} />
          {inviteText.createLabel}
        </button>
        <button className="btn btn-ghost" type="button">
          {inviteText.pasteLabel}
        </button>
      </div>
      <code>{inviteText.inviteValue}</code>
      <div className="fingerprint-line">
        <span>{inviteText.fingerprintLabel}</span>
        <strong>{inviteText.fingerprintValue}</strong>
      </div>
      <button className="btn btn-primary btn-full" type="button" onClick={onConfirm}>
        <IconCheck size={14} />
        {confirmed ? inviteText.confirmedLabel : inviteText.confirmLabel}
      </button>
    </section>
  );
}

function TrustRail() {
  return (
    <ol className="trust-list" aria-label="Private trust setup">
      {trustSteps.map(([label, state]) => (
        <li key={label}>
          <span>{label}</span>
          <strong>{state}</strong>
        </li>
      ))}
    </ol>
  );
}

function ChatPane({ confirmed }: { confirmed: boolean }) {
  return (
    <section className="chat-pane" aria-labelledby="dm-title">
      <header className="chat-header">
        <Avatar name={dmText.contactName} presence="online" size="small" />
        <div className="chat-title">
          <h1 id="dm-title">{dmText.contactName}</h1>
          <p>{confirmed ? "Direct · fingerprint confirmed · MLS ready" : dmText.contactSubtitle}</p>
        </div>
        <div className="chat-actions">
          <IconButton label="Call"><IconPhone size={ICON_SIZE} /></IconButton>
          <IconButton label="Video"><IconVideo size={ICON_SIZE} /></IconButton>
          <IconButton label="More"><IconDots size={ICON_SIZE} /></IconButton>
        </div>
      </header>
      <div className="chat-scroll scroll">
        <CryptoBanner />
        <DayDivider />
        {messages.map((message) => (
          <MessageRow message={message} key={message.id} />
        ))}
      </div>
      <Composer />
    </section>
  );
}

function CryptoBanner() {
  return (
    <section className="crypto-banner">
      <div className="crypto-icon"><IconShieldCheck size={18} /></div>
      <div>
        <strong>{dmText.bannerTitle}</strong>
        <p>{dmText.bannerBody}</p>
      </div>
    </section>
  );
}

function MessageRow({ message }: { message: (typeof messages)[number] }) {
  const isMe = message.from === "me";

  return (
    <article className="message-row">
      <Avatar name={message.name} />
      <div className="message-body">
        <div className="message-meta">
          <strong className={isMe ? "message-author-self" : undefined}>{message.name}</strong>
          <code>{message.key}</code>
          <span>{message.time}</span>
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

function Composer() {
  return (
    <footer className="composer">
      <div className="composer-box">
        <IconButton label="Add"><IconPlus size={ICON_SIZE} /></IconButton>
        <input aria-label={dmText.composerPlaceholder} placeholder={dmText.composerPlaceholder} />
        <IconButton label="Attach"><IconPaperclip size={ICON_SIZE} /></IconButton>
        <button className="send-button" type="button" aria-label="Send message">
          <IconSend size={14} />
        </button>
      </div>
      <div className="composer-footnote">
        <IconLock size={10} />
        <span>{dmText.footerCrypto}</span>
      </div>
    </footer>
  );
}

function DiagnosticsPanel() {
  return (
    <aside className="diagnostics-panel" aria-labelledby="diagnostics-title">
      <header>
        <IconMessageCircle size={18} />
        <h2 id="diagnostics-title">Peer status</h2>
        <IconChevronDown size={14} />
      </header>
      {diagnostics.map(([label, value]) => (
        <div className="diagnostic-row" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </aside>
  );
}

function UserCard() {
  return (
    <footer className="user-card">
      <Avatar name={shellText.userName} presence="online" size="small" />
      <div>
        <strong>{shellText.userName}</strong>
        <code>{shellText.userKey}</code>
      </div>
      <IconButton label="Copy key"><IconCopy size={14} /></IconButton>
      <IconButton label="Mute"><IconMicrophone size={14} /></IconButton>
    </footer>
  );
}

function Avatar({ name, presence, size }: { name: string; presence?: string; size?: "small" }) {
  const initials = name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  return (
    <span className={size === "small" ? "avatar avatar-small" : "avatar"}>
      {initials}
      {presence ? <span className={`avatar-presence presence-${presence}`} /> : null}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="section-label">{children}</div>;
}

function DayDivider() {
  return <div className="day-divider"><span>{dmText.dayLabel}</span></div>;
}

function IconButton({ children, label }: { children: React.ReactNode; label: string }) {
  return <button className="btn btn-ghost btn-icon" type="button" aria-label={label}>{children}</button>;
}
