import { IconMessageCircle } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { AttachmentCard } from "./AttachmentCard";
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

const GROUP_WINDOW_MS = 5 * 60 * 1000;

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

interface MessageMetadata {
  readonly message_id?: string;
  readonly sent_at_ms?: number;
  readonly delivery_status?: "pending" | "sent" | "delivered" | "failed";
  readonly delivery_error?: string | null;
  readonly retryable?: boolean;
  readonly retry_count?: number;
}

interface MessageRenderItem<T extends MessageMetadata> {
  readonly message: T;
  readonly grouped: boolean;
  readonly key: string;
}

export function GroupChatList({
  messages,
  attachments,
  onRetryMessage,
  tools,
  peer,
}: {
  messages: readonly GroupMessage[];
  attachments: MessageAttachmentApi;
  onRetryMessage: (messageId: string) => void;
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
      {messageItems(visibleMessages, (message) => message.from_fingerprint).map((item) => (
        <GroupMessageRow
          message={item.message}
          grouped={item.grouped}
          attachments={attachments}
          onRetryMessage={onRetryMessage}
          peer={peer}
          key={item.key}
        />
      ))}
      <div ref={anchorRef} aria-hidden="true" />
    </div>
  );
}

export function DmChatList({
  messages,
  attachments,
  ownDeviceName,
  onRetryMessage,
  tools,
}: {
  messages: readonly ChatMessage[];
  attachments: MessageAttachmentApi;
  ownDeviceName: string;
  onRetryMessage: (messageId: string) => void;
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
      {messageItems(visibleMessages, (message) => message.from_device).map((item) => (
        <DmMessageRow
          message={item.message}
          grouped={item.grouped}
          attachments={attachments}
          ownDeviceName={ownDeviceName}
          onRetryMessage={onRetryMessage}
          key={item.key}
        />
      ))}
      <div ref={anchorRef} aria-hidden="true" />
    </div>
  );
}

export function ChannelChatList({
  messages,
  attachments,
  onRetryMessage,
  tools,
  peer,
}: {
  messages: readonly ChannelMessage[];
  attachments: MessageAttachmentApi;
  onRetryMessage: (messageId: string) => void;
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
      {messageItems(visibleMessages, (message) => message.from_fingerprint).map((item) => (
        <ChannelMessageRow
          message={item.message}
          grouped={item.grouped}
          attachments={attachments}
          onRetryMessage={onRetryMessage}
          peer={peer}
          key={item.key}
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
  grouped,
  attachments,
  onRetryMessage,
  peer,
}: {
  message: GroupMessage;
  grouped: boolean;
  attachments: MessageAttachmentApi;
  onRetryMessage: (messageId: string) => void;
  peer: PeerActions;
}) {
  return (
    <article className={`message-row${grouped ? " message-row-grouped" : ""}`}>
      {grouped ? (
        <span className="avatar avatar-spacer" aria-hidden="true" />
      ) : (
        <Avatar name={message.from_device} />
      )}
      <div className="message-body">
        {grouped ? null : (
          <div className="message-meta">
            <PeerNickname
              name={message.from_device}
              fingerprint={message.from_fingerprint}
              peer={peer}
            />
            <code className="device-fp">{shorten(message.from_fingerprint, 6)}</code>
            <MlsBadge />
            <MessageTimestamp epoch={message.sent_at_ms} />
          </div>
        )}
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
        <FailedMessageRetry
          message={message}
          outbound={message.from_fingerprint === peer.ownFingerprint}
          onRetryMessage={onRetryMessage}
        />
      </div>
    </article>
  );
}

function DmMessageRow({
  message,
  grouped,
  attachments,
  ownDeviceName,
  onRetryMessage,
}: {
  message: ChatMessage;
  grouped: boolean;
  attachments: MessageAttachmentApi;
  ownDeviceName: string;
  onRetryMessage: (messageId: string) => void;
}) {
  return (
    <article className={`message-row${grouped ? " message-row-grouped" : ""}`}>
      {grouped ? (
        <span className="avatar avatar-spacer" aria-hidden="true" />
      ) : (
        <Avatar name={message.from_device} />
      )}
      <div className="message-body">
        {grouped ? null : (
          <div className="message-meta">
            <strong>{message.from_device}</strong>
            <MlsBadge />
            <MessageTimestamp epoch={message.sent_at_ms} />
          </div>
        )}
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
        <DeliveryTicks message={message} outbound={message.from_device === ownDeviceName} />
        <FailedMessageRetry
          message={message}
          outbound={message.from_device === ownDeviceName}
          onRetryMessage={onRetryMessage}
        />
      </div>
    </article>
  );
}

function ChannelMessageRow({
  message,
  grouped,
  attachments,
  onRetryMessage,
  peer,
}: {
  message: ChannelMessage;
  grouped: boolean;
  attachments: MessageAttachmentApi;
  onRetryMessage: (messageId: string) => void;
  peer: PeerActions;
}) {
  return (
    <article className={`message-row${grouped ? " message-row-grouped" : ""}`}>
      {grouped ? (
        <span className="avatar avatar-spacer" aria-hidden="true" />
      ) : (
        <Avatar name={message.from_device} />
      )}
      <div className="message-body">
        {grouped ? null : (
          <div className="message-meta">
            <PeerNickname
              name={message.from_device}
              fingerprint={message.from_fingerprint}
              peer={peer}
            />
            <code className="device-fp">{shorten(message.from_fingerprint, 6)}</code>
            <MessageTimestamp epoch={message.sent_at_ms} />
          </div>
        )}
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
        <FailedMessageRetry
          message={message}
          outbound={message.from_fingerprint === peer.ownFingerprint}
          onRetryMessage={onRetryMessage}
        />
      </div>
    </article>
  );
}

// One-glance delivery state for the sender's own DM messages. "sent" only
// means the frame left this device; "delivered" means the peer's runtime
// acknowledged it. Failed gets its own retry row below, so it renders nothing
// here.
function DeliveryTicks({
  message,
  outbound,
}: {
  message: MessageMetadata;
  outbound: boolean;
}) {
  if (!outbound || !message.delivery_status || message.delivery_status === "failed") {
    return null;
  }
  const label =
    message.delivery_status === "delivered"
      ? "✓✓ delivered"
      : message.delivery_status === "sent"
        ? "✓ sent"
        : "sending…";
  return (
    <small className="delivery-ticks" aria-label={`Delivery: ${label}`}>
      {label}
    </small>
  );
}

function FailedMessageRetry({
  message,
  outbound,
  onRetryMessage,
}: {
  message: MessageMetadata;
  outbound: boolean;
  onRetryMessage: (messageId: string) => void;
}) {
  if (
    !outbound ||
    message.delivery_status !== "failed" ||
    !message.retryable ||
    !message.message_id
  ) {
    return null;
  }
  return (
    <div
      className="message-meta"
      role="status"
      aria-label={message.delivery_error ? `Failed: ${message.delivery_error}` : "Failed to send"}
    >
      <span>{message.delivery_error?.trim() || "Failed to send"}</span>
      <button
        type="button"
        className="chat-error-retry"
        aria-label="Retry failed message"
        onClick={() => onRetryMessage(message.message_id!)}
      >
        Retry
      </button>
    </div>
  );
}

function messageItems<T extends MessageMetadata>(
  messages: readonly T[],
  senderKey: (message: T) => string,
): readonly MessageRenderItem<T>[] {
  return messages.map((message, index) => {
    const previous = index > 0 ? messages[index - 1] : undefined;
    const grouped = previous ? shouldGroup(previous, message, senderKey) : false;
    return {
      message,
      grouped,
      key: message.message_id ?? `${senderKey(message)}-${index}`,
    };
  });
}

function shouldGroup<T extends MessageMetadata>(
  previous: T,
  current: T,
  senderKey: (message: T) => string,
): boolean {
  if (!previous.sent_at_ms || !current.sent_at_ms) {
    return false;
  }
  return (
    senderKey(previous) === senderKey(current) &&
    current.sent_at_ms >= previous.sent_at_ms &&
    current.sent_at_ms - previous.sent_at_ms <= GROUP_WINDOW_MS
  );
}

function MessageTimestamp({ epoch }: { epoch?: number }) {
  if (!epoch) {
    return null;
  }
  const date = new Date(epoch);
  return (
    <time
      className="message-time"
      dateTime={date.toISOString()}
      title={date.toLocaleString()}
    >
      {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </time>
  );
}

function MlsBadge() {
  return (
    <code
      className="message-protocol"
      title="Message content is protected by OpenMLS"
      aria-label="OpenMLS protected"
    >
      MLS
    </code>
  );
}
