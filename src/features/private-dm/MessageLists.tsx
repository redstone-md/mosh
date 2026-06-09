import { IconLock, IconLockOpen, IconMessageCircle } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { AttachmentCard } from "./attachments";
import { Avatar } from "./Avatar";
import {
  filterMessages,
  SearchEmpty,
  type ConversationToolsState,
} from "./ConversationTools";
import { shorten } from "./format";
import type {
  AttachmentDescriptor,
  AttachmentView,
  ChannelMessage,
  ChatMessage,
  GroupMessage,
} from "./native/native-messaging-gateway";
import { channelText, chatText, groupText } from "./private-dm.content";
import { CallLogEntry } from "./voice-call/CallLogEntry";

interface MessageAttachmentApi {
  readonly views: ReadonlyMap<string, AttachmentView>;
  readonly busy: boolean;
  readonly onDownload: (attachmentId: string) => void;
  readonly onCancel: (attachmentId: string) => void;
  readonly onOpen: (descriptor: AttachmentDescriptor) => void;
}

export interface PeerActions {
  readonly ownFingerprint: string;
  readonly offered: ReadonlySet<string>;
  readonly busy: boolean;
  readonly onMessage: (fingerprint: string) => void;
}

export function GroupChatList({
  messages,
  attachments,
  tools,
  peer,
}: {
  messages: readonly GroupMessage[];
  attachments: MessageAttachmentApi;
  tools: ConversationToolsState;
  peer: PeerActions;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const visibleMessages = filterMessages(messages, tools.search, tools.filter);

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
  if (visibleMessages.length === 0) {
    return <SearchEmpty filter={tools.filter} />;
  }
  return (
    <div className="message-stack">
      {visibleMessages.map((message, index) => (
        <GroupMessageRow
          message={message}
          attachments={attachments}
          peer={peer}
          key={`${message.from_fingerprint}-${index}`}
        />
      ))}
      <div ref={anchorRef} aria-hidden="true" />
    </div>
  );
}

export function DmChatList({
  messages,
  attachments,
  tools,
}: {
  messages: readonly ChatMessage[];
  attachments: MessageAttachmentApi;
  tools: ConversationToolsState;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const visibleMessages = filterMessages(messages, tools.search, tools.filter);

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
  if (visibleMessages.length === 0) {
    return <SearchEmpty filter={tools.filter} />;
  }
  return (
    <div className="message-stack">
      {visibleMessages.map((message, index) => (
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

export function ChannelChatList({
  messages,
  attachments,
  tools,
  peer,
}: {
  messages: readonly ChannelMessage[];
  attachments: MessageAttachmentApi;
  tools: ConversationToolsState;
  peer: PeerActions;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const visibleMessages = filterMessages(messages, tools.search, tools.filter);

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
  if (visibleMessages.length === 0) {
    return <SearchEmpty filter={tools.filter} />;
  }
  return (
    <div className="message-stack">
      {visibleMessages.map((message, index) => (
        <ChannelMessageRow
          message={message}
          attachments={attachments}
          peer={peer}
          key={`${message.from_fingerprint}-${index}`}
        />
      ))}
      <div ref={anchorRef} aria-hidden="true" />
    </div>
  );
}

/** A channel/group sender's name; clicking a peer's name offers a DM. */
function PeerNickname({
  name,
  fingerprint,
  peer,
}: {
  name: string;
  fingerprint: string;
  peer: PeerActions;
}) {
  const [open, setOpen] = useState(false);
  if (fingerprint === peer.ownFingerprint) {
    return <strong>{name}</strong>;
  }
  const alreadyOffered = peer.offered.has(fingerprint);
  return (
    <span className="nick-anchor">
      <button
        type="button"
        className="nick-button"
        onClick={() => setOpen((value) => !value)}
      >
        {name}
      </button>
      {open ? (
        <>
          <div
            className="nick-popover-backdrop"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          <div className="nick-popover" role="dialog" aria-label={`Actions for ${name}`}>
            <div className="nick-popover-name">{name}</div>
            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={alreadyOffered || peer.busy}
              onClick={() => {
                peer.onMessage(fingerprint);
                setOpen(false);
              }}
            >
              <IconMessageCircle size={13} />
              {alreadyOffered ? "Invite sent" : "Message"}
            </button>
          </div>
        </>
      ) : null}
    </span>
  );
}

function GroupMessageRow({
  message,
  attachments,
  peer,
}: {
  message: GroupMessage;
  attachments: MessageAttachmentApi;
  peer: PeerActions;
}) {
  return (
    <article className="message-row">
      <Avatar name={message.from_device} />
      <div className="message-body">
        <div className="message-meta">
          <PeerNickname
            name={message.from_device}
            fingerprint={message.from_fingerprint}
            peer={peer}
          />
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
            onOpen={attachments.onOpen}
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

function DmMessageRow({
  message,
  attachments,
}: {
  message: ChatMessage;
  attachments: MessageAttachmentApi;
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
            onOpen={attachments.onOpen}
          />
        ) : null}
        {message.call_event ? <CallLogEntry event={message.call_event} /> : null}
        <div className="message-seal">
          <IconLock size={10} />
          <span>OpenMLS · sealed</span>
        </div>
      </div>
    </article>
  );
}

function ChannelMessageRow({
  message,
  attachments,
  peer,
}: {
  message: ChannelMessage;
  attachments: MessageAttachmentApi;
  peer: PeerActions;
}) {
  return (
    <article className="message-row">
      <Avatar name={message.from_device} />
      <div className="message-body">
        <div className="message-meta">
          <PeerNickname
            name={message.from_device}
            fingerprint={message.from_fingerprint}
            peer={peer}
          />
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
            onOpen={attachments.onOpen}
          />
        ) : null}
      </div>
    </article>
  );
}
