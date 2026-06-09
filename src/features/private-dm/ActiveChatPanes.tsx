import {
  IconCheck,
  IconCopy,
  IconCrown,
  IconHash,
  IconLock,
  IconLogout,
  IconMessageCircle,
  IconPhone,
  IconPlus,
  IconShieldCheck,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import { ChatDropZone, Composer } from "./ChatComposer";
import {
  ConversationTools,
  type ConversationToolsState,
} from "./ConversationTools";
import { copyText } from "./clipboard";
import {
  ChannelChatList,
  DmChatList,
  GroupChatList,
  type PeerActions,
} from "./MessageLists";
import type { AttachmentApi } from "./use-chat-orchestration";
import type {
  ChannelSnapshot,
  GroupSnapshot,
  SessionSnapshot,
} from "./native/native-messaging-gateway";
import {
  channelText,
  chatText,
  groupText,
  inviteText,
  shellText,
} from "./private-dm.content";

export function ActiveDmChat(props: {
  session: SessionSnapshot;
  peerName: string;
  ready: boolean;
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
  return (
    <>
      <header className="chat-header">
        <Avatar name={props.peerName} />
        <div className="chat-title-block">
          <h1 id="chat-title">{props.peerName}</h1>
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
              !props.callSupported ||
              props.callBusy ||
              props.busy ||
              !props.ready
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

      <ConversationTools tools={props.tools} />

      <ChatDropZone disabled={!props.ready || props.busy} onAttach={props.attachments.onSend}>
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
        disabled={!props.ready || props.busy}
        sending={props.busy}
      />
    </>
  );
}

export function ActiveChannelChat(props: {
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

export function ActiveGroupChat(props: {
  group: GroupSnapshot;
  ready: boolean;
  composer: string;
  busy: boolean;
  attachments: AttachmentApi;
  tools: ConversationToolsState;
  peer: PeerActions;
  onComposer: (value: string) => void;
  onSend: (event: FormEvent) => void;
  onClose: () => void;
}) {
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
            {`${props.group.member_count} member${
              props.group.member_count === 1 ? "" : "s"
            } · MLS ${props.group.state}`}
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

      <ChatDropZone disabled={!props.ready || props.busy} onAttach={props.attachments.onSend}>
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
        disabled={!props.ready || props.busy}
        sending={props.busy}
      />
    </>
  );
}

export function EmptyState({ onNew }: { onNew: () => void }) {
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
