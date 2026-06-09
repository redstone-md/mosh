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
  IconTrash,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  ActiveChatHeader,
  FingerprintBadge,
} from "./ActiveChatHeader";
import { Avatar } from "./Avatar";
import { ChatDropZone, Composer } from "./ChatComposer";
import { type ConversationToolsState } from "./ConversationTools";
import { type ChatHeaderMenuAction } from "./ChatHeaderMenu";
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
  onRetryMessage: (messageId: string) => void;
  onSend: (event: FormEvent) => void;
  onConfirm: () => void;
  onClose: () => void;
  callSupported: boolean;
  callBusy: boolean;
  onStartCall: () => void;
}) {
  const menuActions: readonly ChatHeaderMenuAction[] = [
    {
      label: props.confirmed ? inviteText.confirmedButton : inviteText.confirmButton,
      icon: <IconShieldCheck size={15} />,
      disabled: props.confirmed,
      onSelect: props.onConfirm,
    },
    {
      label: "Delete chat",
      icon: <IconTrash size={15} />,
      tone: "danger",
      onSelect: props.onClose,
    },
  ];

  return (
    <>
      <ActiveChatHeader
        resetKey={props.session.session_id}
        leading={<Avatar name={props.peerName} />}
        title={props.peerName}
        subtitle={
          props.confirmed
            ? `MLS ${props.session.state} · fingerprint confirmed`
            : `MLS ${props.session.state} · fingerprint unverified`
        }
        tools={props.tools}
        beforeSearchActions={
          <span className="chat-desktop-only">
            <FingerprintBadge
              fingerprint={props.session.fingerprint}
              confirmed={props.confirmed}
              onConfirm={props.onConfirm}
            />
          </span>
        }
        afterSearchActions={
          <>
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
              className="btn btn-ghost btn-icon chat-desktop-only"
              type="button"
              onClick={props.onClose}
              aria-label={shellText.closeSession}
              title={shellText.closeSession}
            >
              <IconX size={16} />
            </button>
          </>
        }
        menuActions={menuActions}
      />

      <ChatDropZone disabled={!props.ready || props.busy} onAttach={props.attachments.onSend}>
        <DmChatList
          messages={props.session.messages}
          attachments={props.attachments}
          ownDeviceName={props.session.display_name}
          onRetryMessage={props.onRetryMessage}
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
  onRetryMessage: (messageId: string) => void;
  onSend: (event: FormEvent) => void;
  onClose: () => void;
}) {
  const menuActions: readonly ChatHeaderMenuAction[] = [
    {
      label: channelText.leaveLabel,
      icon: <IconLogout size={15} />,
      tone: "danger",
      onSelect: props.onClose,
    },
  ];

  return (
    <>
      <ActiveChatHeader
        resetKey={props.channel.name}
        leading={
          <div className="channel-icon">
            <IconHash size={18} />
          </div>
        }
        title={props.channel.name}
        subtitle={channelText.subtitle}
        tools={props.tools}
        afterSearchActions={
          <button
            className="btn btn-ghost btn-icon chat-desktop-only"
            type="button"
            onClick={props.onClose}
            aria-label={channelText.leaveLabel}
            title={channelText.leaveLabel}
          >
            <IconLogout size={16} />
          </button>
        }
        menuActions={menuActions}
        afterHeader={<PublicNotice />}
      />

      <ChatDropZone disabled={props.busy} onAttach={props.attachments.onSend}>
        <ChannelChatList
          messages={props.channel.messages}
          attachments={props.attachments}
          onRetryMessage={props.onRetryMessage}
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
  onRetryMessage: (messageId: string) => void;
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
  const menuActions: readonly ChatHeaderMenuAction[] = [
    ...(inviteUri
      ? [
          {
            label: inviteCopied ? groupText.copyInviteDone : groupText.copyInvite,
            icon: inviteCopied ? <IconCheck size={15} /> : <IconCopy size={15} />,
            onSelect: copyGroupInvite,
          },
        ]
      : []),
    {
      label: groupText.leaveLabel,
      icon: <IconLogout size={15} />,
      tone: "danger",
      onSelect: props.onClose,
    },
  ];

  return (
    <>
      <ActiveChatHeader
        resetKey={props.group.group_id}
        leading={
          <div className="group-icon">
            <IconUsers size={18} />
          </div>
        }
        title={label}
        subtitle={
          <>
            {props.group.is_admin ? `${groupText.adminBadge} · ` : ""}
            {`${props.group.member_count} member${
              props.group.member_count === 1 ? "" : "s"
            } · MLS ${props.group.state}`}
          </>
        }
        tools={props.tools}
        beforeSearchActions={
          <>
            {props.group.is_admin ? (
              <span className="admin-pill chat-desktop-only" title={groupText.adminBadge}>
                <IconCrown size={14} />
                <span>{groupText.adminBadge}</span>
              </span>
            ) : null}
            {inviteUri ? (
              <button
                className="btn btn-ghost btn-icon chat-desktop-only"
                type="button"
                onClick={copyGroupInvite}
                aria-label={inviteCopied ? groupText.copyInviteDone : groupText.copyInvite}
                title={inviteCopied ? groupText.copyInviteDone : groupText.copyInvite}
              >
                {inviteCopied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              </button>
            ) : null}
          </>
        }
        afterSearchActions={
          <button
            className="btn btn-ghost btn-icon chat-desktop-only"
            type="button"
            onClick={props.onClose}
            aria-label={groupText.leaveLabel}
            title={groupText.leaveLabel}
          >
            <IconLogout size={16} />
          </button>
        }
        menuActions={menuActions}
        afterHeader={<GroupNotice />}
      />

      <ChatDropZone disabled={!props.ready || props.busy} onAttach={props.attachments.onSend}>
        <GroupChatList
          messages={props.group.messages}
          attachments={props.attachments}
          onRetryMessage={props.onRetryMessage}
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
